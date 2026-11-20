import type { EncounterPath, EncounterPathChoice } from './game.types';
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { QueryFailedError } from 'typeorm';

import {
  Battle,
  Cutscene,
  GameEvent,
  GameState,
  Player,
  QueuedAction,
  ROOM_ARENAS,
  ROOM_FIGHTERS,
  StoryChoice,
  TeamId,
} from './game.types';
import { GameStore, GLOBAL_ROOM_CODE } from './game.store';
import { StoryEngine } from './engines/story.engine';
import { CombatEngine } from './engines/combat.engine';
import type { AdminPlayerSummary, CpuAbilityId, CpuPhase } from './game.types';
import { GameAccountsService } from './accounts/game-accounts.service';
import { applyAdventureInteraction, createAdventureQuest } from './engines/adventure-quests';
import { createEncounterPath, encounterOpponents } from './engines/encounter-path';
import { BATTLE_CINDERS, BATTLE_XP, ProgressionService } from './progression/progression.service';
import { isPremiumFighter, type Loadout } from './progression/catalog';

interface ConnectedClient {
  socket: Socket;
  playerId?: string;
  roomCode?: string;
  watcher?: boolean;
  moderator?: boolean;
}

const MODERATOR_EVENTS = new Set([
  'ADMIN_APPROVE_ROOM',
  'ADMIN_GET_ROOMS',
  'ADMIN_KICK_PLAYER',
  'TEAM_TURN',
  'ELIMINATE',
]);
const GLOBAL_ROOM = 'global';
const ALL_TEAMS: TeamId[] = ['ravens', 'wolves', 'dragons', 'serpents'];

const ACTION_RESOLVE_DELAY_MS = 900;
const LIMIT_BREAK_RESOLVE_DELAY_MS = 2000;
const ENEMY_RETALIATE_DELAY_MS = 700;
const ENEMY_ATTACK_DELAY_MS = 650;
const ROUND_DECISION_TIMEOUT_MS = 30_000;
const STORY_DECISION_TIMEOUT_MS = 70_000;

const MAX_ENCOUNTER_TIER = 61;
const DEFAULT_TEAM_CAP = 4;
const MIN_TEAM_CAP = 1;
const MAX_TEAM_CAP = 10;
const DEFAULT_HP = 2000;
const validHp = (hp: unknown): hp is number =>
  typeof hp === 'number' && Number.isInteger(hp) && hp >= 250 && hp <= 10000;

export interface RoomControl {
  action: string;
  playerId?: string;
  teamId?: TeamId;
  nodeId?: string;
  choiceId?: string;
  value?: number;
}

interface EnemyConfig {
  hp: number;
  attack: number;
  personality: 'aggressive' | 'chaotic' | 'strategic' | 'boss';
  abilityChance: number;
  signatureEveryNRounds: number;
  signatureMultiplier: number;
  telegraphs?: boolean;
  phases?: CpuPhase[];
  abilities?: CpuAbilityId[];
}

const ENEMY_CONFIGS: Record<string, EnemyConfig> = {
  'ECHO BEAST': {
    hp: 2800,
    attack: 110,
    personality: 'chaotic',
    abilityChance: 0.35,
    signatureEveryNRounds: 4,
    signatureMultiplier: 1.6,
    abilities: ['rend', 'sweep'],
  },
  'GATE WARDEN': {
    hp: 3200,
    attack: 100,
    personality: 'boss',
    abilityChance: 0.45,
    signatureEveryNRounds: 3,
    signatureMultiplier: 1.8,
    telegraphs: true,
    abilities: ['rend', 'sweep', 'howl'],
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
        healOnEnter: 400,
      },
    ],
  },
  'THE BELL KEEPER': {
    hp: 3400,
    attack: 105,
    personality: 'strategic',
    abilityChance: 0.35,
    signatureEveryNRounds: 3,
    signatureMultiplier: 1.7,
    telegraphs: true,
    abilities: ['rend', 'sweep', 'mend', 'howl'],
  },
  'BLOOD HUNTERS': {
    hp: 3600,
    attack: 110,
    personality: 'aggressive',
    abilityChance: 0.35,
    signatureEveryNRounds: 4,
    signatureMultiplier: 1.7,
    abilities: ['rend', 'sweep', 'drain'],
  },
  'THE REMNANT': {
    hp: 3800,
    attack: 110,
    personality: 'strategic',
    abilityChance: 0.4,
    signatureEveryNRounds: 3,
    signatureMultiplier: 1.8,
    telegraphs: true,
    abilities: ['rend', 'sweep', 'mend', 'drain'],
  },
  'COLD DRAKE': {
    hp: 3800,
    attack: 110,
    personality: 'strategic',
    abilityChance: 0.4,
    signatureEveryNRounds: 3,
    signatureMultiplier: 1.8,
    telegraphs: true,
    abilities: ['rend', 'sweep', 'mend'],
  },
  'HOLLOW KNIGHTS': {
    hp: 4400,
    attack: 110,
    personality: 'boss',
    abilityChance: 0.45,
    signatureEveryNRounds: 3,
    signatureMultiplier: 1.9,
    telegraphs: true,
    abilities: ['rend', 'sweep', 'crush', 'howl', 'mend'],
    phases: [
      {
        hpThreshold: 0.5,
        attackMultiplier: 1.2,
        announcement: '"We died defending the Highlands."',
        healOnEnter: 500,
      },
    ],
  },
  'NICHOLAS JOHNSON': {
    hp: 5200,
    attack: 200,
    personality: 'boss',
    abilityChance: 0.5,
    signatureEveryNRounds: 3,
    signatureMultiplier: 1.9,
    telegraphs: true,
    abilities: ['rend', 'sweep', 'crush', 'howl', 'mend', 'drain'],
    phases: [
      {
        hpThreshold: 0.5,
        attackMultiplier: 1.2,
        announcement: '"You are still standing."',
        healOnEnter: 600,
      },
      {
        hpThreshold: 0.25,
        attackMultiplier: 1.4,
        announcement:
          '"I have killed you more times than you could ever remember."',
        healOnEnter: 800,
      },
    ],
  },
  'NICHOLAS JOHNSON — FINAL FORM': {
    hp: 7200,
    attack: 300,
    personality: 'boss',
    abilityChance: 0.55,
    signatureEveryNRounds: 2,
    signatureMultiplier: 2.0,
    telegraphs: true,
    abilities: ['rend', 'sweep', 'crush', 'howl', 'mend', 'drain'],
    phases: [
      {
        hpThreshold: 0.66,
        attackMultiplier: 1.15,
        announcement: '"Then let the Highlands remember you."',
      },
      {
        hpThreshold: 0.4,
        attackMultiplier: 1.35,
        announcement: '"Because I will not die alone."',
        healOnEnter: 1200,
      },
      {
        hpThreshold: 0.15,
        attackMultiplier: 1.6,
        announcement: '"I will take this entire world with me."',
        healOnEnter: 900,
      },
    ],
  },
};

@WebSocketGateway({ cors: true })
export class GameGateway {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(GameGateway.name);
  private readonly clients = new Set<ConnectedClient>();

  constructor(
    private readonly gameStore: GameStore,
    private readonly storyEngine: StoryEngine,
    private readonly combatEngine: CombatEngine,
    private readonly accounts: GameAccountsService,
    private readonly progression: ProgressionService,
  ) {}

  private activeCutsceneId: string | null = null;
  private seenCutscenes = new Set<string>();
  private lastCutsceneNodeId: string | null = null;

  private readonly resolvingRooms = new Set<string>();
  private readonly contributors = new WeakMap<Battle, Set<string>>();
  private readonly rewardSettledAt = new WeakMap<Battle, Date>();
  private readonly kickedPlayers = new WeakMap<GameState, Set<string>>();
  private roundTimeoutHandles = new Map<string, NodeJS.Timeout>();
  private storyTimeoutHandles = new Map<string, NodeJS.Timeout>();
  private readonly roomTransitionTimers = new Map<string, NodeJS.Timeout>();

  adminState() {
    return this.gameStore.getAllGames().map((room) => {
      const {
        roomCode,
        phase,
        paused,
        battleMode,
        adventure,
        encounterPath,
        currentTeamId,
        activePlayerId,
        teamCap,
        startingHp,
        teams,
        hostPlayerId,
        battle,
      } = room;
      const scene = room.battleMode
        ? undefined
        : this.storyEngine.getNode(room.currentNodeId, room);
      return {
        roomCode,
        phase,
        paused,
        battleMode,
        adventure,
        encounterPath,
        currentTeamId,
        activePlayerId,
        teamCap,
        startingHp,
        teams,
        hostPlayerId,
        battle: battle && { ...battle, log: battle.log.slice(-10) },
        resolving: this.resolvingRooms.has(roomCode),
        scene: scene && {
          id: scene.id,
          title: scene.title,
          choices: scene.choices.map(({ id, text, result }) => ({
            id,
            text,
            result,
          })),
        },
        scenes: room.battleMode
          ? []
          : Object.values(this.storyEngine.getStory(room)).map(
              ({ id, title }) => ({ id, title }),
            ),
      };
    });
  }

  storyPublished() {
    for (const game of this.gameStore.getAllGames()) {
      if (!game.battleMode && game.phase === 'waiting') {
        this.storyEngine.resetRun(game);
        this.broadcastStory(game.roomCode);
        this.broadcastState(game.roomCode);
      }
    }
  }

  refreshAccount(playerId: string) {
    for (const game of this.gameStore.getAllGames()) {
      if (this.findPlayer(game, playerId)) {
        this.broadcastEvent(game.roomCode, { type: 'PROFILE_UPDATED' });
      }
    }
  }

