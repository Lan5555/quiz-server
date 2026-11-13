-- PostgreSQL: paid voting schema and Flutterwave upgrade.
-- Run this entire file in the same database/schema used by quiz-server.
-- Includes TypeORM migration history so migration:run will not repeat this work.
-- Safe to rerun when migration history is intact. Existing financial rows are retained.
-- If voting tables were created manually without migration history, this file fails
-- rather than assuming that the existing schema matches these migrations.

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('quiz-server:paid-voting-migrations', 0));

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  timestamp BIGINT NOT NULL,
  name VARCHAR NOT NULL
);

-- PaidVoting1794528000000
DO $voting_migration_1$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migrations WHERE name = 'PaidVoting1794528000000') THEN

      CREATE TABLE voting_admins (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, enabled boolean NOT NULL DEFAULT true, can_manage_votes boolean NOT NULL DEFAULT false);
      CREATE TABLE voting_admin_sessions (id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES voting_admins(id), token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz);
      CREATE TABLE voting_polls (
        id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, title varchar(150) NOT NULL, description varchar(3000) NOT NULL,
        state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PUBLISHED','CLOSED')),
        currency text NOT NULL CHECK(currency='NGN'), price bigint NOT NULL CHECK(price>0 AND price<=100000000),
        max_quantity integer NOT NULL CHECK(max_quantity BETWEEN 1 AND 100000), opens_at timestamptz NOT NULL,
        closes_at timestamptz NOT NULL CHECK(closes_at>opens_at), results_visible boolean NOT NULL,
        creator uuid NOT NULL REFERENCES voting_admins(id), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE voting_candidates (
        id uuid PRIMARY KEY, poll_id uuid NOT NULL REFERENCES voting_polls(id), name varchar(150) NOT NULL,
        bio varchar(2000) NOT NULL, photo_url varchar(2048), active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(poll_id,id));
      CREATE INDEX voting_candidates_poll ON voting_candidates(poll_id);
      CREATE TABLE vote_purchases (
        id uuid PRIMARY KEY, poll_id uuid NOT NULL REFERENCES voting_polls(id), candidate_id uuid NOT NULL,
        quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000), price bigint NOT NULL CHECK(price>0),
        amount bigint NOT NULL CHECK(amount>0 AND amount<=100000000 AND amount=price*quantity), currency text NOT NULL CHECK(currency='NGN'),
        email varchar(254) NOT NULL, poll_title text NOT NULL, candidate_name text NOT NULL,
        idempotency_key uuid NOT NULL UNIQUE, request_hash text NOT NULL, provider_reference text NOT NULL UNIQUE,
        provider_transaction_id text UNIQUE, receipt_hash text NOT NULL, receipt_encrypted text NOT NULL,
        status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PAID','FAILED','EXPIRED','REVIEW','REFUNDED')),
        accepted_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, paid_at timestamptz,
        checkout_url text, init_started_at timestamptz, last_verified_at timestamptz, next_check_at timestamptz NOT NULL DEFAULT now(),
        last_error text, review_reason text, FOREIGN KEY(poll_id,candidate_id) REFERENCES voting_candidates(poll_id,id),
        CHECK(expires_at>accepted_at));
      CREATE INDEX vote_purchases_reconcile ON vote_purchases(next_check_at);
      CREATE TABLE vote_ledger (
        id uuid PRIMARY KEY, purchase_id uuid NOT NULL REFERENCES vote_purchases(id), entry_type text NOT NULL CHECK(entry_type IN ('CREDIT','REVERSAL')),
        delta integer NOT NULL, event_reference text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(purchase_id,entry_type), CHECK((entry_type='CREDIT' AND delta>0) OR (entry_type='REVERSAL' AND delta<0)));
      CREATE INDEX vote_ledger_purchase ON vote_ledger(purchase_id);
      CREATE TABLE payment_webhook_events (
        id text PRIMARY KEY, provider text NOT NULL CHECK(provider='paystack'), reference text, event_type text NOT NULL,
        refund_id text, processed_at timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE voting_admin_audit (id uuid PRIMARY KEY, actor uuid NOT NULL REFERENCES voting_admins(id), action text NOT NULL, entity uuid NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE voting_rate_limits (bucket text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL);
      CREATE TABLE voting_email_outbox (purchase_id uuid PRIMARY KEY REFERENCES vote_purchases(id), sent_at timestamptz, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now());
      CREATE FUNCTION voting_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Voting ledger is immutable'; END $$;
      CREATE TRIGGER voting_ledger_immutable BEFORE UPDATE OR DELETE ON vote_ledger FOR EACH ROW EXECUTE FUNCTION voting_ledger_immutable();
      CREATE FUNCTION voting_poll_locked() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.state='CLOSED' AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'Closed polls are terminal'; END IF;
        IF OLD.state<>'DRAFT' AND (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'Published poll configuration is locked'; END IF;
        IF NEW.slug<>OLD.slug THEN RAISE EXCEPTION 'Poll slug is immutable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER voting_poll_locked BEFORE UPDATE ON voting_polls FOR EACH ROW EXECUTE FUNCTION voting_poll_locked();
      CREATE FUNCTION voting_purchase_locked() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (to_jsonb(NEW)-ARRAY['provider_transaction_id','status','paid_at','checkout_url','init_started_at','last_verified_at','next_check_at','last_error','review_reason']) IS DISTINCT FROM
          (to_jsonb(OLD)-ARRAY['provider_transaction_id','status','paid_at','checkout_url','init_started_at','last_verified_at','next_check_at','last_error','review_reason']) THEN RAISE EXCEPTION 'Purchase snapshot is immutable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER voting_purchase_locked BEFORE UPDATE ON vote_purchases FOR EACH ROW EXECUTE FUNCTION voting_purchase_locked();
    INSERT INTO migrations (timestamp, name) VALUES (1794528000000, 'PaidVoting1794528000000');
  END IF;
END;
$voting_migration_1$;

-- FlutterwaveVoting1794614400000
DO $voting_migration_2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migrations WHERE name = 'FlutterwaveVoting1794614400000') THEN

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
    INSERT INTO migrations (timestamp, name) VALUES (1794614400000, 'FlutterwaveVoting1794614400000');
  END IF;
END;
$voting_migration_2$;

-- VotingImages1794700800000
DO $voting_images_migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migrations WHERE name='VotingImages1794700800000') THEN

      CREATE TABLE voting_images (
        id uuid PRIMARY KEY, public_id text NOT NULL UNIQUE,
        purpose text NOT NULL CHECK(purpose IN ('POLL','CANDIDATE')),
        uploaded_by uuid NOT NULL REFERENCES voting_admins(id),
        state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY','FAILED')),
        url varchar(2048) UNIQUE, width integer, height integer, bytes integer, format text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK(state<>'READY' OR (url IS NOT NULL AND width IS NOT NULL AND width BETWEEN 1 AND 2000 AND height IS NOT NULL AND height BETWEEN 1 AND 2000 AND bytes IS NOT NULL AND bytes BETWEEN 1 AND 5242880 AND format IS NOT NULL AND format IN ('jpg','jpeg','png','webp')))
      );
      CREATE INDEX voting_images_owner ON voting_images(uploaded_by,purpose,state);
      ALTER TABLE voting_polls ADD COLUMN image_id uuid REFERENCES voting_images(id);
      ALTER TABLE voting_polls ADD COLUMN image_url varchar(2048);
      ALTER TABLE voting_polls ADD CONSTRAINT voting_poll_image_pair CHECK((image_id IS NULL)=(image_url IS NULL));
      ALTER TABLE voting_candidates ADD COLUMN photo_image_id uuid REFERENCES voting_images(id);
    
    INSERT INTO migrations(timestamp,name) VALUES(1794700800000,'VotingImages1794700800000');
  END IF;
END;
$voting_images_migration$;

DO $key_scoped_voting_migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM migrations WHERE name='FlutterwaveKeyScopedVoting1794787200000') THEN
    ALTER TABLE vote_purchases DROP CONSTRAINT IF EXISTS vote_purchases_flutterwave_config;
    ALTER TABLE vote_purchases ADD CONSTRAINT vote_purchases_flutterwave_config
      CHECK(provider<>'flutterwave' OR provider_mode IS NOT NULL);
    INSERT INTO migrations(timestamp,name) VALUES(1794787200000,'FlutterwaveKeyScopedVoting1794787200000');
  END IF;
END;
$key_scoped_voting_migration$;

COMMIT;

SELECT timestamp, name FROM migrations
WHERE name IN ('PaidVoting1794528000000', 'FlutterwaveVoting1794614400000', 'VotingImages1794700800000', 'FlutterwaveKeyScopedVoting1794787200000')
ORDER BY timestamp;
