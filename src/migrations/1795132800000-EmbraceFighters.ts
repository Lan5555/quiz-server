import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbraceFighters1795132800000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(
      "ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS fighter_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fighter_ids) = 'array');",
    );
  }

  async down(db: QueryRunner) {
    await db.query('ALTER TABLE game_accounts DROP COLUMN fighter_ids');
  }
}
