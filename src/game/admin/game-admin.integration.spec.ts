import { PGlite } from '@electric-sql/pglite';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import type { Server } from 'socket.io';
import { DataSource } from 'typeorm';
import { GameAccountsService } from '../accounts/game-accounts.service';
import { CombatEngine } from '../engines/combat.engine';
import { StoryEngine } from '../engines/story.engine';
import { GameGateway } from '../game.gateway';
import { GameStore } from '../game.store';
import type { TeamId } from '../game.types';
import { ProgressionService } from '../progression/progression.service';
import { HIGHLANDS_STORY } from '../story/highlands-v1';
import { validateStory } from '../story/story-document';
import {
  GameAdminController,
  GameModeratorGuard,
} from './game-admin.controller';
import { GameAdminService } from './game-admin.service';

describe('Embrace moderator console', () => {
  const pg = new PGlite();
  const read = (path: string) =>
    readFileSync(resolve(__dirname, '../../..', path), 'utf8');
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
  const rooms = new GameStore();
  const story = new StoryEngine(db);
  const gateway = new GameGateway(
    rooms,
    story,
    new CombatEngine(),
    accounts,
    new ProgressionService(db),
  );
  let app: INestApplication;
  let moderator: Awaited<ReturnType<GameAccountsService['authenticate']>>;
  let player: typeof moderator;

  beforeAll(async () => {
    await pg.exec(read('docs/sql/embrace-game.sql'));
    await pg.exec(read('docs/sql/embrace-admin.sql'));
    moderator = await accounts.authenticate(
      'moderator',
      'test-password-1',
      'admin-suite',
      true,
    );
    player = await accounts.authenticate(
      'player',
      'test-password-1',
      'admin-suite',
      true,
    );
    await query('UPDATE game_accounts SET moderator=true WHERE id=$1', [
      moderator.id,
    ]);
    gateway.server = { to: () => ({ emit: jest.fn() }) } as unknown as Server;
    const test = await Test.createTestingModule({
      controllers: [GameAdminController],
      providers: [
        GameAdminService,
        GameModeratorGuard,
        { provide: DataSource, useValue: db },
        { provide: GameAccountsService, useValue: accounts },
        { provide: GameGateway, useValue: gateway },
        { provide: StoryEngine, useValue: story },
      ],
    }).compile();
    app = test.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 15000);

  afterAll(async () => {
    await app.close();
    await pg.close();
  });

  const upload = (
    path: string,
    value: unknown,
    token: string,
    revision?: string,
  ) => {
    const form = request(app.getHttpServer())
      .post(`/game/api/admin/story/${path}`)
      .set('Authorization', `Bearer ${token}`);
    if (revision) form.field('expectedRevision', revision);
    return form.attach(
      'file',
      Buffer.from(JSON.stringify(value)),
      'story.json',
    );
  };

  it('accepts the full seeded campaign and normalizes older story keys', () => {
    expect(Object.keys(validateStory(HIGHLANDS_STORY).nodes)).toHaveLength(38);
    const legacy = validateStory({
      start: {
        id: 'start',
        title: 'Legacy title',
        text: 'Legacy story.',
        image: '/images/gate.jpg',
        choices: [
          {
            id: 'fight',
            text: 'Fight',
            result: 'battle',
            battle: 'gate_guardian',
            next: 'end',
          },
        ],
      },
      end: {
        id: 'end',
        title: 'End',
        text: 'The end.',
        choices: [{ id: 'finish', text: 'Finish', result: 'credits' }],
      },
    });
    expect(legacy.nodes.start.background).toBe('/images/gate.jpg');
    expect(legacy.nodes.start.choices[0]).toMatchObject({
      nextNodeId: 'end',
      enemyName: 'GATE GUARDIAN',
    });
  });

  it('rejects regular accounts, broken links and malformed assets before publication', async () => {
    const document = JSON.parse(read('docs/examples/embrace-story.json')) as {
      nodes: {
        start: { background: string; choices: { nextNodeId: string }[] };
      };
    };
    await upload('preview', document, player.token).expect(403);
    await upload('preview', document, moderator.token).expect(201);
    document.nodes.start.choices[0].nextNodeId = 'missing';
    await upload('publish', document, moderator.token, 'seed').expect(400);
    document.nodes.start.choices[0].nextNodeId = 'sanctum';
    document.nodes.start.background = 'javascript:alert(1)';
    await upload('publish', document, moderator.token, 'seed').expect(400);
    expect(story.getInitialNode().title).toBe(HIGHLANDS_STORY.start.title);
  });

  it('publishes atomically, pins running stories, and restores the original version', async () => {
    const currentRoom = rooms.createRoom('global');
    currentRoom.phase = 'story';
    story.startRun(currentRoom);
    const oldTitle = story.getInitialNode().title;
    const document = JSON.parse(
      read('docs/examples/embrace-story.json'),
    ) as unknown;
    await upload('publish', document, moderator.token, 'seed').expect(201);
    expect(story.getInitialNode().title).toBe('The gate beneath the mist');
    expect(story.getNode('start', currentRoom)?.title).toBe(oldTitle);
    await pg.exec(read('docs/sql/embrace-game.sql'));
    expect(
      await query('SELECT count(*)::int AS count FROM game_story_nodes'),
    ).toEqual([{ count: 2 }]);
    await upload('publish', document, moderator.token, 'seed').expect(409);
    const history = await request(app.getHttpServer())
      .get('/game/api/admin/story')
      .set('Authorization', `Bearer ${moderator.token}`)
      .expect(200);
    const { revision, versions } = history.body as {
      revision: string;
      versions: { id: string; publisher: string | null }[];
    };
    const baseline = versions.find((entry) => entry.publisher === null)!;
    await request(app.getHttpServer())
      .post(`/game/api/admin/story/revisions/${baseline.id}/restore`)
      .set('Authorization', `Bearer ${moderator.token}`)
      .send({ expectedRevision: revision })
      .expect(201);
    expect(story.getInitialNode().title).toBe(oldTitle);
  });

  it('scopes live moderation to the selected room and records credit adjustments', async () => {
    const current = rooms.createRoom('ARENA1');
    const other = rooms.createRoom('ARENA2');
    for (const room of [current, other]) {
      const team: TeamId = 'ravens';
      room.teams[team].players.push({
        id: player.id!,
        name: player.username,
        teamId: team,
        hp: 2000,
        maxHp: 2000,
        ready: true,
        connected: true,
        status: 'alive',
      });
    }
    const api = request(app.getHttpServer());
    const command = (action: string, extras: object = {}) =>
      api
        .post('/game/api/admin/rooms/ARENA1/commands')
        .set('Authorization', `Bearer ${moderator.token}`)
        .send({ action, ...extras });
    await command('max_hp', { playerId: player.id, value: 1200 }).expect(201);
    expect(current.teams.ravens.players[0].maxHp).toBe(1200);
    expect(other.teams.ravens.players[0].maxHp).toBe(2000);
    current.phase = 'story';
    await command('pause').expect(201);
    expect(current.paused).toBe(true);
    await command('end').expect(201);
    expect(current.phase).toBe('ended');
    const adjustment = {
      requestId: randomUUID(),
      action: 'credits',
      amount: 260,
      reason: 'Event prize',
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      await api
        .post(`/game/api/admin/accounts/${player.id}/adjustments`)
        .set('Authorization', `Bearer ${moderator.token}`)
        .send(adjustment)
        .expect(201);
    }
    expect(
      await query('SELECT credits FROM game_accounts WHERE id=$1', [player.id]),
    ).toEqual([{ credits: 560 }]);
    expect(
      await query(
        "SELECT action,details->>'reason' AS reason FROM game_admin_activity WHERE target=$1",
        [player.id],
      ),
    ).toEqual([{ action: 'credits', reason: 'Event prize' }]);
    await query('UPDATE game_accounts SET moderator=false WHERE id=$1', [
      moderator.id,
    ]);
    await command('restart').expect(403);
  });
});
