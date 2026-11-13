import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import {
  FlutterwaveService,
  ProviderTransaction,
  flutterwaveFailureCode,
} from './flutterwave.service';
import { VotingConfig } from '../common/voting';
import type { PurchaseRecord } from '../purchases/purchase.record';
export type VerificationSource =
  | 'RECEIPT'
  | 'RECONCILIATION'
  | 'WEBHOOK'
  | 'CHECKOUT_RETRY';

function paymentIdentityReasons(
  p: PurchaseRecord,
  t: ProviderTransaction,
  mode: string,
) {
  const reasons: string[] = [];
  if (t.reference !== p.provider_reference) reasons.push('REFERENCE_MISMATCH');
  if (t.amount !== Number(p.amount)) reasons.push('AMOUNT_MISMATCH');
  if (t.currency !== 'NGN') reasons.push('CURRENCY_MISMATCH');
  if (t.domain !== (p.provider_mode || mode)) reasons.push('MODE_MISMATCH');
  if (!/^[0-9]+$/.test(String(t.id))) reasons.push('TRANSACTION_ID_INVALID');
  return reasons;
}
export function paymentReviewReasons(
  p: PurchaseRecord,
  t: ProviderTransaction,
  active: boolean,
  mode: string,
) {
  const reasons = paymentIdentityReasons(p, t, mode);
  if (t.status !== 'success') return reasons;
  if (!active) reasons.push('CANDIDATE_DISABLED');
  return reasons;
}

