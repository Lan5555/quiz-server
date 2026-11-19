import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbraceCheckout1794960000000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS game_checkout_orders (
        id uuid PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES game_accounts(id) ON DELETE RESTRICT,
        request_id uuid NOT NULL,
        gear_id text NOT NULL,
        amount_minor integer NOT NULL CHECK (amount_minor > 0),
        currency text NOT NULL CHECK (currency = 'NGN'),
        provider_mode text NOT NULL CHECK (provider_mode IN ('test', 'live')),
        provider_reference text NOT NULL UNIQUE,
        payer_email_hash text NOT NULL,
        provider_transaction_id text,
        checkout_url text,
        status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FULFILLED', 'REVIEW', 'EXPIRED')),
        review_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        fulfilled_at timestamptz,
        UNIQUE (account_id, request_id),
        UNIQUE (provider_mode, provider_transaction_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS game_checkout_active_gear_idx
        ON game_checkout_orders (account_id, gear_id) WHERE status = 'PENDING';
    `);
  }

  async down(db: QueryRunner) {
    await db.query('DROP TABLE game_checkout_orders');
  }
}
