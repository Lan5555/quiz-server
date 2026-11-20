-- Apply before starting the backend version with seven-day reward retention.
-- Stop all older backend instances first; they do not reject expired retries.
-- The backend removes expired guards in batches every minute after deployment.
CREATE INDEX IF NOT EXISTS game_battle_rewards_created_at_idx
  ON game_battle_rewards(created_at);

-- Optional after the backlog is cleared (outside a transaction):
-- VACUUM (ANALYZE) game_battle_rewards;
-- Ordinary VACUUM makes space reusable; it does not shrink the database file.
