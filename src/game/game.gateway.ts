/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import {
  Battle,
  Cutscene,
  GameEvent,
  GameState,
  Player,
  QueuedAction,
  StoryChoice,
  TeamId,
} from './game.types';
import { GameStore, GLOBAL_ROOM_CODE } from './game.store';
import { StoryEngine } from './engines/story.engine';
import { CombatEngine } from './engines/combat.engine';

interface ConnectedClient {
  socket: Socket;
  playerId?: string;
  roomCode?: string;
  watcher?: boolean;
}

const GLOBAL_ROOM = 'global';
const ALL_TEAMS: TeamId[] = ['ravens', 'wolves', 'dragons', 'serpents'];

/** Delay between resolved queued actions, in ms. */
const ACTION_RESOLVE_DELAY_MS = 900;
/** Delay before the CPU retaliates at the end of a round, in ms. */
const ENEMY_RETALIATE_DELAY_MS = 1200;
/** How long the active team has to submit all actions, in ms. */
const ROUND_DECISION_TIMEOUT_MS = 30_000;
/** How long a single story-phase player has to pick a choice, in ms. */
const STORY_DECISION_TIMEOUT_MS = 50_000;

@WebSocketGateway({ cors: true })
export class GameGateway {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(GameGateway.name);
  private readonly clients = new Set<ConnectedClient>();

  constructor(
    private readonly gameStore: GameStore,
    private readonly storyEngine: StoryEngine,
    private readonly combatEngine: CombatEngine,
  ) {}

  private recentEvents: GameEvent[] = [];
  private activeCutsceneId: string | null = null;
  private seenCutscenes = new Set<string>();
  private lastCutsceneNodeId: string | null = null;

  private resolvingRound = false;
  private roundTimeoutHandle: NodeJS.Timeout | null = null;
  private storyTimeoutHandle: NodeJS.Timeout | null = null;

  /* ================================================================== */
  /* Connection                                                          */
  /* ================================================================== */

  handleConnection(socket: Socket) {
    const client: ConnectedClient = { socket };
    this.clients.add(client);
    this.logger.debug(`Client connected: socket=${socket.id}`);

    this.send(socket, {
      type: 'CONNECTED',
      roomCode: GLOBAL_ROOM,
      message: 'Connected to Embrace Your Horror.',
    });

    socket.on('message', (data) => this.handleMessage(client, data));

    socket.on('disconnect', (reason) => {
      this.clients.delete(client);
      this.removeFromRoom(client);
      this.logger.debug(
        `Client disconnected: socket=${socket.id} room=${client.roomCode ?? 'none'} reason=${reason}`,
      );
    });
  }

  /* ================================================================== */
  /* Message plumbing                                                    */
  /* ================================================================== */

  private handleMessage(client: ConnectedClient, rawData: unknown) {
    try {
      const raw =
        typeof rawData === 'string'
          ? rawData
          : rawData instanceof Buffer
            ? rawData.toString()
            : Array.isArray(rawData)
              ? Buffer.concat(
                  rawData.map((part) =>
                    Buffer.isBuffer(part) ? part : Buffer.from(String(part)),
                  ),
                ).toString()
              : String(rawData);

      const event = JSON.parse(raw) as GameEvent;

      this.logger.debug(
        `Received ${event.type}: socket=${client.socket.id} room=${client.roomCode ?? 'none'}`,
      );
      this.handleEvent(client, event);
    } catch (error) {
      this.logger.warn(
        `Invalid message: socket=${client.socket.id} error=${error instanceof Error ? error.message : String(error)}`,
      );
      this.sendError(client.socket, 'Invalid WebSocket message.');
    }
  }