export function automaticPaymentReview(
  p: Pick<PurchaseRecord, 'review_reason'>,
) {
  const automatic = new Set([
    'PAYMENT_EVIDENCE_MISMATCH',
    'REFERENCE_MISMATCH',
    'AMOUNT_MISMATCH',
    'CURRENCY_MISMATCH',
    'MODE_MISMATCH',
    'ACCOUNT_MISMATCH',
    'TRANSACTION_ID_INVALID',
    'INVALID_PAYMENT_TIMESTAMP',
    'INVALID_TRANSACTION_TIMESTAMP',
    'TRANSACTION_BEFORE_PURCHASE',
    'PAYMENT_PRECEDES_TRANSACTION',
    'PAYMENT_BEFORE_PURCHASE',
    'PAYMENT_AFTER_CHECKOUT_EXPIRY',
    'PAYMENT_TIME_IN_FUTURE',
  ]);
  const reasons = (p.review_reason || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return reasons.length > 0 && reasons.every((reason) => automatic.has(reason));
}

export function paymentDecision(
  p: PurchaseRecord,
  t: ProviderTransaction,
  active: boolean,
  mode: string,
  now = Date.now(),
) {
  if (paymentReviewReasons(p, t, active, mode).length) return 'REVIEW';
  if (t.status === 'reversed') return 'REVERSED';
  if (t.status !== 'success') {
    if (t.status === 'failed') return 'FAILED';
    if (t.status === 'abandoned' && now > new Date(p.expires_at).getTime())
      return 'EXPIRED';
    return 'PENDING';
  }
  return 'CREDIT';
}
@Injectable()
export class VoteAccountingService {
  private readonly logger = new Logger(VoteAccountingService.name);
  constructor(
    private readonly db: DataSource,
    private readonly provider: FlutterwaveService,
    private readonly config: VotingConfig,
  ) {}
  async verify(
    id: string,
    force = false,
    source: VerificationSource = 'RECEIPT',
  ) {
    // A committed lease avoids duplicate provider calls across receipt reads and worker instances.
    const claimed = await this.db.transaction(async (m) =>
      m.query<PurchaseRecord[]>(
        `WITH claimed AS (UPDATE vote_purchases SET last_verified_at=now(), next_check_at=now()+CASE WHEN status IN ('PAID','REFUNDED') THEN interval '1 day' ELSE interval '5 minutes' END
      WHERE id=$1 AND provider='flutterwave' AND ($2 OR last_verified_at IS NULL OR last_verified_at<now()-interval '15 seconds') RETURNING *) SELECT * FROM claimed`,
        [id, force],
      ),
    );
    const p = claimed[0];
    if (!p) return;
    try {
      await this.confirm(id, false, source);
    } catch {
      await this.db.query(
        `UPDATE vote_purchases SET last_error=CASE WHEN last_error LIKE 'INITIALIZATION_%' THEN last_error ELSE 'PROVIDER_UNAVAILABLE' END WHERE id=$1`,
        [id],
      );
      return; // No inference of failure/expiry from a timeout or missing provider record.
    }
  }
  async confirm(
    id: string,
    refundEvent = false,
    source: VerificationSource = 'RECEIPT',
    verifiedTransaction?: ProviderTransaction,
  ) {
    const [p] = await this.db.query<PurchaseRecord[]>(
      `SELECT * FROM vote_purchases WHERE id=$1`,
      [id],
    );
    if (!p) return;
    if (p.provider !== 'flutterwave') return;
    let t: ProviderTransaction;
    try {
      t =
        verifiedTransaction ??
        (p.provider_transaction_id
          ? await this.provider.verifyId(p.provider_transaction_id)
          : await this.provider.verify(p.provider_reference));
    } catch (error) {
      this.logger.warn(
        `Payment verification failed: purchaseId=${id}; source=${source}; reason=${flutterwaveFailureCode(error)}`,
      );
      throw error;
    }
    if (
      t.reference !== p.provider_reference ||
      t.amount !== Number(p.amount) ||
      t.currency !== 'NGN' ||
      t.domain !== p.provider_mode
    ) {
      await this.apply(id, t);
      this.logger.warn(
        `Payment evidence mismatch: purchaseId=${id}; source=${source}; status=REVIEW`,
      );
      return 'review';
    }
    let fullReversal = false;
    if (
      t.status === 'reversed' ||
      refundEvent ||
      (source === 'RECONCILIATION' &&
        (p.status === 'PAID' ||
          (p.status === 'REVIEW' && !automaticPaymentReview(p))))
    ) {
      const state = await this.provider.refundState(t);
      fullReversal = state === 'FULL';
      if (state !== 'NONE' || refundEvent || t.status === 'reversed')
        t.status = 'reversed';
    }
    await this.apply(id, t, fullReversal);
    const [result] = await this.db.query<
      { status: string; credited: string }[]
    >(
      `SELECT status,COALESCE((SELECT sum(delta) FROM vote_ledger WHERE purchase_id=p.id),0) AS credited FROM vote_purchases p WHERE id=$1`,
      [id],
    );
    if (result)
      this.logger.log(
        `Payment verification result: purchaseId=${id}; source=${source}; status=${result.status}; creditedVotes=${Number(result.credited)}`,
      );
    return t.status;
  }
  async apply(id: string, t: ProviderTransaction, fullReversal = false) {
    await this.db.transaction(async (m) => {
      const [p] = await m.query<(PurchaseRecord & { active: boolean })[]>(
        `SELECT p.*,c.active FROM vote_purchases p JOIN voting_candidates c ON c.id=p.candidate_id WHERE p.id=$1 AND p.provider='flutterwave' FOR UPDATE OF p`,
        [id],
      );
      if (!p) return;
      const decision = paymentDecision(
        p,
        t,
        p.active,
        this.config.required('VOTING_PROVIDER_MODE'),
      );
      if (decision === 'REVIEW' || (decision === 'REVERSED' && !fullReversal)) {
        const reasons = paymentReviewReasons(
          p,
          t,
          p.active,
          this.config.required('VOTING_PROVIDER_MODE'),
        );
        if (decision === 'REVERSED' && !fullReversal)
          reasons.push('REVERSAL_EVIDENCE_REQUIRED');
        if (p.status === 'REVIEW' && !automaticPaymentReview(p))
          reasons.push(p.review_reason || 'MANUAL_REVIEW');
        if (p.status !== 'REFUNDED') {
          if (
            !paymentIdentityReasons(
              p,
              t,
              this.config.required('VOTING_PROVIDER_MODE'),
            ).length &&
            !(await this.claimTransaction(m, p, t))
          )
            reasons.push('TRANSACTION_ALREADY_CLAIMED');
          await m.query(
            `UPDATE vote_purchases SET status='REVIEW',review_reason=$2,last_error=NULL WHERE id=$1`,
            [id, reasons.join(',') || 'PAYMENT_EVIDENCE_MISMATCH'],
          );
          this.logger.warn(
            `Payment requires review: purchaseId=${id}; reasons=${reasons.join(',') || 'PAYMENT_EVIDENCE_MISMATCH'}`,
          );
        }
        return;
      }
      if (p.status === 'REFUNDED') return;
      if (
        decision === 'CREDIT' &&
        p.status === 'REVIEW' &&
        !automaticPaymentReview(p)
      )
        return;
      if (!(await this.claimTransaction(m, p, t))) {
        await m.query(
          `UPDATE vote_purchases SET status='REVIEW',review_reason='TRANSACTION_ALREADY_CLAIMED' WHERE id=$1`,
          [id],
        );
        return;
      }
      if (decision === 'REVERSED') {
        const [credit] = await m.query<{ delta: number }[]>(
          `SELECT delta FROM vote_ledger WHERE purchase_id=$1 AND entry_type='CREDIT'`,
          [id],
        );
        if (credit)
          await m.query(
            `INSERT INTO vote_ledger(id,purchase_id,entry_type,delta,event_reference) VALUES($1,$2,'REVERSAL',$3,$4) ON CONFLICT(purchase_id,entry_type) DO NOTHING`,
            [randomUUID(), id, -credit.delta, `flutterwave-reversal-${t.id}`],
          );
        await m.query(
          `UPDATE vote_purchases SET status='REFUNDED' WHERE id=$1`,
          [id],
        );
        return;
      }
      if (decision === 'CREDIT') {
        const [reversed] = await m.query<{ id: string }[]>(
          `SELECT id FROM vote_ledger WHERE purchase_id=$1 AND entry_type='REVERSAL'`,
          [id],
        );
        if (reversed) {
          await m.query(
            `UPDATE vote_purchases SET status='REFUNDED' WHERE id=$1`,
            [id],
          );
          return;
        }
        await m.query(
          `INSERT INTO vote_ledger(id,purchase_id,entry_type,delta,event_reference) VALUES($1,$2,'CREDIT',$3,$4) ON CONFLICT(purchase_id,entry_type) DO NOTHING`,
          [randomUUID(), id, p.quantity, `flutterwave-credit-${t.id}`],
        );
        await m.query(
          `UPDATE vote_purchases SET status='PAID',paid_at=$2,review_reason=NULL,last_error=NULL WHERE id=$1`,
          [
            id,
            t.paid_at && Number.isFinite(Date.parse(t.paid_at))
              ? t.paid_at
              : null,
          ],
        );
        await m.query(
          `INSERT INTO voting_email_outbox(purchase_id) VALUES($1) ON CONFLICT DO NOTHING`,
          [id],
        );
      } else if (p.status !== 'PAID' && p.status !== 'REVIEW') {
        await m.query(`UPDATE vote_purchases SET status=$2 WHERE id=$1`, [
          id,
          decision,
        ]);
      }
    });
  }
  private async claimTransaction(
    m: EntityManager,
    p: PurchaseRecord,
    t: ProviderTransaction,
  ) {
    await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `flutterwave:${t.id}`,
    ]);
    const [other] = await m.query<{ id: string }[]>(
      `SELECT id FROM vote_purchases WHERE provider='flutterwave' AND provider_transaction_id=$1 AND id<>$2`,
      [String(t.id), p.id],
    );
    if (
      other ||
      (p.provider_transaction_id && p.provider_transaction_id !== String(t.id))
    )
      return false;
    await m.query(
      `UPDATE vote_purchases SET provider_transaction_id=$2,last_error=NULL WHERE id=$1`,
      [p.id, String(t.id)],
    );
    return true;
  }
}
