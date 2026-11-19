import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbraceAdmin1795046400000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS game_story_revisions (
        id uuid PRIMARY KEY,
        document jsonb NOT NULL,
        published_by uuid REFERENCES game_accounts(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE IF NOT EXISTS game_story_publication (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        initial_node_id text NOT NULL DEFAULT 'start',
        revision_id uuid REFERENCES game_story_revisions(id)
      );
      INSERT INTO game_story_publication(singleton) VALUES (true) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS game_admin_activity (
        id uuid PRIMARY KEY,
        actor_id uuid REFERENCES game_accounts(id) ON DELETE SET NULL,
        action text NOT NULL,
        target text NOT NULL,
        details jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX IF NOT EXISTS game_admin_activity_recent_idx ON game_admin_activity(created_at DESC);
    `);
  }

  async down(db: QueryRunner) {
    await db.query(
      'DROP TABLE game_admin_activity, game_story_publication, game_story_revisions',
    );
  }
}
