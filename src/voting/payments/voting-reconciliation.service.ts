import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, QueryFailedError } from 'typeorm';
import axios from 'axios';
import { VoteAccountingService } from './vote-accounting.service';
import { VotingConfig } from '../common/voting';
import type { PurchaseRecord } from '../purchases/purchase.record';
interface WebhookRecord {
  id: string;
  reference: string | null;
  event_type: string;
  refund_id: string | null;
}
@Injectable()
export class VotingReconciliationService {
  private readonly logger = new Logger(VotingReconciliationService.name);
  private running = false;
  constructor(
    private readonly db: DataSource,
    private readonly accounting: VoteAccountingService,
    private readonly config: VotingConfig,
  ) {}
  @Cron('*/30 * * * * *')
  async tick() {
    if (
      this.running ||
      (this.config.get('VOTING_PAYMENTS_ENABLED') !== 'true' &&
        this.config.get('VOTING_RECONCILIATION_ENABLED') !== 'true')
    )
      return;
    this.running = true;
    try {
      // Advance leases within a transaction, so multiple workers share the queue.
      const events = await this.db.transaction((m) =>
        m.query<
          WebhookRecord[]
        >(`WITH claimed AS (UPDATE payment_webhook_events SET attempts=attempts+1,next_attempt_at=now()+interval '2 minutes'
        WHERE id IN (SELECT id FROM payment_webhook_events WHERE provider='flutterwave' AND processed_at IS NULL AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING *) SELECT * FROM claimed`),
      );
      for (const e of events) {
        try {
          const [p] = e.reference
            ? await this.db.query<PurchaseRecord[]>(
                `SELECT * FROM vote_purchases WHERE provider='flutterwave' AND provider_reference=$1`,
                [e.reference],
              )
            : [];
          if (p) {
            // The same verifier handles receipts, missed events, processed refunds and disputes.
            const status = await this.accounting.confirm(
              p.id,
              e.event_type.startsWith('refund.'),
              'WEBHOOK',
            );
            if (e.event_type.includes('chargeback') && status !== 'reversed')
              await this.db.query(
                `UPDATE vote_purchases SET status='REVIEW',review_reason='DISPUTE_REQUIRES_RECONCILIATION' WHERE id=$1 AND status<>'REFUNDED'`,
                [p.id],
              );
          }
          await this.db.query(
            `UPDATE payment_webhook_events SET processed_at=now() WHERE id=$1`,
            [e.id],
          );
        } catch {
          this.logger.warn('Voting webhook remains queued for reconciliation');
        }
      }
      const purchases = await this.db.transaction((m) =>
        m.query<
          { id: string }[]
        >(`WITH claimed AS (UPDATE vote_purchases SET next_check_at=now()+CASE WHEN status IN ('PAID','REFUNDED') THEN interval '1 day' ELSE interval '5 minutes' END
        WHERE id IN (SELECT id FROM vote_purchases WHERE provider='flutterwave' AND next_check_at<=now() ORDER BY next_check_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id) SELECT * FROM claimed`),
      );
      for (const p of purchases) {
        try {
          await this.accounting.verify(p.id, false, 'RECONCILIATION');
        } catch {
          this.logger.warn('Voting payment requires reconciliation');
        }
      }
      await this.deliverReceipts();
      await this.db.query(
        `DELETE FROM voting_rate_limits WHERE window_start<now()-interval '1 day'`,
      );
      await this.db.query(
        `DELETE FROM payment_webhook_events WHERE processed_at<now()-interval '90 days'`,
      );
      const [health] = await this.db.query<{ unresolved: string }[]>(
        `SELECT count(*) AS unresolved FROM vote_purchases WHERE status IN ('PENDING','REVIEW') AND accepted_at<now()-interval '1 hour'`,
      );
      if (Number(health.unresolved))
        this.logger.warn(
          `Voting unresolved purchases: ${Number(health.unresolved)}. Results remain provisional.`,
        );
    } catch {
      this.logger.error(
        'Voting reconciliation unavailable; check database, migrations and provider configuration',
      );
    } finally {
      this.running = false;
    }
  }
  private async deliverReceipts() {
    if (!this.config.get('BREVO_API_KEY') || !this.config.get('BREVO_SENDER'))
      return;
    const rows = await this.db.transaction((m) =>
      m.query<
        { purchase_id: string }[]
      >(`WITH claimed AS (UPDATE voting_email_outbox SET attempts=attempts+1,next_attempt_at=now()+interval '10 minutes'
      WHERE purchase_id IN (SELECT purchase_id FROM voting_email_outbox WHERE sent_at IS NULL AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING purchase_id) SELECT * FROM claimed`),
    );
    for (const row of rows) {
      let stage = 'load_purchase';
      try {
        const [p] = await this.db.query<PurchaseRecord[]>(
          `SELECT * FROM vote_purchases WHERE id=$1`,
          [row.purchase_id],
        );
        if (p.status !== 'PAID') continue;
        stage = 'send_to_brevo';
        await axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender: { email: this.config.get('BREVO_SENDER') },
            to: [{ email: p.email }],
            subject: 'Your verified vote receipt',
            textContent: `Payment verified. Receipt: ${p.id}\nPoll: ${p.poll_title}\nCandidate: ${p.candidate_name}\nVotes credited: ${p.quantity}\nAmount: ${p.amount} kobo (NGN).\nResults remain provisional while payments or disputes are unresolved. Keep your original browser session for receipt access. Contact the site operator for support.`,
          },
          {
            headers: { 'api-key': this.config.get('BREVO_API_KEY') },
            timeout: 12000,
            maxRedirects: 0,
          },
        );
        stage = 'mark_sent';
        await this.db.query(
          `UPDATE voting_email_outbox SET sent_at=now() WHERE purchase_id=$1`,
          [p.id],
        );
      } catch (error) {
        let reason = 'unexpected_error';
        if (axios.isAxiosError(error)) {
          reason = error.response
            ? `HTTP ${error.response.status}`
            : error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
              ? 'request_timeout'
              : 'transport_error';
        } else if (error instanceof QueryFailedError) {
          const code: unknown = error.driverError.code;
          reason =
            typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)
              ? `SQLSTATE=${code}`
              : 'database_error';
        }
      }
    }
  }
}
