import { EmbracePerTierCheckpoints1795392000000 } from '../migrations/1795392000000-EmbracePerTierCheckpoints';
import { EmbraceEncounterCheckpoints1795305600000 } from '../migrations/1795305600000-EmbraceEncounterCheckpoints';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DataSource, QueryRunner } from 'typeorm';
import type { Server, Socket } from 'socket.io';
import { EmbraceShopAndExperience1795219200000 } from '../migrations/1795219200000-EmbraceShopAndExperience';
import { GameAdminService } from './admin/game-admin.service';
import { EmbraceFighters1795132800000 } from '../migrations/1795132800000-EmbraceFighters';
import { EmbraceProgression1794873600000 } from '../migrations/1794873600000-EmbraceProgression';
import { EmbraceAdmin1795046400000 } from '../migrations/1795046400000-EmbraceAdmin';
import { GameAccountsService } from './accounts/game-accounts.service';
import { CombatEngine } from './engines/combat.engine';
import { createEncounterPath } from './engines/encounter-path';
import { presentCombatKit } from './engines/fighter-combat';
import { StoryEngine } from './engines/story.engine';
import { GameStore } from './game.store';
import { GameGateway } from './game.gateway';
import type { Player } from './game.types';
import { STARTER_LOADOUT } from './progression/catalog';
import { ProgressionService } from './progression/progression.service';
import { BattleRewardRetentionService } from './progression/battle-reward-retention.service';
import { EmbraceBattleRewardRetention1795478400000 } from '../migrations/1795478400000-EmbraceBattleRewardRetention';