  private handleEvent(client: ConnectedClient, event: GameEvent) {
    switch (event.type) {
      case 'JOIN_GAME':
        this.joinGame(client, event);
        break;
      case 'WATCH_GAME':
        this.watchGame(client, event);
        break;
      case 'CHOICE':
        this.handleChoice(client, event);
        break;
      case 'COMBAT_ACTION':
        this.handleCombatAction(client, event);
        break;
      case 'COMBAT_ACTION_SELECTED':
        this.handleCombatAction(client, event);
        break;
      case 'COMBAT_QUEUE_ACTION':
        this.handleCombatQueueAction(client, event);
        break;
      case 'ROOM_PLAYER_READY':
        this.playerReady(client, event.playerId);
        break;
      case 'TEAM_TURN':
        this.changeTeamTurn(client, event.teamId);
        break;
      case 'ELIMINATE':
        this.eliminatePlayer(client, event.playerId);
        break;
      case 'ADMIN_APPROVE_ROOM':
        this.approveRoom(client, event);
        break;
      case 'ADMIN_GET_ROOMS':
        this.sendRoomList(client.socket);
        break;
      case 'STORY_UPDATE':
        if (!client.roomCode) {
          this.sendError(client.socket, 'You are not inside a game.');
          return;
        }
        this.broadcastEvent(GLOBAL_ROOM, event);
        break;
      case 'LEAVE_ROOM':
        this.removeFromRoom(client);
        break;
      case 'LEAVE_GAME':
        this.leaveGame(client, event);
        break;
      case 'CUTSCENE_DONE':
        if (event.cutsceneId === this.activeCutsceneId) {
          this.activeCutsceneId = null;
        }
        break;
      default:
        this.sendError(client.socket, 'Unknown game event.');
    }
  }

  /* ================================================================== */
  /* Timers                                                              */
  /* ================================================================== */

  private clearRoundTimeout() {
    if (this.roundTimeoutHandle) {
      clearTimeout(this.roundTimeoutHandle);
      this.roundTimeoutHandle = null;
    }
    this.broadcastEvent(GLOBAL_ROOM, { type: 'ROUND_TIMER', remainingMs: 0 });
  }

  private clearStoryTimeout() {
    if (this.storyTimeoutHandle) {
      clearTimeout(this.storyTimeoutHandle);
      this.storyTimeoutHandle = null;
    }
  }

