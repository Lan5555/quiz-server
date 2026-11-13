import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlutterwaveKeyScopedVoting1794787200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE vote_purchases DROP CONSTRAINT IF EXISTS vote_purchases_flutterwave_config;
      ALTER TABLE vote_purchases ADD CONSTRAINT vote_purchases_flutterwave_config
        CHECK(provider<>'flutterwave' OR provider_mode IS NOT NULL);
    `);
  }

  down(): Promise<void> {
    throw new Error(
      'Use a forward migration; new purchases no longer require an account snapshot.',
    );
  }
}
