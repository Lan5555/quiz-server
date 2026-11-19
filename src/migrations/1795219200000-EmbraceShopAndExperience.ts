import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbraceShopAndExperience1795219200000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`
      ALTER TABLE game_accounts ADD COLUMN IF NOT EXISTS xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0);
      CREATE TABLE IF NOT EXISTS game_shop_items (
        id text PRIMARY KEY CHECK (id ~ '^custom_[a-f0-9-]{36}$'),
        name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
        effect text NOT NULL,
        power integer NOT NULL,
        price integer NOT NULL CHECK (price BETWEEN 1 AND 100000),
        created_by uuid NOT NULL REFERENCES game_accounts(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((effect='heal' AND power BETWEEN 1 AND 320)
            OR (effect='guard' AND power BETWEEN 1 AND 25))
      );
    `);
  }

  async down(db: QueryRunner) {
    await db.query('DROP TABLE game_shop_items; ALTER TABLE game_accounts DROP COLUMN xp');
  }
}
