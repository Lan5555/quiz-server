import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbraceEncounterCheckpoints1795305600000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`
      CREATE TABLE game_encounter_checkpoints (
        account_id uuid PRIMARY KEY REFERENCES game_accounts(id) ON DELETE CASCADE,
        tier integer NOT NULL CHECK (tier BETWEEN 1 AND 61),
        cleared integer NOT NULL CHECK (cleared IN (6, 12)),
        levels jsonb NOT NULL CHECK (jsonb_typeof(levels) = 'array' AND jsonb_array_length(levels) = 12)
      );
    `);
  }

  async down(db: QueryRunner) {
    await db.query('DROP TABLE game_encounter_checkpoints');
  }
}
