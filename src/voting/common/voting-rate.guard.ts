import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Request, Response } from 'express';
import { fail, hash } from './voting';
@Injectable()
export class VotingRateGuard implements CanActivate {
  constructor(private readonly db: DataSource) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    const limit = req.method === 'GET' ? 120 : 20;
    const bucket = hash(
      `${req.ip}|${req.method}|${req.path.includes('webhooks') ? 'webhooks' : 'votes'}`,
    );
    const [row] = await this.db.query<{ hits: number }[]>(
      `INSERT INTO voting_rate_limits (bucket, window_start, hits) VALUES ($1, date_trunc('minute',now()),1)
      ON CONFLICT (bucket) DO UPDATE SET hits=CASE WHEN voting_rate_limits.window_start=excluded.window_start THEN voting_rate_limits.hits+1 ELSE 1 END, window_start=excluded.window_start RETURNING hits`,
      [bucket],
    );
    if (Number(row.hits) > limit)
      fail(429, 'Too many requests. Please try again shortly.');
    return true;
  }
}
