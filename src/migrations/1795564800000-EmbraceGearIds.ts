import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbraceGearIds1795564800000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS game_gear (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gear_id text,
        name text NOT NULL,
        slot text NOT NULL,
        rarity text NOT NULL,
        attack integer NOT NULL DEFAULT 0,
        armor integer NOT NULL DEFAULT 0,
        price integer NOT NULL DEFAULT 0,
        paid boolean NOT NULL DEFAULT false,
        cash_amount_minor integer,
        image_url text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE game_gear ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE game_gear ADD COLUMN IF NOT EXISTS gear_id text;
      ALTER TABLE game_gear ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false;
      ALTER TABLE game_gear ADD COLUMN IF NOT EXISTS cash_amount_minor integer;
      ALTER TABLE game_gear ADD COLUMN IF NOT EXISTS image_url text;
      UPDATE game_gear
      SET image_url = CASE WHEN slot='armor' THEN '/forge/shop/oathkeeper-plate.webp' ELSE '/forge/shop/hollowfang.webp' END
      WHERE image_url IS NULL OR btrim(image_url)='';

      UPDATE game_gear
      SET gear_id = CASE name
        WHEN 'Crownforged Blade' THEN 'crownforged_blade'
        WHEN 'Sovereign Plate' THEN 'sovereign_plate'
        WHEN 'Iron Blade' THEN 'iron_blade'
        WHEN 'Traveler Coat' THEN 'traveler_coat'
        WHEN 'Ashblade' THEN 'ashblade'
        WHEN 'Bellwarden Mail' THEN 'bellwarden_mail'
        WHEN 'Hollowfang' THEN 'hollowfang'
        WHEN 'Oathkeeper Plate' THEN 'oathkeeper_plate'
        ELSE lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'))
      END
      WHERE gear_id IS NULL OR gear_id = '';

      UPDATE game_gear
      SET gear_id = gear_id || '_' || substr(id::text, 1, 8)
      WHERE gear_id IN (
        SELECT gear_id FROM game_gear GROUP BY gear_id HAVING count(*) > 1
      );

      ALTER TABLE game_accounts DROP CONSTRAINT IF EXISTS game_accounts_pity_check;
      ALTER TABLE game_accounts ADD CONSTRAINT game_accounts_pity_check CHECK (pity BETWEEN 0 AND 89);

      ALTER TABLE game_gear ALTER COLUMN gear_id SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS game_gear_gear_id_idx ON game_gear(gear_id);
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_slot_check;
      ALTER TABLE game_gear ADD CONSTRAINT game_gear_slot_check CHECK (slot IN ('weapon', 'armor'));
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_rarity_check;
      ALTER TABLE game_gear ADD CONSTRAINT game_gear_rarity_check CHECK (rarity IN ('common', 'rare', 'legendary'));
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_attack_check;
      ALTER TABLE game_gear ADD CONSTRAINT game_gear_attack_check CHECK (attack >= 0);
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_armor_check;
      ALTER TABLE game_gear ADD CONSTRAINT game_gear_armor_check CHECK (armor >= 0);
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_price_check;
      ALTER TABLE game_gear ADD CONSTRAINT game_gear_price_check CHECK (price >= 0);
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_cash_price_check;
      ALTER TABLE game_gear ADD CONSTRAINT game_gear_cash_price_check CHECK (
        (NOT paid AND cash_amount_minor IS NULL)
        OR (paid AND cash_amount_minor IS NOT NULL AND cash_amount_minor >= 100)
      );
    `);
  }

  async down(db: QueryRunner) {
    await db.query(`
      DROP INDEX IF EXISTS game_gear_gear_id_idx;
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_slot_check;
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_rarity_check;
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_attack_check;
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_armor_check;
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_price_check;
      ALTER TABLE game_gear DROP CONSTRAINT IF EXISTS game_gear_cash_price_check;
      ALTER TABLE game_gear DROP COLUMN IF EXISTS cash_amount_minor;
      ALTER TABLE game_gear DROP COLUMN IF EXISTS paid;
      ALTER TABLE game_gear DROP COLUMN IF EXISTS image_url;
      ALTER TABLE game_gear DROP COLUMN IF EXISTS gear_id;
      ALTER TABLE game_accounts DROP CONSTRAINT IF EXISTS game_accounts_pity_check;
      ALTER TABLE game_accounts ADD CONSTRAINT game_accounts_pity_check CHECK (pity BETWEEN 0 AND 9);
    `);
  }
}
