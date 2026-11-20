import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

@Injectable()
export class BattleRewardRetentionService {
  private readonly logger = new Logger(BattleRewardRetentionService.name);
  private running = false;

  constructor(private readonly db: DataSource) {}

  // Bounded batches keep a large backlog from holding a long transaction.
  async pruneBatch() {
    const rows = await this.db.query<{ account_id: string }[]>(`
      WITH expired AS (
        SELECT account_id,battle_id FROM game_battle_rewards
        WHERE created_at < statement_timestamp() - interval '7 days'
        ORDER BY created_at LIMIT 5000 FOR UPDATE SKIP LOCKED
      ), removed AS (
        DELETE FROM game_battle_rewards r USING expired e
        WHERE r.account_id=e.account_id AND r.battle_id=e.battle_id
        RETURNING r.account_id
      ) SELECT account_id FROM removed
    `);
    return rows.length;
  }

  @Interval(60_000)
  async pruneExpired() {
    if (this.running) return;
    this.running = true;
    try {
      for (let batch = 0; batch < 20; batch++) {
        if ((await this.pruneBatch()) < 5000) break;
      }
    } catch {
      this.logger.error(
        'Could not prune expired battle reward guards; retrying next minute.',
      );
    } finally {
      this.running = false;
    }
  }
}
