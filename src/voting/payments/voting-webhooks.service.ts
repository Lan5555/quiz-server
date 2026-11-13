import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fail, hash } from '../common/voting';
import {
  FlutterwaveService,
  flutterwaveFailureCode,
} from './flutterwave.service';
import { VoteAccountingService } from './vote-accounting.service';
@Injectable()
export class VotingWebhooksService {
  private readonly logger = new Logger(VotingWebhooksService.name);
  constructor(
    private readonly db: DataSource,
    private readonly provider: FlutterwaveService,
    private readonly accounting: VoteAccountingService,
  ) {}
  async accept(raw: Buffer | undefined, signature: string | undefined) {
    this.provider.signature(raw, signature);
    let event: {
      event?: unknown;
      TransactionId?: unknown;
      id?: unknown;
      data?: {
        tx_ref?: unknown;
        TransactionId?: unknown;
        transaction_id?: unknown;
        id?: unknown;
        transaction?: { reference?: unknown };
      };
    } | null;
    try {
      event = JSON.parse(
        raw!
          .toString('utf8')
          .replace(
            /("(?:id|TransactionId|transaction_id)"\s*:\s*)(\d{16,})/g,
            '$1"$2"',
          ),
      ) as typeof event;
    } catch {
      fail(400, 'Invalid webhook body');
    }
    if (event && event.event == null && event.TransactionId != null)
      event.event = 'refund.updated';
    if (!event || typeof event.event !== 'string' || event.event.length > 120)
      fail(400, 'Invalid webhook event');
    let reference = event.data?.tx_ref;
    const transactionId =
      event.TransactionId ??
      event.data?.TransactionId ??
      event.data?.transaction_id;
    if (reference == null && transactionId != null) {
      if (
        typeof transactionId !== 'string' &&
        typeof transactionId !== 'number'
      )
        fail(400, 'Invalid webhook transaction identifier');
      const verified = await this.provider.verifyId(String(transactionId));
      reference = verified.reference;
    }
    // Persist only routing information. No raw payload, payer, token or provider secret is retained.
    const routed =
      typeof reference === 'string' && /^vote-[a-f0-9-]{36}$/.test(reference)
        ? reference
        : null;
    const refundId =
      event.event === 'refund.processed' &&
      /^[0-9]+$/.test(String(event.data?.id))
        ? String(event.data?.id)
        : null;
    const eventId = hash(raw!.toString('utf8'));
    await this.db.query(
      `INSERT INTO payment_webhook_events(id,provider,reference,event_type,refund_id) VALUES($1,'flutterwave',$2,$3,$4) ON CONFLICT DO NOTHING`,
      [eventId, routed, event.event, refundId],
    );
    // V3 payment webhooks include the transaction ID. Verify it server-side rather
    // than relying on reference lookup availability in the sandbox.
    if (
      routed &&
      event.event === 'charge.completed' &&
      event.data?.id != null
    ) {
      const hint = event.data.id;
      if (
        (typeof hint !== 'string' && typeof hint !== 'number') ||
        !/^[1-9][0-9]*$/.test(String(hint)) ||
        (typeof hint === 'number' && !Number.isSafeInteger(hint))
      )
        fail(400, 'Invalid webhook transaction identifier');
      const [record] = await this.db.query<{ processed_at: Date | null }[]>(
        `SELECT processed_at FROM payment_webhook_events WHERE id=$1`,
        [eventId],
      );
      const [purchase] = await this.db.query<{ id: string; status: string }[]>(
        `SELECT id,status FROM vote_purchases WHERE provider='flutterwave' AND provider_reference=$1`,
        [routed],
      );
      if (!purchase) return;
      if (record?.processed_at && purchase.status !== 'REVIEW') return;
      this.logger.log(
        `Payment webhook received: purchaseId=${purchase.id}; event=charge.completed`,
      );
      try {
        const verified = await this.provider.verifyId(String(hint));
        if (String(verified.id) !== String(hint))
          fail(503, 'Provider transaction ID mismatch');
        await this.accounting.confirm(purchase.id, false, 'WEBHOOK', verified);
        await this.db.query(
          `UPDATE payment_webhook_events SET processed_at=now() WHERE id=$1`,
          [eventId],
        );
      } catch (error) {
        this.logger.warn(
          `Payment webhook verification failed: purchaseId=${purchase.id}; reason=${flutterwaveFailureCode(error)}`,
        );
        throw error; // Keep the durable event and let Flutterwave retry too.
      }
    }
  }
}
