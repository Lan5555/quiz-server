import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbracePerTierCheckpoints1795392000000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE game_encounter_checkpoints DROP CONSTRAINT game_encounter_checkpoints_pkey, ADD PRIMARY KEY (account_id, tier)');
  }

  async down(db: QueryRunner) {
    await db.query('DELETE FROM game_encounter_checkpoints c USING game_encounter_checkpoints higher WHERE c.account_id = higher.account_id AND c.tier < higher.tier');
    await db.query('ALTER TABLE game_encounter_checkpoints DROP CONSTRAINT game_encounter_checkpoints_pkey, ADD PRIMARY KEY (account_id)');
  }
}