describe('Embrace progression PostgreSQL integration', () => {
  const pg = new PGlite();
  const query = async (sql: string, params?: unknown[]) =>
    (await pg.query(sql, params)).rows;
  const db = {
    query,
    manager: { query },
    transaction: (
      callback: (tx: { query: typeof query }) => Promise<unknown>,
    ) =>
      pg.transaction((tx) =>
        callback({
          query: async (sql, params) => (await tx.query(sql, params)).rows,
        }),
      ),
  } as unknown as DataSource;
  const accounts = new GameAccountsService(db);
  const progression = new ProgressionService(db);

  beforeAll(async () => {
    const runner = {
      query: (sql: string, params?: unknown[]) =>
        params ? query(sql, params) : pg.exec(sql),
    } as QueryRunner;
    await new EmbraceProgression1794873600000().up(runner);
    await new EmbraceAdmin1795046400000().up(runner);
    await new EmbraceFighters1795132800000().up(runner);
    await new EmbraceShopAndExperience1795219200000().up(runner);
    await new EmbraceEncounterCheckpoints1795305600000().up(runner);
    await new EmbracePerTierCheckpoints1795392000000().up(runner);
    await new EmbraceBattleRewardRetention1795478400000().up(runner);
  }, 15000);

  afterAll(() => pg.close());

  it('provides distinct kits for new fighters and keeps elites within the 12-fight path', () => {
    expect(presentCombatKit('lady-ley', ['call_moonveil_double']).skills.map(({ id }) => id)).toEqual([
      'astral_severance', 'crimson_waltz', 'moonveil_reflection', 'call_moonveil_double',
    ]);
    expect(presentCombatKit('grave-chorister', ['call_moonveil_double']).skills.map(({ id }) => id)).toEqual([
      'unwritten_end', 'chronos_elegy', 'funeral_of_stars',
    ]);
    const first = createEncounterPath().levels.map(({ id }) => id);
    const second = createEncounterPath(false, 2).levels.map(({ id }) => id);
    expect(first).toHaveLength(12);
    expect(first).toEqual(expect.arrayContaining(['glasswing-siren', 'obsidian-harrower']));
    expect(second).toHaveLength(12);
    expect(second).toEqual(expect.arrayContaining(['saltglass-oracle', 'cinder-jackal']));
    expect(createEncounterPath(true).levels).toHaveLength(6);
  });

  it('seeds and loads the existing story graph from PostgreSQL', async () => {
    await query(
      "UPDATE game_story_nodes SET scene=jsonb_set(scene,'{title}',to_jsonb('Revised Highlands'::text)) WHERE node_id='start'",
    );
    const story = new StoryEngine(db);
    await story.onModuleInit();
    expect(story.getInitialNode().title).toBe('Revised Highlands');
    expect(Object.keys(story.getStory()).length).toBeGreaterThan(15);
    expect(story.getNode('constructor')).toBeUndefined();
  });

  it('normalizes account names, authenticates independently, and revokes signed-out sessions', async () => {
    const registered = await accounts.authenticate(
      'Aster',
      'long-game-pass',
      'test-auth',
      true,
    );
    const loggedIn = await accounts.authenticate(
      'ASTER',
      'long-game-pass',
      'test-auth',
      false,
    );
    expect(loggedIn.id).toBe(registered.id);
    await expect(
      accounts.requireSession(registered.token),
    ).resolves.toMatchObject({ moderator: false, username: 'aster' });
    await accounts.logout(registered.token);
    await expect(
      accounts.requireSession(registered.token),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      accounts.requireSession(loggedIn.token),
    ).resolves.toMatchObject({ id: registered.id });
  });

  it('deduplicates a concurrent purchase and rejects a loadout with unowned gear', async () => {
    const { id } = await accounts.authenticate(
      'Ember',
      'long-game-pass',
      'test-shop',
      true,
    );
    const key = randomUUID();
    const [first, second] = await Promise.all([
      progression.purchase(id, key, 'bloodleaf_tonic'),
      progression.purchase(id, key, 'bloodleaf_tonic'),
    ]);
    expect(first.result).toEqual(second.result);
    expect(second.profile).toMatchObject({
      credits: 250,
      items: { bloodleaf_tonic: 3 },
    });
    await expect(
      progression.purchase(id, key, 'ward_stone'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      progression.saveLoadout(id, { ...STARTER_LOADOUT, weapon: 'hollowfang' }),
    ).rejects.toMatchObject({ status: 400 });
    const spent = await Promise.all(
      Array.from({ length: 4 }, () =>
        progression.consumeItem(id, 'bloodleaf_tonic'),
      ),
    );
    expect(spent.filter(Boolean)).toHaveLength(3);
  });

  it('prunes old guards without changing balances or allowing an expired settlement to pay again', async () => {
    const { id } = await accounts.authenticate('Retention', 'long-game-pass', 'test-retention', true);
    const expiredBattle = randomUUID();
    const recentBattle = randomUUID();
    const settledAt = new Date();
    await progression.reward(id, expiredBattle, settledAt);
    await progression.reward(id, recentBattle, settledAt);
    await query("UPDATE game_battle_rewards SET created_at=now()-interval '8 days' WHERE account_id=$1 AND battle_id=$2", [id, expiredBattle]);
    const before = await progression.profile(id);
    const retention = new BattleRewardRetentionService(db);
    expect(await retention.pruneBatch()).toBe(1);
    expect(await retention.pruneBatch()).toBe(0);
    expect(await query('SELECT battle_id FROM game_battle_rewards WHERE account_id=$1', [id])).toEqual([{ battle_id: recentBattle }]);
    const expiredTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(await progression.reward(id, expiredBattle, expiredTime)).toBeUndefined();
    expect(await progression.reward(id, randomUUID(), expiredTime)).toBeUndefined();
    expect(await progression.reward(id, recentBattle, settledAt)).toBeUndefined();
    expect(await progression.reward(id, randomUUID(), new Date(Date.now() + 3600_000))).toBeUndefined();
    expect(await progression.profile(id)).toEqual(before);
    expect(await query('SELECT battle_id FROM game_battle_rewards WHERE account_id=$1', [id])).toHaveLength(1);
    expect(await progression.reward(id, randomUUID(), new Date())).toBeDefined();
  });

  it('guarantees the tenth summon and settles battle Cinders and XP once', async () => {
    const { id } = await accounts.authenticate(
      'Cinder',
      'long-game-pass',
      'test-summon',
      true,
    );
    await query('UPDATE game_accounts SET pity=9 WHERE id=$1', [id]);
    const purchase = await progression.purchase(id, randomUUID(), 'summon');
    expect(purchase.result.guaranteed).toBe(true);
    expect(['hollowfang', 'oathkeeper_plate']).toContain(
      purchase.result.itemId,
    );
    expect(purchase.profile.pity).toBe(0);
    const battleId = randomUUID();
    const settledAt = new Date();
    await Promise.all([
      progression.reward(id, battleId, settledAt),
      progression.reward(id, battleId, settledAt),
    ]);
    expect(await progression.profile(id)).toMatchObject({ credits: 230, xp: 25, progression: { level: 1 } });
    for (let i = 0; i < 3; i++) await progression.reward(id, randomUUID(), new Date());
    expect(await progression.profile(id)).toMatchObject({
      credits: 320, xp: 100, progression: { level: 2, attack: 2, defense: 1 },
    });
    expect(await progression.roomLoadout(id)).toMatchObject({ strength: { attack: 2, defense: 1 } });
  });

  it('publishes a moderator item once and uses its actual effect in combat', async () => {
    const { id } = await accounts.authenticate('ShopFixture', 'long-game-pass', 'shop-create', true);
    const admin = new GameAdminService(db);
    const input = { requestId: randomUUID(), name: 'Forest Elixir', effect: 'heal' as const, power: 200, price: 70 };
    const item = await admin.createShopItem(id, input);
    await expect(admin.createShopItem(id, input)).resolves.toEqual(item);
    expect((await progression.catalog()).items[item.id]).toMatchObject({ name: input.name, price: 70 });
    await expect(progression.purchase(id, randomUUID(), 'royal_bloodleaf')).rejects.toMatchObject({ status: 400 });
    await progression.purchase(id, randomUUID(), item.id);
    await progression.saveLoadout(id, { ...STARTER_LOADOUT, item: item.id });
    const equipped = await progression.roomLoadout(id);
    expect(equipped.equippedItem).toMatchObject({ name: input.name, power: 200 });
    const game = new GameStore().createRoom('custom-item-fixture');
    const player: Player = { id, teamId: 'ravens', name: 'Fixture', hp: 400, maxHp: 1000, status: 'alive', ready: true, connected: true, loadout: equipped };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const battle = engine.createCpuBattle(game, 'ravens', 'Target', 5000, 5000);
    game.battle = battle;
    player.hp = 400;
    expect(await progression.consumeItem(id, item.id)).toBe(true);
    expect(engine.performAction(game, player, 'item', item.id)).toContain('Forest Elixir');
    expect(player.hp).toBe(600);
    expect(await progression.consumeItem(id, item.id)).toBe(false);
  });

  it('purchases one fighter summon exactly once and restores ownership in the room', async () => {
    const { id } = await accounts.authenticate(
      'SentinelFixture',
      'long-game-pass',
      'test-skill-ownership',
      true,
    );
    await query('UPDATE game_accounts SET credits=1200 WHERE id=$1', [id]);
    const key = randomUUID();
    const first = await progression.purchase(id, key, 'call_iron_sentinel');
    expect(first.profile).toMatchObject({
      credits: 600,
      unlockedSkills: ['call_iron_sentinel'],
    });
    await expect(
      progression.purchase(id, key, 'call_iron_sentinel'),
    ).resolves.toEqual(first);
    await expect(
      progression.purchase(id, randomUUID(), 'call_iron_sentinel'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(progression.roomLoadout(id)).resolves.toMatchObject({
      unlockedSkills: ['call_iron_sentinel'],
    });
    const engine = new CombatEngine();
    const loadout = await progression.roomLoadout(id);
    const player = { fighterId: 'knight', loadout, skillCharges: 2 } as Player;
    expect(() =>
      engine.validateAction(player, 'skill', 'call_iron_sentinel'),
    ).not.toThrow();
    expect(() =>
      engine.validateAction(
        { ...player, fighterId: 'monk' },
        'skill',
        'call_iron_sentinel',
      ),
    ).toThrow('has not unlocked');
  });

  it('creates rooms before the fighter upgrade and diagnoses legacy fighter inventory requests', async () => {
    const account = await accounts.authenticate(
      'Legacy',
      'long-game-pass',
      'legacy-room',
      true,
    );
    const store = new GameStore();
    const gateway = new GameGateway(
      store,
      new StoryEngine(db),
      new CombatEngine(),
      accounts,
      progression,
    );
    gateway.server = { to: () => ({ emit: jest.fn() }) } as unknown as Server;
    const send = jest.fn();
    const socket = {
      id: 'legacy-fixture',
      connected: true,
      send,
      join: jest.fn(),
      handshake: { auth: { gameToken: account.token } },
    } as unknown as Socket;
    const client = { socket };
    const submit = (event: object) =>
      gateway['handleMessage'](client, JSON.stringify(event));
    const schema = readFileSync(
      resolve(__dirname, '../../docs/sql/embrace-fighters.sql'),
      'utf8',
    );
    const log = jest
      .spyOn(gateway['logger'], 'error')
      .mockImplementation(() => undefined);
    await pg.exec(
      'ALTER TABLE game_accounts RENAME COLUMN fighter_ids TO previous_fighter_ids',
    );
    try {
      await expect(progression.profile(account.id!)).rejects.toMatchObject({
        code: '42703',
      });
      await submit({
        type: 'CREATE_ROOM',
        mode: 'pvp',
        battleMode: 'pvp',
        teamId: 'ravens',
        arenaId: 'ember-citadel',
      });
      expect(store.getAllGames()).toHaveLength(1);
      expect(send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"ROOM_CREATED"'),
      );

      const select = {
        type: 'SELECT_FIGHTER',
        playerId: account.id,
        fighterId: 'ember-duelist',
      };
      await submit(select);
      expect(log).toHaveBeenCalledWith(
        'Game event failed: event=SELECT_FIGHTER stage=select_fighter socket=legacy-fixture database_error SQLSTATE=42703',
      );
      expect(send).toHaveBeenLastCalledWith(
        expect.stringContaining('The game database needs an update.'),
      );

      await pg.exec(schema);
      await expect(progression.profile(account.id!)).resolves.toMatchObject({
        id: account.id,
        credits: 300,
        fighters: [],
      });
      await pg.exec(schema);
      await submit(select);
      expect(send).toHaveBeenLastCalledWith(
        expect.stringContaining('Unlock this fighter'),
      );
      await query(
        'UPDATE game_accounts SET fighter_ids=$2::jsonb WHERE id=$1',
        [account.id, JSON.stringify(['ember-duelist'])],
      );
      await pg.exec(schema);
      await expect(progression.profile(account.id!)).resolves.toMatchObject({
        fighters: ['ember-duelist'],
      });
    } finally {
      log.mockRestore();
      await pg.exec(
        'ALTER TABLE game_accounts DROP COLUMN IF EXISTS fighter_ids',
      );
      await pg.exec(
        'ALTER TABLE game_accounts RENAME COLUMN previous_fighter_ids TO fighter_ids',
      );
    }
  });

  it('recovers PvP room creation when a cached lobby sends HP as arenaId', async () => {
    const account = await accounts.authenticate(
      'CachedLobby',
      'long-game-pass',
      'cached-lobby',
      true,
    );
    const store = new GameStore();
    const gateway = new GameGateway(
      store,
      new StoryEngine(db),
      new CombatEngine(),
      accounts,
      progression,
    );
    gateway.server = { to: () => ({ emit: jest.fn() }) } as unknown as Server;
    const send = jest.fn();
    const socket = {
      id: 'cached-lobby',
      connected: true,
      handshake: { auth: { gameToken: account.token } },
      send,
      join: jest.fn(),
    } as unknown as Socket;
    const client = { socket };
    const submit = (fields: object) =>
      gateway['handleMessage'](
        client,
        JSON.stringify({
          type: 'CREATE_ROOM',
          battleMode: 'pvp',
          teamId: 'ravens',
          ...fields,
        }),
      );

    for (const fields of [
      { arenaId: 'unknown-arena' },
      { arenaId: 10001 },
      { arenaId: 1500, startingHp: 2000 },
      { arenaId: 1500, battleMode: 'cpu' },
    ]) {
      await submit(fields);
      expect(send).toHaveBeenLastCalledWith(
        expect.stringContaining('Choose an available arena.'),
      );
    }
    expect(store.getAllGames()).toHaveLength(0);

    await submit({ arenaId: 1500 });
    expect(store.getAllGames()).toEqual([
      expect.objectContaining({
        arenaId: 'moonlit-observatory',
        startingHp: 1500,
        phase: 'waiting',
      }),
    ]);
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"ROOM_CREATED"'),
    );
  });

  it('binds PvP ownership to sessions and applies host HP after both loadouts are ready', async () => {
    const host = await accounts.authenticate(
      'Host',
      'long-game-pass',
      'test-pvp',
      true,
    );
    const guest = await accounts.authenticate(
      'Guest',
      'long-game-pass',
      'test-pvp',
      true,
    );
    const store = new GameStore();
    const gateway = new GameGateway(
      store,
      new StoryEngine(db),
      new CombatEngine(),
      accounts,
      progression,
    );
    const broadcast = jest.fn();
    gateway.server = { to: () => ({ emit: broadcast }) } as unknown as Server;
    function client(token: string) {
      const send = jest.fn();
      const socket = {
        handshake: { auth: { gameToken: token } },
        send,
        emit: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        connected: true,
      } as unknown as Socket;
      return { state: { socket }, send };
    }
    const hostClient = client(host.token);
    const guestClient = client(guest.token);
    const submit = (sender: ReturnType<typeof client>, event: object) =>
      gateway['handleMessage'](sender.state, JSON.stringify(event));

    await submit(hostClient, {
      type: 'CREATE_ROOM',
      playerId: guest.id,
      battleMode: 'pvp',
      teamId: 'ravens',
      startingHp: 1200,
      arenaId: 'ashen-cathedral',
    });
    const [room] = store.getAllGames();
    const roomCode = room.roomCode;
    expect(room.hostPlayerId).toBe(host.id);
    expect(room.arenaId).toBe('ashen-cathedral');
    await submit(guestClient, {
      type: 'JOIN_GAME',
      playerId: host.id,
      roomCode,
      teamId: 'wolves',
    });
    await submit(guestClient, {
      type: 'SET_STARTING_HP',
      playerId: guest.id,
      hp: 1500,
    });
    expect(room.startingHp).toBe(1200);
    await submit(hostClient, {
      type: 'SET_STARTING_HP',
      playerId: host.id,
      hp: 1700,
      targetId: guest.id,
    });
    expect(room.teams.wolves.players[0]).toMatchObject({
      id: guest.id,
      hp: 1700,
      maxHp: 1700,
      loadout: STARTER_LOADOUT,
    });
    await submit(hostClient, { type: 'START_PVP', playerId: host.id });
    expect(room.phase).toBe('waiting');
    await submit(hostClient, { type: 'ROOM_PLAYER_READY', playerId: host.id });
    expect(room.teams.ravens.players[0].ready).toBe(false);
    await submit(guestClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'warden',
    });
    expect(room.teams.ravens.players[0].fighterId).toBeUndefined();
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'invalid',
    });
    expect(room.teams.ravens.players[0].fighterId).toBeUndefined();
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'ember-duelist',
    });
    expect(room.teams.ravens.players[0].fighterId).toBeUndefined();
    await query('UPDATE game_accounts SET fighter_ids=$2::jsonb WHERE id=$1', [
      host.id,
      JSON.stringify(['ember-duelist']),
    ]);
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'ember-duelist',
    });
    expect(room.teams.ravens.players[0].fighterId).toBe('ember-duelist');
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'monk',
    });
    await submit(hostClient, { type: 'ROOM_PLAYER_READY', playerId: host.id });
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'duelist',
    });
    expect(room.teams.ravens.players[0]).toMatchObject({
      fighterId: 'duelist',
      ready: false,
    });
    await submit(hostClient, { type: 'ROOM_PLAYER_READY', playerId: host.id });
    await submit(guestClient, {
      type: 'SELECT_FIGHTER',
      playerId: guest.id,
      fighterId: 'arcanist',
    });
    const snapshot = broadcast.mock.calls
      .map(([, payload]) => JSON.parse(payload))
      .filter(({ type }) => type === 'STATE_SYNC')
      .at(-1);
    expect(snapshot.payload).toMatchObject({
      arenaId: 'ashen-cathedral',
      teams: {
        ravens: { players: [{ fighterId: 'duelist' }] },
        wolves: { players: [{ fighterId: 'arcanist' }] },
      },
    });
    await submit(guestClient, {
      type: 'ROOM_PLAYER_READY',
      playerId: guest.id,
    });
    await submit(hostClient, { type: 'START_PVP', playerId: host.id });
    gateway['clearRoundTimeout'](roomCode);
    expect(room.battle).toMatchObject({ mode: 'team', status: 'active' });
    await submit(hostClient, {
      type: 'SET_STARTING_HP',
      playerId: host.id,
      hp: 2000,
    });
    expect(room.teams.ravens.players[0].hp).toBe(1200);
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'knight',
    });
    expect(room.teams.ravens.players[0].fighterId).toBe('duelist');

    await submit(hostClient, {
      type: 'CREATE_ROOM',
      playerId: host.id,
      battleMode: 'cpu',
      teamId: 'ravens',
      arenaId: 'eclipse-throne',
    });
    const practice = store
      .getAllGames()
      .find(({ battleMode }) => battleMode === 'cpu')!;
    expect(practice).toMatchObject({
      phase: 'waiting',
      arenaId: 'eclipse-throne',
    });
    await submit(hostClient, { type: 'START_CPU', playerId: host.id });
    expect(practice.battle).toBeUndefined();
    await submit(guestClient, {
      type: 'JOIN_GAME',
      playerId: guest.id,
      roomCode: practice.roomCode,
      teamId: 'ravens',
    });
    expect(practice.teams.ravens.players).toHaveLength(1);
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'monk',
    });
    await submit(hostClient, { type: 'START_CPU', playerId: host.id });
    gateway['clearRoundTimeout'](practice.roomCode);
    expect(practice.battle).toMatchObject({
      mode: 'cpu',

      enemyName: 'Ironbound Sentry',
      encounterId: 'ironbound-sentry',
      status: 'active',
    });
    expect(practice.encounterPath).toMatchObject({ index: 0, status: 'active' });
    const levels = practice.encounterPath!.levels;
    expect(levels).toHaveLength(12);
    expect(levels[11].id).toBe('tidebound-executioner');
    expect(levels.some((level) => level.allies?.length === 2)).toBe(true);
    expect(levels[5].id).toBe('crownless-king');
    const beforeClear = await progression.profile(host.id);
    for (let i = 0; i < levels.length; i++) {
      expect(practice.battle).toMatchObject({ encounterId: levels[i].id });
      if (levels[i].allies?.length) {
        expect(practice.battle).toMatchObject({ enemyUnits: expect.arrayContaining(levels[i].allies!.map(({ id }) => expect.objectContaining({ encounterId: id }))) });
      }
      const encounter = practice.battle;
      if (encounter?.mode !== 'cpu') throw new Error('Missing CPU encounter');
      encounter.enemyHp = 0;
      encounter.status = 'victory';
      await gateway['finishRound'](practice);
      if (i === 11) expect(encounter.rewards).toMatchObject({ tier: { cinders: 180, xp: 100 }, tierPlayerId: host.id });
      if (i < 5) expect(await progression.encounterCheckpoint(host.id)).toBeUndefined();
      if (i >= 5 && i < 11) {
        expect(await progression.encounterCheckpoint(host.id)).toMatchObject({ tier: 1, cleared: 6 });
        expect(await gateway['resumePath'](host.id)).toMatchObject({ tier: 1, index: 6, levels });
      }
      expect(practice.battle).toBeUndefined();
      if (i < levels.length - 1) {
        expect(practice.encounterPath?.index).toBe(i + 1);
        await submit(hostClient, { type: 'START_CPU', playerId: host.id });
        gateway['clearRoundTimeout'](practice.roomCode);
      }
    }
    expect(practice).toMatchObject({ phase: 'ended', encounterPath: { status: 'cleared', tier: 1, savedWins: 12, nextTier: 2, completionReward: { cinders: 180, xp: 100 } } });
    const cleared = practice.encounterPath!;
    expect(await gateway['resumePath'](host.id)).toMatchObject({ status: 'cleared', nextTier: 2, levels });
    await Promise.all([progression.saveEncounterCheckpoint(host.id, cleared, 12), progression.saveEncounterCheckpoint(host.id, cleared, 12)]);
    expect(await progression.profile(host.id)).toMatchObject({ credits: beforeClear.credits + 180, xp: beforeClear.xp + 100 });
    await submit(hostClient, { type: 'START_CPU', playerId: host.id, pathChoice: 'higher' });
    expect(practice).toMatchObject({ phase: 'battle', encounterPath: { status: 'active', tier: 2, index: 0 } });
    expect(await progression.encounterCheckpoint(host.id)).toMatchObject({ tier: 1, cleared: 12 });
    expect(practice.encounterPath!.levels[0].id).not.toBe(levels[0].id);
    await submit(hostClient, { type: 'START_CPU', playerId: host.id });
    gateway['clearRoundTimeout'](practice.roomCode);
    const party = practice.battle;
    if (party?.mode !== 'cpu' || !party.enemyUnits) throw new Error('Missing enemy group');
    const [leader, flank] = party.enemyUnits;
    const player = practice.teams.ravens.players[0];
    const leaderHp = leader.enemyHp;
    flank.enemyHp = 1;
    const engine = new CombatEngine();
    expect(engine.performAction(practice, player, 'attack', undefined, flank.id)).toContain(flank.enemyName);
    expect(flank.enemyHp).toBe(0);
    expect(leader.enemyHp).toBe(leaderHp);
    expect(party.status).toBe('active');
    Array.from(engine.cpuRetaliate(practice, party));
    expect(party.log.slice(-3).some((line) => line.startsWith(leader.enemyName))).toBe(true);
    player.status = 'alive';
    player.hp = player.maxHp;
    leader.enemyHp = 1;
    engine.performAction(practice, player, 'attack', undefined, leader.id);
    expect(party).toMatchObject({ status: 'victory', enemyHp: 0 });
    gateway['endBattleAndAdvance'](practice);

    for (let i = 1; i < 6; i++) {
      await submit(hostClient, { type: 'START_CPU', playerId: host.id });
      gateway['clearRoundTimeout'](practice.roomCode);
      const encounter = practice.battle;
      if (encounter?.mode !== 'cpu') throw new Error('Missing Tier 2 encounter');
      encounter.enemyHp = 0;
      encounter.status = 'victory';
      await gateway['finishRound'](practice);
      if (i < 5) expect(await progression.encounterCheckpoint(host.id, 2)).toBeUndefined();
    }
    expect(await progression.encounterCheckpoint(host.id, 1)).toMatchObject({ tier: 1, cleared: 12, levels });
    expect(await progression.encounterCheckpoint(host.id)).toMatchObject({ tier: 2, cleared: 6 });
    expect(await gateway['resumePath'](host.id)).toMatchObject({ index: 6, tier: 2, levels: practice.encounterPath!.levels });
    await progression.saveEncounterCheckpoint(host.id, practice.encounterPath!, 12);
    practice.encounterPath!.status = 'cleared';
    practice.encounterPath!.nextTier = 3;
    practice.phase = 'ended';
    await submit(hostClient, { type: 'START_CPU', playerId: host.id, pathChoice: 'higher' });
    expect(practice.encounterPath).toMatchObject({ tier: 3, status: 'active', index: 0 });
    expect(practice.encounterPath!.levels[2].allies).toHaveLength(2);

    await submit(hostClient, {
      type: 'CREATE_ROOM',
      playerId: host.id,
      battleMode: 'cpu',
      teamId: 'ravens',
      adventure: true,
    });
    const adventureRoom = store.getAllGames().find((game) => game.adventure)!;
    expect(adventureRoom).toMatchObject({ phase: 'waiting', adventure: true });
    await submit(hostClient, { type: 'BEGIN_ADVENTURE', playerId: host.id });
    expect(adventureRoom.phase).toBe('waiting');
    await submit(hostClient, {
      type: 'SELECT_FIGHTER',
      playerId: host.id,
      fighterId: 'knight',
    });
    await submit(hostClient, { type: 'START_CPU', playerId: host.id });
    expect(adventureRoom.phase).toBe('waiting');
    await submit(hostClient, { type: 'BEGIN_ADVENTURE', playerId: host.id });
    await submit(hostClient, { type: 'BEGIN_ADVENTURE', playerId: host.id });
    expect(adventureRoom.phase).toBe('battle');
    expect(adventureRoom.battle).toBeUndefined();
    await submit(hostClient, { type: 'START_CPU', playerId: host.id });
    expect(adventureRoom.battle).toBeUndefined();
    for (const [action, target] of [['talk', undefined], ['collect', 'oil'], ['collect', 'oil'], ['collect', 'flint']] as const) {
      await submit(hostClient, { type: 'ADVENTURE_INTERACT', playerId: host.id, chapter: 0, action, target });
    }
    expect(adventureRoom.adventureQuest).toMatchObject({ ready: true, progress: ['oil', 'flint'] });
    await submit(hostClient, { type: 'START_CPU', playerId: host.id });
    gateway['clearRoundTimeout'](adventureRoom.roomCode);
    expect(adventureRoom.battle).toMatchObject({ encounterId: 'ironbound-sentry', status: 'active' });
    adventureRoom.battle!.status = 'victory';
    gateway['endBattleAndAdvance'](adventureRoom);
    expect(adventureRoom).toMatchObject({ phase: 'battle', adventure: true, encounterPath: { index: 1 } });
    expect(adventureRoom.battle).toBeUndefined();
    expect(gateway.adminState()).toContainEqual(expect.objectContaining({
      adventure: true, encounterPath: expect.objectContaining({ index: 1 }),
    }));
    expect(adventureRoom.adventureQuest).toEqual({ accepted: false, progress: [], ready: false });
    await submit(hostClient, { type: 'ADVENTURE_INTERACT', playerId: host.id, chapter: 0, action: 'talk' });
    expect(adventureRoom.adventureQuest?.accepted).toBe(false);
    await submit(hostClient, { type: 'ADVENTURE_INTERACT', playerId: host.id, chapter: 1, action: 'talk' });
    await submit(hostClient, { type: 'ADVENTURE_INTERACT', playerId: host.id, chapter: 1, action: 'rune', target: 'bell' });
    expect(adventureRoom.adventureQuest).toMatchObject({ incorrect: true, progress: [], ready: false });
    for (const target of ['moon', 'wave', 'bell']) {
      await submit(hostClient, { type: 'ADVENTURE_INTERACT', playerId: host.id, chapter: 1, action: 'rune', target });
    }
    expect(adventureRoom.adventureQuest).toMatchObject({ ready: true, incorrect: false });
  });
});

