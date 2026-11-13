import { MigrationInterface, QueryRunner } from 'typeorm';
export class VotingImages1794700800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE voting_images (
        id uuid PRIMARY KEY, public_id text NOT NULL UNIQUE,
        purpose text NOT NULL CHECK(purpose IN ('POLL','CANDIDATE')),
        uploaded_by uuid NOT NULL REFERENCES voting_admins(id),
        state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY','FAILED')),
        url varchar(2048) UNIQUE, width integer, height integer, bytes integer, format text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK(state<>'READY' OR (url IS NOT NULL AND width IS NOT NULL AND width BETWEEN 1 AND 2000 AND height IS NOT NULL AND height BETWEEN 1 AND 2000 AND bytes IS NOT NULL AND bytes BETWEEN 1 AND 5242880 AND format IS NOT NULL AND format IN ('jpg','jpeg','png','webp')))
      );
      CREATE INDEX voting_images_owner ON voting_images(uploaded_by,purpose,state);
      ALTER TABLE voting_polls ADD COLUMN image_id uuid REFERENCES voting_images(id);
      ALTER TABLE voting_polls ADD COLUMN image_url varchar(2048);
      ALTER TABLE voting_polls ADD CONSTRAINT voting_poll_image_pair CHECK((image_id IS NULL)=(image_url IS NULL));
      ALTER TABLE voting_candidates ADD COLUMN photo_image_id uuid REFERENCES voting_images(id);
    `);
  }
  down(): Promise<void> {
    throw new Error(
      'Retain referenced voting images; use an audited forward migration.',
    );
  }
}
