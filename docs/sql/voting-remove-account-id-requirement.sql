-- Run once against the backend PostgreSQL database before deploying the updated code.
-- Retains legacy snapshots and ledger history. Does not mark payments paid manually.
BEGIN;
ALTER TABLE vote_purchases DROP CONSTRAINT IF EXISTS vote_purchases_flutterwave_config;
ALTER TABLE vote_purchases ADD CONSTRAINT vote_purchases_flutterwave_config
  CHECK(provider<>'flutterwave' OR provider_mode IS NOT NULL);
COMMIT;
