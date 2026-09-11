/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { Battle, GameEvent, GameState, TeamId } from './game.types';
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
  handleConnection(socket: Socket) {
    const client: ConnectedClient = { socket };
    this.clients.add(client);
    this.logger.debug(`Client connected: socket=${socket.id}`);

    this.send(socket, {
      type: 'STATE_SYNC',
      roomCode: GLOBAL_ROOM,
      payload: {
        connected: true,
        message: 'Connected to Embrace Your Horror.',
      },
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
      default:
        this.sendError(client.socket, 'Unknown game event.');
    }
  }

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

    // Remove the player from their team's roster entirely.
    for (const team of Object.values(game.teams)) {
      const idx = team.players.findIndex((p) => p.id === event.playerId);
      if (idx >= 0) {
        team.players.splice(idx, 1);
        break;
      }
    }

    // Remove the socket from the game.
    if (client.roomCode) {
      void client.socket.leave(client.roomCode);
      client.roomCode = undefined;
    }
    client.playerId = undefined;

    this.logger.log(`Player left: player=${event.playerId}`);

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

  private handleChoice(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'CHOICE' }>,
  ) {
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
    if (player.status !== 'alive') {
      this.sendError(client.socket, 'Eliminated players cannot make choices.');
      return;
    }

    const result = this.storyEngine.applyChoice(game, event.choiceId);
    if (!result) {
      this.sendError(client.socket, 'Invalid story choice.');
      return;
    }

    const { choice } = result;

    if (choice.result === 'battle') {
      // ---------- Resolve the matchups first ----------
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

      // ---------- PvP: skip if either side is wiped ----------
      if (teamA && teamB) {
        const aAlive = sideHasAlive(teamA);
        const bAlive = sideHasAlive(teamB);

        if (!aAlive || !bAlive) {
          this.logger.warn(
            `Skipping PvP at ${game.currentNodeId}: ${teamA}=${aAlive}, ${teamB}=${bAlive}`,
          );
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
          if (choice.nextNodeId) {
            game.currentNodeId = choice.nextNodeId;
          }

          this.broadcastStory();
          this.broadcastState();
          this.broadcastRoomList();
          return;
        }
      }

      // ---------- Otherwise set up the battle ----------
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
        // Fallback: pick the next team in rotation, but make sure they're alive.
        const defenderTeam =
          choice.enemyTeamId ??
          this.getNextEnemyTeam(game.currentTeamId, game.activeTeams);

        if (!sideHasAlive(defenderTeam)) {
          this.logger.warn(
            `Fallback PvP skipped: ${defenderTeam} has no alive players.`,
          );

          game.phase = 'story';
          if (choice.nextNodeId) {
            game.currentNodeId = choice.nextNodeId;
          }

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

      this.broadcastStory();
      this.broadcastState();
      this.broadcastRoomList();
      return;
    }

    if (choice.result === 'safe') {
      this.advanceTeam(game);
      this.broadcastStory();
      this.broadcastState();
      this.broadcastRoomList();
      return;
    }

    if (choice.result === 'random') {
      this.handleRandomEncounter(game, choice.nextNodeId);
      this.broadcastStory();
      this.broadcastState();
      this.broadcastRoomList();
      return;
    }

    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private handleRandomEncounter(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
    nextNodeId?: string,
  ) {
    const random = Math.random();

    // 50% safe, 50% encounter
    if (random < 0.5) {
      this.advanceTeam(game);
      return;
    }

    game.phase = 'battle';

    // Small pool of random encounters. Each has its own stats + personality,
    // so "random" doesn't mean "boring".
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

    const index = Math.floor(Math.random() * encounters.length);
    const encounter = encounters[index];

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
  }

  private handleCombatAction(
    client: ConnectedClient,
    event: Extract<
      GameEvent,
      { type: 'COMBAT_ACTION' | 'COMBAT_ACTION_SELECTED' }
    >,
  ) {
    const game = this.getGlobalGame(client);
    if (!game) return;

    if (!game.battle) {
      this.sendError(client.socket, 'No active battle.');
      return;
    }

    const player = this.findPlayer(game, event.playerId);
    if (!player) {
      this.sendError(client.socket, 'Player not found.');
      return;
    }

    try {
      const variant = 'variant' in event ? event.variant : undefined;
      const targetId = 'targetId' in event ? event.targetId : undefined;

      const logBefore = game.battle.log.length;
      const message = this.combatEngine.performAction(
        game,
        player,
        event.action,
        variant,
        targetId,
      );

      const battle = game.battle;
      const newLines = battle.log.slice(logBefore);

      // --- Broadcast the player's own action first ---------------------
      this.broadcastPlayerAction(battle, message, player.teamId);
      this.broadcastState();

      // --- CPU-only: delay the enemy response -------------------------
      if (battle.mode === 'cpu' && battle.status === 'active') {
        // Tell clients the enemy is "thinking".
        this.broadcastEvent(GLOBAL_ROOM, {
          type: 'BATTLE_UPDATE',
          mode: 'cpu',
          message: '',
          thinking: true,
        });

        setTimeout(() => {
          // Re-fetch in case the state changed during the pause.
          const live = this.gameStore.getGame(GLOBAL_ROOM_CODE);
          if (!live?.battle || live.battle.mode !== 'cpu') return;
          if (live.battle.status !== 'active') return;

          const battleRef = live.battle;
          const before = battleRef.log.length;

          this.combatEngine.cpuRetaliate(live, battleRef);

          const newCpuLines = battleRef.log.slice(before);

          for (const line of newCpuLines) {
            this.broadcastEvent(GLOBAL_ROOM, {
              type: 'BATTLE_UPDATE',
              mode: 'cpu',
              enemyName: battleRef.enemyName,
              enemyHp: battleRef.enemyHp,
              enemyMaxHp: battleRef.enemyMaxHp,
              message: line,
              source: 'enemy',
            });
          }

          // Clear the thinking flag.
          this.broadcastEvent(GLOBAL_ROOM, {
            type: 'BATTLE_UPDATE',
            mode: 'cpu',
            message: '',
            thinking: false,
          });

          if (battleRef.status !== 'active') {
            this.endBattleAndAdvance(live);
            this.broadcastStory();
            this.broadcastState();
            this.broadcastRoomList();
            return;
          }

          this.broadcastState();
          this.broadcastRoomList();
        }, 3000); // 3s thinking pause — tune as you like

        return;
      }

      // --- Team battles: emit any extra log lines immediately ----------
      for (const line of newLines) {
        if (line === message) continue;
        this.broadcastEvent(GLOBAL_ROOM, {
          type: 'BATTLE_UPDATE',
          mode: 'team',
          message: line,
        });
        if (line.endsWith('is BROKEN!')) {
          this.emitBreak(line, game);
        }
      }

      if (battle.status !== 'active') {
        this.endBattleAndAdvance(game);
        this.broadcastStory();
        this.broadcastState();
        this.broadcastRoomList();
        return;
      }

      this.combatEngine.nextTurn(game);
      this.combatEngine.tickStatuses(game);

      this.broadcastState();
      this.broadcastRoomList();
    } catch (error) {
      this.sendError(
        client.socket,
        error instanceof Error ? error.message : 'Combat action failed.',
      );
    }
  }

  private broadcastPlayerAction(
    battle: Battle,
    message: string,
    actingTeamId?: TeamId,
  ) {
    if (battle.mode === 'cpu') {
      this.broadcastEvent(GLOBAL_ROOM, {
        type: 'BATTLE_UPDATE',
        mode: 'cpu',
        enemyName: battle.enemyName,
        enemyHp: battle.enemyHp,
        enemyMaxHp: battle.enemyMaxHp,
        message,
        source: 'player',
      });
    } else {
      this.broadcastEvent(GLOBAL_ROOM, {
        type: 'BATTLE_UPDATE',
        mode: 'team',
        message,
        actingTeamId,
      });
    }
  }

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

  private playerReady(client: ConnectedClient, playerId: string) {
    const game = this.getGlobalGame(client);
    if (!game) return;

    const player = this.findPlayer(game, playerId);
    if (!player) return;

    player.ready = true;
    this.broadcastState();
    this.broadcastRoomList();
  }

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
      // Only keep caps for teams that are actually in rotation.
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

    this.broadcastEvent(GLOBAL_ROOM, {
      type: 'TEAM_TURN',
      teamId: populated[0],
    });
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

    this.broadcastEvent(GLOBAL_ROOM, { type: 'TEAM_TURN', teamId });
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

  private advanceTeam(game: NonNullable<ReturnType<GameStore['getGame']>>) {
    const pool =
      game.activeTeams && game.activeTeams.length > 0
        ? game.activeTeams
        : ALL_TEAMS;

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
        this.broadcastEvent(GLOBAL_ROOM, {
          type: 'TEAM_TURN',
          teamId: candidate,
        });
        return;
      }
    }

    // Nobody can act — end the game.
    game.phase = 'ended';
    this.broadcastState();
  }

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
  }

  private broadcastState() {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (!game) return;

    this.logger.debug(`Broadcasting state: room=${GLOBAL_ROOM}`);
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
    this.logger.debug(`Broadcasting ${event.type}: room=${roomCode}`);
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
  private endBattleAndAdvance(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    game.phase = 'story';
    game.battle = undefined;

    if (game.pendingNextNodeId) {
      game.currentNodeId = game.pendingNextNodeId;
      game.pendingNextNodeId = undefined;
    }

    this.advanceTeam(game);
  }
}