  private startRoundTimeout(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    this.clearRoundTimeout();

    this.roundTimeoutHandle = setTimeout(() => {
      this.logger.warn(
        `Round timeout fired: room=${game.roomCode} team=${game.battle?.turnTeamId}`,
      );
      void this.handleRoundTimeout();
    }, ROUND_DECISION_TIMEOUT_MS);

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'ROUND_TIMER',
      remainingMs: ROUND_DECISION_TIMEOUT_MS,
    });
  }

  private async handleRoundTimeout() {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    const battle = game?.battle;

    if (!game || !battle || battle.status !== 'active') {
      this.clearRoundTimeout();
      return;
    }

    if (this.resolvingRound) {
      return;
    }

    this.logger.log(
      `Auto-resolving round: team=${battle.turnTeamId} queued=${battle.queuedActions?.length ?? 0}`,
    );

    await this.resolveRound(game);
  }

  private startStoryTimeout(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    this.clearStoryTimeout();
    if (game.phase !== 'story') return;

    this.storyTimeoutHandle = setTimeout(() => {
      this.logger.warn(
        `Story timeout fired: room=${game.roomCode} team=${game.currentTeamId} player=${game.activePlayerId}`,
      );
      this.handleStoryTimeout();
    }, STORY_DECISION_TIMEOUT_MS);
  }

  private handleStoryTimeout() {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game || game.phase !== 'story') {
      this.clearStoryTimeout();
      return;
    }

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'BATTLE_UPDATE',
      mode: 'team',
      message: 'Time expired — the turn passes.',
    });

    this.advanceActivePlayer(game);
    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  /* ================================================================== */
  /* Room / player lifecycle                                             */
  /* ================================================================== */

  private getOrCreateGlobalGame() {
    const game = this.gameStore.getOrCreateGlobalGame();

    if (!game.currentNodeId) {
      const initialNode = this.storyEngine.getInitialNode();
      if (initialNode) {
        game.currentNodeId = initialNode.id;
      }
    }

    return game;
  }

  private removeFromRoom(client: ConnectedClient) {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);

    if (game && client.playerId) {
      const player = this.findPlayer(game, client.playerId);
      if (player) {
        player.connected = false;
      }
    }

    if (client.roomCode) {
      void client.socket.leave(client.roomCode);
      client.roomCode = undefined;
    }

    if (game) {
      this.broadcastState();
      this.broadcastRoomList();
    }
  }

  private leaveGame(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'LEAVE_GAME' }>,
  ) {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game) return;

    for (const team of Object.values(game.teams)) {
      const idx = team.players.findIndex((p) => p.id === event.playerId);
      if (idx >= 0) {
        team.players.splice(idx, 1);
        break;
      }
    }

    if (client.roomCode) {
      void client.socket.leave(client.roomCode);
      client.roomCode = undefined;
    }
    client.playerId = undefined;

    this.broadcastState();
    this.broadcastRoomList();
  }

  private joinGame(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'JOIN_GAME' }>,
  ) {
    const game = this.getOrCreateGlobalGame();
    const team = game.teams[event.teamId];

    if (!team) {
      this.sendError(client.socket, 'Invalid team.');
      return;
    }

    const existingPlayer = team.players.find(
      (player) => player.id === event.playerId,
    );

    if (!existingPlayer) {
      team.players.push({
        id: event.playerId,
        name: event.playerName ?? event.playerId,
        teamId: event.teamId,
        hp: 1000,
        maxHp: 1000,
        status: 'alive',
        ready: false,
        connected: true,
        breakMeter: 0,
        statusEffects: [],
      });
    } else {
      existingPlayer.connected = true;
    }

    if (client.roomCode && client.roomCode !== GLOBAL_ROOM) {
      void client.socket.leave(client.roomCode);
    }
    void client.socket.join(GLOBAL_ROOM);

    client.playerId = event.playerId;
    client.roomCode = GLOBAL_ROOM;
    client.watcher = false;

    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private watchGame(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'WATCH_GAME' }>,
  ) {
    const game = this.getOrCreateGlobalGame();

    client.watcher = true;

    if (client.roomCode && client.roomCode !== GLOBAL_ROOM) {
      void client.socket.leave(client.roomCode);
    }
    void client.socket.join(GLOBAL_ROOM);

    client.roomCode = GLOBAL_ROOM;
    client.playerId = event.watcherId;

    for (const past of this.recentEvents) {
      this.send(client.socket, past);
    }

    this.broadcastStory();
    this.sendState(client.socket, game);
    this.sendRoomList(client.socket);
  }

  private playerReady(client: ConnectedClient, playerId: string) {
    const game = this.getGlobalGame(client);
    if (!game) return;

    const player = this.findPlayer(game, playerId);
    if (!player) return;

    player.ready = true;
    this.broadcastState();
    this.broadcastRoomList();
  }

  /* ================================================================== */
  /* Admin                                                               */
  /* ================================================================== */

  private approveRoom(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'ADMIN_APPROVE_ROOM' }>,
  ) {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game) {
      this.sendError(client.socket, 'Game not found.');
      return;
    }

    const populated = ALL_TEAMS.filter(
      (id) => game.teams[id].players.length > 0,
    );

    if (populated.length < 2) {
      this.sendError(
        client.socket,
        'At least two teams must have players before activation.',
      );
      return;
    }

    if (event.teamCaps) {
      const filteredCaps = Object.fromEntries(
        populated
          .filter((id) => event.teamCaps![id] !== undefined)
          .map((id) => [id, event.teamCaps![id]]),
      ) as Partial<Record<TeamId, number>>;

      game.teamCaps = filteredCaps;
    }

    game.activeTeams = populated;
    game.currentTeamId = populated[0];
    game.phase = 'story';

    const firstTeam = game.teams[populated[0]];
    const firstAlive = firstTeam.players.find((p) => p.status === 'alive');
    game.activePlayerId = firstAlive?.id;

    this.seenCutscenes.clear();
    this.lastCutsceneNodeId = null;

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'TEAM_TURN',
      teamId: populated[0],
      activePlayerId: game.activePlayerId,
    });

    this.startStoryTimeout(game);

    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private changeTeamTurn(client: ConnectedClient, teamId: TeamId) {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game) {
      this.sendError(client.socket, 'Game not found.');
      return;
    }

    game.currentTeamId = teamId;

    const team = game.teams[teamId];
    const firstAlive = team.players.find((p) => p.status === 'alive');
    game.activePlayerId = firstAlive?.id;

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'TEAM_TURN',
      teamId,
      activePlayerId: game.activePlayerId,
    });

    this.startStoryTimeout(game);

    this.broadcastState();
    this.broadcastRoomList();
  }

  private eliminatePlayer(client: ConnectedClient, playerId: string) {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game) {
      this.sendError(client.socket, 'Game not found.');
      return;
    }

    const player = this.findPlayer(game, playerId);
    if (!player) {
      this.sendError(client.socket, 'Player not found.');
      return;
    }

    player.status = 'eliminated';
    player.hp = 0;

    this.broadcastEvent(GLOBAL_ROOM, { type: 'ELIMINATE', playerId });
    this.broadcastState();
    this.broadcastRoomList();
  }

  /* ================================================================== */
  /* Turn rotation                                                       */
  /* ================================================================== */

  private advanceTeam(game: NonNullable<ReturnType<GameStore['getGame']>>) {
    const pool = game.activeTeams ?? ALL_TEAMS;
    const canAct = (teamId: TeamId) =>
      game.teams[teamId].players.some(
        (p) =>
          p.status === 'alive' &&
          !(p.statusEffects ?? []).some((s) => s.id === 'immobilized'),
      );

    const startIndex = pool.indexOf(game.currentTeamId);
    const startFrom = startIndex === -1 ? 0 : startIndex + 1;

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[(startFrom + i) % pool.length];
      if (canAct(candidate)) {
        game.currentTeamId = candidate;

        const team = game.teams[candidate];
        const firstAlive = team.players.find(
          (p) =>
            p.status === 'alive' &&
            !(p.statusEffects ?? []).some((s) => s.id === 'immobilized'),
        );
        game.activePlayerId = firstAlive?.id;

        this.broadcastEvent(GLOBAL_ROOM, {
          type: 'TEAM_TURN',
          teamId: candidate,
          activePlayerId: game.activePlayerId,
        });

        this.startStoryTimeout(game);
        return;
      }
    }

    game.phase = 'ended';
    this.clearRoundTimeout();
    this.clearStoryTimeout();
    this.broadcastState();
  }

  private advanceActivePlayer(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    const team = game.teams[game.currentTeamId];
    const alive = team.players.filter(
      (p) =>
        p.status === 'alive' &&
        !(p.statusEffects ?? []).some((s) => s.id === 'immobilized'),
    );

    if (alive.length === 0) {
      this.advanceTeam(game);
      return;
    }

    const currentIndex = alive.findIndex((p) => p.id === game.activePlayerId);
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + 1) % alive.length;

    if (currentIndex !== -1 && nextIndex === 0) {
      this.advanceTeam(game);
      return;
    }

    game.activePlayerId = alive[nextIndex].id;

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'TEAM_TURN',
      teamId: game.currentTeamId,
      activePlayerId: game.activePlayerId,
    });

    this.startStoryTimeout(game);
  }

  /* ================================================================== */
  /* Story choices                                                       */
  /* ================================================================== */

  private handleChoice(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'CHOICE' }>,
  ) {
    if (this.activeCutsceneId) {
      this.sendError(client.socket, 'A cutscene is playing.');
      return;
    }

    const game = this.getGlobalGame(client);
    if (!game) return;

    const player = this.findPlayer(game, event.playerId);
    if (!player) {
      this.sendError(client.socket, 'Player not found.');
      return;
    }
    if (player.teamId !== game.currentTeamId) {
      this.sendError(client.socket, "It is not your team's turn.");
      return;
    }
    if (game.activePlayerId && player.id !== game.activePlayerId) {
      this.sendError(client.socket, 'It is not your turn.');
      return;
    }
    if (player.status !== 'alive') {
      this.sendError(client.socket, 'Eliminated players cannot make choices.');
      return;
    }

    const result = this.storyEngine.applyChoice(game, event.choiceId);
    if (!result) {
      this.sendError(client.socket, 'Invalid story choice.');
      return;
    }

    // The choice is in — clear the story timer.
    this.clearStoryTimeout();

    const { choice } = result;
    this.logger.debug(
      `Choice resolved: id=${choice.id} result=${choice.result}`,
    );

    this.playCutscene(choice.cutscene, 'story', false);

    if (choice.result === 'battle') {
      this.startBattleFromChoice(game, choice);
      return;
    }

    if (choice.result === 'safe') {
      this.advanceActivePlayer(game);
      this.broadcastStory();
      this.broadcastState();
      this.broadcastRoomList();
      return;
    }

    if (choice.result === 'random') {
      this.handleRandomEncounter(game, choice.nextNodeId, choice.onBattle);
      this.broadcastStory();
      this.broadcastState();
      this.broadcastRoomList();
      return;
    }

    if (choice.result === 'elimination') {
      this.resolveElimination(game, choice);
      return;
    }

    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private startBattleFromChoice(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
    choice: StoryChoice,
  ) {
    let teamA: TeamId | null = null;
    let teamB: TeamId | null = null;

    if (choice.versus) {
      [teamA, teamB] = choice.versus;
    } else if (choice.enemyTeamId) {
      teamA = game.currentTeamId;
      teamB = choice.enemyTeamId;
    }

    const sideHasAlive = (teamId: TeamId) =>
      game.teams[teamId].players.some((p) => p.status === 'alive');

    if (teamA && teamB) {
      const aAlive = sideHasAlive(teamA);
      const bAlive = sideHasAlive(teamB);

      if (!aAlive || !bAlive) {
        const standing = aAlive ? teamA : bAlive ? teamB : null;
        const fallen = aAlive ? teamB : bAlive ? teamA : null;

        this.broadcastEvent(GLOBAL_ROOM, {
          type: 'BATTLE_UPDATE',
          mode: 'team',
          message: standing
            ? `${fallen} could not answer the challenge. ${standing} walks on.`
            : `Both sides have fallen. The path is silent.`,
        });

        game.phase = 'story';
        if (choice.nextNodeId) game.currentNodeId = choice.nextNodeId;

        this.broadcastStory();
        this.broadcastState();
        this.broadcastRoomList();
        return;
      }
    }

    game.phase = 'battle';
    game.pendingNextNodeId = choice.nextNodeId;

    if (choice.versus && teamA && teamB) {
      game.battle = this.combatEngine.createTeamBattle(
        game,
        teamA,
        teamB,
        game.currentNodeId,
      );
    } else if (choice.enemyName) {
      const isBoss = choice.enemyName === 'NICHOLAS JOHNSON';

      game.battle = isBoss
        ? this.combatEngine.createBossBattle(game, game.currentTeamId, {
            name: choice.enemyName,
            hp: choice.enemyHp ?? 400,
            attack: 22,
            personality: 'boss',
            phases: [
              {
                hpThreshold: 0.66,
                attackMultiplier: 1.15,
                announcement: '"You should have turned back."',
              },
              {
                hpThreshold: 0.33,
                attackMultiplier: 1.35,
                announcement: 'The Warden sheds its armor.',
                healOnEnter: 60,
              },
            ],
          })
        : this.combatEngine.createCpuBattle(
            game,
            game.currentTeamId,
            choice.enemyName,
            choice.enemyHp ?? 100,
            choice.enemyMaxHp ?? choice.enemyHp ?? 100,
            {
              personality: 'aggressive',
              abilityChance: 0.25,
              signatureEveryNRounds: 4,
              signatureMultiplier: 1.5,
            },
          );
    } else {
      const defenderTeam =
        choice.enemyTeamId ??
        this.getNextEnemyTeam(game.currentTeamId, game.activeTeams);

      if (!sideHasAlive(defenderTeam)) {
        game.phase = 'story';
        if (choice.nextNodeId) game.currentNodeId = choice.nextNodeId;

        this.broadcastStory();
        this.broadcastState();
        this.broadcastRoomList();
        return;
      }

      game.battle = this.combatEngine.createTeamBattle(
        game,
        game.currentTeamId,
        defenderTeam,
        game.currentNodeId,
      );
    }

    if (game.battle) {
      game.battle.queuedActions = [];
      game.battle.readyPlayerIds = [];
    }

    this.playCutscene(choice.onBattle, 'battle', false);

    this.broadcastRoundState(game);
    this.startRoundTimeout(game);

    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private resolveElimination(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
    choice: StoryChoice,
  ) {
    const teamId = game.currentTeamId;
    const team = game.teams[teamId];

    const candidates = team.players
      .filter((p) => p.status === 'alive')
      .sort((a, b) => a.hp - b.hp);

    const victim = candidates[0];

    if (victim) {
      victim.status = 'eliminated';
      victim.hp = 0;

      this.broadcastEvent(GLOBAL_ROOM, {
        type: 'ELIMINATE',
        playerId: victim.id,
      });

      this.logger.log(
        `Elimination at ${game.currentNodeId}: ${victim.name} (${teamId})`,
      );
    }

    game.phase = 'story';
    if (choice.nextNodeId) game.currentNodeId = choice.nextNodeId;

    this.advanceActivePlayer(game);
    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private handleRandomEncounter(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
    nextNodeId?: string,
    onBattle?: Cutscene,
  ) {
    const random = Math.random();

    if (random < 0.5) {
      this.advanceActivePlayer(game);
      return;
    }

    game.phase = 'battle';

    const encounters = [
      {
        name: 'THE SHADOW',
        hp: 80,
        attack: 14,
        personality: 'chaotic' as const,
        abilityChance: 0.15,
        signatureEveryNRounds: 0,
      },
      {
        name: 'A HOLLOW WRAITH',
        hp: 100,
        attack: 16,
        personality: 'aggressive' as const,
        abilityChance: 0.25,
        signatureEveryNRounds: 4,
        signatureMultiplier: 1.5,
      },
      {
        name: 'THE PALE HUNTER',
        hp: 120,
        attack: 18,
        personality: 'strategic' as const,
        abilityChance: 0.3,
        signatureEveryNRounds: 3,
        signatureMultiplier: 1.7,
        telegraphs: true,
      },
    ];

    const encounter = encounters[Math.floor(Math.random() * encounters.length)];

    game.battle = this.combatEngine.createCpuBattle(
      game,
      game.currentTeamId,
      encounter.name,
      encounter.hp,
      encounter.hp,
      {
        attack: encounter.attack,
        personality: encounter.personality,
        abilityChance: encounter.abilityChance,
        signatureEveryNRounds: encounter.signatureEveryNRounds,
        signatureMultiplier: encounter.signatureMultiplier,
        telegraphs: encounter.telegraphs,
      },
    );

    if (game.battle) {
      game.battle.queuedActions = [];
      game.battle.readyPlayerIds = [];
      game.battle.intro = onBattle;
      this.playCutscene(onBattle, 'battle', false);
    }

    this.broadcastRoundState(game);
    this.startRoundTimeout(game);
  }

  /* ================================================================== */
  /* Combat queue                                                        */
  /* ================================================================== */

  private expectedActors(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
    battle: Battle,
  ): Player[] {
    const teamId =
      battle.mode === 'team' ? battle.turnTeamId : battle.attackerTeamId;
    const team = game.teams[teamId];
    return team.players.filter(
      (p) =>
        p.status === 'alive' &&
        p.connected &&
        !(p.statusEffects ?? []).some((s) => s.id === 'immobilized'),
    );
  }

  private broadcastRoundState(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    const battle = game.battle;
    if (!battle) return;

    const expected = this.expectedActors(game, battle);
    const ready = new Set(battle.readyPlayerIds ?? []);
    const waitingOn = expected.filter((p) => !ready.has(p.id)).map((p) => p.id);

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'COMBAT_ROUND_UPDATE',
      waitingOn,
      expected: expected.length,
    });
  }

  private handleCombatQueueAction(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'COMBAT_QUEUE_ACTION' }>,
  ) {
    if (this.activeCutsceneId) {
      this.sendError(client.socket, 'A cutscene is playing.');
      return;
    }

    const game = this.getGlobalGame(client);
    if (!game) return;

    const battle = game.battle;
    if (!battle || battle.status !== 'active') {
      this.sendError(client.socket, 'No active battle.');
      return;
    }

    const player = this.findPlayer(game, event.playerId);
    if (!player) {
      this.sendError(client.socket, 'Player not found.');
      return;
    }

    const expected = this.expectedActors(game, battle);
    if (!expected.some((p) => p.id === player.id)) {
      this.sendError(client.socket, 'It is not your turn.');
      return;
    }

    battle.queuedActions = battle.queuedActions ?? [];
    battle.readyPlayerIds = battle.readyPlayerIds ?? [];

    if (battle.readyPlayerIds.includes(player.id)) {
      battle.queuedActions = battle.queuedActions.filter(
        (q) => q.playerId !== player.id,
      );
    }

    battle.queuedActions.push({
      playerId: player.id,
      action: event.action,
      variant: event.variant,
      targetId: event.targetId,
    });

    if (!battle.readyPlayerIds.includes(player.id)) {
      battle.readyPlayerIds.push(player.id);
    }

    this.logger.debug(
      `Queued action: player=${player.id} action=${event.action} ready=${battle.readyPlayerIds.length}/${expected.length}`,
    );

    this.broadcastRoundState(game);
    this.broadcastState();

    const allReady = expected.every((p) =>
      battle.readyPlayerIds!.includes(p.id),
    );

    if (allReady && !this.resolvingRound) {
      void this.resolveRound(game);
    }
  }

  private async resolveRound(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    const battle = game.battle;
    if (!battle || battle.status !== 'active') return;

    this.clearRoundTimeout();
    this.resolvingRound = true;

    try {
      // Auto-fill missing actions with a default attack.
      const expected = this.expectedActors(game, battle);
      const queued = new Set(
        (battle.queuedActions ?? []).map((q) => q.playerId),
      );

      for (const p of expected) {
        if (queued.has(p.id)) continue;
        battle.queuedActions!.push({
          playerId: p.id,
          action: 'attack',
        });
        this.logger.debug(`Auto-queued attack for ${p.id}`);
      }

      const queue = [...(battle.queuedActions ?? [])];

      for (const entry of queue) {
        const live = this.gameStore.getGame(GLOBAL_ROOM_CODE);
        if (!live?.battle || live.battle.status !== 'active') break;

        const liveBattle = live.battle;
        const actor = this.findPlayer(live, entry.playerId);
        if (!actor || actor.status !== 'alive') continue;

        const before = liveBattle.log.length;

        try {
          this.combatEngine.performAction(
            live,
            actor,
            entry.action,
            entry.variant,
            entry.targetId,
          );

          const newLines = liveBattle.log.slice(before);
          for (const line of newLines) {
            this.broadcastEvent(GLOBAL_ROOM, {
              type: 'BATTLE_UPDATE',
              mode: liveBattle.mode,
              enemyName:
                liveBattle.mode === 'cpu' ? liveBattle.enemyName : undefined,
              enemyHp:
                liveBattle.mode === 'cpu' ? liveBattle.enemyHp : undefined,
              enemyMaxHp:
                liveBattle.mode === 'cpu' ? liveBattle.enemyMaxHp : undefined,
              message: line,
              source: 'player',
              actingTeamId: actor.teamId,
              actingPlayerId: actor.id,
            });

            if (line.endsWith('is BROKEN!')) {
              this.emitBreak(line, live);
            }
          }

          this.broadcastState();
        } catch (error) {
          this.logger.warn(
            `Action failed: player=${entry.playerId} action=${entry.action} error=${error instanceof Error ? error.message : String(error)}`,
          );
        }

        if (liveBattle.status !== 'active') break;

        await this.wait(ACTION_RESOLVE_DELAY_MS);
      }

      const live = this.gameStore.getGame(GLOBAL_ROOM_CODE);
      if (!live?.battle) {
        this.resolvingRound = false;
        return;
      }

      const liveBattle = live.battle;

      if (liveBattle.status !== 'active') {
        this.finishRound(live);
        return;
      }

      if (liveBattle.mode === 'cpu') {
        this.broadcastEvent(GLOBAL_ROOM, {
          type: 'BATTLE_UPDATE',
          mode: 'cpu',
          message: '',
          thinking: true,
        });

        await this.wait(ENEMY_RETALIATE_DELAY_MS);

        const before = liveBattle.log.length;
        this.combatEngine.cpuRetaliate(live, liveBattle);

        const newCpuLines = liveBattle.log.slice(before);
        for (const line of newCpuLines) {
          this.broadcastEvent(GLOBAL_ROOM, {
            type: 'BATTLE_UPDATE',
            mode: 'cpu',
            enemyName: liveBattle.enemyName,
            enemyHp: liveBattle.enemyHp,
            enemyMaxHp: liveBattle.enemyMaxHp,
            message: line,
            source: 'enemy',
          });

          if (line.endsWith('is BROKEN!')) {
            this.emitBreak(line, live);
          }
        }

        this.broadcastEvent(GLOBAL_ROOM, {
          type: 'BATTLE_UPDATE',
          mode: 'cpu',
          message: '',
          thinking: false,
        });

        if (liveBattle.status !== 'active') {
          this.finishRound(live);
          return;
        }
      }

      liveBattle.queuedActions = [];
      liveBattle.readyPlayerIds = [];

      this.combatEngine.nextTurn(live);
      this.combatEngine.tickStatuses(live);

      this.broadcastRoundState(live);
      this.broadcastState();
      this.broadcastRoomList();

      this.startRoundTimeout(live);
    } finally {
      this.resolvingRound = false;
    }
  }

  private finishRound(game: NonNullable<ReturnType<GameStore['getGame']>>) {
    this.endBattleAndAdvance(game);
    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private handleCombatAction(
    client: ConnectedClient,
    event: Extract<
      GameEvent,
      { type: 'COMBAT_ACTION' | 'COMBAT_ACTION_SELECTED' }
    >,
  ) {
    const variant = 'variant' in event ? event.variant : undefined;
    const targetId = 'targetId' in event ? event.targetId : undefined;

    this.handleCombatQueueAction(client, {
      type: 'COMBAT_QUEUE_ACTION',
      playerId: event.playerId,
      action: event.action,
      variant,
      targetId,
    });
  }

  /* ================================================================== */
  /* Battle helpers                                                      */
  /* ================================================================== */

  private emitBreak(line: string, game: GameState) {
    const name = line.slice(0, line.indexOf(' is BROKEN!')).trim();
    const broken = Object.values(game.teams)
      .flatMap((t) => t.players)
      .find((p) => p.name === name);
    if (broken) {
      this.broadcastEvent(GLOBAL_ROOM, {
        type: 'BREAK',
        teamId: broken.teamId,
        playerId: broken.id,
      });
    }
  }

  private endBattleAndAdvance(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    this.clearRoundTimeout();

    const battle = game.battle;
    if (battle) {
      const cutscene =
        battle.status === 'victory' ? battle.victory : battle.defeat;
      this.playCutscene(cutscene, 'battle', false);
    }

    game.phase = 'story';
    game.battle = undefined;

    if (game.pendingNextNodeId) {
      game.currentNodeId = game.pendingNextNodeId;
      game.pendingNextNodeId = undefined;
    }

    this.advanceActivePlayer(game);
  }

  /* ================================================================== */
  /* Cutscenes                                                           */
  /* ================================================================== */

  private playCutscene(
    cutscene: Cutscene | undefined,
    context: 'story' | 'battle',
    pause = false,
  ) {
    if (!cutscene || cutscene.lines.length === 0) return;
    if (this.seenCutscenes.has(cutscene.id)) return;
    this.seenCutscenes.add(cutscene.id);

    this.activeCutsceneId = pause ? cutscene.id : null;

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'CUTSCENE',
      cutscene,
      context,
      pausePhase: pause,
    });
  }

  /* ================================================================== */
  /* Utilities                                                           */
  /* ================================================================== */

  private getNextEnemyTeam(
    currentTeam: TeamId,
    activeTeams?: TeamId[],
  ): TeamId {
    const pool =
      activeTeams && activeTeams.length > 0 ? activeTeams : ALL_TEAMS;
    const index = pool.indexOf(currentTeam);
    return pool[(index + 1) % pool.length];
  }

  private findPlayer(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
    playerId: string,
  ) {
    for (const team of Object.values(game.teams)) {
      const player = team.players.find((p) => p.id === playerId);
      if (player) return player;
    }
    return undefined;
  }

  private getGlobalGame(client: ConnectedClient) {
    if (!client.roomCode) {
      this.sendError(client.socket, 'You are not inside the game.');
      return undefined;
    }

    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);

    if (!game) {
      this.sendError(client.socket, 'Game not found.');
      return undefined;
    }

    return game;
  }

  private broadcastStory() {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game) return;

    const node = this.storyEngine.getNode(game.currentNodeId);
    if (!node) return;

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'STORY_UPDATE',
      nodeId: node.id,
      title: node.title,
      text: node.text,
      background: node.background,
      choices: node.choices,
    } as GameEvent);

    if (game.currentNodeId !== this.lastCutsceneNodeId) {
      this.lastCutsceneNodeId = game.currentNodeId;
      this.playCutscene(node.onEnter, 'story', false);
    }
  }

  private broadcastState() {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game) return;

    this.server.to(GLOBAL_ROOM).emit(
      'message',
      JSON.stringify({
        type: 'STATE_SYNC',
        roomCode: game.roomCode,
        payload: game as unknown as Record<string, unknown>,
      } satisfies GameEvent),
    );
  }

  private sendState(
    socket: Socket,
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    this.send(socket, {
      type: 'STATE_SYNC',
      roomCode: game.roomCode,
      payload: game as unknown as Record<string, unknown>,
    });
  }

  private broadcastEvent(roomCode: string, event: GameEvent) {
    this.recentEvents.push(event);
    if (this.recentEvents.length > 60) {
      this.recentEvents.shift();
    }
    this.server.to(roomCode).emit('message', JSON.stringify(event));
  }

  private send(socket: Socket, event: GameEvent) {
    if (socket.connected) {
      socket.send(JSON.stringify(event));
    }
  }

  private sendError(socket: Socket, message: string) {
    this.logger.warn(`Game error: socket=${socket.id} message=${message}`);
    this.send(socket, {
      type: 'STATE_SYNC',
      roomCode: '',
      payload: { error: message },
    });
  }

  private sendRoomList(socket: Socket) {
    const event = {
      type: 'ROOM_LIST_UPDATE',
      rooms: this.gameStore.getGlobalRoomSummary(),
    };
    socket.emit('message', JSON.stringify(event));
  }

  private broadcastRoomList() {
    const event = {
      type: 'ROOM_LIST_UPDATE',
      rooms: this.gameStore.getGlobalRoomSummary(),
    };

    for (const client of this.clients) {
      if (client.watcher) {
        client.socket.emit('message', JSON.stringify(event));
      }
    }
  }
}
