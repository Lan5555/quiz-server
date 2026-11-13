import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CreatePollDto } from '../common/voting.dto';
import { fail, VotingConfig } from '../common/voting';
import type { PollRecord } from './poll.record';
import type { CandidateRecord } from '../candidates/candidate.record';
import { VotingImagesService } from '../images/images.service';

export function pollStatus(p: PollRecord, now = Date.now()) {
  if (p.state === 'DRAFT' || p.state === 'CLOSED') return p.state as string;
  if (now >= new Date(p.closes_at).getTime()) return 'CLOSED';
  return now < new Date(p.opens_at).getTime() ? 'SCHEDULED' : 'OPEN';
}
export async function audit(
  m: EntityManager,
  actor: string,
  action: string,
  entity: string,
) {
  await m.query(
    `INSERT INTO voting_admin_audit(id,actor,action,entity) VALUES($1,$2,$3,$4)`,
    [randomUUID(), actor, action, entity],
  );
}
@Injectable()
export class PollsService {
  constructor(
    private readonly db: DataSource,
    private readonly config: VotingConfig,
    private readonly images: VotingImagesService,
  ) {}
  async shape(p: PollRecord, admin: boolean, m = this.db.manager) {
    const [counts] = await m.query<{ candidates: string; votes: string }[]>(
      `SELECT (SELECT count(*) FROM voting_candidates WHERE poll_id=$1) AS candidates,
      COALESCE((SELECT sum(l.delta) FROM vote_ledger l JOIN vote_purchases v ON v.id=l.purchase_id WHERE v.poll_id=$1),0) AS votes`,
      [p.id],
    );
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      imageId: p.image_id,
      imageUrl: p.image_url,
      status: pollStatus(p),
      currency: p.currency,
      votePriceMinor: Number(p.price),
      maxVotesPerPurchase: p.max_quantity,
      opensAt: new Date(p.opens_at).toISOString(),
      closesAt: new Date(p.closes_at).toISOString(),
      resultsVisible: p.results_visible,
      totalVotes: admin || p.results_visible ? Number(counts.votes) : null,
      candidateCount: Number(counts.candidates),
    };
  }
  async list(admin = false) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const rows = await m.query<PollRecord[]>(
        `SELECT * FROM voting_polls ${admin ? '' : "WHERE state<>'DRAFT'"} ORDER BY created_at DESC,id DESC`,
      );
      return Promise.all(rows.map((p) => this.shape(p, admin, m)));
    });
  }
  async detail(key: string, admin = false) {
    return this.db.transaction('REPEATABLE READ', async (m) => {
      const [p] = await m.query<PollRecord[]>(
        `SELECT * FROM voting_polls WHERE ${admin ? 'id::text' : 'slug'}=$1 ${admin ? '' : "AND state<>'DRAFT'"}`,
        [key],
      );
      if (!p) fail(404, 'Poll unavailable');
      const candidates = await m.query<(CandidateRecord & { votes: string })[]>(
        `SELECT c.*, COALESCE((SELECT sum(l.delta) FROM vote_ledger l JOIN vote_purchases v ON v.id=l.purchase_id WHERE v.candidate_id=c.id),0) AS votes FROM voting_candidates c WHERE poll_id=$1 ORDER BY created_at,id`,
        [p.id],
      );
      return {
        poll: await this.shape(p, admin, m),
        candidates: candidates.map((c) => ({
          id: c.id,
          name: c.name,
          bio: c.bio,
          photoUrl: c.photo_url,
          photoImageId: c.photo_image_id,
          active: c.active,
          voteCount: admin || p.results_visible ? Number(c.votes) : null,
        })),
      };
    });
  }
  async create(body: CreatePollDto, actor: string) {
    const opens = new Date(body.opensAt);
    const closes = new Date(body.closesAt);
    if (
      !Number.isFinite(opens.getTime()) ||
      !Number.isFinite(closes.getTime()) ||
      closes <= opens ||
      closes.getTime() <= Date.now()
    )
      fail(400, 'Closing time must follow opening time and be in the future');
    if (
      !Number.isSafeInteger(body.votePriceMinor * body.maxVotesPerPurchase) ||
      body.votePriceMinor * body.maxVotesPerPurchase > this.config.maximum()
    )
      fail(400, 'Maximum purchase amount exceeds the operational limit');
    return this.db.transaction(async (m) => {
      const image = await this.images.resolve(body.imageId, 'POLL', actor, m);
      const id = randomUUID();
      const slug = `${
        body.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80) || 'poll'
      }-${id}`;
      const [p] = await m.query<PollRecord[]>(
        `INSERT INTO voting_polls(id,slug,title,description,currency,price,max_quantity,opens_at,closes_at,results_visible,creator,image_id,image_url) VALUES($1,$2,$3,$4,'NGN',$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          id,
          slug,
          body.title,
          body.description,
          body.votePriceMinor,
          body.maxVotesPerPurchase,
          opens,
          closes,
          body.resultsVisible,
          actor,
          image?.id ?? null,
          image?.url ?? null,
        ],
      );
      await audit(m, actor, 'CREATE_POLL', id);
      return this.shape(p, true, m);
    });
  }
  async status(id: string, state: 'PUBLISHED' | 'CLOSED', actor: string) {
    return this.db.transaction(async (m) => {
      const [p] = await m.query<PollRecord[]>(
        `SELECT * FROM voting_polls WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!p) fail(404, 'Poll unavailable');
      if (
        p.state === 'CLOSED' ||
        (p.state !== 'DRAFT' && state === 'PUBLISHED')
      )
        fail(409, 'Poll has already been published or closed');
      if (state === 'PUBLISHED') {
        if (new Date(p.closes_at).getTime() <= Date.now())
          fail(409, 'Poll closing time has passed');
        const [c] = await m.query<{ id: string }[]>(
          `SELECT id FROM voting_candidates WHERE poll_id=$1 AND active LIMIT 1`,
          [id],
        );
        if (!c)
          fail(409, 'Register at least one active candidate before publishing');
      }
      const [updated] = await m.query<PollRecord[]>(
        `WITH changed AS (UPDATE voting_polls SET state=$2 WHERE id=$1 RETURNING *) SELECT * FROM changed`,
        [id, state],
      );
      await audit(m, actor, state, id);
      return this.shape(updated, true, m);
    });
  }
}
