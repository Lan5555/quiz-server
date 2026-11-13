import { MigrationInterface, QueryRunner } from 'typeorm';
export class FlutterwaveVoting1794614400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE vote_purchases ADD COLUMN provider text NOT NULL DEFAULT 'paystack' CHECK(provider IN ('paystack','flutterwave'));
      ALTER TABLE vote_purchases ALTER COLUMN provider SET DEFAULT 'flutterwave';
      ALTER TABLE vote_purchases ADD COLUMN provider_account_id text;
      ALTER TABLE vote_purchases ADD COLUMN provider_mode text CHECK(provider_mode IN ('test','live'));
      ALTER TABLE vote_purchases ADD CONSTRAINT vote_purchases_flutterwave_config CHECK(provider<>'flutterwave' OR (provider_account_id IS NOT NULL AND provider_account_id ~ '^[1-9][0-9]*$' AND provider_mode IS NOT NULL));
      ALTER TABLE vote_purchases DROP CONSTRAINT vote_purchases_provider_transaction_id_key;
      ALTER TABLE vote_purchases ADD CONSTRAINT vote_purchases_provider_transaction_unique UNIQUE(provider,provider_transaction_id);
      ALTER TABLE payment_webhook_events DROP CONSTRAINT payment_webhook_events_provider_check;
      ALTER TABLE payment_webhook_events ADD CONSTRAINT payment_webhook_events_provider_check CHECK(provider IN ('paystack','flutterwave'));
      CREATE INDEX vote_purchases_provider_reconcile ON vote_purchases(provider,next_check_at);
    `);
  }
  down(): Promise<void> {
    throw new Error(
      'Financial provider history must be retained; use an audited forward migration.',
    );
  }
}
