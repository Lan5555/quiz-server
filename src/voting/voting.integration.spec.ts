/* SQL test fixtures deliberately mirror TypeORM's untyped raw-query boundary. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { PGlite } from '@electric-sql/pglite';
import { ConfigService } from '@nestjs/config';
import { HttpException, Logger, ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import request from 'supertest';
import axios from 'axios';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, scryptSync } from 'node:crypto';
import { DataSource } from 'typeorm';
import { PaidVoting1794528000000 } from '../migrations/1794528000000-PaidVoting';
import { FlutterwaveVoting1794614400000 } from '../migrations/1794614400000-FlutterwaveVoting';
import { VotingImages1794700800000 } from '../migrations/1794700800000-VotingImages';
import { FlutterwaveKeyScopedVoting1794787200000 } from '../migrations/1794787200000-FlutterwaveKeyScopedVoting';
import {
  imageFormat,
  MAX_IMAGE_BYTES,
  VotingImagesService,
} from './images/images.service';
import { VotingConfig } from './common/voting';
import { PollsService } from './polls/polls.service';
import { CandidatesService } from './candidates/candidates.service';
import { PurchasesService } from './purchases/purchases.service';
import { ReceiptTokenService } from './purchases/receipt-token.service';
import {
  FlutterwaveService,
  ProviderTransaction,
  toMinor,
  toMajor,
  FlutterwaveProviderError,
} from './payments/flutterwave.service';
import { VoteAccountingService } from './payments/vote-accounting.service';
import { VotingAuthService } from './auth/voting-auth.service';
import { VotingReconciliationService } from './payments/voting-reconciliation.service';
import { VotingWebhooksService } from './payments/voting-webhooks.service';
import { VotingModule } from './voting.module';

// Real PostgreSQL SQL/constraints/triggers in an in-memory WASM database; no environment files or external services.
describe('paid voting PostgreSQL integration', () => {
  let pg: PGlite,
    db: DataSource,
    config: VotingConfig,
    polls: PollsService,
    candidates: CandidatesService;
  let purchases: PurchasesService,
    accounting: VoteAccountingService,
    auth: VotingAuthService;
  let images: VotingImagesService;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1cAAAAASUVORK5CYII=',
    'base64',
  );
  const imageFile = () => ({
    buffer: png,
    mimetype: 'image/png',
    size: png.length,
  });
  function mockCloudinary() {
    return jest.spyOn(axios, 'post').mockImplementation((_url, form) => {
      const publicId = (form as FormData).get('public_id') as string;
      return Promise.resolve({
        data: {
          public_id: publicId,
          secure_url: `https://res.cloudinary.com/unit-cloud/image/upload/v1/${publicId}.png`,
          resource_type: 'image',
          type: 'upload',
          format: 'png',
          width: 1,
          height: 1,
          bytes: png.length,
        },
      } as any);
    });
  }
  let provider: FlutterwaveService, admin: string, poll: any, candidate: any;
  const initialize = jest.fn();
  const verify = jest.fn();
  const verifyId = jest.fn();
  const query = async (target: any, sql: string, params?: unknown[]) => {
    const r = await target.query(sql, params);
    // Match TypeORM's PostgresQueryRunner raw return shape, including UPDATE/DELETE.
    return /^(UPDATE|DELETE)\b/i.test(sql.trim())
      ? [r.rows, r.affectedRows]
      : r.rows;
  };
  const run = (sql: string, params?: unknown[]) => query(pg, sql, params);
  const body = () => ({
    pollId: poll.id,
    candidateId: candidate.id,
    quantity: 3,
    email: 'guest@example.test',
  });
  const transaction = (p: any, overrides = {}): ProviderTransaction => ({
    id: BigInt(`0x${p.id.replaceAll('-', '')}`).toString(),
    reference: p.provider_reference,
    status: 'success',
    amount: Number(p.amount),
    currency: 'NGN',
    domain: 'test',
    account_id: '12345',
    created_at: new Date(p.accepted_at).toISOString(),
    paid_at: new Date(new Date(p.accepted_at).getTime() + 100).toISOString(),
    ...overrides,
  });
  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
    await new PaidVoting1794528000000().up({
      query: (sql: string) => pg.exec(sql),
    } as any);
    await new FlutterwaveVoting1794614400000().up({
      query: (sql: string) => pg.exec(sql),
    } as any);
    await new VotingImages1794700800000().up({
      query: (sql: string) => pg.exec(sql),
    } as any);
    await new FlutterwaveKeyScopedVoting1794787200000().up({
      query: (sql: string) => pg.exec(sql),
    } as any);
    const facade: any = {
      query: run,
      manager: { query: run },
      transaction: (arg: any, next?: any) =>
        pg.transaction((tx) =>
          (next || arg)({
            query: (sql: string, params?: unknown[]) => query(tx, sql, params),
          }),
        ),
    };
    db = facade;
    config = new VotingConfig(
      new ConfigService({
        VOTING_PAYMENTS_ENABLED: 'true',
        VOTING_FRONTEND_ORIGIN: 'https://votes.example.test',
        VOTING_RECEIPT_KEY: 'ab'.repeat(32),
        FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-unit-test-only-X',
        FLUTTERWAVE_SECRET_HASH: 'unit-test-webhook-secret',
        VOTING_PROVIDER_MODE: 'test',
        VOTING_ADMIN_EMAIL: 'admin@example.test',
        VOTING_ADMIN_PASSWORD_HASH: `test-salt:${scryptSync('test-password', 'test-salt', 64).toString('hex')}`,
        VOTING_ADMIN_JWT_SECRET:
          'test-only-admin-secret-at-least-32-characters',
        VOTING_IMAGE_HOSTS: 'images.example.test',
        CLOUDINARY_CLOUD_NAME: 'unit-cloud',
        CLOUDINARY_API_KEY: 'test-cloudinary-key',
        CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
      }),
    );
    provider = {
      initialize,
      assertCanInitialize: jest.fn(),
      verify,
      verifyId,
      checkoutUrl: (value: string) => value,
      refundState: jest.fn().mockResolvedValue('NONE'),
    } as any;
    accounting = new VoteAccountingService(db, provider, config);
    images = new VotingImagesService(db, config);
    polls = new PollsService(db, config, images);
    candidates = new CandidatesService(db, config, images);
    purchases = new PurchasesService(
      db,
      config,
      new ReceiptTokenService(config),
      provider,
      accounting,
    );
    auth = new VotingAuthService(db, new JwtService(), config);
    admin = randomUUID();
    await run(
      `INSERT INTO voting_admins(id,email,name,can_manage_votes) VALUES($1,'admin@example.test','Admin',true)`,
      [admin],
    );
  }, 60000);
  afterAll(async () => {
    await pg?.close();
  });
  beforeEach(async () => {
    initialize
      .mockReset()
      .mockResolvedValue('https://checkout.flutterwave.com/test');
    verify.mockReset().mockRejectedValue(new Error('offline'));
    verifyId.mockReset().mockRejectedValue(new Error('offline'));
    poll = await polls.create(
      {
        title: 'Awards',
        description: 'Support candidates',
        currency: 'NGN',
        votePriceMinor: 10000,
        maxVotesPerPurchase: 100,
        opensAt: new Date(Date.now() - 60000).toISOString(),
        closesAt: new Date(Date.now() + 3600000).toISOString(),
        resultsVisible: false,
      },
      admin,
    );
    candidate = await candidates.create(
      poll.id,
      { name: 'Candidate', bio: 'Biography', photoUrl: null },
      admin,
    );
  });
  async function open() {
    await polls.status(poll.id, 'PUBLISHED', admin);
  }
  async function buy(key = randomUUID()) {
    await open();
    const checkout = await purchases.start(key, body());
    const [p] = await run(`SELECT * FROM vote_purchases WHERE id=$1`, [
      checkout.purchaseId,
    ]);
    return { checkout, p, key };
  }

  it('keeps drafts private and locks candidate registration after publishing', async () => {
    await expect(polls.detail(poll.slug)).rejects.toMatchObject({
      status: 404,
    });
    await open();
    expect((await polls.detail(poll.slug)).poll.status).toBe('OPEN');
    await expect(
      candidates.create(
        poll.id,
        { name: 'Late', bio: 'Late', photoUrl: null },
        admin,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('credits once, hides public totals and returns an email-free receipt', async () => {
    const { p, checkout } = await buy();
    const t = transaction(p);
    await accounting.apply(p.id, t);
    await accounting.apply(p.id, t);
    const publicPoll = await polls.detail(poll.slug);
    const privatePoll = await polls.detail(poll.id, true);
    expect(publicPoll.poll.totalVotes).toBeNull();
    expect(publicPoll.candidates[0].voteCount).toBeNull();
    expect(privatePoll.poll.totalVotes).toBe(3);
    const receipt = await purchases.receipt(p.id, checkout.receiptToken);
    expect(receipt.status).toBe('PAID');
    expect(receipt.creditedVotes).toBe(3);
    expect(receipt).not.toHaveProperty('email');
    expect(
      (await run(`SELECT * FROM vote_ledger WHERE purchase_id=$1`, [p.id]))
        .length,
    ).toBe(1);
  });
  it('replays the same checkout and receipt capability even after poll closes', async () => {
    const { p, checkout, key } = await buy();
    await polls.status(poll.id, 'CLOSED', admin);
    expect(await purchases.start(key, body())).toEqual(checkout);
    expect(initialize).toHaveBeenCalledTimes(1);
    await expect(
      purchases.start(key, { ...body(), quantity: 4 }),
    ).rejects.toMatchObject({ status: 409 });
    await accounting.apply(p.id, transaction(p));
    expect(
      (await purchases.receipt(p.id, checkout.receiptToken)).creditedVotes,
    ).toBe(3);
  });
  it('converges concurrent same-key requests on one purchase and one initialization', async () => {
    await open();
    const key = randomUUID();
    const results = await Promise.allSettled([
      purchases.start(key, body()),
      purchases.start(key, body()),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(
      (
        await run(`SELECT id FROM vote_purchases WHERE idempotency_key=$1`, [
          key,
        ])
      ).length,
    ).toBe(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    const a = await purchases.start(key, body());
    const b = await purchases.start(key, body());
    expect(a).toEqual(b);
  });
  it('preserves uncertain initialization and never issues another initialization', async () => {
    await open();
    initialize.mockRejectedValueOnce(new Error('timeout'));
    const key = randomUUID();
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    expect(initialize).toHaveBeenCalledTimes(1);
    const [p] = await run(
      `SELECT * FROM vote_purchases WHERE idempotency_key=$1`,
      [key],
    );
    expect(p.status).toBe('PENDING');
  });
  it('leaves initialization unclaimed when local preflight configuration fails', async () => {
    await open();
    const key = randomUUID();
    (provider.assertCanInitialize as jest.Mock).mockImplementationOnce(() => {
      throw new HttpException('Invalid frontend origin configuration', 503);
    });
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    expect(initialize).not.toHaveBeenCalled();
    const [p] = await run(
      `SELECT * FROM vote_purchases WHERE idempotency_key=$1`,
      [key],
    );
    expect(p.init_started_at).toBeNull();
    await expect(purchases.start(key, body())).resolves.toMatchObject({
      purchaseId: p.id,
    });
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it('preserves initialization diagnostics through failed provider reconciliation', async () => {
    await open();
    const key = randomUUID();
    initialize.mockRejectedValueOnce(new FlutterwaveProviderError('HTTP_401'));
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    const [p] = await run(
      `SELECT last_error FROM vote_purchases WHERE idempotency_key=$1`,
      [key],
    );
    expect(p.last_error).toBe('INITIALIZATION_HTTP_401');
    expect(initialize).toHaveBeenCalledTimes(1);
  });
  it('refuses another provider initialization when a stored receipt uses a different encryption key', async () => {
    await open();
    const key = randomUUID();
    initialize.mockRejectedValueOnce(new Error('timeout'));
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    const [p] = await run(
      `SELECT id FROM vote_purchases WHERE idempotency_key=$1`,
      [key],
    );
    await run(`UPDATE vote_purchases SET init_started_at=NULL WHERE id=$1`, [
      p.id,
    ]);
    const settings = new ConfigService({ VOTING_RECEIPT_KEY: 'cd'.repeat(32) });
    settings.skipProcessEnv = true;
    const changedKeyService = new PurchasesService(
      db,
      config,
      new ReceiptTokenService(new VotingConfig(settings)),
      provider,
      accounting,
    );
    await expect(changedKeyService.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    expect(initialize).toHaveBeenCalledTimes(1);
    const [after] = await run(
      `SELECT init_started_at FROM vote_purchases WHERE id=$1`,
      [p.id],
    );
    expect(after.init_started_at).toBeNull();
    await expect(purchases.start(key, body())).resolves.toMatchObject({
      purchaseId: p.id,
    });
  });
  it('safely resets only the confirmed unopened sandbox attempt while preserving its reference', async () => {
    await open();
    const key = randomUUID();
    initialize.mockRejectedValueOnce(new Error('timeout'));
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 503,
    });
    const [p] = await run(
      `SELECT * FROM vote_purchases WHERE idempotency_key=$1`,
      [key],
    );
    await run(
      `UPDATE vote_purchases SET init_started_at=now()-interval '2 minutes' WHERE id=$1`,
      [p.id],
    );
    const script = readFileSync(
      resolve(__dirname, '../../docs/sql/retry-unopened-test-checkout.sql'),
      'utf8',
    ).replace(/target_id text := '[^']*';/, `target_id text := '${p.id}';`);
    await pg.exec(script);
    const checkout = await purchases.start(key, body());
    expect(checkout.purchaseId).toBe(p.id);
    const [after] = await run(
      `SELECT provider_reference,idempotency_key FROM vote_purchases WHERE id=$1`,
      [p.id],
    );
    expect(after).toEqual({
      provider_reference: p.provider_reference,
      idempotency_key: key,
    });
  });
  it('rejects closed polls and wrong candidate membership before provider calls', async () => {
    await open();
    await expect(
      purchases.start(randomUUID(), { ...body(), candidateId: randomUUID() }),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'PURCHASE_NOT_CREATED' },
    });
    await polls.status(poll.id, 'CLOSED', admin);
    await expect(purchases.start(randomUUID(), body())).rejects.toMatchObject({
      status: 409,
      response: { code: 'PURCHASE_NOT_CREATED' },
    });
    expect(initialize).not.toHaveBeenCalled();
  });
  it('does not disclose receipts for absent or incorrect tokens', async () => {
    const { p } = await buy();
    await expect(purchases.receipt(p.id, '')).rejects.toMatchObject({
      status: 404,
    });
    await expect(purchases.receipt(p.id, 'wrong')).rejects.toMatchObject({
      status: 404,
    });
    expect(verify).not.toHaveBeenCalled();
  });
  it.each([
    { amount: 1 },
    { currency: 'USD' },
    { reference: 'wrong' },
    { domain: 'live' },
  ])('routes mismatched evidence to review: %j', async (overrides) => {
    const { p, checkout } = await buy();
    await accounting.apply(p.id, transaction(p, overrides));
    const receipt = await purchases.receipt(p.id, checkout.receiptToken);
    expect(receipt.status).toBe('REVIEW');
    expect(receipt.creditedVotes).toBe(0);
  });
  it('automatically credits a matching successful payment after the saved checkout window', async () => {
    const { p } = await buy();
    await accounting.apply(
      p.id,
      transaction(p, {
        paid_at: new Date(new Date(p.expires_at).getTime() + 1).toISOString(),
      }),
    );
    expect(
      (await run(`SELECT status FROM vote_purchases WHERE id=$1`, [p.id]))[0]
        .status,
    ).toBe('PAID');
    expect(
      (
        await run(
          `SELECT sum(delta)::int AS votes FROM vote_ledger WHERE purchase_id=$1`,
          [p.id],
        )
      )[0].votes,
    ).toBe(3);
  });
  it.each([
    'PAYMENT_AFTER_CHECKOUT_EXPIRY',
    'INVALID_PAYMENT_TIMESTAMP',
    'PAYMENT_EVIDENCE_MISMATCH',
  ])(
    'automatically clears the resolved verification review %s after server-confirmed success',
    async (reason) => {
      const { p } = await buy();
      const t = transaction(p);
      await run(
        `UPDATE vote_purchases SET status='REVIEW',review_reason=$2 WHERE id=$1`,
        [p.id, reason],
      );
      verify.mockResolvedValue(t);
      verifyId.mockResolvedValue(t);
      await accounting.verify(p.id, true, 'RECEIPT');
      await accounting.verify(p.id, true, 'RECEIPT');
      const [saved] = await run(
        `SELECT status,review_reason FROM vote_purchases WHERE id=$1`,
        [p.id],
      );
      expect(saved).toEqual({ status: 'PAID', review_reason: null });
      expect(
        (await run(`SELECT * FROM vote_ledger WHERE purchase_id=$1`, [p.id]))
          .length,
      ).toBe(1);
    },
  );
  it.each([
    'DISPUTE_REQUIRES_RECONCILIATION',
    'REVERSAL_EVIDENCE_REQUIRED',
    'MANUAL_REVIEW',
    'CANDIDATE_DISABLED',
  ])(
    'preserves the protected review %s despite a stale success response',
    async (reason) => {
      const { p } = await buy();
      await run(
        `UPDATE vote_purchases SET status='REVIEW',review_reason=$2 WHERE id=$1`,
        [p.id, reason],
      );
      await accounting.apply(p.id, transaction(p));
      expect(
        (await run(`SELECT status FROM vote_purchases WHERE id=$1`, [p.id]))[0]
          .status,
      ).toBe('REVIEW');
      expect(
        (await run(`SELECT * FROM vote_ledger WHERE purchase_id=$1`, [p.id]))
          .length,
      ).toBe(0);
    },
  );
  it('credits a verified success with missing provider time without inventing a paid timestamp', async () => {
    const { p } = await buy();
    await accounting.apply(
      p.id,
      transaction(p, { paid_at: 'invalid', created_at: 'invalid' }),
    );
    expect(
      (
        await run(`SELECT status,paid_at FROM vote_purchases WHERE id=$1`, [
          p.id,
        ])
      )[0],
    ).toEqual({ status: 'PAID', paid_at: null });
  });
  it('reverses exactly once and ignores out-of-order success', async () => {
    const { p, checkout } = await buy();
    const t = transaction(p);
    await accounting.apply(p.id, t);
    await accounting.apply(p.id, { ...t, status: 'reversed' }, true);
    await accounting.apply(p.id, { ...t, status: 'reversed' }, true);
    await accounting.apply(p.id, t);
    const receipt = await purchases.receipt(p.id, checkout.receiptToken);
    expect(receipt.status).toBe('REFUNDED');
    expect(receipt.creditedVotes).toBe(0);
    expect(
      (await run(`SELECT * FROM vote_ledger WHERE purchase_id=$1`, [p.id]))
        .length,
    ).toBe(2);
    await expect(
      run(`UPDATE vote_ledger SET delta=1 WHERE purchase_id=$1`, [p.id]),
    ).rejects.toThrow('immutable');
  });
  it('enforces snapshot, amount and membership constraints in PostgreSQL', async () => {
    const { p } = await buy();
    await expect(
      run(`UPDATE vote_purchases SET quantity=99 WHERE id=$1`, [p.id]),
    ).rejects.toThrow('immutable');
    await expect(
      run(`UPDATE voting_polls SET price=1 WHERE id=$1`, [poll.id]),
    ).rejects.toThrow('locked');
    await expect(
      run(`UPDATE voting_polls SET state='CLOSED' WHERE id=$1`, [poll.id]),
    ).resolves.toBeDefined();
    await expect(
      run(`UPDATE voting_polls SET state='PUBLISHED' WHERE id=$1`, [poll.id]),
    ).rejects.toThrow('terminal');
  });
  it('authenticates v3 webhooks and retains a durable event when transaction-ID verification fails', async () => {
    const { p } = await buy();
    const real = new FlutterwaveService(config);
    const webhooks = new VotingWebhooksService(db, real, accounting);
    jest
      .spyOn(real, 'verifyId')
      .mockRejectedValue(new FlutterwaveProviderError('HTTP_400'));
    const raw = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: {
          id: 123,
          tx_ref: p.provider_reference,
          customer: { email: 'private@example.test' },
        },
      }),
    );
    const header = 'unit-test-webhook-secret';
    await expect(webhooks.accept(raw, header)).rejects.toMatchObject({
      status: 503,
    });
    await expect(webhooks.accept(raw, header)).rejects.toMatchObject({
      status: 503,
    });
    expect(
      (
        await run(`SELECT * FROM payment_webhook_events WHERE reference=$1`, [
          p.provider_reference,
        ])
      ).length,
    ).toBe(1);
    expect(() => real.signature(raw, 'wrong')).toThrow();
    expect(() => real.signature(raw, undefined)).toThrow();
    expect(
      (await run(`SELECT status FROM vote_purchases WHERE id=$1`, [p.id]))[0]
        .status,
    ).toBe('PENDING');
  });
  it('reconciles missed webhooks and sanitizes persistent provider failures', async () => {
    const { p } = await buy();
    verify.mockResolvedValue(transaction(p));
    const worker = new VotingReconciliationService(db, accounting, config);
    await worker.tick();
    expect(
      (await run(`SELECT status FROM vote_purchases WHERE id=$1`, [p.id]))[0]
        .status,
    ).toBe('PAID');
  });
  it('credits a server-verified webhook transaction ID once even when reference lookup fails', async () => {
    const { p, checkout } = await buy();
    const t = transaction(p);
    const real = new FlutterwaveService(config);
    const idLookup = jest.spyOn(real, 'verifyId').mockResolvedValue(t);
    const referenceLookup = jest
      .spyOn(real, 'verify')
      .mockRejectedValue(new FlutterwaveProviderError('HTTP_400'));
    const webhooks = new VotingWebhooksService(db, real, accounting);
    const raw = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: { id: t.id, tx_ref: p.provider_reference, status: 'failed' },
      }),
    );
    await webhooks.accept(raw, 'unit-test-webhook-secret');
    await webhooks.accept(raw, 'unit-test-webhook-secret');
    expect(idLookup).toHaveBeenCalledTimes(1);
    expect(referenceLookup).not.toHaveBeenCalled();
    const receipt = await purchases.receipt(p.id, checkout.receiptToken);
    expect(receipt).toMatchObject({ status: 'PAID', creditedVotes: 3 });
    expect(
      (await run(`SELECT * FROM vote_ledger WHERE purchase_id=$1`, [p.id]))
        .length,
    ).toBe(1);
  });
  it('does not credit a webhook payment whose server-verified amount mismatches', async () => {
    const { p } = await buy();
    const t = transaction(p, { amount: 1 });
    const real = new FlutterwaveService(config);
    jest.spyOn(real, 'verifyId').mockResolvedValue(t);
    const raw = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: {
          id: t.id,
          tx_ref: p.provider_reference,
          status: 'successful',
          amount: Number(p.amount),
        },
      }),
    );
    await new VotingWebhooksService(db, real, accounting).accept(
      raw,
      'unit-test-webhook-secret',
    );
    expect(
      (await run(`SELECT status FROM vote_purchases WHERE id=$1`, [p.id]))[0]
        .status,
    ).toBe('REVIEW');
    expect(
      (await run(`SELECT * FROM vote_ledger WHERE purchase_id=$1`, [p.id]))
        .length,
    ).toBe(0);
  });
  it('uses an already verified provider transaction ID for receipt rechecks', async () => {
    const { p } = await buy();
    const t = transaction(p);
    await accounting.apply(p.id, t);
    verifyId.mockResolvedValue(t);
    await accounting.verify(p.id, true, 'RECEIPT');
    expect(verifyId).toHaveBeenCalledWith(String(t.id));
    expect(verify).not.toHaveBeenCalled();
    expect(
      (
        await run(
          `SELECT sum(delta)::int AS votes FROM vote_ledger WHERE purchase_id=$1`,
          [p.id],
        )
      )[0].votes,
    ).toBe(3);
  });
  it.each(['67890', '12345'])(
    'recovers a legacy account mismatch using successful key-scoped API evidence: %s',
    async (accountId) => {
      const { p } = await buy();
      expect(p.provider_account_id).toBeNull();
      // Existing ACCOUNT_MISMATCH reviews recover without manually marking them paid.
      await run(
        `UPDATE vote_purchases SET status='REVIEW',review_reason='ACCOUNT_MISMATCH' WHERE id=$1`,
        [p.id],
      );
      verify.mockResolvedValue(transaction(p, { account_id: accountId }));
      await accounting.verify(p.id, true, 'RECEIPT');
      await accounting.verify(p.id, true, 'RECEIPT');
      const [saved] = await run(
        `SELECT status,review_reason FROM vote_purchases WHERE id=$1`,
        [p.id],
      );
      expect(saved).toEqual({
        status: 'PAID',
        review_reason: null,
      });
      expect(
        await run(`SELECT id FROM vote_ledger WHERE purchase_id=$1`, [p.id]),
      ).toHaveLength(1);
    },
  );
  it('correlates failed background verification with the purchase ID and trigger', async () => {
    const { p } = await buy();
    verify.mockRejectedValue(new FlutterwaveProviderError('HTTP_400'));
    const log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await accounting.verify(p.id, true, 'RECONCILIATION');
      expect(log).toHaveBeenCalledWith(
        `Payment verification failed: purchaseId=${p.id}; source=RECONCILIATION; reason=HTTP_400`,
      );
    } finally {
      log.mockRestore();
    }
  });
  it('accepts only active, unrevoked admin sessions and rejects student tokens', async () => {
    const session = await auth.login('test-password');
    expect(await auth.authorize(session.token)).toBe(admin);
    await run(
      `UPDATE voting_admin_sessions SET revoked_at=now() WHERE admin_id=$1`,
      [admin],
    );
    await expect(auth.authorize(session.token)).rejects.toMatchObject({
      status: 403,
    });
    const student = await new JwtService().signAsync(
      { sub: 1 },
      { secret: 'other-secret' },
    );
    await expect(auth.authorize(student)).rejects.toMatchObject({
      status: 401,
    });
    await expect(auth.login('wrong')).rejects.toMatchObject({ status: 401 });
  });
  it('matches administrator email without casing or surrounding-space differences', async () => {
    const normalizedAuth = new VotingAuthService(
      db,
      new JwtService(),
      new VotingConfig(
        new ConfigService({
          VOTING_ADMIN_EMAIL: '  ADMIN@EXAMPLE.TEST  ',
          VOTING_ADMIN_PASSWORD_HASH: config.get('VOTING_ADMIN_PASSWORD_HASH'),
          VOTING_ADMIN_JWT_SECRET: config.get('VOTING_ADMIN_JWT_SECRET'),
        }),
      ),
    );
    expect((await normalizedAuth.login('test-password')).email).toBe(
      'admin@example.test',
    );
  });
  it('diagnoses missing, disabled, unauthorized and mismatched credentials without logging them', async () => {
    const warnings = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const missingAuth = new VotingAuthService(
        db,
        new JwtService(),
        new VotingConfig(
          new ConfigService({
            VOTING_ADMIN_EMAIL: 'missing@example.test',
            VOTING_ADMIN_PASSWORD_HASH: config.get(
              'VOTING_ADMIN_PASSWORD_HASH',
            ),
          }),
        ),
      );
      await expect(missingAuth.login('test-password')).rejects.toMatchObject({
        status: 401,
      });
      expect(warnings).toHaveBeenLastCalledWith(
        'Admin login rejected: ADMIN_NOT_PROVISIONED',
      );
      await run(`UPDATE voting_admins SET enabled=false WHERE id=$1`, [admin]);
      await expect(auth.login('test-password')).rejects.toMatchObject({
        status: 401,
      });
      expect(warnings).toHaveBeenLastCalledWith(
        'Admin login rejected: ADMIN_DISABLED',
      );
      await run(
        `UPDATE voting_admins SET enabled=true,can_manage_votes=false WHERE id=$1`,
        [admin],
      );
      await expect(auth.login('test-password')).rejects.toMatchObject({
        status: 401,
      });
      expect(warnings).toHaveBeenLastCalledWith(
        'Admin login rejected: VOTING_PERMISSION_MISSING',
      );
      await run(`UPDATE voting_admins SET can_manage_votes=true WHERE id=$1`, [
        admin,
      ]);
      await expect(auth.login('wrong')).rejects.toMatchObject({ status: 401 });
      expect(warnings).toHaveBeenLastCalledWith(
        'Admin login rejected: PASSWORD_MISMATCH',
      );
      await expect(auth.login(undefined)).rejects.toMatchObject({
        status: 401,
      });
      expect(warnings).toHaveBeenLastCalledWith(
        'Admin login rejected: INVALID_LOGIN_BODY',
      );
    } finally {
      await run(
        `UPDATE voting_admins SET enabled=true,can_manage_votes=true WHERE id=$1`,
        [admin],
      );
      warnings.mockRestore();
    }
  });
  it('provisions an administrator with operator SQL and preserves the existing record when rerun', async () => {
    const script = readFileSync(
      resolve(__dirname, '../../docs/sql/provision-voting-admin.sql'),
      'utf8',
    );
    const provision = script.replace(
      /admin_email text := '[^']*';/,
      "admin_email text := 'NEW.ADMIN@example.test';",
    );
    await pg.exec(provision);
    const [before] = await run(
      `SELECT id,enabled,can_manage_votes FROM voting_admins WHERE email='new.admin@example.test'`,
    );
    expect(before).toMatchObject({ enabled: true, can_manage_votes: true });
    await run(
      `UPDATE voting_admins SET enabled=false,can_manage_votes=false WHERE id=$1`,
      [before.id],
    );
    await pg.exec(provision);
    const rows = await run(
      `SELECT id,enabled,can_manage_votes FROM voting_admins WHERE email='new.admin@example.test'`,
    );
    expect(rows).toEqual([
      { id: before.id, enabled: true, can_manage_votes: true },
    ]);
  });
  it('requires full provider refund evidence and rejects partial refund accounting', async () => {
    const { p } = await buy();
    const real = new FlutterwaveService(config);
    const t = transaction(p, { status: 'reversed' });
    const refund = {
      id: '123',
      account_id: 12345,
      amount_refunded: toMajor(t.amount),
      transaction_id: t.id,
      status: 'completed-mpgs',
    };
    const api = jest.spyOn(axios, 'request');
    try {
      api.mockResolvedValueOnce({
        data: {
          status: 'success',
          meta: { page_info: { total_pages: 1 } },
          data: [{ ...refund, amount_refunded: 1 }],
        },
      });
      expect(await real.refundState(t)).toBe('REVIEW');
      api.mockResolvedValueOnce({
        data: {
          status: 'success',
          meta: { page_info: { total_pages: 1 } },
          data: [refund],
        },
      });
      expect(await real.refundState(t)).toBe('FULL');
      api.mockResolvedValueOnce({
        data: {
          status: 'success',
          meta: { page_info: { total_pages: 1 } },
          data: [{ ...refund, status: 'completed' }],
        },
      });
      expect(await real.refundState(t)).toBe('REVIEW');
      await accounting.apply(p.id, t);
      expect(
        (await run(`SELECT status FROM vote_purchases WHERE id=$1`, [p.id]))[0]
          .status,
      ).toBe('REVIEW');
      expect(
        (await run(`SELECT * FROM vote_ledger WHERE purchase_id=$1`, [p.id]))
          .length,
      ).toBe(0);
    } finally {
      api.mockRestore();
    }
  });
  it('uses Flutterwave Standard v3, exact naira conversion and server reference verification', async () => {
    const { p } = await buy();
    const real = new FlutterwaveService(config);
    const api = jest.spyOn(axios, 'request');
    try {
      api.mockResolvedValueOnce({
        data: {
          status: 'success',
          data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/test' },
        },
      });
      await expect(real.initialize(p)).resolves.toBe(
        'https://checkout.flutterwave.com/v3/hosted/pay/test',
      );
      expect(api.mock.calls[0][0]).toMatchObject({
        baseURL: 'https://api.flutterwave.com/v3',
        url: '/payments',
        method: 'POST',
        data: {
          tx_ref: p.provider_reference,
          amount: '300.00',
          currency: 'NGN',
          customer: { email: p.email },
          redirect_url: `https://votes.example.test/pages/votes/payment?purchaseId=${p.id}`,
        },
      });
      api.mockResolvedValueOnce({
        data: {
          status: 'success',
          data: {
            id: '123456789',
            tx_ref: p.provider_reference,
            amount: '300.00',
            currency: 'NGN',
            account_id: 12345,
            status: 'successful',
            created_at: new Date(p.accepted_at).toISOString(),
          },
        },
      });
      expect(await real.verify(p.provider_reference)).toMatchObject({
        id: '123456789',
        reference: p.provider_reference,
        amount: 30000,
        status: 'success',
        account_id: '12345',
        domain: 'test',
      });
      expect(api.mock.calls[1][0].url).toBe(
        `/transactions/verify_by_reference?tx_ref=${p.provider_reference}`,
      );
      expect(toMinor('123.45')).toBe(12345);
      expect(toMajor(12345)).toBe('123.45');
      expect(() => toMinor('1.001')).toThrow();
      expect(() => toMinor('9007199254740992')).toThrow();
      expect(() =>
        real.checkoutUrl('https://checkout.paystack.com/old'),
      ).toThrow();
      expect(() =>
        real.checkoutUrl('https://checkout.flutterwave.com@evil.example/'),
      ).toThrow();
    } finally {
      api.mockRestore();
    }
  });
  it('routes raw v3 refund notifications using server-verified transaction IDs', async () => {
    const { p } = await buy();
    const real = new FlutterwaveService(config);
    const route = jest
      .spyOn(real, 'verifyId')
      .mockResolvedValue(transaction(p));
    const raw = Buffer.from(
      JSON.stringify({ id: 456, TransactionId: 123, status: 'completed' }),
    );
    await new VotingWebhooksService(db, real, accounting).accept(
      raw,
      'unit-test-webhook-secret',
    );
    expect(route).toHaveBeenCalledWith('123');
    const [event] = await run(
      `SELECT * FROM payment_webhook_events WHERE reference=$1`,
      [p.provider_reference],
    );
    expect(event).toMatchObject({
      provider: 'flutterwave',
      event_type: 'refund.updated',
    });
  });
  it('keeps legacy provider purchases from resuming or verifying through Flutterwave', async () => {
    const { p } = await buy();
    const id = randomUUID();
    const key = randomUUID();
    await run(
      `INSERT INTO vote_purchases SELECT (jsonb_populate_record(NULL::vote_purchases,to_jsonb(p)||jsonb_build_object('id',$2::text,'idempotency_key',$3::text,'provider_reference',$4::text,'provider','paystack','provider_account_id',NULL,'provider_mode',NULL))).* FROM vote_purchases p WHERE p.id=$1`,
      [p.id, id, key, `legacy-${id}`],
    );
    await expect(purchases.start(key, body())).rejects.toMatchObject({
      status: 409,
    });
    await accounting.verify(id);
    expect(verify).not.toHaveBeenCalled();
  });
  it('expires only after provider-confirmed abandonment and accepts delayed in-window success', async () => {
    const { p, checkout } = await buy();
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date(p.expires_at).getTime() + 1);
    try {
      await accounting.apply(
        p.id,
        transaction(p, { status: 'abandoned', paid_at: null }),
      );
    } finally {
      clock.mockRestore();
    }
    expect(
      (await run(`SELECT status FROM vote_purchases WHERE id=$1`, [p.id]))[0]
        .status,
    ).toBe('EXPIRED');
    await accounting.apply(p.id, transaction(p));
    expect(
      (await purchases.receipt(p.id, checkout.receiptToken)).creditedVotes,
    ).toBe(3);
  });
  it('uploads poll and candidate images and returns canonical URLs on every read', async () => {
    const api = mockCloudinary();
    try {
      const cover = await images.upload(imageFile(), 'POLL', admin);
      const portrait = await images.upload(imageFile(), 'CANDIDATE', admin);
      expect(cover).toMatchObject({
        purpose: 'POLL',
        format: 'png',
        width: 1,
        height: 1,
      });
      expect(cover).not.toHaveProperty('apiSecret');
      const saved = await polls.create(
        {
          title: 'Poll with cover',
          description: 'Description',
          currency: 'NGN',
          votePriceMinor: 100,
          maxVotesPerPurchase: 10,
          opensAt: new Date(Date.now() - 1000).toISOString(),
          closesAt: new Date(Date.now() + 3600000).toISOString(),
          resultsVisible: false,
          imageId: cover.imageId,
        },
        admin,
      );
      const savedCandidate = await candidates.create(
        saved.id,
        {
          name: 'Portrait',
          bio: 'Biography',
          photoUrl: null,
          photoImageId: portrait.imageId,
        },
        admin,
      );
      expect(saved).toMatchObject({
        imageId: cover.imageId,
        imageUrl: cover.url,
      });
      expect(savedCandidate).toMatchObject({
        photoImageId: portrait.imageId,
        photoUrl: portrait.url,
      });
      await polls.status(saved.id, 'PUBLISHED', admin);
      const publicDetail = await polls.detail(saved.slug);
      expect(publicDetail.poll).toMatchObject({
        imageId: cover.imageId,
        imageUrl: cover.url,
        totalVotes: null,
      });
      expect(publicDetail.candidates[0]).toMatchObject({
        photoImageId: portrait.imageId,
        photoUrl: portrait.url,
        voteCount: null,
      });
      expect(
        (await polls.list()).find((p) => p.id === saved.id)?.imageUrl,
      ).toBe(cover.url);
      expect((await polls.detail(saved.id, true)).poll.imageUrl).toBe(
        cover.url,
      );
      expect((api.mock.calls[0][1] as FormData).get('overwrite')).toBe('false');
    } finally {
      api.mockRestore();
    }
  });
  it('rejects images from a different purpose, account, or an unfinished upload', async () => {
    const api = mockCloudinary();
    try {
      const cover = await images.upload(imageFile(), 'POLL', admin);
      await expect(
        candidates.create(
          poll.id,
          {
            name: 'Wrong purpose',
            bio: 'Biography',
            photoUrl: null,
            photoImageId: cover.imageId,
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 400 });
      const portrait = await images.upload(imageFile(), 'CANDIDATE', admin);
      await expect(
        candidates.create(
          poll.id,
          {
            name: 'Conflicting values',
            bio: 'Biography',
            photoUrl: 'https://images.example.test/photo.png',
            photoImageId: portrait.imageId,
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        db.transaction((m) =>
          images.resolve(cover.imageId, 'POLL', randomUUID(), m),
        ),
      ).rejects.toMatchObject({ status: 400 });
      await run(`UPDATE voting_images SET state='FAILED' WHERE id=$1`, [
        portrait.imageId,
      ]);
      await expect(
        candidates.create(
          poll.id,
          {
            name: 'Failed upload',
            bio: 'Biography',
            photoUrl: null,
            photoImageId: portrait.imageId,
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      api.mockRestore();
    }
  });
  it('rejects unsupported or oversized files and leaves provider failures unavailable', async () => {
    expect(() =>
      imageFormat({ ...imageFile(), mimetype: 'image/svg+xml' }),
    ).toThrow();
    expect(() =>
      imageFormat({ ...imageFile(), buffer: Buffer.alloc(20), size: 20 }),
    ).toThrow();
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    expect(() =>
      imageFormat({
        buffer: oversized,
        size: oversized.length,
        mimetype: 'image/png',
      }),
    ).toThrow();
    const api = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('provider-internal-sensitive-details'));
    try {
      await expect(
        images.upload(imageFile(), 'POLL', admin),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          success: false,
          message: 'Image upload could not be completed. Please try again.',
          data: null,
        },
      });
      const form = api.mock.calls[0][1] as FormData;
      const [record] = await run(
        `SELECT state,url FROM voting_images WHERE public_id=$1`,
        [form.get('public_id')],
      );
      expect(record).toEqual({ state: 'FAILED', url: null });
    } finally {
      api.mockRestore();
    }
  });
  it('accepts authenticated multipart uploads and enforces file limits over HTTP', async () => {
    const api = mockCloudinary();
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ global: true }), VotingModule],
    })
      .overrideProvider(VotingConfig)
      .useValue(config)
      .useMocker((token) => (token === DataSource ? db : undefined))
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    try {
      const server = app.getHttpServer();
      await request(server)
        .post('/votes/api/admin/images')
        .field('purpose', 'POLL')
        .attach('file', png, {
          filename: 'cover.png',
          contentType: 'image/png',
        })
        .expect(401);
      expect(api).not.toHaveBeenCalled();
      const login = await auth.login('test-password');
      const uploaded = await request(server)
        .post('/votes/api/admin/images')
        .set('Authorization', `Bearer ${login.token}`)
        .field('purpose', 'POLL')
        .attach('file', png, {
          filename: 'cover.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(uploaded.body.data).toMatchObject({
        purpose: 'POLL',
        format: 'png',
      });
      const calls = api.mock.calls.length;
      await request(server)
        .post('/votes/api/admin/images')
        .set('Authorization', `Bearer ${login.token}`)
        .field('purpose', 'INVALID')
        .attach('file', png, {
          filename: 'cover.png',
          contentType: 'image/png',
        })
        .expect(400);
      await request(server)
        .post('/votes/api/admin/images')
        .set('Authorization', `Bearer ${login.token}`)
        .field('purpose', 'POLL')
        .attach('file', Buffer.alloc(MAX_IMAGE_BYTES + 1), {
          filename: 'large.png',
          contentType: 'image/png',
        })
        .expect(413);
      expect(api).toHaveBeenCalledTimes(calls);
    } finally {
      await app.close();
      api.mockRestore();
    }
  });
  it('wires the Nest modules and enforces HTTP authentication, DTO validation and error envelopes', async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ global: true }), VotingModule],
    })
      .overrideProvider(VotingConfig)
      .useValue(config)
      .useMocker((token) => (token === DataSource ? db : undefined))
      .compile();
    const app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    try {
      const server = app.getHttpServer();
      const publicResponse = await request(server)
        .get('/votes/api/polls')
        .expect(200);
      expect(publicResponse.headers['cache-control']).toBe('no-store');
      expect(publicResponse.body.success).toBe(true);
      await request(server).get('/votes/api/admin/polls').expect(401);
      const login = await request(server)
        .post('/votes/api/admin/login')
        .send({ password: 'test-password' })
        .expect(200);
      const session = login.body.data;
      await request(server)
        .get('/votes/api/admin/polls')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);
      const invalid = await request(server)
        .post('/votes/api/purchases')
        .set('Idempotency-Key', randomUUID())
        .send({ ...body(), quantity: -1, amount: 1 })
        .expect(400);
      expect(invalid.body).toMatchObject({ success: false, data: null });
      const notFound = await request(server)
        .get(`/votes/api/polls/${poll.slug}`)
        .expect(404);
      expect(notFound.body).toMatchObject({ success: false, data: null });
      await request(server)
        .post('/votes/api/webhooks/flutterwave')
        .send({ event: 'charge.success' })
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