describe('Embrace loadouts in combat', () => {
  it('validates fighter skills, applies poison to CPU enemies, and expires it after two ticks', () => {
    const game = new GameStore().createRoom('fighter-kit');
    const player: Player = {
      id: 'duel',
      name: 'Duelist',
      teamId: 'ravens',
      hp: 1000,
      maxHp: 1000,
      status: 'alive',
      ready: true,
      connected: true,
      fighterId: 'duelist',
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const battle = engine.createCpuBattle(
      game,
      'ravens',
      'Echo Beast',
      1000,
      1000,
    );
    game.battle = battle;
    expect(player.combatKit?.skills.map(({ id }) => id)).toEqual([
      'shadow_strike',
      'spirit_palm',
      'riposte',
      'phantom_thread',
    ]);
    expect(() =>
      engine.performAction(game, player, 'skill', 'fire_burst'),
    ).toThrow('cannot use');
    engine.performAction(game, player, 'skill', 'shadow_strike');
    expect(battle.enemyStatusEffects).toEqual([{ id: 'poisoned', turns: 2 }]);
    const afterHit = battle.enemyHp;
    engine.tickStatuses(game);
    expect(battle.enemyHp).toBe(afterHit - 70);
    engine.tickStatuses(game);
    engine.tickStatuses(game);
    expect(battle.enemyHp).toBe(afterHit - 140);
    expect(battle.enemyStatusEffects).toEqual([]);
  });

  it('applies the selected fighter heal and enforces its target', () => {
    const game = new GameStore().createRoom('fighter-heal');
    const player: Player = {
      id: 'monk',
      name: 'Monk',
      teamId: 'ravens',
      hp: 500,
      maxHp: 1000,
      status: 'alive',
      ready: true,
      connected: true,
      fighterId: 'monk',
    };
    const ally: Player = {
      ...player,
      id: 'ally',
      name: 'Ally',
      fighterId: 'warden',
    };
    game.teams.ravens.players.push(player, ally);
    const engine = new CombatEngine();
    game.battle = engine.createCpuBattle(
      game,
      'ravens',
      'Echo Beast',
      1000,
      1000,
    );
    player.statusEffects = [
      { id: 'cursed', turns: 2 },
      { id: 'poisoned', turns: 2 },
    ];
    expect(
      engine.performAction(game, player, 'heal', undefined, ally.id),
    ).toContain('Centering Breath');
    expect(player.hp).toBe(860);
    expect(player.statusEffects).toEqual([]);
    expect(ally.hp).toBe(500);
    expect(
      engine.performAction(game, ally, 'heal', undefined, player.id),
    ).toContain('Sanctuary');
    expect(player.hp).toBe(1000);
    expect(player.statusEffects).toEqual([{ id: 'guarded', turns: 3 }]);
    engine.tickStatuses(game);
    expect(player.statusEffects).toEqual([{ id: 'guarded', turns: 2 }]);
    engine.tickStatuses(game);
    expect(player.statusEffects).toEqual([{ id: 'guarded', turns: 1 }]);
    engine.tickStatuses(game);
    expect(player.statusEffects).toEqual([]);
  });

  it('lets companions attack independently for the full battle', () => {
    const game = new GameStore().createRoom('arena');
    const player: Player = {
      id: 'owner',
      name: 'Owner',
      teamId: 'ravens',
      fighterId: 'knight',
      hp: 1000,
      maxHp: 2000,
      ready: true,
      connected: true,
      status: 'alive',
      loadout: { ...STARTER_LOADOUT, unlockedSkills: ['call_iron_sentinel'] },
    };
    const enemy: Player = {
      ...player,
      id: 'enemy',
      name: 'Enemy',
      teamId: 'wolves',
      hp: 2000,
      loadout: STARTER_LOADOUT,
    };
    game.teams.ravens.players.push(player);
    game.teams.wolves.players.push(enemy);
    const engine = new CombatEngine();
    game.battle = engine.createTeamBattle(game, 'ravens', 'wolves');
    expect(player.combatKit?.skills).toContainEqual(
      expect.objectContaining({ id: 'call_iron_sentinel' }),
    );
    expect(player.combatKit?.heals).toHaveLength(2);
    expect(
      engine.performAction(game, player, 'skill', 'call_iron_sentinel'),
    ).toContain('summoned Iron Sentinel');
    expect(() =>
      engine.performAction(game, player, 'skill', 'call_iron_sentinel'),
    ).toThrow('already summoned');
    expect(engine.performAction(game, player, 'item', 'ward_stone')).toContain(
      'Ward Stone',
    );
    expect(player.battleItems).toEqual({ bloodleaf_tonic: 1, ward_stone: 1 });
    expect(player.companion?.strikes).toBe(0);
    for (let turn = 0; turn < 4; turn++) {
      const before = enemy.hp;
      engine.performAction(game, player, 'block');
      expect(enemy.hp).toBe(before);
      engine.resolveCompanions(game);
      expect(enemy.hp).toBe(before - 138);
      expect(game.battle.log.at(-1)).toContain('Iron Sentinel struck Enemy');
    }
    expect(player.companion).toMatchObject({ remaining: 1, strikes: 4 });
  });

  it('applies a summoned companion’s damage against a PvE enemy', () => {
    const game = new GameStore().createRoom('summon-pve');
    const player: Player = {
      id: 'caster',
      name: 'Caster',
      teamId: 'ravens',
      fighterId: 'arcanist',
      hp: 1000,
      maxHp: 1000,
      ready: true,
      connected: true,
      status: 'alive',
      loadout: { ...STARTER_LOADOUT, unlockedSkills: ['call_aether_wraith'] },
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const battle = engine.createCpuBattle(
      game,
      'ravens',
      'Echo Beast',
      1000,
      1000,
    );
    game.battle = battle;
    engine.performAction(game, player, 'skill', 'call_aether_wraith');
    const before = battle.enemyHp;
    engine.performAction(game, player, 'dodge');
    expect(battle.enemyHp).toBe(before);
    engine.resolveCompanions(game);
    expect(battle.log.at(-1)).toContain('Aether Wraith struck Echo Beast for 155 damage');
    expect(battle.enemyHp).toBe(before - 155);
    expect(player.companion?.strikes).toBe(1);
  });

  it.each(['attack', 'ability', 'signature', 'no break'] as const)(
    'resolves CPU retaliation and the break follow-up for %s',
    (move) => {
      const game = new GameStore().createRoom('cpu-break');
      const player: Player = {
        id: 'vanguard',
        name: 'Vanguard',
        teamId: 'ravens',
        hp: 1000,
        maxHp: 1000,
        ready: true,
        connected: true,
        status: 'alive',
      };
      game.teams.ravens.players.push(player);
      const engine = new CombatEngine();
      const battle = engine.createCpuBattle(game, 'ravens', 'Echo Beast', 1000, 1000, {
        attack: 180,
        abilityChance: move === 'ability' ? 1 : 0,
        abilities: ['rend'],
        signatureEveryNRounds: move === 'signature' ? 1 : 0,
      });
      game.battle = battle;
      const shouldBreak = move !== 'no break';
      player.breakMeter = shouldBreak ? 199 : 0;
      const random = jest.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const retaliation = engine.cpuRetaliate(game, battle);
        expect(retaliation.next().done).toBe(!shouldBreak);
        const hpAfterFirstHit = player.hp;
        expect(hpAfterFirstHit).toBeLessThan(player.maxHp);
        expect(battle.log).not.toContain('Echo Beast attacks again after the break!');
        if (shouldBreak) {
          expect(battle.log).toContain('Vanguard is BROKEN!');
          expect(retaliation.next().done).toBe(true);
          expect(player.hp).toBeLessThan(hpAfterFirstHit);
          expect(player.statusEffects?.some(({ id }) => id === 'immobilized')).toBe(false);
          expect(battle.log.filter((line) => line === 'Echo Beast attacks again after the break!')).toHaveLength(1);
        }
        expect(battle).toMatchObject({ status: 'active', round: 2 });
      } finally {
        random.mockRestore();
      }
    },
  );

  it('restricts a second distinct summon to the paid slot and supports healer and buffer roles', () => {
    const game = new GameStore().createRoom('dual-companions');
    const player: Player = {
      id: 'caster', name: 'Caster', teamId: 'ravens', fighterId: 'arcanist',
      hp: 1000, maxHp: 1000, ready: true, connected: true, status: 'alive',
      loadout: { ...STARTER_LOADOUT, unlockedSkills: ['call_aether_wraith_healer', 'call_aether_wraith_buffer'] },
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    game.battle = engine.createCpuBattle(game, 'ravens', 'Echo Beast', 1000, 1000);
    engine.performAction(game, player, 'skill', 'call_aether_wraith_healer');
    expect(() => engine.performAction(game, player, 'skill', 'call_aether_wraith_buffer')).toThrow('slots');
    player.loadout!.summonCapacity = 2;
    expect(() => engine.performAction(game, player, 'skill', 'call_aether_wraith_healer')).toThrow('already summoned');
    engine.performAction(game, player, 'skill', 'call_aether_wraith_buffer');
    player.hp = 800;
    engine.resolveCompanions(game);
    expect(player.hp).toBe(890);
    expect(player.statusEffects).toContainEqual({ id: 'enraged', turns: 3 });
    expect(player.secondaryCompanion?.strikes).toBe(1);
  });

  it('builds break pressure per enemy and gives one follow-up to the fighter who breaks it', () => {
    const game = new GameStore().createRoom('enemy-break');
    const player: Player = {
      id: 'fighter', name: 'Fighter', teamId: 'ravens', hp: 1500, maxHp: 1500,
      ready: true, connected: true, status: 'alive',
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const battle = engine.createEncounterBattle(game, 'ravens', ['Lead', 'Flank'].map((name) => ({
      id: name.toLowerCase(), name, hint: '', hp: 2400, attack: 145,
      personality: 'strategic', abilities: [], signatureEveryNRounds: 0, signatureMultiplier: 1,
    })));
    game.battle = battle;
    const [lead, flank] = battle.enemyUnits!;
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      for (let hit = 1; hit <= 4; hit++) {
        engine.performAction(game, player, 'attack', undefined, flank.id);
        expect(flank.enemyBreakMeter).toBe(hit * 40);
        expect(engine.resolvePlayerBreak(game, player)).toBe(false);
      }
      engine.performAction(game, player, 'attack', undefined, flank.id);
      expect(flank.enemyStatusEffects).toContainEqual({ id: 'immobilized', turns: 1 });
      expect(lead.enemyBreakMeter).toBeUndefined();
      const hp = flank.enemyHp;
      const focus = player.focus;
      expect(engine.resolvePlayerBreak(game, { ...player, id: 'another' })).toBe(false);
      expect(engine.resolvePlayerBreak(game, player)).toBe(true);
      expect(flank.enemyHp).toBeLessThan(hp);
      expect(flank.enemyStatusEffects).toEqual([]);
      expect(flank.enemyBreakMeter).toBe(0);
      expect(lead.enemyHp).toBe(lead.enemyMaxHp);
      expect(player.focus).toBe(focus);
      expect(engine.resolvePlayerBreak(game, player)).toBe(false);
    } finally {
      random.mockRestore();
    }
  });

  it('ends a battle when the break follow-up defeats its last enemy', () => {
    const game = new GameStore().createRoom('break-victory');
    const player: Player = {
      id: 'fighter', name: 'Fighter', teamId: 'ravens', hp: 1000, maxHp: 1000,
      ready: true, connected: true, status: 'alive',
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const battle = engine.createCpuBattle(game, 'ravens', 'Beast', 1000, 1000);
    game.battle = battle;
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      engine.performAction(game, player, 'attack');
      const attackDamage = 1000 - battle.enemyHp;
      battle.enemyHp = attackDamage + 1;
      battle.enemyBreakMeter = 199;
      engine.performAction(game, player, 'attack');
      expect(battle.enemyHp).toBe(1);
      expect(engine.resolvePlayerBreak(game, player)).toBe(true);
      expect(battle).toMatchObject({ status: 'victory', enemyHp: 0 });
      expect(battle.log.at(-1)).toBe('Beast has been destroyed.');
    } finally {
      random.mockRestore();
    }
  });

  it('adds a veteran signature without replacing moves or allowing it on another kit', () => {
    const engine = new CombatEngine();
    const player = { fighterId: 'knight', skillCharges: 2 } as Player;
    expect(presentCombatKit('knight').skills.map(({ id }) => id)).toEqual([
      'iron_cleave', 'blood_rage', 'blacksteel_rebuke', 'oathbreaker_aegis',
    ]);
    expect(() => engine.validateAction(player, 'skill', 'oathbreaker_aegis')).not.toThrow();
    expect(() => engine.validateAction({ ...player, fighterId: 'monk' }, 'skill', 'oathbreaker_aegis')).toThrow();
  });

  it('summons a targetable familiar once, from round three and below half HP', () => {
    const game = new GameStore().createRoom('enemy-summon');
    const player: Player = {
      id: 'fighter', name: 'Fighter', teamId: 'ravens', hp: 5000, maxHp: 5000,
      ready: true, connected: true, status: 'alive',
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const battle = engine.createEncounterBattle(game, 'ravens', [{
      id: 'glasswing-siren', name: 'Glasswing Siren', hint: '', hp: 1000, attack: 145,
      personality: 'aggressive', abilities: ['rend'], signatureEveryNRounds: 0, signatureMultiplier: 1,
    }]);
    game.battle = battle;
    battle.round = 3;
    battle.enemyHp = 500;
    expect(engine.cpuRetaliate(game, battle).next()).toEqual({ value: 650, done: false });
    expect(battle).toMatchObject({ enemyHp: 660, enemyMaxHp: 1160, round: 4 });
    expect(battle.log.at(-1)).toBe('Glasswing Siren summoned Glasswing Echo.');
    const echo = battle.enemyUnits?.[1];
    expect(echo).toMatchObject({ encounterId: 'glasswing-echo', enemyHp: 160 });
    engine.performAction(game, player, 'attack', undefined, echo!.id);
    expect(echo!.enemyHp).toBeLessThan(160);
    Array.from(engine.cpuRetaliate(game, battle));
    expect(battle.enemyUnits).toHaveLength(2);
  });

  it('lets an encounter enemy pick a healing item, a buff spell and a Limit Break', () => {
    const game = new GameStore().createRoom('enemy-tools');
    const player: Player = {
      id: 'fighter', name: 'Fighter', teamId: 'ravens',
      hp: 1500, maxHp: 1500, ready: true, connected: true, status: 'alive',
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const battle = engine.createEncounterBattle(game, 'ravens', [{
      id: 'tactician', name: 'Tactician', hint: '', hp: 1000, attack: 145,
      personality: 'strategic', abilities: [], signatureEveryNRounds: 0, signatureMultiplier: 1,
    }]);
    game.battle = battle;
    battle.enemyHp = 200;
    Array.from(engine.cpuRetaliate(game, battle));
    expect(battle.enemyHp).toBe(400);
    expect(battle.enemyItems?.tonic).toBe(0);
    player.statusEffects = [{ id: 'guarded', turns: 3 }];
    Array.from(engine.cpuRetaliate(game, battle));
    expect(battle.enemyStatusEffects).toContainEqual({ id: 'enraged', turns: 3 });
    battle.enemyFocus = 100;
    const retaliation = engine.cpuRetaliate(game, battle);
    expect(retaliation.next()).toMatchObject({ value: 2000, done: false });
    expect(battle.log.some((line) => line.includes('Tactician unleashed a Limit Break on Fighter'))).toBe(true);
    expect(battle.enemyFocus).toBe(0);
    expect(retaliation.next().done).toBe(true);
  });

  it('resolves group attacks separately and dismisses a fallen summoner', () => {
    const game = new GameStore().createRoom('group-attacks');
    const player: Player = {
      id: 'caster', name: 'Caster', teamId: 'ravens', fighterId: 'arcanist',
      hp: 1000, maxHp: 1000, ready: true, connected: true, status: 'alive',
      loadout: { ...STARTER_LOADOUT, unlockedSkills: ['call_aether_wraith'] },
    };
    game.teams.ravens.players.push(player);
    const engine = new CombatEngine();
    const group = engine.createEncounterBattle(game, 'ravens', ['Lead', 'Flank'].map((name) => ({
      id: name.toLowerCase(), name, hint: '', hp: 1000, attack: 145,
      personality: 'strategic', abilities: [], signatureEveryNRounds: 0, signatureMultiplier: 1,
    })));
    game.battle = group;
    engine.performAction(game, player, 'skill', 'call_aether_wraith');
    expect(player.companion).toBeDefined();
    player.hp = 140;
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const retaliation = engine.cpuRetaliate(game, group);
      expect(retaliation.next().done).toBe(false);
      expect(player.hp).toBeGreaterThan(0);
      expect(group.log.at(-1)).toContain('Lead hits Caster');
      expect(retaliation.next().done).toBe(true);
      expect(player).toMatchObject({ status: 'eliminated', hp: 0 });
      expect(player.companion).toBeUndefined();
      expect(group.status).toBe('defeat');
    } finally {
      random.mockRestore();
    }
  });

  it('carries Guard into the opposing turn and spends Focus on a Limit Break', () => {
    const game = new GameStore().createRoom('arena');
    const vanguard: Player = {
      id: 'vanguard',
      name: 'Vanguard',
      teamId: 'ravens',
      hp: 1000,
      maxHp: 1000,
      ready: true,
      connected: true,
      status: 'alive',
      loadout: STARTER_LOADOUT,
    };
    const spellblade: Player = {
      ...vanguard,
      id: 'spellblade',
      name: 'Spellblade',
      teamId: 'wolves',
      loadout: { ...STARTER_LOADOUT, job: 'spellblade', weapon: 'hollowfang' },
    };
    game.teams.ravens.players.push(vanguard);
    game.teams.wolves.players.push(spellblade);
    const engine = new CombatEngine();
    game.battle = engine.createTeamBattle(game, 'ravens', 'wolves');
    engine.performAction(game, vanguard, 'block');
    engine.nextTurn(game);
    engine.tickStatuses(game);
    expect(() => engine.performAction(game, spellblade, 'limit')).toThrow(
      '100 Focus',
    );
    spellblade.focus = 100;
    const damage = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      engine.performAction(game, spellblade, 'limit', undefined, vanguard.id);
    } finally {
      damage.mockRestore();
    }
    expect(spellblade.focus).toBe(0);
    expect(vanguard.hp).toBe(793);
  });
});