  controlRoom(roomCode: string, command: RoomControl) {
    const game = this.gameStore.getGame(roomCode);
    if (!game) throw new NotFoundException('Room not found.');
    if (this.resolvingRooms.has(roomCode))
      throw new ConflictException('Wait for the current round to finish.');
    const { action, playerId, teamId, nodeId, choiceId, value } = command;
    const player = playerId ? this.findPlayer(game, playerId) : undefined;
    const integer = (min: number, max: number) => {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < min ||
        value > max
      )
        throw new BadRequestException(
          `Enter a whole number from ${min} to ${max}.`,
        );
      return value;
    };
    switch (action) {
      case 'start':
        if (game.phase !== 'waiting')
          throw new ConflictException('Start is available in the lobby.');
        if (game.battleMode === 'pvp') this.startPvp(game);
        else if (game.battleMode === 'cpu') {
          if (game.openingEnemy || game.encounterPath) {
            this.startStagedCpuMatch(game);
            break;
          }
          if (
            !game.teams[game.currentTeamId].players.some(
              (entry) => entry.connected,
            )
          )
            throw new ConflictException('The arena needs a connected player.');
          game.phase = 'battle';
          this.scheduleCpuEncounter(game, 0);
        } else this.activateStory(game);
        break;
      case 'pause':
        if (game.paused || (game.phase !== 'story' && game.phase !== 'battle'))
          throw new ConflictException(
            'Only a running story or match can be paused.',
          );
        game.paused = true;
        this.clearRoomTimers(roomCode);
        break;
      case 'resume':
        if (!game.paused)
          throw new ConflictException('This room is already running.');
        game.paused = false;
        if (game.phase === 'story') this.startStoryTimeout(game);
        else if (game.battle?.status === 'active') this.startRoundTimeout(game);
        else if (game.battleMode === 'cpu' && !game.battle && !game.encounterPath)
          this.scheduleCpuEncounter(game);
        break;
      case 'restart':
        this.restartGame(roomCode);
        return;
      case 'end':
        this.clearRoomTimers(roomCode);
        game.phase = 'ended';
        game.paused = false;
        game.battle = undefined;
        game.pendingNextNodeId = undefined;
        if (roomCode === GLOBAL_ROOM_CODE) this.activeCutsceneId = null;
        break;
      case 'room_hp':
        if (game.phase !== 'waiting')
          throw new ConflictException('Set room HP in the lobby.');
        game.startingHp = integer(250, 10000);
        for (const member of Object.values(game.teams).flatMap(
          (team) => team.players,
        )) {
          member.hp = member.maxHp = game.startingHp;
        }
        break;
      case 'capacity':
        if (game.phase !== 'waiting')
          throw new ConflictException('Set team capacity in the lobby.');
        game.teamCap = integer(1, 10);
        for (const id of ALL_TEAMS) {
          game.teamCaps = { ...game.teamCaps, [id]: game.teamCap };
        }
        break;
      case 'scene':
        if (
          game.battleMode ||
          game.phase !== 'story' ||
          !nodeId ||
          !this.storyEngine.getNode(nodeId, game)
        )
          throw new ConflictException('Choose a scene in the running story.');
        game.currentNodeId = nodeId;
        game.pendingNextNodeId = undefined;
        this.lastCutsceneNodeId = null;
        this.activeCutsceneId = null;
        this.startStoryTimeout(game);
        break;
      case 'choice':
        if (game.phase !== 'story' || game.paused || !choiceId)
          throw new ConflictException(
            'Resume the story before playing a choice.',
          );
        this.resolveStoryChoice(game, choiceId);
        return;
      case 'turn': {
        if (game.phase !== 'story' || !teamId || !ALL_TEAMS.includes(teamId))
          throw new ConflictException('Choose a team in the running story.');
        const actor = game.teams[teamId].players.find(
          (entry) =>
            entry.status === 'alive' &&
            entry.connected &&
            (!playerId || entry.id === playerId),
        );
        if (!actor)
          throw new ConflictException(
            'That team has no eligible player for this turn.',
          );
        game.currentTeamId = teamId;
        game.activePlayerId = game.lastActivePlayerId = actor.id;
        game.playerRotation = {
          ...game.playerRotation,
          [teamId]: game.teams[teamId].players
            .filter((entry) => entry.status === 'alive')
            .indexOf(actor),
        };
        this.broadcastEvent(roomCode, {
          type: 'TEAM_TURN',
          teamId,
          activePlayerId: actor.id,
        });
        this.startStoryTimeout(game);
        break;
      }
      case 'round':
        if (game.paused || game.battle?.status !== 'active')
          throw new ConflictException('Resume an active battle first.');
        void this.resolveRound(game).catch(() =>
          this.logger.error(`Could not resolve round in ${roomCode}`),
        );
        return;
      case 'enemy_hp':
        if (game.battle?.mode !== 'cpu' || game.battle.status !== 'active')
          throw new ConflictException('This room has no active CPU opponent.');
        game.battle.enemyHp = integer(1, game.battle.enemyMaxHp);
        if (game.battle.enemyUnits) {
          let remaining = game.battle.enemyHp;
          let capacity = game.battle.enemyMaxHp;
          for (const unit of game.battle.enemyUnits) {
            unit.enemyHp = Math.ceil(remaining * unit.enemyMaxHp / capacity);
            remaining -= unit.enemyHp;
            capacity -= unit.enemyMaxHp;
          }
        }
        break;
      case 'victory':
      case 'defeat':
        if (game.battle?.status !== 'active')
          throw new ConflictException('This room has no active battle.');
        game.paused = false;
        game.battle.status = action;
        this.broadcastEvent(roomCode, {
          type: 'BATTLE_UPDATE',
          mode: game.battle.mode,
          source: 'system',
          message: `A moderator ended the battle with a ${action}.`,
        });
        this.broadcastState(roomCode);
        this.endBattleAndAdvance(game);
        break;
      case 'hp':
      case 'max_hp':
      case 'revive':
      case 'eliminate':
      case 'kick':
      case 'move_team':
        if (!player)
          throw new NotFoundException('Choose a player in this room.');
        if (action === 'kick') {
          this.moderatorKick(game, player);
        } else if (action === 'move_team') {
          if (
            game.phase !== 'waiting' ||
            !teamId ||
            !ALL_TEAMS.includes(teamId)
          )
            throw new ConflictException(
              'Players can change teams in the lobby.',
            );
          if (player.teamId !== teamId) {
            const cap =
              game.teamCaps?.[teamId] ?? game.teamCap ?? DEFAULT_TEAM_CAP;
            const active = ALL_TEAMS.filter(
              (id) =>
                id !== player.teamId &&
                game.teams[id].players.some((entry) => entry.connected),
            );
            const oldTeamStays = game.teams[player.teamId].players.some(
              (entry) => entry.id !== player.id && entry.connected,
            );
            if (
              game.battleMode === 'pvp' &&
              !active.includes(teamId) &&
              active.length + Number(oldTeamStays) >= 2
            )
              throw new ConflictException('PvP is limited to two teams.');
            if (
              game.teams[teamId].players.filter((entry) => entry.connected)
                .length >= cap
            )
              throw new ConflictException('The target team is at capacity.');
            game.teams[player.teamId].players = game.teams[
              player.teamId
            ].players.filter((entry) => entry.id !== player.id);
            player.teamId = teamId;
            player.ready = false;
            game.teams[teamId].players.push(player);
            if (game.battleMode === 'cpu') game.currentTeamId = teamId;
          }
        } else if (action === 'eliminate') {
          player.hp = 0;
          player.status = 'eliminated';
          player.companion = undefined;
          player.secondaryCompanion = undefined;
          this.broadcastEvent(roomCode, {
            type: 'ELIMINATE',
            playerId: player.id,
          });
        } else if (action === 'max_hp') {
          player.maxHp = integer(250, 10000);
          player.hp = Math.min(player.hp, player.maxHp);
        } else {
          if (action === 'hp' && player.status !== 'alive')
            throw new ConflictException(
              'Revive this player before setting current HP.',
            );
          player.hp =
            action === 'revive' ? player.maxHp : integer(1, player.maxHp);
          if (action === 'revive') {
            player.status = 'alive';
            player.breakMeter = 0;
            player.statusEffects = [];
          }
        }
        this.clampRotations(game);
        if (game.phase === 'story' && game.activePlayerId) {
          const active = this.findPlayer(game, game.activePlayerId);
          if (!active?.connected || active.status !== 'alive')
            this.advanceActivePlayer(game);
        }
        if (game.battle?.status === 'active') {
          this.combatEngine.reconcileRoster(game);
          if (game.battle.status === 'active') this.broadcastRoundState(game);
          else this.endBattleAndAdvance(game);
        }
        break;
      default:
        throw new BadRequestException('Unknown room command.');
    }
    if (!game.battleMode) this.broadcastStory(roomCode);
    this.broadcastState(roomCode);
    this.broadcastRoomList();
    this.broadcastPlayerList();
  }

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

    let pending = Promise.resolve();
    let outstanding = 0;
    socket.on('message', (data: unknown) => {
      if (outstanding >= 12) return;
      outstanding++;
      pending = pending
        .then(() => this.handleMessage(client, data))
        .finally(() => {
          outstanding--;
        });
    });

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

  private async handleMessage(client: ConnectedClient, rawData: unknown) {
    let eventType = 'UNKNOWN';
    let stage = 'decode_message';
    try {
      if (!client.socket.connected) return;
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
      if (
        !event ||
        typeof event !== 'object' ||
        typeof event.type !== 'string'
      ) {
        throw new BadRequestException('Invalid game message.');
      }
      if (/^[A-Z_]{1,40}$/.test(event.type)) eventType = event.type;

      this.logger.debug(
        `Received ${eventType}: socket=${client.socket.id} room=${client.roomCode ?? 'none'}`,
      );
      if (event.type === 'WATCH_GAME' || event.type === 'LEAVE_ROOM') {
        stage = 'apply_room_event';
        return this.handleEvent(client, event);
      }
      stage = 'authorize_game_session';
      const identity = await this.accounts.requireSession(
        client.socket.handshake.auth.gameToken,
      );
      if (!client.socket.connected) return;
      client.moderator = identity.moderator;
      if (MODERATOR_EVENTS.has(event.type) && !identity.moderator) {
        return this.sendError(
          client.socket,
          'Game moderator access is required.',
        );
      }

      if (
        event.type === 'CREATE_ROOM' ||
        event.type === 'JOIN_GAME' ||
        event.type === 'REFRESH_LOADOUT'
      ) {
        stage = 'load_room_loadout';
        const loadout = await this.progression.roomLoadout(identity.id);
        if (!client.socket.connected) return;
        event.playerId = identity.id;
        if (event.type !== 'REFRESH_LOADOUT') {
          if (!ALL_TEAMS.includes(event.teamId))
            return this.sendError(client.socket, 'Choose a valid team.');
          event.playerName = identity.username;
        }
        stage = 'apply_room_event';
        return await this.handleEvent(client, event, loadout);
      }

      if (
        !MODERATOR_EVENTS.has(event.type) &&
        (client.watcher ||
          client.playerId !== identity.id ||
          ('playerId' in event && event.playerId !== identity.id))
      ) {
        return this.sendError(
          client.socket,
          'Join the room as your own player first.',
        );
      }
      if (event.type === 'SELECT_FIGHTER') {
        stage = 'select_fighter';
        await this.selectFighter(client, event);
        return;
      }
      stage = 'apply_room_event';
      await this.handleEvent(client, event);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        return this.sendError(client.socket, error.message);
      }
      if (stage === 'decode_message' && error instanceof SyntaxError) {
        return this.sendError(client.socket, 'Invalid game message.');
      }
      const driver: unknown =
        error instanceof QueryFailedError ? error.driverError : error;
      const code =
        driver && typeof driver === 'object' && 'code' in driver
          ? driver.code
          : undefined;
      const sqlState =
        typeof code === 'string' &&
        /^[0-9A-Z]{5}$/.test(code) &&
        (error instanceof QueryFailedError ||
          (driver && typeof driver === 'object' && 'severity' in driver))
          ? code
          : undefined;
      const reason = sqlState
        ? `database_error SQLSTATE=${sqlState}`
        : error instanceof TypeError
          ? 'type_error'
          : 'unexpected_error';
      this.logger.error(
        `Game event failed: event=${eventType} stage=${stage} socket=${client.socket.id} ${reason}`,
      );
      const schemaMissing = sqlState === '42703' || sqlState === '42P01';
      this.sendError(
        client.socket,
        schemaMissing
          ? 'The game database needs an update. Contact the game administrator.'
          : 'Could not process the game message. Try again shortly.',
      );
    }
  }

  private handleEvent(
    client: ConnectedClient,
    event: GameEvent,
    loadout?: Loadout,
  ) {
    switch (event.type) {
      case 'CREATE_ROOM':
        return this.createRoom(client, event, loadout!);
      case 'JOIN_GAME':
        this.joinGame(client, event, loadout!);
        break;
      case 'ADVENTURE_INTERACT':
        this.adventureInteract(client, event);
        break;
      case 'BEGIN_ADVENTURE':
        this.beginAdventure(client);
        break;
      case 'START_CPU':
        return this.startCpuMatch(client, event.pathChoice);
      case 'START_PVP':
        this.startPvpMatch(client, event);
        break;
      case 'SET_TEAM_CAP':
        this.setTeamCap(client, event);
        break;
      case 'SET_STARTING_HP':
        this.setStartingHp(client, event);
        break;
      case 'REFRESH_LOADOUT': {
        const game = client.roomCode && this.gameStore.getGame(client.roomCode);
        if (
          !game ||
          client.watcher ||
          client.playerId !== event.playerId ||
          game.phase !== 'waiting'
        ) {
          return this.sendError(
            client.socket,
            'You can change your room loadout while waiting.',
          );
        }
        const player = this.findPlayer(game, event.playerId);
        if (player) {
          player.loadout = loadout;
          player.ready = false;
        }
        this.broadcastState(game.roomCode);
        break;
      }
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
        this.playerReady(client, event.playerId, event.ready !== false);
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
        this.sendPlayerList(client.socket);
        break;
      case 'LEAVE_ROOM':
        this.removeFromRoom(client);
        break;
      case 'LEAVE_GAME':
        this.leaveGame(client, event);
        break;
      case 'CUTSCENE_DONE':
        if (
          client.roomCode === GLOBAL_ROOM &&
          event.cutsceneId === this.activeCutsceneId
        ) {
          this.activeCutsceneId = null;
        }
        break;
      case 'CREDITS_DONE':
        this.handleCreditsDone(client);
        break;
      case 'ADMIN_KICK_PLAYER':
        this.adminKickPlayer(client, event.playerId);
        break;
      default:
        this.sendError(client.socket, 'Unknown game event.');
    }
  }

  /* ================================================================== */
  /* Room creation                                                       */
  /* ================================================================== */

  private async createRoom(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'CREATE_ROOM' }>,
    loadout: Loadout,
  ) {
    if (event.battleMode !== 'pvp' && event.battleMode !== 'cpu') {
      return this.sendError(client.socket, 'Choose an arena mode.');
    }
    if (event.adventure !== undefined &&
        (typeof event.adventure !== 'boolean' || (event.adventure && (event.battleMode !== 'cpu' || event.enemyName !== undefined)))) {
      return this.sendError(client.socket, 'Adventure requires a solo encounter path.');
    }
    let arenaId = event.arenaId;
    let startingHp = event.startingHp;
    // A cached HP-only lobby can pass HP as the newer page's arena argument.
    if (
      event.battleMode === 'pvp' &&
      startingHp === undefined &&
      validHp(arenaId)
    ) {
      startingHp = arenaId;
      arenaId = ROOM_ARENAS[0];
      this.logger.debug(
        `CREATE_ROOM recovered starting HP from arenaId: socket=${client.socket.id}`,
      );
    }
    if (arenaId !== undefined && !ROOM_ARENAS.includes(arenaId)) {
      this.logger.warn(
        `CREATE_ROOM rejected: socket=${client.socket.id} arenaIdType=${arenaId === null ? 'null' : typeof arenaId}`,
      );
      return this.sendError(client.socket, 'Choose an available arena.');
    }
    if (startingHp !== undefined && !validHp(startingHp)) {
      return this.sendError(
        client.socket,
        'Starting HP must be a whole number from 250 to 10,000.',
      );
    }
    if (
      event.enemyName !== undefined &&
      (typeof event.enemyName !== 'string' ||
        !Object.hasOwn(ENEMY_CONFIGS, event.enemyName))
    ) {
      return this.sendError(client.socket, 'Choose an available opponent.');
    }
    const checkpointPath = event.battleMode === 'cpu' && !event.adventure && event.enemyName === undefined
      ? await this.resumePath(event.playerId)
      : undefined;
    if (!client.socket.connected) return;
    this.removeFromRoom(client);
    const roomCode = this.generateRoomCode();
    const game = this.gameStore.createRoom(roomCode);

    if (!game) {
      this.sendError(client.socket, 'Could not create room.');
      return;
    }

    client.watcher = false;
    client.roomCode = roomCode;
    client.playerId = event.playerId;
    void client.socket.join(roomCode);

    const hp =
      event.battleMode === 'pvp'
        ? (startingHp ?? DEFAULT_HP)
        : DEFAULT_HP;
    const team = game.teams[event.teamId];
    team.players.push({
      id: event.playerId,
      name: (event.playerName ?? 'Player').trim() || 'Player',
      teamId: event.teamId,
      hp,
      maxHp: hp,
      loadout,
      status: 'alive',
      ready: false,
      connected: true,
      breakMeter: 0,
      statusEffects: [],
    });

    game.battleMode = event.battleMode;
    game.arenaId = arenaId;
    game.hostPlayerId = event.playerId;
    game.activeTeams = [event.teamId];
    game.currentTeamId = event.teamId;
    game.playerRotation = { [event.teamId]: 0 };
    game.activePlayerId = event.playerId;
    game.lastActivePlayerId = event.playerId;

    if (event.battleMode === 'cpu') {
      if (!event.enemyName) {
        game.encounterPath = checkpointPath ?? createEncounterPath(event.adventure);
        if (event.adventure) {
          game.adventure = true;
          game.adventureQuest = createAdventureQuest();
        }
        game.openingEnemy = game.encounterPath.levels[game.encounterPath.index].name;
        game.arenaId ??= ROOM_ARENAS[0];
        game.phase = 'waiting';
      } else if (game.arenaId) {
        game.openingEnemy = event.enemyName;
        game.phase = 'waiting';
      } else {
        this.startCpuBattle(game, event.enemyName);
      }
    } else {
      game.phase = 'waiting';
      game.teamCap = DEFAULT_TEAM_CAP;
      game.startingHp = hp;
    }

    this.send(client.socket, {
      type: 'ROOM_CREATED',
      roomCode,
      teamId: event.teamId,
      battleMode: event.battleMode,
    });

    this.sendState(client.socket, game);
    this.broadcastRoomList();
  }

  private async selectFighter(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'SELECT_FIGHTER' }>,
  ) {
    const game = client.roomCode && this.gameStore.getGame(client.roomCode);
    const player = game ? this.findPlayer(game, event.playerId) : undefined;
    if (
      !game ||
      !game.arenaId ||
      game.phase !== 'waiting' ||
      !player?.connected
    ) {
      return this.sendError(
        client.socket,
        'Fighters can be selected in the waiting room.',
      );
    }
    if (!ROOM_FIGHTERS.includes(event.fighterId)) {
      return this.sendError(client.socket, 'Choose an available fighter.');
    }
    if (isPremiumFighter(event.fighterId)) {
      const { fighters } = await this.progression.profile(player.id);
      if (
        !client.socket.connected ||
        client.roomCode !== game.roomCode ||
        client.playerId !== player.id ||
        this.gameStore.getGame(game.roomCode) !== game ||
        game.phase !== 'waiting' ||
        !player.connected
      )
        return;
      if (!fighters.includes(event.fighterId)) {
        return this.sendError(
          client.socket,
          'Unlock this fighter in the Cinder Forge first.',
        );
      }
    }
    if (player.fighterId !== event.fighterId) {
      player.fighterId = event.fighterId;
      player.ready = false;
    }
    this.broadcastState(game.roomCode);
  }

  private adventureInteract(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'ADVENTURE_INTERACT' }>,
  ) {
    const game = client.roomCode && this.gameStore.getGame(client.roomCode);
    if (!game || !game.adventure || game.paused || game.phase !== 'battle' ||
        game.battle || client.playerId !== game.hostPlayerId ||
        game.encounterPath?.status !== 'active' || event.chapter !== game.encounterPath.index) return;
    const quest = applyAdventureInteraction(
      event.chapter, game.adventureQuest ?? createAdventureQuest(), event.action, event.target,
    );
    if (quest && quest !== game.adventureQuest) {
      game.adventureQuest = quest;
      this.broadcastState(game.roomCode);
    }
  }

  private beginAdventure(client: ConnectedClient) {
    const game = client.roomCode && this.gameStore.getGame(client.roomCode);
    if (
      !game ||
      !game.adventure ||
      game.paused ||
      game.phase !== 'waiting' ||
      client.playerId !== game.hostPlayerId
    ) {
      return this.sendError(client.socket, 'Only the host can begin a waiting Adventure.');
    }
    this.startStagedCpuMatch(game);
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
  }

  private async resumePath(accountId: string, tier?: number): Promise<EncounterPath> {
    const checkpoint = await this.progression.encounterCheckpoint(accountId, tier) ??
      (tier === undefined ? undefined : await this.progression.encounterCheckpoint(accountId));
    if (!checkpoint) return createEncounterPath();
    return {
      index: checkpoint.cleared === 12 ? 11 : 6,
      status: checkpoint.cleared === 12 ? 'cleared' : 'active',
      levels: checkpoint.levels,
      tier: checkpoint.tier,
      savedWins: checkpoint.cleared,
      nextTier: checkpoint.cleared === 12 && checkpoint.tier < MAX_ENCOUNTER_TIER ? checkpoint.tier + 1 : undefined,
    };
  }

  private async choosePathDifficulty(game: GameState, path: EncounterPath, action: EncounterPathChoice) {
    if (action === 'resume' ? path.status !== 'defeated' : path.status !== 'cleared') {
      throw new ConflictException('Finish the current run before choosing a difficulty.');
    }
    if (action === 'higher' && !path.nextTier) throw new ConflictException('You have reached the highest difficulty.');

    if (path.savePending && path.status === 'cleared') {
      await this.savePathMilestone(game, path, 12);
    }
    if (game.phase !== 'ended' || game.encounterPath !== path) return;
    if (action === 'save') {
      this.broadcastState(game.roomCode);
      return;
    }

    const next = action === 'resume'
      ? await this.resumePath(game.hostPlayerId!, path.tier)
      : createEncounterPath(false, action === 'higher' ? path.nextTier : path.tier, path.levels[0].id);
    if (game.phase !== 'ended' || game.encounterPath !== path) return;
    if (action === 'replay') next.savedWins = path.savedWins;
    game.encounterPath = next;
    game.phase = next.status === 'cleared' ? 'ended' : 'battle';
    game.openingEnemy = next.levels[next.index].name;
    const host = this.findPlayer(game, game.hostPlayerId!);
    if (host) {
      host.hp = host.maxHp;
      host.status = 'alive';
      host.statusEffects = [];
      host.breakMeter = 0;
    }
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
  }

  private async startCpuMatch(client: ConnectedClient, pathChoice?: EncounterPathChoice) {
    const game = client.roomCode && this.gameStore.getGame(client.roomCode);
    if (pathChoice !== undefined) {
      if (!game || game.adventure || !game.encounterPath || game.battle || game.paused ||
          game.phase !== 'ended' || client.playerId !== game.hostPlayerId ||
          !['replay', 'higher', 'resume', 'save'].includes(pathChoice)) {
        throw new ConflictException('Only the host can choose the next Highlands Path run.');
      }
      return this.choosePathDifficulty(game, game.encounterPath, pathChoice);
    }
    if (
      !game ||
      game.battleMode !== 'cpu' ||
      game.paused ||
      (game.adventure && game.phase === 'waiting') ||
      (game.phase !== 'waiting' && !(game.phase === 'battle' && !game.battle && game.encounterPath?.status === 'active')) ||
      client.playerId !== game.hostPlayerId ||
      !game.openingEnemy
    ) {
      return this.sendError(
        client.socket,
        'Only the host can enter an available encounter.',
      );
    }
    if (game.adventure && !game.adventureQuest?.ready) {
      return this.sendError(client.socket, 'Complete the local quest before entering combat.');
    }
    if (game.encounterPath?.savePending) {
      await this.savePathMilestone(game, game.encounterPath, 6);
      if (game.battle) return;
    }
    this.startStagedCpuMatch(game);
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
  }

  private startStagedCpuMatch(game: GameState) {
    const host = game.hostPlayerId && this.findPlayer(game, game.hostPlayerId);
    if (!host || !host.connected || !host.fighterId || !game.openingEnemy) {
      throw new ConflictException(
        'The host must choose a fighter before starting.',
      );
    }
    if (game.adventure && game.phase === 'waiting') {
      game.phase = 'battle';
      return;
    }
    const path = game.encounterPath;
    if (path?.status === 'cleared') {
      game.phase = 'ended';
      return;
    }
    const opponents = path ? encounterOpponents(path) : [];
    if (!path || !opponents.length) {
      this.startCpuBattle(game, game.openingEnemy);
      return;
    }
    game.phase = 'battle';
    game.battle = this.combatEngine.createEncounterBattle(game, game.currentTeamId, opponents);
    game.battle.log.push('Level ' + (path.index + 1) + ' begins.');
    this.broadcastRoundState(game);
    this.startRoundTimeout(game);
  }

  private startCpuBattle(game: GameState, enemyName: string) {
    const config = ENEMY_CONFIGS[enemyName];
    game.phase = 'battle';
    game.battle = this.combatEngine.createCpuBattle(
      game,
      game.currentTeamId,
      enemyName,
      config?.hp ?? 1200,
      config?.hp ?? 1200,
      {
        attack: config?.attack ?? 100,
        personality: config?.personality ?? 'aggressive',
        abilityChance: config?.abilityChance ?? 0.35,
        signatureEveryNRounds: config?.signatureEveryNRounds ?? 4,
        signatureMultiplier: config?.signatureMultiplier ?? 1.6,
        telegraphs: config?.telegraphs,
        phases: config?.phases,
        abilities: config?.abilities,
      },
    );
    if (game.battle) {
      game.battle.queuedActions = [];
      game.battle.readyPlayerIds = [];
      game.battle.log.push(`${enemyName} emerges from the Highlands.`);
    }
    this.broadcastRoundState(game);
    this.startRoundTimeout(game);
  }

  private generateRoomCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 8; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.gameStore.getGame(code)) return code;
    }
    return `R${Date.now().toString(36).toUpperCase()}`;
  }

  private pickRandomOpeningEnemy(): string {
    const pool = [
      'THE BELL KEEPER',
      'BLOOD HUNTERS',
      'THE REMNANT',
      'HOLLOW KNIGHTS',
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Host-only. Starts the PvP match if at least two teams are populated.
   * No CPU fallback — a lone host waits.
   */
  private startPvpMatch(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'START_PVP' }>,
  ) {
    const roomCode = client.roomCode;
    if (!roomCode) return;
    const game = this.gameStore.getGame(roomCode);
    if (!game || game.battleMode !== 'pvp') return;
    if (client.playerId !== game.hostPlayerId) {
      this.sendError(client.socket, 'Only the host can start the match.');
      return;
    }
    this.startPvp(game);
  }

  private startPvp(game: GameState) {
    if (game.phase !== 'waiting') {
      throw new ConflictException('The match has already started.');
    }

    const populated = ALL_TEAMS.filter((id) =>
      game.teams[id].players.some((player) => player.connected),
    );

    if (populated.length !== 2) {
      throw new ConflictException(
        'Exactly two teams must have players before starting.',
      );
    }
    if (
      populated.some((id) =>
        game.teams[id].players.some(
          (player) =>
            player.connected &&
            (!player.ready || (game.arenaId && !player.fighterId)),
        ),
      )
    ) {
      throw new ConflictException(
        game.arenaId
          ? 'Every player must choose a fighter and confirm their loadout.'
          : 'Every player must confirm their loadout before starting.',
      );
    }

    const [teamA, teamB] = populated;
    for (const id of populated) {
      game.teams[id].players = game.teams[id].players.filter(
        (player) => player.connected,
      );
      for (const player of game.teams[id].players) {
        player.hp = player.maxHp;
        player.status = 'alive';
      }
    }
    game.activeTeams = populated;
    game.currentTeamId = teamA;
    game.phase = 'battle';

    game.battle = this.combatEngine.createTeamBattle(game, teamA, teamB);

    if (game.battle) {
      game.battle.queuedActions = [];
      game.battle.readyPlayerIds = [];
      game.battle.log.push(`${teamA} and ${teamB} meet in the arena.`);
    }

    this.broadcastRoundState(game);
    this.startRoundTimeout(game);
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
  }

  /**
   * Host-only. Sets the per-team player cap for the current PvP room.
   */
  private setTeamCap(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'SET_TEAM_CAP' }>,
  ) {
    const roomCode = client.roomCode;
    if (!roomCode) return;
    const game = this.gameStore.getGame(roomCode);
    if (!game || game.battleMode !== 'pvp') return;
    if (game.phase !== 'waiting') {
      this.sendError(
        client.socket,
        'Team cap is locked once the match starts.',
      );
      return;
    }

    if (client.playerId !== game.hostPlayerId) {
      this.sendError(client.socket, 'Only the host can set the team cap.');
      return;
    }

    const cap = event.teamCap;
    if (!Number.isInteger(cap) || cap < MIN_TEAM_CAP || cap > MAX_TEAM_CAP) {
      return this.sendError(
        client.socket,
        'Choose a team size between 1 and 10.',
      );
    }

    game.teamCap = cap;
    this.broadcastState(roomCode);
  }

  private setStartingHp(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'SET_STARTING_HP' }>,
  ) {
    const game = client.roomCode && this.gameStore.getGame(client.roomCode);
    if (
      !game ||
      game.battleMode !== 'pvp' ||
      game.phase !== 'waiting' ||
      game.hostPlayerId !== client.playerId
    ) {
      return this.sendError(
        client.socket,
        'Only the host can set HP before a PvP match.',
      );
    }
    if (!validHp(event.hp))
      return this.sendError(
        client.socket,
        'Starting HP must be a whole number from 250 to 10,000.',
      );
    if (event.targetId) {
      const player = this.findPlayer(game, event.targetId);
      if (!player)
        return this.sendError(
          client.socket,
          'That player is no longer in the room.',
        );
      player.hp = player.maxHp = event.hp;
    } else {
      game.startingHp = event.hp;
      for (const team of Object.values(game.teams)) {
        for (const player of team.players) player.hp = player.maxHp = event.hp;
      }
    }
    this.broadcastState(game.roomCode);
  }

  /* ================================================================== */
  /* Admin — player list + kick                                          */
  /* ================================================================== */

  private buildPlayerList(): AdminPlayerSummary[] {
    const byId = new Map<string, AdminPlayerSummary>();

    for (const game of this.gameStore.getAllGames()) {
      for (const team of Object.values(game.teams)) {
        for (const p of team.players) {
          byId.set(p.id, {
            id: p.id,
            name: p.name,
            teamId: p.teamId,
            hp: p.hp,
            maxHp: p.maxHp,
            status: p.status,
            connected: p.connected,
            ready: p.ready,
          });
        }
      }
    }

    return Array.from(byId.values());
  }

  private sendPlayerList(socket: Socket) {
    const players = this.buildPlayerList();
    socket.emit(
      'message',
      JSON.stringify({
        type: 'PLAYER_LIST_UPDATE',
        players,
      } satisfies GameEvent),
    );
  }

  private broadcastPlayerList() {
    const players = this.buildPlayerList();
    const event = { type: 'PLAYER_LIST_UPDATE' as const, players };

    for (const client of this.clients) {
      if (client.moderator) {
        client.socket.emit('message', JSON.stringify(event));
      }
    }
  }

  private adminKickPlayer(client: ConnectedClient, playerId: string) {
    const game = this.findGameByPlayer(playerId);
    if (!game) {
      this.sendError(client.socket, 'Player not found.');
      return;
    }

    const player = this.findPlayer(game, playerId);
    if (!player) {
      this.sendError(client.socket, 'Player not found.');
      return;
    }

    this.controlRoom(game.roomCode, { action: 'kick', playerId });
  }

  private moderatorKick(game: GameState, player: Player) {
    const kicked = this.kickedPlayers.get(game) ?? new Set<string>();
    kicked.add(player.id);
    this.kickedPlayers.set(game, kicked);
    for (const client of this.clients) {
      if (client.roomCode === game.roomCode && client.playerId === player.id) {
        this.send(client.socket, {
          type: 'ROOM_REMOVED',
          roomCode: game.roomCode,
        });
        this.removeFromRoom(client);
      }
    }
    const team = game.teams[player.teamId];
    team.players = team.players.filter((entry) => entry.id !== player.id);
    if (game.hostPlayerId === player.id) {
      game.hostPlayerId = Object.values(game.teams)
        .flatMap((entry) => entry.players)
        .find((entry) => entry.connected)?.id;
    }
  }

  /* ================================================================== */
  /* Timers (per-room)                                                   */
  /* ================================================================== */

  private clearRoundTimeout(roomCode: string) {
    const handle = this.roundTimeoutHandles.get(roomCode);
    if (handle) {
      clearTimeout(handle);
      this.roundTimeoutHandles.delete(roomCode);
    }
    this.broadcastEvent(roomCode, { type: 'ROUND_TIMER', remainingMs: 0 });
  }

  private clearStoryTimeout(roomCode: string) {
    const handle = this.storyTimeoutHandles.get(roomCode);
    if (handle) {
      clearTimeout(handle);
      this.storyTimeoutHandles.delete(roomCode);
    }
  }

  private startRoundTimeout(game: GameState) {
    this.clearRoundTimeout(game.roomCode);
    if (game.paused) return;

    const battle = game.battle;
    const blocked = battle?.mode === 'cpu' &&
      this.expectedActors(game, battle).length === 0 &&
      game.teams[battle.attackerTeamId].players.some(
        (player) => player.connected && player.status === 'alive' &&
          player.statusEffects?.some(({ id }) => id === 'immobilized'),
      );
    const decisionTime = blocked ? ENEMY_ATTACK_DELAY_MS : ROUND_DECISION_TIMEOUT_MS;
    const handle = setTimeout(() => {
      this.logger.warn(
        `Round timeout fired: room=${game.roomCode} team=${game.battle?.turnTeamId}`,
      );
      void this.handleRoundTimeout(game.roomCode);
    }, decisionTime);

    this.roundTimeoutHandles.set(game.roomCode, handle);

    this.broadcastEvent(game.roomCode, {
      type: 'ROUND_TIMER',
      remainingMs: decisionTime,
    });
  }

  private clearRoomTimers(roomCode: string) {
    this.clearRoundTimeout(roomCode);
    this.clearStoryTimeout(roomCode);
    clearTimeout(this.roomTransitionTimers.get(roomCode));
    this.roomTransitionTimers.delete(roomCode);
  }

  private async handleRoundTimeout(roomCode: string) {
    this.roundTimeoutHandles.delete(roomCode);
    const game = this.gameStore.getGame(roomCode);
    const battle = game?.battle;

    if (!game || game.paused || !battle || battle.status !== 'active') {
      this.clearRoundTimeout(roomCode);
      return;
    }

    if (this.resolvingRooms.has(roomCode)) return;
    if (
      !Object.values(game.teams).some((team) =>
        team.players.some((player) => player.connected),
      )
    )
      return;

    this.logger.log(
      `Auto-resolving round: room=${roomCode} team=${battle.turnTeamId} queued=${battle.queuedActions?.length ?? 0}`,
    );

    await this.resolveRound(game);
  }

  private startStoryTimeout(game: GameState) {
    this.clearStoryTimeout(game.roomCode);
    if (game.paused || game.phase !== 'story') return;

    const handle = setTimeout(() => {
      this.logger.warn(
        `Story timeout fired: room=${game.roomCode} team=${game.currentTeamId} player=${game.activePlayerId}`,
      );
      this.handleStoryTimeout(game.roomCode);
    }, STORY_DECISION_TIMEOUT_MS);

    this.storyTimeoutHandles.set(game.roomCode, handle);
  }

  private handleStoryTimeout(roomCode: string) {
    const game = this.gameStore.getGame(roomCode);
    if (!game || game.paused || game.phase !== 'story') {
      this.clearStoryTimeout(roomCode);
      return;
    }

    this.broadcastEvent(roomCode, {
      type: 'BATTLE_UPDATE',
      mode: 'team',
      message: 'Time expired — the turn passes.',
    });

    this.advanceActivePlayer(game);
    this.broadcastStory(roomCode);
    this.broadcastState(roomCode);
    this.broadcastRoomList();
  }

  /* ================================================================== */
  /* Room / player lifecycle                                             */
  /* ================================================================== */

  private getOrCreateGlobalGame() {
    const game = this.gameStore.getGame(GLOBAL_ROOM_CODE);
    if (game) {
      if (!game.currentNodeId) {
        const node = this.storyEngine.getInitialNode();
        if (node) game.currentNodeId = node.id;
      }
      return game;
    }

    const fresh = this.gameStore.createRoom(GLOBAL_ROOM_CODE);
    this.storyEngine.resetRun(fresh);
    return fresh;
  }

  private removeFromRoom(client: ConnectedClient) {
    const roomCode = client.roomCode;
    if (!roomCode) return;
    const game = this.gameStore.getGame(roomCode);

    if (game && client.playerId && !client.watcher) {
      const player = this.findPlayer(game, client.playerId);
      if (player) player.connected = false;
    }

    void client.socket.leave(roomCode);
    client.roomCode = undefined;
    client.playerId = undefined;

    if (game) {
      this.broadcastState(roomCode);
      this.broadcastRoomList();
    }
    this.broadcastPlayerList();
  }

  private leaveGame(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'LEAVE_GAME' }>,
  ) {
    const game = client.roomCode
      ? this.gameStore.getGame(client.roomCode)
      : undefined;
    if (!game) return;

    for (const team of Object.values(game.teams)) {
      const idx = team.players.findIndex((p) => p.id === event.playerId);
      if (idx >= 0) {
        team.players.splice(idx, 1);
        break;
      }
    }

    // Reassign host if the host left.
    if (game.hostPlayerId === event.playerId) {
      const anyHost = Object.values(game.teams)
        .flatMap((t) => t.players)
        .find((p) => p.connected);
      game.hostPlayerId = anyHost?.id;
    }

    if (client.roomCode) {
      void client.socket.leave(client.roomCode);
      client.roomCode = undefined;
    }
    client.playerId = undefined;

    this.clampRotations(game);

    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
    this.broadcastPlayerList();
  }

  private joinGame(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'JOIN_GAME' }>,
    loadout: Loadout,
  ) {
    const roomCode = event.roomCode ?? client.roomCode ?? GLOBAL_ROOM_CODE;
    const game =
      roomCode === GLOBAL_ROOM_CODE
        ? this.getOrCreateGlobalGame()
        : this.gameStore.getGame(roomCode);

    if (!game) {
      this.sendError(client.socket, 'Room not found.');
      this.send(client.socket, { type: 'ROOM_NOT_FOUND', roomCode });
      return;
    }
    if (this.kickedPlayers.get(game)?.has(event.playerId)) {
      this.sendError(client.socket, 'A moderator removed you from this room.');
      return;
    }

    if (
      game.battleMode === 'cpu' &&
      game.arenaId &&
      event.playerId !== game.hostPlayerId
    ) {
      return this.sendError(
        client.socket,
        'This enemy battle is reserved for its host.',
      );
    }
    const existingPlayer = this.findPlayer(game, event.playerId);
    if (existingPlayer) event.teamId = existingPlayer.teamId;
    const team = game.teams[event.teamId];
    if (!team) {
      this.sendError(client.socket, 'Invalid team.');
      return;
    }

    const requestedName = (event.playerName ?? '').trim();
    const fallbackName = event.playerId.slice(0, 6).toUpperCase();
    const desiredName = requestedName.length > 0 ? requestedName : fallbackName;

    if (!existingPlayer && game.battleMode && game.phase !== 'waiting') {
      return this.sendError(
        client.socket,
        'This match has started. You can watch from the spectator menu.',
      );
    }
    if (
      !existingPlayer?.connected &&
      game.phase === 'waiting' &&
      game.battleMode === 'pvp' &&
      !team.players.some((player) => player.connected) &&
      ALL_TEAMS.filter((id) =>
        game.teams[id].players.some((player) => player.connected),
      ).length >= 2
    ) {
      return this.sendError(
        client.socket,
        'Choose one of the two teams in this arena.',
      );
    }

    if (!existingPlayer) {
      const nameTaken = Object.values(game.teams)
        .flatMap((t) => t.players)
        .some(
          (p) =>
            p.name.toLowerCase() === desiredName.toLowerCase() &&
            p.id !== event.playerId,
        );

      if (nameTaken) {
        this.sendError(
          client.socket,
          `The name "${desiredName}" is already taken. Choose another.`,
        );
        return;
      }
    }

    // Enforce the PvP team cap.
    if (
      game.battleMode === 'pvp' &&
      game.phase === 'waiting' &&
      !existingPlayer?.connected
    ) {
      const cap = game.teamCap ?? DEFAULT_TEAM_CAP;
      const connectedCount = team.players.filter((p) => p.connected).length;
      if (connectedCount >= cap) {
        this.sendError(
          client.socket,
          `Team ${event.teamId} is full (${connectedCount}/${cap}). Pick another team.`,
        );
        return;
      }
    }

    // Legacy teamCaps (admin path) still applies.
    const legacyCap = game.teamCaps?.[event.teamId];
    if (legacyCap !== undefined && !existingPlayer) {
      const connectedCount = team.players.filter((p) => p.connected).length;
      if (connectedCount >= legacyCap) {
        this.sendError(
          client.socket,
          `Team ${event.teamId} is full (${connectedCount}/${legacyCap}). Choose another team.`,
        );
        return;
      }
    }

    if (!existingPlayer) {
      team.players.push({
        id: event.playerId,
        name: desiredName,
        teamId: event.teamId,
        hp: game.startingHp ?? DEFAULT_HP,
        maxHp: game.startingHp ?? DEFAULT_HP,
        loadout,
        status: 'alive',
        ready: false,
        connected: true,
        breakMeter: 0,
        statusEffects: [],
      });
    } else {
      existingPlayer.connected = true;
      if (game.phase === 'waiting') {
        if (JSON.stringify(existingPlayer.loadout) !== JSON.stringify(loadout))
          existingPlayer.ready = false;
        existingPlayer.loadout = loadout;
      }
    }

    if (client.roomCode && client.roomCode !== roomCode) {
      this.removeFromRoom(client);
    }
    for (const other of this.clients) {
      if (
        other !== client &&
        other.roomCode === roomCode &&
        other.playerId === event.playerId &&
        !other.watcher
      ) {
        this.removeFromRoom(other);
        const player = this.findPlayer(game, event.playerId);
        if (player) player.connected = true;
      }
    }
    void client.socket.join(roomCode);

    client.playerId = event.playerId;
    client.roomCode = roomCode;
    client.watcher = false;

    this.clampRotations(game);

    // NOTE: PvP no longer auto-starts. The host must send START_PVP.

    this.broadcastStory(roomCode);
    this.broadcastState(roomCode);
    this.broadcastRoomList();
    this.broadcastPlayerList();
    if (
      game.battle?.status === 'active' &&
      !this.roundTimeoutHandles.has(roomCode) &&
      !this.resolvingRooms.has(roomCode)
    )
      this.startRoundTimeout(game);
  }

  private watchGame(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'WATCH_GAME' }>,
  ) {
    const roomCode = event.roomCode || GLOBAL_ROOM_CODE;
    const game =
      roomCode === GLOBAL_ROOM_CODE
        ? this.getOrCreateGlobalGame()
        : this.gameStore.getGame(roomCode);

    if (!game) {
      this.sendError(client.socket, 'Room not found.');
      return;
    }

    this.removeFromRoom(client);
    client.watcher = true;
    void client.socket.join(roomCode);

    client.roomCode = roomCode;
    client.playerId = undefined;

    this.broadcastStory(roomCode);
    this.sendState(client.socket, game);
    this.sendRoomList(client.socket);
  }

  private playerReady(
    client: ConnectedClient,
    playerId: string,
    ready: boolean,
  ) {
    const game = client.roomCode
      ? this.gameStore.getGame(client.roomCode)
      : undefined;
    if (!game || game.phase !== 'waiting') return;
    const player = this.findPlayer(game, playerId);
    if (!player) return;
    if (ready && game.arenaId && !player.fighterId) {
      return this.sendError(
        client.socket,
        'Choose your fighter before readying up.',
      );
    }
    player.ready = ready;
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
  }

  /* ================================================================== */
  /* Admin — approval                                                    */
  /* ================================================================== */

  private approveRoom(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'ADMIN_APPROVE_ROOM' }>,
  ) {
    const roomCode = event.roomId || client.roomCode || GLOBAL_ROOM_CODE;
    const game = this.gameStore.getGame(roomCode);
    if (!game) {
      this.sendError(client.socket, 'Game not found.');
      return;
    }
    this.activateStory(game, event.teamCaps);
  }

  private activateStory(game: GameState, caps?: GameState['teamCaps']) {
    const roomCode = game.roomCode;
    if (game.battleMode || game.phase !== 'waiting')
      throw new ConflictException(
        'Only a waiting story room can be activated.',
      );
    const populated = ALL_TEAMS.filter((id) =>
      game.teams[id].players.some((player) => player.connected),
    );

    if (populated.length < 2) {
      throw new ConflictException(
        'At least two teams must have players before activation.',
      );
    }

    if (caps) {
      const filteredCaps = Object.fromEntries(
        populated
          .filter(
            (id) =>
              Number.isInteger(caps[id]) && caps[id]! >= 1 && caps[id]! <= 10,
          )
          .map((id) => [id, caps[id]]),
      ) as Partial<Record<TeamId, number>>;
      game.teamCaps = filteredCaps;
    }

    game.activeTeams = populated;
    game.currentTeamId = populated[0];
    game.phase = 'story';
    this.storyEngine.startRun(game);

    game.playerRotation = {};
    for (const teamId of populated) game.playerRotation[teamId] = 0;

    const firstTeam = game.teams[populated[0]];
    const firstAlive = firstTeam.players.find(
      (p) => p.status === 'alive' && p.connected,
    );
    game.activePlayerId = firstAlive?.id;
    game.lastActivePlayerId = firstAlive?.id;

    this.seenCutscenes.clear();
    this.lastCutsceneNodeId = null;

    this.broadcastEvent(roomCode, {
      type: 'TEAM_TURN',
      teamId: populated[0],
      activePlayerId: game.activePlayerId,
    });

    this.startStoryTimeout(game);
    this.broadcastStory(roomCode);
    this.broadcastState(roomCode);
    this.broadcastRoomList();
    this.broadcastPlayerList();
  }

  private changeTeamTurn(client: ConnectedClient, teamId: TeamId) {
    const roomCode = client.roomCode ?? GLOBAL_ROOM_CODE;
    const game = this.gameStore.getGame(roomCode);
    if (!game) {
      this.sendError(client.socket, 'Game not found.');
      return;
    }
    if (game.phase !== 'story' || !ALL_TEAMS.includes(teamId)) return;

    game.currentTeamId = teamId;
    const team = game.teams[teamId];
    const alive = team.players.filter(
      (p) =>
        p.status === 'alive' &&
        !(p.statusEffects ?? []).some((s) => s.id === 'immobilized'),
    );

    game.playerRotation = game.playerRotation ?? {};
    const startIdx = game.playerRotation[teamId] ?? 0;
    const safeIdx = alive.length ? startIdx % alive.length : 0;
    game.activePlayerId = alive[safeIdx]?.id;
    game.lastActivePlayerId = game.activePlayerId;

    this.broadcastEvent(roomCode, {
      type: 'TEAM_TURN',
      teamId,
      activePlayerId: game.activePlayerId,
    });

    this.startStoryTimeout(game);
    this.broadcastState(roomCode);
    this.broadcastRoomList();
  }

  private eliminatePlayer(client: ConnectedClient, playerId: string) {
    const game = this.findGameByPlayer(playerId);
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
    player.companion = undefined;
    player.secondaryCompanion = undefined;

    this.clampRotations(game);

    this.broadcastEvent(game.roomCode, { type: 'ELIMINATE', playerId });
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
    this.broadcastPlayerList();
  }

  /* ================================================================== */
  /* Turn rotation                                                       */
  /* ================================================================== */

  private advanceActivePlayer(game: GameState) {
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

    game.playerRotation = game.playerRotation ?? {};
    game.playerRotation[game.currentTeamId] = nextIndex;

    game.activePlayerId = alive[nextIndex].id;
    game.lastActivePlayerId = game.activePlayerId;

    this.broadcastEvent(game.roomCode, {
      type: 'TEAM_TURN',
      teamId: game.currentTeamId,
      activePlayerId: game.activePlayerId,
    });

    this.startStoryTimeout(game);
    this.advanceTeam(game);
  }

  private advanceTeam(game: GameState) {
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
      if (!canAct(candidate)) continue;

      game.currentTeamId = candidate;
      const team = game.teams[candidate];
      const alive = team.players.filter(
        (p) =>
          p.status === 'alive' &&
          !(p.statusEffects ?? []).some((s) => s.id === 'immobilized'),
      );

      game.playerRotation = game.playerRotation ?? {};
      const startIdx = game.playerRotation[candidate] ?? 0;
      const safeIdx = alive.length ? startIdx % alive.length : 0;

      game.activePlayerId = alive[safeIdx].id;
      game.lastActivePlayerId = game.activePlayerId;

      this.broadcastEvent(game.roomCode, {
        type: 'TEAM_TURN',
        teamId: candidate,
        activePlayerId: game.activePlayerId,
      });

      this.startStoryTimeout(game);
      return;
    }

    game.phase = 'ended';
    this.clearRoundTimeout(game.roomCode);
    this.clearStoryTimeout(game.roomCode);

    this.roomTransitionTimers.set(
      game.roomCode,
      setTimeout(() => {
        this.roomTransitionTimers.delete(game.roomCode);
        if (
          this.gameStore.getGame(game.roomCode) === game &&
          game.phase === 'ended'
        )
          this.restartGame(game.roomCode);
      }, 15_000),
    );

    this.broadcastState(game.roomCode);
  }

  private clampRotations(game: GameState) {
    game.playerRotation = game.playerRotation ?? {};
    for (const teamId of Object.keys(game.teams) as TeamId[]) {
      const alive = game.teams[teamId].players.filter(
        (p) => p.status === 'alive',
      );
      const current = game.playerRotation[teamId] ?? 0;
      game.playerRotation[teamId] = alive.length ? current % alive.length : 0;
    }
  }

  /* ================================================================== */
  /* Story choices                                                       */
  /* ================================================================== */

  private handleChoice(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'CHOICE' }>,
  ) {
    if (client.roomCode === GLOBAL_ROOM && this.activeCutsceneId) {
      this.sendError(client.socket, 'A cutscene is playing.');
      return;
    }

    const roomCode = client.roomCode;
    if (!roomCode) return;
    const game = this.gameStore.getGame(roomCode);
    if (!game) {
      this.sendError(client.socket, 'Game not found.');
      return;
    }
    if (game.phase !== 'story') return;
    if (game.paused)
      return this.sendError(client.socket, 'A moderator paused this room.');

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

    this.resolveStoryChoice(game, event.choiceId);
  }

  private resolveStoryChoice(game: GameState, choiceId: string) {
    const roomCode = game.roomCode;
    const scene = this.storyEngine.getNode(game.currentNodeId, game);
    const result = this.storyEngine.applyChoice(game, choiceId);
    if (!result) {
      throw new BadRequestException('Choose a valid option for this scene.');
    }

    this.clearStoryTimeout(roomCode);

    const { choice } = result;
    this.playCutscene(
      choice.cutscene ?? scene?.onChoice?.[choice.id],
      'story',
      false,
      roomCode,
    );

    if (choice.result === 'battle') {
      this.startBattleFromChoice(game, choice);
      return;
    }

    if (choice.result === 'safe') {
      this.advanceActivePlayer(game);
      this.broadcastStory(roomCode);
      this.broadcastState(roomCode);
      this.broadcastRoomList();
      return;
    }

    if (choice.result === 'random') {
      this.handleRandomEncounter(game, choice);
      this.broadcastStory(roomCode);
      this.broadcastState(roomCode);
      this.broadcastRoomList();
      return;
    }

    if (choice.result === 'elimination') {
      this.resolveElimination(game, choice);
      return;
    }

    if (choice.result === 'credits') {
      game.phase = 'credits';
      game.creditsStartedAt = Date.now();
      game.creditsDurationMs = 68000;

      this.clearStoryTimeout(roomCode);
      this.clearRoundTimeout(roomCode);

      this.broadcastEvent(roomCode, {
        type: 'CREDITS',
        durationMs: game.creditsDurationMs,
        startedAt: game.creditsStartedAt,
      });

      this.broadcastState(roomCode);
      this.broadcastRoomList();
      return;
    }

    this.broadcastStory(roomCode);
    this.broadcastState(roomCode);
    this.broadcastRoomList();
  }

  private startBattleFromChoice(game: GameState, choice: StoryChoice) {
    let teamA: TeamId | null = null;
    let teamB: TeamId | null = null;

    if (choice.versus) [teamA, teamB] = choice.versus;
    else if (choice.enemyTeamId) {
      teamA = game.currentTeamId;
      teamB = choice.enemyTeamId;
    }

    const sideHasAlive = (teamId: TeamId) =>
      game.teams[teamId].players.some((p) => p.status === 'alive');

    if (teamA && teamB && (!sideHasAlive(teamA) || !sideHasAlive(teamB))) {
      game.phase = 'story';
      if (choice.nextNodeId) game.currentNodeId = choice.nextNodeId;
      this.broadcastStory(game.roomCode);
      this.broadcastState(game.roomCode);
      this.broadcastRoomList();
      return;
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
      const config = Object.hasOwn(ENEMY_CONFIGS, choice.enemyName)
        ? ENEMY_CONFIGS[choice.enemyName]
        : undefined;

      if (config) {
        game.battle = this.combatEngine.createCpuBattle(
          game,
          game.currentTeamId,
          choice.enemyName,
          choice.enemyHp ?? config.hp,
          choice.enemyMaxHp ?? config.hp,
          {
            attack: choice.enemyAttack ?? config.attack,
            personality: config.personality,
            abilityChance: config.abilityChance,
            signatureEveryNRounds: config.signatureEveryNRounds,
            signatureMultiplier: config.signatureMultiplier,
            telegraphs: config.telegraphs,
            phases: choice.enemyPhases ?? config.phases,
            abilities: choice.enemyAbilities ?? config.abilities,
          },
        );
      } else {
        game.battle = this.combatEngine.createCpuBattle(
          game,
          game.currentTeamId,
          choice.enemyName,
          choice.enemyHp ?? 1200,
          choice.enemyMaxHp ?? choice.enemyHp ?? 1200,
          {
            attack: choice.enemyAttack ?? 100,
            personality: 'aggressive',
            abilityChance: 0.35,
            signatureEveryNRounds: 4,
            signatureMultiplier: 1.6,
          },
        );
      }
    } else {
      const defenderTeam =
        choice.enemyTeamId ??
        this.getNextEnemyTeam(game.currentTeamId, game.activeTeams);

      if (!sideHasAlive(defenderTeam)) {
        game.phase = 'story';
        if (choice.nextNodeId) game.currentNodeId = choice.nextNodeId;
        this.broadcastStory(game.roomCode);
        this.broadcastState(game.roomCode);
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

    this.playCutscene(choice.onBattle, 'battle', false, game.roomCode);
    this.broadcastRoundState(game);
    this.startRoundTimeout(game);
    this.broadcastStory(game.roomCode);
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
  }

  private resolveElimination(game: GameState, choice: StoryChoice) {
    const team = game.teams[game.currentTeamId];
    const candidates = team.players
      .filter((p) => p.status === 'alive')
      .sort((a, b) => a.hp - b.hp);
    const victim = candidates[0];

    if (victim) {
      victim.status = 'eliminated';
      victim.hp = 0;
      victim.companion = undefined;
      victim.secondaryCompanion = undefined;
      this.broadcastEvent(game.roomCode, {
        type: 'ELIMINATE',
        playerId: victim.id,
      });
    }

    game.phase = 'story';
    if (choice.nextNodeId) game.currentNodeId = choice.nextNodeId;
    this.clampRotations(game);
    this.advanceActivePlayer(game);
    this.broadcastStory(game.roomCode);
    this.broadcastState(game.roomCode);
    this.broadcastRoomList();
  }

  private handleRandomEncounter(game: GameState, choice: StoryChoice) {
    const { nextNodeId, onBattle } = choice;
    const team = game.teams[game.currentTeamId];
    const alive = team.players.filter((p) => p.status === 'alive');
    const aliveCount = alive.length;
    const avgHp =
      alive.length > 0
        ? alive.reduce((sum, p) => sum + p.hp, 0) / alive.length
        : 0;

    const sampleMaxHp = alive[0]?.maxHp ?? 1000;
    const damageRatio =
      sampleMaxHp > 0 ? 1 - Math.min(1, avgHp / sampleMaxHp) : 0;
    const sizeFactor = aliveCount <= 1 ? 0.25 : aliveCount === 2 ? 0.1 : 0;
    const encounterChance = 0.4 + damageRatio * 0.2 + sizeFactor;

    if (Math.random() > encounterChance) {
      if (nextNodeId) game.currentNodeId = nextNodeId;
      this.advanceActivePlayer(game);
      return;
    }

    const teamStrength = aliveCount * 200 + avgHp * 0.6;
    const tier: 'low' | 'mid' | 'elite' =
      teamStrength > 1600 ? 'elite' : teamStrength > 900 ? 'mid' : 'low';

    const ENCOUNTER_POOL = {
      low: [
        {
          name: 'THE SHADOW',
          hp: 1000,
          attack: 180,
          personality: 'chaotic' as const,
          abilityChance: 0.3,
          signatureEveryNRounds: 0,
          weight: 60,
        },
        {
          name: 'A HOLLOW WRAITH',
          hp: 1100,
          attack: 190,
          personality: 'aggressive' as const,
          abilityChance: 0.35,
          signatureEveryNRounds: 4,
          signatureMultiplier: 1.5,
          weight: 40,
        },
      ],
      mid: [
        {
          name: 'THE PALE HUNTER',
          hp: 1300,
          attack: 210,
          personality: 'strategic' as const,
          abilityChance: 0.4,
          signatureEveryNRounds: 3,
          signatureMultiplier: 1.7,
          telegraphs: true,
          weight: 45,
        },
        {
          name: 'THE ASHEN CHOIR',
          hp: 1400,
          attack: 220,
          personality: 'chaotic' as const,
          abilityChance: 0.45,
          signatureEveryNRounds: 3,
          signatureMultiplier: 1.6,
          weight: 35,
        },
        {
          name: 'WOLF OF THE HOLLOW',
          hp: 1250,
          attack: 230,
          personality: 'aggressive' as const,
          abilityChance: 0.35,
          signatureEveryNRounds: 5,
          signatureMultiplier: 2.0,
          weight: 20,
        },
      ],
      elite: [
        {
          name: 'THE HOLLOWED KING',
          hp: 1700,
          attack: 240,
          personality: 'boss' as const,
          abilityChance: 0.5,
          signatureEveryNRounds: 3,
          signatureMultiplier: 1.8,
          telegraphs: true,
          weight: 30,
        },
        {
          name: 'SIR CULLEN, THE LAST KNIGHT',
          hp: 1600,
          attack: 250,
          personality: 'strategic' as const,
          abilityChance: 0.45,
          signatureEveryNRounds: 2,
          signatureMultiplier: 1.9,
          telegraphs: true,
          weight: 30,
        },
        {
          name: 'THE FACELESS MOTHER',
          hp: 1800,
          attack: 260,
          personality: 'chaotic' as const,
          abilityChance: 0.55,
          signatureEveryNRounds: 4,
          signatureMultiplier: 2.1,
          weight: 25,
        },
        {
          name: 'THE THING IN THE BELL',
          hp: 1500,
          attack: 270,
          personality: 'aggressive' as const,
          abilityChance: 0.4,
          signatureEveryNRounds: 3,
          signatureMultiplier: 2.0,
          weight: 15,
        },
        {
          name: 'SMALL MICHEAL',
          hp: 2500,
          attack: 270,
          personality: 'aggressive' as const,
          abilityChance: 0.4,
          signatureEveryNRounds: 3,
          signatureMultiplier: 2.0,
          weight: 15,
        },
      ],
    };

    const pool = ENCOUNTER_POOL[tier] as Array<{
      name: string;
      hp: number;
      attack: number;
      personality: 'aggressive' | 'chaotic' | 'strategic' | 'boss';
      abilityChance: number;
      signatureEveryNRounds: number;
      signatureMultiplier?: number;
      telegraphs?: boolean;
      weight: number;
    }>;

    const encounter = this.weightedPick(pool);
    const enemyName = choice.enemyName ?? encounter.name;
    const maxHp = choice.enemyMaxHp ?? encounter.hp;

    game.phase = 'battle';
    game.pendingNextNodeId = nextNodeId;
    game.battle = this.combatEngine.createCpuBattle(
      game,
      game.currentTeamId,
      enemyName,
      choice.enemyHp ?? maxHp,
      maxHp,
      {
        attack: choice.enemyAttack ?? encounter.attack,
        abilities: choice.enemyAbilities,
        phases: choice.enemyPhases,
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
      game.battle.log.push(`${enemyName} emerges from the Highlands.`);
      this.playCutscene(onBattle, 'battle', false, game.roomCode);
    }

    this.broadcastRoundState(game);
    this.startRoundTimeout(game);
  }

  private weightedPick<T extends { weight: number }>(pool: T[]): T {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let r = Math.random() * total;
    for (const item of pool) {
      r -= item.weight;
      if (r <= 0) return item;
    }
    return pool[0];
  }

  /* ================================================================== */
  /* Combat queue                                                        */
  /* ================================================================== */

  private expectedActors(game: GameState, battle: Battle): Player[] {
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

  private broadcastRoundState(game: GameState) {
    const battle = game.battle;
    if (!battle) return;

    const expected = this.expectedActors(game, battle);
    const ready = new Set(battle.readyPlayerIds ?? []);
    const waitingOn = expected.filter((p) => !ready.has(p.id)).map((p) => p.id);

    this.broadcastEvent(game.roomCode, {
      type: 'COMBAT_ROUND_UPDATE',
      waitingOn,
      expected: expected.length,
    });
  }

  private handleCombatQueueAction(
    client: ConnectedClient,
    event: Extract<GameEvent, { type: 'COMBAT_QUEUE_ACTION' }>,
  ) {
    if (client.roomCode === GLOBAL_ROOM && this.activeCutsceneId) {
      this.sendError(client.socket, 'A cutscene is playing.');
      return;
    }

    const roomCode = client.roomCode;
    if (!roomCode) return;
    const game = this.gameStore.getGame(roomCode);
    if (!game) return;
    if (game.paused)
      return this.sendError(client.socket, 'A moderator paused this room.');
    if (this.resolvingRooms.has(roomCode)) return;

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
    try {
      this.combatEngine.validateAction(player, event.action, event.variant);
    } catch (error) {
      return this.sendError(client.socket, (error as Error).message);
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

    this.broadcastRoundState(game);
    this.broadcastState(roomCode);

    const allReady = expected.every((p) =>
      battle.readyPlayerIds!.includes(p.id),
    );
    if (allReady) void this.resolveRound(game);
  }

  private async resolveRound(game: GameState) {
    const battle = game.battle;
    if (
      !battle ||
      game.paused ||
      battle.status !== 'active' ||
      this.resolvingRooms.has(game.roomCode)
    )
      return;

    this.clearRoundTimeout(game.roomCode);
    this.resolvingRooms.add(game.roomCode);

    try {
      const expected = this.expectedActors(game, battle);
      const queued = new Set(
        (battle.queuedActions ?? []).map((q) => q.playerId),
      );

      for (const p of expected) {
        if (queued.has(p.id)) continue;
        battle.queuedActions!.push({ playerId: p.id, action: 'attack' });
      }

      const speed = new Map(expected.map((player) => [player.id, player.loadout?.strength?.speed ?? 1]));
      const queue = [...(battle.queuedActions ?? [])].sort((a, b) =>
        (speed.get(b.playerId) ?? 1) - (speed.get(a.playerId) ?? 1));

      for (const entry of queue) {
        const live = this.gameStore.getGame(game.roomCode);
        if (live?.battle !== battle || battle.status !== 'active') break;

        const liveBattle = live.battle;
        const actor = this.findPlayer(live, entry.playerId);
        if (!actor?.connected || actor.status !== 'alive') continue;

        const before = liveBattle.log.length;
        let presentationDelay = ACTION_RESOLVE_DELAY_MS;
        try {
          if (entry.action === 'item') {
            const item = this.combatEngine.battleItemFor(actor, entry.variant);
            if (!actor.battleItems?.[item]) {
              if (!(await this.progression.consumeItem(actor.id, item))) {
                liveBattle.log.push(
                  `${actor.name} is out of their equipped item and attacks instead.`,
                );
                entry.action = 'attack';
              } else {
                this.broadcastEvent(live.roomCode, { type: 'PROFILE_UPDATED' });
              }
            }
          }
          this.combatEngine.performAction(
            live,
            actor,
            entry.action,
            entry.variant,
            entry.targetId,
          );
          if (entry.action === 'limit') {
            presentationDelay = LIMIT_BREAK_RESOLVE_DELAY_MS;
          }
          if (queued.has(actor.id)) {
            const contributors =
              this.contributors.get(battle) ?? new Set<string>();
            contributors.add(actor.id);
            this.contributors.set(battle, contributors);
          }

          this.broadcastPlayerAction(live, liveBattle, actor, before);
        } catch (err) {
          this.logger.warn(`Action failed: ${err}`);
        }

        if (liveBattle.status === 'active' || presentationDelay === LIMIT_BREAK_RESOLVE_DELAY_MS) {
          await this.wait(presentationDelay);
        }
        if (this.gameStore.getGame(live.roomCode)?.battle !== liveBattle) return;
        const beforeFollowUp = liveBattle.log.length;
        if (this.combatEngine.resolvePlayerBreak(live, actor)) {
          this.broadcastPlayerAction(live, liveBattle, actor, beforeFollowUp);
          if (liveBattle.status === 'active') await this.wait(ACTION_RESOLVE_DELAY_MS);
        }
        if (liveBattle.status !== 'active') break;
      }

      const live = this.gameStore.getGame(game.roomCode);
      if (live?.battle !== battle) return;
      const liveBattle = live.battle;

      if (liveBattle.status !== 'active') {
        await this.finishRound(live);
        return;
      }

      const beforeCompanions = liveBattle.log.length;
      this.combatEngine.resolveCompanions(live);
      if (liveBattle.log.length !== beforeCompanions) {
        this.broadcastState(live.roomCode);
        if (liveBattle.status === 'active') await this.wait(500);
        if (this.gameStore.getGame(live.roomCode)?.battle !== liveBattle) return;
      }
      if (liveBattle.status !== 'active') {
        await this.finishRound(live);
        return;
      }

      if (liveBattle.mode === 'cpu') {
        this.broadcastEvent(live.roomCode, {
          type: 'BATTLE_UPDATE',
          mode: 'cpu',
          message: '',
          thinking: true,
        });
        await this.wait(ENEMY_RETALIATE_DELAY_MS);
        if (this.gameStore.getGame(live.roomCode)?.battle !== liveBattle) return;

        const retaliation = this.combatEngine.cpuRetaliate(live, liveBattle);
        let logOffset = liveBattle.log.length;
        for (let step = retaliation.next(); ; step = retaliation.next()) {
          for (const line of liveBattle.log.slice(logOffset)) {
            this.broadcastEvent(live.roomCode, {
              type: 'BATTLE_UPDATE',
              mode: 'cpu',
              enemyName: liveBattle.enemyName,
              enemyHp: liveBattle.enemyHp,
              enemyMaxHp: liveBattle.enemyMaxHp,
              message: line,
              source: 'enemy',
            });
            if (line.endsWith('is BROKEN!')) this.emitBreak(line, live);
          }
          if (step.done) break;
          logOffset = liveBattle.log.length;
          this.broadcastState(live.roomCode);
          await this.wait(step.value);
          if (this.gameStore.getGame(live.roomCode)?.battle !== liveBattle) return;
          if (liveBattle.status !== 'active') break;
        }
        this.broadcastEvent(live.roomCode, {
          type: 'BATTLE_UPDATE',
          mode: 'cpu',
          message: '',
          thinking: false,
        });

        if (liveBattle.status !== 'active') {
          await this.finishRound(live);
          return;
        }
      }

      liveBattle.queuedActions = [];
      liveBattle.readyPlayerIds = [];
      this.combatEngine.nextTurn(live);
      this.combatEngine.tickStatuses(live);
      if (liveBattle.status !== 'active') {
        await this.finishRound(live);
        return;
      }

      this.broadcastRoundState(live);
      this.broadcastState(live.roomCode);
      this.broadcastRoomList();
      this.startRoundTimeout(live);
    } finally {
      this.resolvingRooms.delete(game.roomCode);
    }
  }

  private broadcastPlayerAction(game: GameState, battle: Battle, player: Player, logOffset: number) {
    const cpu = battle.mode === 'cpu' ? battle : undefined;
    for (const message of battle.log.slice(logOffset)) {
      this.broadcastEvent(game.roomCode, {
        type: 'BATTLE_UPDATE',
        mode: battle.mode,
        enemyName: cpu?.enemyName,
        enemyHp: cpu?.enemyHp,
        enemyMaxHp: cpu?.enemyMaxHp,
        message,
        source: 'player',
        actingTeamId: player.teamId,
        actingPlayerId: player.id,
      });
      if (!cpu && message.endsWith('is BROKEN!')) this.emitBreak(message, game);
    }
    this.broadcastState(game.roomCode);
  }

  private async savePathMilestone(game: GameState, path: EncounterPath, cleared: 6 | 12) {
    if (!game.hostPlayerId) throw new ConflictException('This path has no player account.');
    const result = await this.progression.saveEncounterCheckpoint(game.hostPlayerId, path, cleared);
    path.savedWins = result.savedWins;
    path.savePending = undefined;
    if (result.reward && result.progression) {
      path.completionReward = result.reward;
      if (game.battle?.rewards) {
        game.battle.rewards.tier = { ...result.reward, level: result.progression.level };
        game.battle.rewards.tierPlayerId = game.hostPlayerId;
      }
      const host = this.findPlayer(game, game.hostPlayerId);
      if (host?.loadout) {
        const { attack, defense, speed } = result.progression;
        host.loadout.strength = { attack, defense, speed };
      }
      this.broadcastEvent(game.roomCode, { type: 'PROFILE_UPDATED' });
    }
  }

  private async finishRound(game: GameState) {
    const battle = game.battle;
    if (battle && (battle.status === 'victory' || battle.status === 'defeat')) {
      const rewards = battle.rewards ??= { earned: {} };
      const settledAt = this.rewardSettledAt.get(battle) ?? new Date();
      this.rewardSettledAt.set(battle, settledAt);
      const results = await Promise.allSettled(
        [...(this.contributors.get(battle) ?? [])].map(async (id) => {
          const progression = await this.progression.reward(id, battle.id, settledAt).catch((error) => {
            const unavailable = rewards.unavailable ??= [];
            if (!unavailable.includes(id)) unavailable.push(id);
            throw error;
          });
          if (rewards.unavailable) rewards.unavailable = rewards.unavailable.filter((playerId) => playerId !== id);
          if (progression) rewards.earned[id] = { xp: BATTLE_XP, cinders: BATTLE_CINDERS, level: progression.level };
          const player = this.findPlayer(game, id);
          if (progression && player?.loadout) {
            player.loadout.strength = { attack: progression.attack, defense: progression.defense, speed: progression.speed };
          }
        }),
      );
      if (results.some((result) => result.status === 'rejected')) {
        this.logger.error(
          `Could not award every participation reward for battle ${battle.id}`,
        );
      }
      this.broadcastEvent(game.roomCode, { type: 'PROFILE_UPDATED' });
    }
    const path = game.encounterPath;
    if (!game.adventure && path?.levels.length === 12 && battle?.mode === 'cpu' &&
        battle.encounterId && battle.status === 'victory' && battle.enemyHp === 0 &&
        (path.index === 5 || path.index === 11)) {
      try {
        await this.savePathMilestone(game, path, path.index === 5 ? 6 : 12);
      } catch {
        path.savePending = true;
        this.logger.error('Could not save Highlands Path milestone for room ' + game.roomCode);
      }
    }
    if (game.battle !== battle) return;
    if (battle?.rewards && !(game.battleMode === 'cpu' && path && battle.mode === 'cpu' && battle.encounterId))
      this.broadcastState(game.roomCode);
    this.endBattleAndAdvance(game);
    this.broadcastStory(game.roomCode);
    this.broadcastState(game.roomCode);
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
      this.broadcastEvent(game.roomCode, {
        type: 'BREAK',
        teamId: broken.teamId,
        playerId: broken.id,
      });
    }
  }

  private endBattleAndAdvance(game: GameState) {
    this.clearRoundTimeout(game.roomCode);

    const battle = game.battle;
    if (battle) {
      const cutscene =
        battle.status === 'victory' ? battle.victory : battle.defeat;
      this.playCutscene(cutscene, 'battle', false, game.roomCode);
    }

    if (game.battleMode === 'cpu') {
      if (game.encounterPath && battle?.mode === 'cpu' && battle.encounterId) {
        const path = game.encounterPath;
        this.broadcastState(game.roomCode);
        game.battle = undefined;
        if (battle.status === 'defeat') {
          path.status = 'defeated';
          game.phase = 'ended';
        } else if (!game.adventure && battle.enemyHp > 0) {
          // A moderator can end a fight, but a forced result does not earn a path win.
          return;
        } else if (path.index === path.levels.length - 1) {
          path.status = 'cleared';
          game.phase = 'ended';
          if (!game.adventure && (path.tier ?? 1) < MAX_ENCOUNTER_TIER) path.nextTier = (path.tier ?? 1) + 1;
        } else {
          path.index += 1;
          if (game.adventure) game.adventureQuest = createAdventureQuest();
          game.openingEnemy = path.levels[path.index].name;
          for (const player of game.teams[battle.attackerTeamId].players) {
            if (player.status === 'alive') {
              player.hp = Math.min(player.maxHp, player.hp + Math.ceil(player.maxHp * 0.3));
            }
          }
        }
        return;
      }
      if (battle?.status === 'defeat') {
        game.phase = 'ended';
        return;
      }
      game.battle = undefined;
      game.phase = 'battle';
      this.scheduleCpuEncounter(game);
      return;
    }

    if (game.battleMode === 'pvp') {
      // Return to the waiting screen. Host can start a new match.
      game.battle = undefined;
      game.phase = 'waiting';
      for (const team of Object.values(game.teams)) {
        for (const player of team.players) {
          player.ready = false;
          player.hp = player.maxHp;
          player.status = 'alive';
        }
      }
      this.broadcastState(game.roomCode);
      return;
    }

    game.phase = 'story';
    game.battle = undefined;

    if (game.pendingNextNodeId) {
      game.currentNodeId = game.pendingNextNodeId;
      game.pendingNextNodeId = undefined;
    }

    this.clampRotations(game);
    this.advanceActivePlayer(game);
  }

  private scheduleCpuEncounter(game: GameState, delay = 4000) {
    const code = game.roomCode;
    clearTimeout(this.roomTransitionTimers.get(code));
    const timer = setTimeout(() => {
      this.roomTransitionTimers.delete(code);
      const fresh = this.gameStore.getGame(code);
      if (
        fresh !== game ||
        game.paused ||
        game.phase !== 'battle' ||
        game.battle
      )
        return;
      const nextEnemy = this.pickRandomOpeningEnemy();
      const config = ENEMY_CONFIGS[nextEnemy];
      game.battle = this.combatEngine.createCpuBattle(
        game,
        game.currentTeamId,
        nextEnemy,
        config.hp,
        config.hp,
        {
          attack: config.attack,
          personality: config.personality,
          abilityChance: config.abilityChance,
          signatureEveryNRounds: config.signatureEveryNRounds,
          signatureMultiplier: config.signatureMultiplier,
          telegraphs: config.telegraphs,
          phases: config.phases,
          abilities: config.abilities,
        },
      );
      game.battle.queuedActions = [];
      game.battle.readyPlayerIds = [];
      game.battle.log.push(`${nextEnemy} emerges from the Highlands.`);
      this.broadcastRoundState(game);
      this.startRoundTimeout(game);
      this.broadcastState(code);
    }, delay);
    this.roomTransitionTimers.set(code, timer);
  }

  /* ================================================================== */
  /* Cutscenes                                                           */
  /* ================================================================== */

  private playCutscene(
    cutscene: Cutscene | undefined,
    context: 'story' | 'battle',
    pause = false,
    roomCode?: string,
  ) {
    if (!cutscene || cutscene.lines.length === 0) return;
    if (cutscene.once && this.seenCutscenes.has(cutscene.id)) return;
    if (cutscene.once) this.seenCutscenes.add(cutscene.id);

    if (!roomCode || roomCode === GLOBAL_ROOM)
      this.activeCutsceneId = pause ? cutscene.id : null;

    this.broadcastEvent(roomCode ?? GLOBAL_ROOM, {
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

  private findGameByPlayer(playerId: string): GameState | undefined {
    return this.gameStore
      .getAllGames()
      .find((g) =>
        Object.values(g.teams).some((t) =>
          t.players.some((p) => p.id === playerId),
        ),
      );
  }

  private findPlayer(game: GameState, playerId: string): Player | undefined {
    for (const team of Object.values(game.teams)) {
      const player = team.players.find((p) => p.id === playerId);
      if (player) return player;
    }
    return undefined;
  }

  private broadcastStory(roomCode: string) {
    const game = this.gameStore.getGame(roomCode);
    if (!game) return;

    const node = this.storyEngine.getNode(game.currentNodeId, game);
    if (!node) return;

    this.broadcastEvent(roomCode, {
      type: 'STORY_UPDATE',
      nodeId: node.id,
      title: node.title,
      text: node.text,
      background: node.background,
      choices: node.choices,
    } as GameEvent);

    if (
      !game.battleMode &&
      !game.paused &&
      game.phase === 'story' &&
      game.currentNodeId !== this.lastCutsceneNodeId
    ) {
      this.lastCutsceneNodeId = game.currentNodeId;
      this.playCutscene(node.onEnter, 'story', false, roomCode);
    }
  }

  private broadcastState(roomCode: string) {
    const game = this.gameStore.getGame(roomCode);
    if (!game) return;

    this.server.to(roomCode).emit(
      'message',
      JSON.stringify({
        type: 'STATE_SYNC',
        roomCode,
        payload: game as unknown as Record<string, unknown>,
      } satisfies GameEvent),
    );
  }

  private sendState(socket: Socket, game: GameState) {
    this.send(socket, {
      type: 'STATE_SYNC',
      roomCode: game.roomCode,
      payload: game as unknown as Record<string, unknown>,
    });
  }

  private broadcastEvent(roomCode: string, event: GameEvent) {
    this.server.to(roomCode).emit('message', JSON.stringify(event));
  }

  private send(socket: Socket, event: GameEvent) {
    if (socket.connected) socket.send(JSON.stringify(event));
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
      if (client.watcher || client.moderator) {
        client.socket.emit('message', JSON.stringify(event));
      }
    }

    this.broadcastPlayerList();
  }

  private handleCreditsDone(client: ConnectedClient) {
    const roomCode = client.roomCode;
    if (!roomCode) return;
    const game = this.gameStore.getGame(roomCode);
    if (!game || game.phase !== 'credits') return;

    game.phase = 'waiting';
    this.storyEngine.resetRun(game);
    game.creditsStartedAt = undefined;
    game.creditsDurationMs = undefined;
    game.playerRotation = {};
    game.lastActivePlayerId = undefined;

    this.broadcastStory(roomCode);
    this.broadcastState(roomCode);
  }

  private restartGame(roomCode: string) {
    const game = this.gameStore.getGame(roomCode);
    if (!game) return;
    this.clearRoomTimers(roomCode);
    this.kickedPlayers.delete(game);

    this.logger.log(`Restarting the Highlands: ${roomCode}`);

    for (const teamId of Object.keys(game.teams) as TeamId[]) {
      const team = game.teams[teamId];
      for (const player of team.players) {
        player.hp = player.maxHp;
        player.status = 'alive';
        player.ready = false;
        player.breakMeter = 0;
        player.statusEffects = [];
        player.skillCharges = undefined;
        player.healCharges = undefined;
        player.battleItems = undefined;
        player.companion = undefined;
        player.secondaryCompanion = undefined;
      }
    }

    game.playerRotation = {};
    game.lastActivePlayerId = undefined;
    game.phase = 'waiting';
    game.paused = false;
    if (game.encounterPath) {
      game.encounterPath = createEncounterPath(game.adventure);
      if (game.adventure) game.adventureQuest = createAdventureQuest();
      game.openingEnemy = game.encounterPath.levels[0].name;
    }
    this.storyEngine.resetRun(game);
    game.currentTeamId = game.battleMode ? game.currentTeamId : 'ravens';
    game.activePlayerId = undefined;
    game.battle = undefined;
    game.pendingNextNodeId = undefined;
    game.events = [];
    game.creditsStartedAt = undefined;
    game.creditsDurationMs = undefined;

    if (!game.battleMode) {
      this.seenCutscenes.clear();
      this.lastCutsceneNodeId = null;
      this.activeCutsceneId = null;
    }

    this.broadcastStory(roomCode);
    this.broadcastState(roomCode);
    this.broadcastRoomList();
    this.broadcastPlayerList();
  }
}
