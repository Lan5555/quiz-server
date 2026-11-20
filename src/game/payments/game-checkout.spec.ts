import { PGlite } from '@electric-sql/pglite';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DataSource, QueryRunner } from 'typeorm';
import { EmbraceShopAndExperience1795219200000 } from '../../migrations/1795219200000-EmbraceShopAndExperience';
import { VotingConfig } from '../../voting/common/voting';
import {
  FlutterwaveProviderError,
  FlutterwaveService,
} from '../../voting/payments/flutterwave.service';
import type { ProviderTransaction } from '../../voting/payments/flutterwave.service';
import { GameCheckoutService } from './game-checkout.service';
import { ProgressionService } from '../progression/progression.service';

describe('Embrace cash gear checkout', () => {
  const pg = new PGlite();
  const sql = readFileSync(
    resolve(__dirname, '../../../docs/sql/embrace-game.sql'),
    'utf8',
  );
  const query = async (statement: string, params?: unknown[]) =>
    (await pg.query(statement, params)).rows;
  const db = {
    query,
    manager: { query },
    transaction: (
      callback: (tx: { query: typeof query }) => Promise<unknown>,
    ) =>
      pg.transaction((tx) =>
        callback({
          query: async (statement, params) =>
            (await tx.query(statement, params)).rows,
        }),
      ),
  } as unknown as DataSource;
  const config = new VotingConfig(
    new ConfigService({
      GAME_CASH_CHECKOUT_ENABLED: 'true',
      VOTING_FRONTEND_ORIGIN: 'https://example.test',
      VOTING_PROVIDER_MODE: 'test',
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-fixture',
      FLUTTERWAVE_SECRET_HASH: 'local-test-signature',
    }),
  );
  const provider = new FlutterwaveService(config);
  const checkout = new GameCheckoutService(db, provider, config);
  const progression = new ProgressionService(db);

  beforeAll(async () => {
    await pg.exec(sql);
    await new EmbraceShopAndExperience1795219200000().up({ query: (statement: string) => pg.exec(statement) } as QueryRunner);
  }, 15_000);
  afterAll(() => pg.close());
  afterEach(() => jest.restoreAllMocks());

  async function account() {
    const id = randomUUID();
    await query(
      'INSERT INTO game_accounts(id,username,password_salt,password_digest) VALUES ($1,$2,$3,$4)',
      [id, id.slice(0, 24), 'fixture', 'fixture'],
    );
    return id;
  }

  function evidence(
    id: string,
    fields: Partial<ProviderTransaction> = {},
  ): ProviderTransaction {
    return {
      id: '100001',
      reference: `game-${id}`,
      status: 'success',
      amount: 350000,
      currency: 'NGN',
      domain: 'test',
      account_id: '100',
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      ...fields,
    };
  }

  async function start(gearId = 'crownforged_blade') {
    const init = jest
      .spyOn(provider, 'initializeHosted')
      .mockResolvedValue('https://checkout.flutterwave.com/test');
    const owner = await account();
    const requestId = randomUUID();
    const order = await checkout.start(
      owner,
      requestId,
      gearId,
      'player@example.test',
    );
    return { init, owner, requestId, order };
  }

  it('grants the same permanent skill through either currency without duplicate purchases', async () => {
    const skill = 'call_moonveil_double';
    expect(checkout.offers().offers).toContainEqual({ gearId: skill, kind: 'skill', name: 'Call Moonveil Double', amountMinor: 120_000 });
    const { owner, order } = await start(skill);
    await query('UPDATE game_accounts SET credits=1000 WHERE id=$1', [owner]);
    await expect(progression.purchase(owner, randomUUID(), skill)).rejects.toMatchObject({ status: 409 });
    expect((await progression.profile(owner)).unlockedSkills).not.toContain(skill);
    jest.spyOn(provider, 'verify').mockResolvedValue(evidence(order.id, { id: '450021', amount: 120_000 }));
    await Promise.all([checkout.verify(owner, order.id), checkout.verify(owner, order.id)]);
    expect((await progression.roomLoadout(owner)).unlockedSkills).toEqual([skill]);
    await expect(progression.purchase(owner, randomUUID(), skill)).rejects.toMatchObject({ status: 409 });

    const second = await account();
    await query('UPDATE game_accounts SET credits=1000 WHERE id=$1', [second]);
    const purchased = await progression.purchase(second, randomUUID(), skill);
    expect(purchased.profile).toMatchObject({ credits: 250, unlockedSkills: [skill] });
    await expect(checkout.start(second, randomUUID(), skill, 'player@example.test')).rejects.toMatchObject({ status: 409 });
  });

  it('grants the named fighter only once after verified full payment', async () => {
    const { owner, order, init } = await start('ember-duelist');
    expect(init.mock.calls[0][0].redirectUrl).toContain('&forge=summon');
    expect(checkout.offers().offers).toContainEqual({
      gearId: 'ember-duelist',
      kind: 'fighter',
      name: 'Ember Duelist',
      amountMinor: 350000,
    });
    const inventory = () =>
      query('SELECT fighter_ids, gear FROM game_accounts WHERE id=$1', [owner]);
    expect((await inventory())[0]).toMatchObject({ fighter_ids: [] });
    jest
      .spyOn(provider, 'verify')
      .mockResolvedValue(evidence(order.id, { id: '450001' }));
    await Promise.all([
      checkout.verify(owner, order.id),
      checkout.verify(owner, order.id),
    ]);
    expect((await inventory())[0]).toMatchObject({
      fighter_ids: ['ember-duelist'],
      gear: ['iron_blade', 'traveler_coat'],
    });
    await expect(
      checkout.start(
        owner,
        randomUUID(),
        'ember-duelist',
        'player@example.test',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('sells Dual Summoning for ?4,000 and grants it after verified payment', async () => {
    expect(checkout.offers().offers).toContainEqual({
      gearId: 'dual_summoning', kind: 'summon', name: 'Dual Summoning', amountMinor: 400_000,
    });
    const { owner, order, init } = await start('dual_summoning');
    expect(init.mock.calls[0][0].amount).toBe(400_000);
    const inventory = () => query('SELECT gear FROM game_accounts WHERE id=$1', [owner]);
    expect((await inventory())[0]).toEqual({ gear: ['iron_blade', 'traveler_coat'] });
    jest.spyOn(provider, 'verify').mockResolvedValue(evidence(order.id, { id: '450010', amount: 400_000 }));
    await Promise.all([checkout.verify(owner, order.id), checkout.verify(owner, order.id)]);
    expect((await inventory())[0]).toEqual({ gear: ['iron_blade', 'traveler_coat', 'dual_summoning'] });
    await expect(checkout.start(owner, randomUUID(), 'dual_summoning', 'player@example.test'))
      .rejects.toMatchObject({ status: 409 });
  });

  it('lists the additional server-priced weapons, armor, and consumables', () => {
    expect(checkout.offers().offers).toEqual(
      expect.arrayContaining([
        {
          gearId: 'crownforged_blade',
          kind: 'gear',
          name: 'Crownforged Blade',
          amountMinor: 350_000,
        },
        {
          gearId: 'sovereign_plate',
          kind: 'gear',
          name: 'Sovereign Plate',
          amountMinor: 350_000,
        },
        {
          gearId: 'royal_bloodleaf',
          kind: 'item',
          name: 'Royal Bloodleaf',
          amountMinor: 50_000,
        },
        {
          gearId: 'sovereign_ward',
          kind: 'item',
          name: 'Sovereign Ward',
          amountMinor: 50_000,
        },
      ]),
    );
  });

  it('adds purchased Cinders once after concurrent payment verification', async () => {
    const { owner, order } = await start('cinders_300');
    const balance = async () => (await query('SELECT credits FROM game_accounts WHERE id=$1', [owner]))[0].credits;
    const before = await balance();
    jest.spyOn(provider, 'verify').mockResolvedValue(evidence(order.id, { id: '450005', amount: 100_000 }));
    await Promise.all([checkout.verify(owner, order.id), checkout.verify(owner, order.id)]);
    expect(await balance()).toBe(before + 300);
    await expect(checkout.start(owner, randomUUID(), 'ashblade', 'player@example.test')).rejects.toMatchObject({ status: 400 });
  });

  it('adds one consumable per verified order and allows a subsequent purchase', async () => {
    const { owner, order, init, requestId } = await start('sovereign_ward');
    const inventory = () =>
      query('SELECT gear, items, credits FROM game_accounts WHERE id=$1', [
        owner,
      ]);
    const [original] = await inventory();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50_000 }),
    );
    const verify = jest
      .spyOn(provider, 'verify')
      .mockResolvedValue(evidence(order.id, { id: '450002', amount: 50_000 }));
    await Promise.all([
      checkout.verify(owner, order.id),
      checkout.verify(owner, order.id),
    ]);
    const [afterFirst] = await inventory();
    expect(afterFirst).toMatchObject({
      gear: original.gear,
      credits: original.credits,
      items: { sovereign_ward: (original.items.sovereign_ward ?? 0) + 1 },
    });
    const replay = await checkout.start(
      owner,
      requestId,
      'sovereign_ward',
      'player@example.test',
    );
    expect(replay).toMatchObject({ id: order.id, status: 'FULFILLED' });
    const next = await checkout.start(
      owner,
      randomUUID(),
      'sovereign_ward',
      'player@example.test',
    );
    expect(next.id).not.toBe(order.id);
    verify.mockResolvedValue(
      evidence(next.id, { id: '450003', amount: 50_000 }),
    );
    await checkout.verify(owner, next.id);
    expect((await inventory())[0]).toMatchObject({
      items: { sovereign_ward: (original.items.sovereign_ward ?? 0) + 2 },
    });
  });

  it('reapplies the manual SQL without resetting story edits or account inventory', async () => {
    const owner = await account();
    await query('UPDATE game_accounts SET credits=987 WHERE id=$1', [owner]);
    await query(
      "UPDATE game_story_nodes SET scene=jsonb_set(scene,'{title}',to_jsonb('Edited Highlands'::text)) WHERE node_id='start'",
    );
    await pg.exec(sql);
    expect(
      await query('SELECT credits FROM game_accounts WHERE id=$1', [owner]),
    ).toEqual([{ credits: 987 }]);
    expect(
      await query(
        "SELECT scene->>'title' AS title FROM game_story_nodes WHERE node_id='start'",
      ),
    ).toEqual([{ title: 'Edited Highlands' }]);
  });

  it('uses server-priced hosted checkout, isolates ownership and delivers verified gear once', async () => {
    const { init, owner, requestId, order } = await start();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 350000,
        reference: `game-${order.id}`,
        redirectUrl: `https://example.test/pages/embrace-game?gameOrder=${order.id}`,
      }),
    );
    const replay = await checkout.start(
      owner,
      requestId,
      'crownforged_blade',
      'PLAYER@example.test',
    );
    expect(replay.id).toBe(order.id);
    expect(
      (
        await checkout.start(
          owner,
          randomUUID(),
          'crownforged_blade',
          'other@example.test',
        )
      ).id,
    ).toBe(order.id);
    expect(init).toHaveBeenCalledTimes(1);
    await expect(
      checkout.verify(await account(), order.id),
    ).rejects.toMatchObject({ status: 404 });
    jest.spyOn(provider, 'verify').mockResolvedValue(evidence(order.id));
    const results = await Promise.all([
      checkout.verify(owner, order.id),
      checkout.verify(owner, order.id),
    ]);
    expect(results.map(({ status }) => status)).toEqual([
      'FULFILLED',
      'FULFILLED',
    ]);
    expect(
      await query('SELECT gear FROM game_accounts WHERE id=$1', [owner]),
    ).toEqual([{ gear: ['iron_blade', 'traveler_coat', 'crownforged_blade'] }]);
    expect(
      (
        await checkout.start(
          owner,
          requestId,
          'crownforged_blade',
          'player@example.test',
        )
      ).status,
    ).toBe('FULFILLED');
    await expect(
      checkout.start(owner, randomUUID(), 'crownforged_blade', 'player@example.test'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('authenticates shared webhooks and holds a mismatched payment for review', async () => {
    const { owner, order } = await start('sovereign_plate');
    const webhook = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: { id: '100002', tx_ref: `game-${order.id}` },
      }),
    );
    const verify = jest
      .spyOn(provider, 'verifyId')
      .mockResolvedValue(evidence(order.id, { id: '100002', amount: 100000 }));
    await expect(
      checkout.routeWebhook(webhook, 'invalid'),
    ).rejects.toMatchObject({ status: 401 });
    expect(verify).not.toHaveBeenCalled();
    await expect(
      checkout.routeWebhook(webhook, 'local-test-signature'),
    ).resolves.toBe(true);
    expect((await checkout.orders(owner))[0].status).toBe('REVIEW');
    expect(
      await query('SELECT gear FROM game_accounts WHERE id=$1', [owner]),
    ).toEqual([{ gear: ['iron_blade', 'traveler_coat'] }]);
    await expect(
      checkout.routeWebhook(Buffer.from('{"data":{"tx_ref":"vote-example"}}')),
    ).resolves.toBe(false);
  });

  it('retains an uncertain checkout reference without creating a second hosted link', async () => {
    const init = jest
      .spyOn(provider, 'initializeHosted')
      .mockRejectedValue(new FlutterwaveProviderError('ETIMEDOUT'));
    const owner = await account();
    const key = randomUUID();
    await expect(
      checkout.start(owner, key, 'crownforged_blade', 'player@example.test'),
    ).rejects.toMatchObject({ status: 503 });
    const retry = await checkout.start(
      owner,
      key,
      'crownforged_blade',
      'player@example.test',
    );
    expect(retry).toMatchObject({ status: 'PENDING', checkoutUrl: null });
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('releases an old checkout after a provider 404 while still accepting late verified payment', async () => {
    const { owner, order } = await start();
    await query(
      "UPDATE game_checkout_orders SET expires_at=now()-interval '25 hours' WHERE id=$1",
      [order.id],
    );
    const verify = jest
      .spyOn(provider, 'verify')
      .mockRejectedValueOnce(new FlutterwaveProviderError('HTTP_404'))
      .mockResolvedValueOnce(evidence(order.id, { id: '100003' }));
    await expect(checkout.verify(owner, order.id)).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    await expect(checkout.verify(owner, order.id)).resolves.toMatchObject({
      status: 'FULFILLED',
    });
    expect(verify).toHaveBeenCalledTimes(2);
  });
});
