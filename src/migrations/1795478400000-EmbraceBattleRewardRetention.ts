import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbraceBattleRewardRetention1795478400000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(
      'CREATE INDEX IF NOT EXISTS game_battle_rewards_created_at_idx ON game_battle_rewards(created_at)',
    );
  }

  async down(db: QueryRunner) {
    await db.query('DROP INDEX IF EXISTS game_battle_rewards_created_at_idx');
  }
}
