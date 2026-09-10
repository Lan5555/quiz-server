/* eslint-disable @typescript-eslint/no-unused-vars */
import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { GameEvent, TeamId } from './game.types';
import { GameStore, GLOBAL_ROOM_CODE } from './game.store';
import { StoryEngine } from './engines/story.engine';
import { CombatEngine } from './engines/combat.engine';

interface ConnectedClient {
  socket: Socket;
  playerId?: string;
  roomCode?: string;
  watcher?: boolean;
}

/**
 * Socket.io room name used for broadcasts. All players join this room
 * so a single `server.to(GLOBAL_ROOM)` reaches every team at once.
 *
 * This is intentionally separate from `GLOBAL_ROOM_CODE`, which is the
 * key used to look up the shared game in the GameStore. They happen to
 * be the same string today, but keeping them separate avoids coupling
 * the store's key to the transport's room name.
 */
const GLOBAL_ROOM = 'global';

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
        this.handleCombatAction(client, {
          type: 'COMBAT_ACTION',
          playerId: event.playerId,
          action: event.action,
        });
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

      default:
        this.sendError(client.socket, 'Unknown game event.');
    }
  }

  /**
   * Returns the single shared game, creating it via the store on first
   * access. Also seeds the initial story node exactly once.
   */
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
      });
    } else {
      existingPlayer.connected = true;
      this.logger.debug(
        `Reconnected player: player=${event.playerId} team=${event.teamId}`,
      );
    }

    // Everyone joins the same socket.io room.
    if (client.roomCode && client.roomCode !== GLOBAL_ROOM) {
      void client.socket.leave(client.roomCode);
    }
    void client.socket.join(GLOBAL_ROOM);

    client.playerId = event.playerId;
    client.roomCode = GLOBAL_ROOM;
    client.watcher = false;

    this.logger.log(
      `Player joined: player=${event.playerId} team=${event.teamId} socket=${client.socket.id}`,
    );

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

    this.logger.log(
      `Watcher joined: watcher=${event.watcherId} socket=${client.socket.id}`,
    );

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

    this.logger.debug(
      `Choice applied: player=${event.playerId} team=${player.teamId} choice=${choice.id} result=${choice.result} node=${game.currentNodeId}`,
    );

    if (choice.result === 'battle') {
      const defenderTeam =
        choice.enemyTeamId ?? this.getNextEnemyTeam(game.currentTeamId);

      game.phase = 'battle';
      game.battle = this.combatEngine.createBattle(
        game.currentTeamId,
        defenderTeam,
        choice.enemyName ?? 'Unknown Horror',
        choice.enemyHp ?? 100,
        choice.enemyMaxHp ?? 100,
      );
    }

    if (choice.result === 'safe') {
      this.advanceTeam(game);
    }

    if (choice.result === 'random') {
      this.handleRandomEncounter(game);
    }

    this.broadcastStory();
    this.broadcastState();
    this.broadcastRoomList();
  }

  private handleRandomEncounter(
    game: NonNullable<ReturnType<GameStore['getGame']>>,
  ) {
    const random = Math.random();

    this.logger.debug(`Random encounter: roll=${random.toFixed(3)}`);

    if (random < 0.5) {
      this.advanceTeam(game);
      return;
    }

    game.phase = 'battle';
    game.battle = this.combatEngine.createBattle(
      game.currentTeamId,
      this.getNextEnemyTeam(game.currentTeamId),
      'THE SHADOW',
      80,
      80,
    );
  }

  private handleCombatAction(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'COMBAT_ACTION' }>,
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
      const message = this.combatEngine.performAction(
        game,
        player,
        event.action,
      );

      this.logger.debug(
        `Combat action: player=${event.playerId} action=${event.action} enemyHp=${game.battle.enemyHp}`,
      );

      this.broadcastEvent(GLOBAL_ROOM, {
        type: 'BATTLE_UPDATE',
        enemyName: game.battle.enemyName,
        enemyHp: game.battle.enemyHp,
        enemyMaxHp: game.battle.enemyMaxHp,
        message,
      });

      if (game.battle.status === 'victory') {
        game.phase = 'story';
        this.advanceTeam(game);

        this.broadcastStory();
        this.broadcastState();
        this.broadcastRoomList();
        return;
      }

      this.combatEngine.nextTurn(game);
      this.broadcastState();
    } catch (error) {
      this.sendError(
        client.socket,
        error instanceof Error ? error.message : 'Combat action failed.',
      );
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

    const populated = (Object.keys(game.teams) as TeamId[]).filter(
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
      game.teamCaps = event.teamCaps;
    }

    game.phase = 'story';

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
    const teams: TeamId[] = ['ravens', 'wolves', 'dragons', 'serpents'];
    const index = teams.indexOf(game.currentTeamId);
    const next = teams[(index + 1) % teams.length];

    game.currentTeamId = next;

    this.broadcastEvent(GLOBAL_ROOM, { type: 'TEAM_TURN', teamId: next });
  }

  private getNextEnemyTeam(currentTeam: TeamId): TeamId {
    const teams: TeamId[] = ['ravens', 'wolves', 'dragons', 'serpents'];
    const index = teams.indexOf(currentTeam);
    return teams[(index + 1) % teams.length];
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

  /**
   * Emits a STORY_UPDATE carrying the full current story node so all
   * clients render the same content and choices.
   */
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
}
