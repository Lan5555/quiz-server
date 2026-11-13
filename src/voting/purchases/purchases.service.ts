import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { PurchaseDto } from '../common/voting.dto';
import { equal, fail, hash, VotingConfig } from '../common/voting';
import { pollStatus } from '../polls/polls.service';
import { FlutterwaveService } from '../payments/flutterwave.service';
import { checkoutFailureCode } from './checkout-diagnostics';
import { VoteAccountingService } from '../payments/vote-accounting.service';
import { ReceiptTokenService } from './receipt-token.service';
import type { PurchaseRecord } from './purchase.record';
import type { PollRecord } from '../polls/poll.record';
import type { CandidateRecord } from '../candidates/candidate.record';

export function requestHash(body: PurchaseDto) {
  return hash(
    JSON.stringify([body.pollId, body.candidateId, body.quantity, body.email]),
  );
}
@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);
  constructor(
    private readonly db: DataSource,
    private readonly config: VotingConfig,
    private readonly tokens: ReceiptTokenService,
    private readonly provider: FlutterwaveService,
    private readonly accounting: VoteAccountingService,
  ) {}
  async start(key: string, body: PurchaseDto) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        key || '',
      )
    )
      fail(400, 'A UUID Idempotency-Key is required');
    const digest = requestHash(body);
    const p = await this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        key.toLowerCase(),
      ]);
      const [existing] = await m.query<PurchaseRecord[]>(
        `SELECT * FROM vote_purchases WHERE idempotency_key=$1`,
        [key],
      );
      if (existing) {
        if (existing.provider !== 'flutterwave')
          fail(
            409,
            'This purchase belongs to the previous payment provider. Contact support.',
          );
        if (!equal(existing.request_hash, digest))
          fail(
            409,
            'Idempotency key was already used with different purchase details',
          );
        return existing;
      }
      this.config.enabled();
      const reject = (status: number, message: string): never =>
        fail(status, message, 'PURCHASE_NOT_CREATED');
      const [poll] = await m.query<PollRecord[]>(
        `SELECT * FROM voting_polls WHERE id=$1 FOR UPDATE`,
        [body.pollId],
      );
      if (!poll || poll.state === 'DRAFT') reject(404, 'Poll unavailable');
      const [clock] = await m.query<{ now: Date }[]>(
        `SELECT clock_timestamp() AS now`,
      );
      const status = pollStatus(poll, new Date(clock.now).getTime());
      if (status !== 'OPEN')
        reject(
          409,
          status === 'CLOSED'
            ? 'This poll is closed'
            : 'This poll has not opened yet',
        );
      const [candidate] = await m.query<CandidateRecord[]>(
        `SELECT * FROM voting_candidates WHERE id=$1 AND poll_id=$2`,
        [body.candidateId, body.pollId],
      );
      if (!candidate) reject(404, 'Candidate unavailable for this poll');
      if (!candidate.active) reject(409, 'This candidate is disabled');
      if (body.quantity > poll.max_quantity)
        reject(400, 'Quantity exceeds this poll purchase limit');
      const amount = Number(poll.price) * body.quantity;
      if (
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > this.config.maximum()
      )
        reject(400, 'Purchase amount exceeds the operational limit');
      const id = randomUUID();
      const receipt = this.tokens.create(id);
      const [purchase] = await m.query<PurchaseRecord[]>(
        `INSERT INTO vote_purchases(id,poll_id,candidate_id,quantity,price,amount,currency,email,poll_title,candidate_name,idempotency_key,request_hash,provider_reference,receipt_hash,receipt_encrypted,accepted_at,expires_at,provider,provider_account_id,provider_mode)
        VALUES($1,$2,$3,$4,$5,$6,'NGN',$7,$8,$9,$10,$11,$12,$13,$14,clock_timestamp(),clock_timestamp()+$15*interval '1 second','flutterwave',$16,$17) RETURNING *`,
        [
          id,
          poll.id,
          candidate.id,
          body.quantity,
          poll.price,
          amount,
          body.email,
          poll.title,
          candidate.name,
          key,
          digest,
          `vote-${id}`,
          hash(receipt.token),
          receipt.encrypted,
          this.config.checkoutSeconds(),
          null, // Legacy account snapshot; merchant access is authorized by the server API key.
          this.config.required('VOTING_PROVIDER_MODE'),
        ],
      );
      return purchase;
    });
    if (p.checkout_url) return this.checkout(p);
    // Local configuration must pass before committing the "sent to provider" marker.
    if (!p.init_started_at) {
      this.provider.assertCanInitialize(p);
      try {
        this.tokens.decrypt(p.id, p.receipt_encrypted);
      } catch (error) {
        this.logger.error(
          `Checkout preflight failed: purchaseId=${p.id}; stage=RECEIPT_PREFLIGHT; reason=${checkoutFailureCode(error)}`,
        );
        throw error;
      }
    }
    // Persist this marker BEFORE the network request. A crash/timeout can never silently issue a second initialization.
    const claims = await this.db.transaction((m) =>
      m.query<PurchaseRecord[]>(
        `WITH claimed AS (UPDATE vote_purchases SET init_started_at=now() WHERE id=$1 AND init_started_at IS NULL RETURNING *) SELECT * FROM claimed`,
        [p.id],
      ),
    );
    if (!claims.length) {
      await this.accounting.verify(p.id, false, 'CHECKOUT_RETRY');
      const [fresh] = await this.db.query<PurchaseRecord[]>(
        `SELECT * FROM vote_purchases WHERE id=$1`,
        [p.id],
      );
      if (fresh.checkout_url) return this.checkout(fresh);
      const reason = /^[A-Z0-9_]{1,100}$/.test(fresh.last_error || '')
        ? fresh.last_error
        : 'INITIALIZATION_STATE_UNKNOWN';
      this.logger.warn(
        `Checkout recovery required: purchaseId=${p.id}; reason=${reason}`,
      );
      fail(
        503,
        'Checkout initialization is pending reconciliation. Keep this attempt and retry; contact support if it persists.',
      );
    }
    let stage = 'PROVIDER_INITIALIZATION';
    try {
      const url = await this.provider.initialize(p);
      stage = 'SAVE_CHECKOUT_URL';
      await this.db.query(
        `UPDATE vote_purchases SET checkout_url=$2,last_error=NULL WHERE id=$1`,
        [p.id, url],
      );
      stage = 'BUILD_CHECKOUT_RESPONSE';
      return this.checkout({ ...p, checkout_url: url });
    } catch (error) {
      const diagnostic = checkoutFailureCode(error);
      this.logger.error(
        `Checkout initialization failed: purchaseId=${p.id}; stage=${stage}; reason=${diagnostic}`,
      );
      try {
        await this.db.query(
          `UPDATE vote_purchases SET last_error=$2 WHERE id=$1`,
          [p.id, `INITIALIZATION_${diagnostic}`],
        );
      } catch (recordingError) {
        this.logger.error(
          `Checkout diagnostic could not be persisted: purchaseId=${p.id}; reason=${checkoutFailureCode(recordingError)}`,
        );
      }
      fail(
        503,
        'Payment initialization is uncertain. Keep this attempt and retry.',
      );
    }
  }
  private checkout(p: PurchaseRecord) {
    try {
      return {
        purchaseId: p.id,
        receiptToken: this.tokens.decrypt(p.id, p.receipt_encrypted),
        checkoutUrl: this.provider.checkoutUrl(p.checkout_url),
        amountMinor: Number(p.amount),
        currency: 'NGN',
        quantity: p.quantity,
      };
    } catch (error) {
      this.logger.error(
        `Checkout response failed: purchaseId=${p.id}; stage=BUILD_CHECKOUT_RESPONSE; reason=${checkoutFailureCode(error)}`,
      );
      throw error;
    }
  }
  async receipt(id: string, token: string) {
    const [p] = await this.db.query<{ receipt_hash: string }[]>(
      `SELECT receipt_hash FROM vote_purchases WHERE id=$1`,
      [id],
    );
    const valid = equal(
      hash(token || ''),
      p?.receipt_hash || hash('unavailable'),
    );
    if (!p || !token || token.length > 200 || !valid)
      fail(
        404,
        'Receipt unavailable. Use the original browser session or contact support.',
      );
    await this.accounting.verify(id);
    const [receipt] = await this.db.query<
      (PurchaseRecord & { credited: string })[]
    >(
      `SELECT p.*,COALESCE((SELECT sum(delta) FROM vote_ledger WHERE purchase_id=p.id),0) AS credited FROM vote_purchases p WHERE id=$1`,
      [id],
    );
    return {
      purchaseId: receipt.id,
      status: receipt.status,
      candidateName: receipt.candidate_name,
      pollTitle: receipt.poll_title,
      quantity: receipt.quantity,
      amountMinor: Number(receipt.amount),
      currency: 'NGN',
      creditedVotes: Number(receipt.credited),
    };
  }
}
