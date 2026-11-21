import type { MigrationInterface, QueryRunner } from 'typeorm';
import { HIGHLANDS_STORY } from '../game/story/highlands-v1';

export class EmbraceProgression1794873600000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS game_accounts (
        id uuid PRIMARY KEY,
        username varchar(24) NOT NULL UNIQUE,
        password_salt text NOT NULL,
        password_digest text NOT NULL,
        moderator boolean NOT NULL DEFAULT false,
        credits integer NOT NULL DEFAULT 300 CHECK (credits >= 0),
        pity integer NOT NULL DEFAULT 0 CHECK (pity BETWEEN 0 AND 89),
        gear jsonb NOT NULL DEFAULT '["iron_blade","traveler_coat"]',
        items jsonb NOT NULL DEFAULT '{"bloodleaf_tonic":2,"ward_stone":1}',
        loadout jsonb NOT NULL DEFAULT '{"job":"vanguard","weapon":"iron_blade","armor":"traveler_coat","item":"bloodleaf_tonic"}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS game_sessions (
        token_hash text PRIMARY KEY,
        account_id uuid NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS game_sessions_account_idx ON game_sessions(account_id);
      CREATE TABLE IF NOT EXISTS game_purchases (
        account_id uuid NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
        request_id uuid NOT NULL,
        product text NOT NULL,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS game_battle_rewards (
        account_id uuid NOT NULL REFERENCES game_accounts(id) ON DELETE CASCADE,
        battle_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, battle_id)
      );
      CREATE TABLE IF NOT EXISTS game_story_nodes (
        node_id text PRIMARY KEY,
        scene jsonb NOT NULL CHECK (scene->>'id' = node_id)
      );
    `);
    await db.query(
      'INSERT INTO game_story_nodes(node_id, scene) SELECT key, value FROM jsonb_each($1::jsonb) WHERE NOT EXISTS (SELECT 1 FROM game_story_nodes) ON CONFLICT (node_id) DO NOTHING',
      [JSON.stringify(HIGHLANDS_STORY)],
    );
  }

  async down(db: QueryRunner) {
    await db.query(
      'DROP TABLE game_story_nodes, game_battle_rewards, game_purchases, game_sessions, game_accounts',
    );
  }
}
