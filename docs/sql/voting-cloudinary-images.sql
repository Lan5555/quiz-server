-- PostgreSQL: run after the base paid-voting migrations.
-- Adds image uploads, poll covers and candidate upload references. Safe to rerun.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('quiz-server:paid-voting-migrations',0));
CREATE TABLE IF NOT EXISTS migrations(id SERIAL PRIMARY KEY,timestamp BIGINT NOT NULL,name VARCHAR NOT NULL);
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

COMMIT;
