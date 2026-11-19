-- Upgrade an existing Embrace installation to support owned fighters.
-- The full embrace-game.sql already includes this column for fresh installations.
BEGIN;

ALTER TABLE game_accounts
  ADD COLUMN IF NOT EXISTS fighter_ids jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(fighter_ids) = 'array');

COMMIT;
