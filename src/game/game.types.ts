import { RoomSummary } from './game.store';

export type TeamId = 'ravens' | 'wolves' | 'dragons' | 'serpents';

export type CombatAction = 'attack' | 'skill' | 'heal' | 'block' | 'dodge';

export type SkillId =
  | 'shadow_strike'
  | 'blood_rage'
  | 'fire_burst'
  | 'void_blast';

export type HealId = 'minor_heal' | 'major_heal';
export type CombatVariant = SkillId | HealId;

export type PlayerStatus = 'alive' | 'eliminated' | 'defeated' | 'spectator';

export type ChoiceResult = 'safe' | 'battle' | 'random' | 'elimination';

export type AdminRole = 'executioner' | 'chronicler' | 'scouter';
export type TeamCaps = Partial<Record<TeamId, number>>;

export interface Player {
  id: string;
  name: string;
  teamId: TeamId;
  hp: number;
  maxHp: number;
  status: PlayerStatus;
  ready: boolean;
  connected: boolean;
}

export interface Team {
  id: TeamId;
  name: string;
  players: Player[];
}

export interface StoryChoice {
  id: string;
  text: string;
  result: ChoiceResult;
  nextNodeId?: string;

  // PvP battle
  versus?: [TeamId, TeamId];

  // CPU battle
  enemyTeamId?: TeamId;
  enemyName?: string;
  enemyHp?: number;
  enemyMaxHp?: number;
  enemyAttack?: number;
}

export interface StoryNode {
  id: string;
  title: string;
  text: string;

  background?: string;

  choices: StoryChoice[];
}

// export interface Battle {
//   id: string;

//   attackerTeamId: TeamId;
//   defenderTeamId: TeamId;

//   enemyName: string;

//   enemyHp: number;
//   enemyMaxHp: number;

//   activePlayerId?: string;

//   turnTeamId: TeamId;

//   status: 'active' | 'victory' | 'defeat';

//   log: string[];
// }
type GamePhase = 'waiting' | 'story' | 'combat' | 'ended' | 'battle';
export interface GameState {
  roomCode: string;
  phase: GamePhase;
  currentNodeId: string;
  currentTeamId: TeamId;
  teams: Record<TeamId, Team>;
  activeTeams?: TeamId[];
  teamCaps?: TeamCaps;
  battle?: Battle;
  events: GameEvent[];
  createdAt: number;
  pendingNextNodeId?: string;
}

export type GameEvent =
  | {
      type: 'JOIN_GAME';
      playerId: string;
      teamId: TeamId;
      playerName?: string;
    }
  | {
      type: 'WATCH_GAME';
      watcherId: string;
      roomCode: string;
    }
  | {
      type: 'CHOICE';
      playerId: string;
      choiceId: string;
    }
  | {
      type: 'COMBAT_ACTION';
      playerId: string;
      action: CombatAction;
    }
  | {
      type: 'COMBAT_ACTION_SELECTED';
      playerId: string;
      action: CombatAction;
      variant?: SkillId | HealId;
    }
  | {
      type: 'TEAM_TURN';
      teamId: TeamId;
    }
  | {
      type: 'ELIMINATE';
      playerId: string;
    }
  | {
      type: 'ROOM_PLAYER_READY';
      playerId: string;
    }
  | {
      type: 'ADMIN_APPROVE_ROOM';
      roomId: string;
      teamCaps?: TeamCaps;
    }
  | {
      type: 'BATTLE_UPDATE';
      mode: 'team' | 'cpu';
      message: string;
      enemyName?: string;
      enemyHp?: number;
      enemyMaxHp?: number;
      thinking?: boolean;
      source?: 'player' | 'enemy' | 'system';
      actingTeamId?: TeamId;
    }
  | {
      type: 'STATE_SYNC';
      roomCode: string;
      payload: Record<string, unknown>;
    }
  | {
      type: 'ADMIN_GET_ROOMS';
    }
  | {
      type: 'ROOM_LIST_UPDATE';
      rooms: RoomSummary[];
    }
  | {
      type: 'STORY_UPDATE';
      roomId: string;
    }
  | {
      type: 'STORY_UPDATE';
      nodeId: string;
      title: string;
      text: string;
      background?: string;
      choices: StoryChoice[];
    }
  | {
      type: 'BREAK';
      teamId: TeamId;
      playerId: string;
    }
  | {
      type: 'COMBAT_ACTION_SELECTED';
      playerId: string;
      action: CombatAction;
      variant?: CombatVariant;
      targetId?: string;
    }
  | { type: 'CONNECTED'; roomCode: string; message: string }
  | { type: 'LEAVE_ROOM'; roomCode: string; playerId: string }
  | { type: 'LEAVE_GAME'; playerId: string };

interface BattleBase {
  id: string;
  mode: BattleMode;
  attackerTeamId: TeamId;
  defenderTeamId: TeamId;
  status: 'active' | 'victory' | 'defeat';
  log: string[];
  turnTeamId: TeamId;
  /** Player whose turn it is. Rotates per-side. */
  activePlayerId?: string;
  /** Optional story node id this battle was spawned from. */
  sourceNodeId?: string;
}

export interface TeamBattle extends BattleBase {
  mode: 'team';
  /** No enemy pool — players on each side are the HP pool. */
}

export interface CpuBattle extends BattleBase {
  mode: 'cpu';
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
  enemyAttack: number;
  round: number;
}

export type BattleMode = 'team' | 'cpu';

export interface TeamBattle {
  id: string;
  mode: 'team';
  attackerTeamId: TeamId;
  defenderTeamId: TeamId;
  turnTeamId: TeamId;
  status: 'active' | 'victory' | 'defeat';
  log: string[];
  activePlayerId?: string;
  sourceNodeId?: string;
}

export interface CpuBattle {
  id: string;
  mode: 'cpu';
  attackerTeamId: TeamId;
  defenderTeamId: TeamId;
  turnTeamId: TeamId;
  status: 'active' | 'victory' | 'defeat';
  log: string[];
  activePlayerId?: string;
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
  enemyAttack: number;
  round: number;
}

export type Battle = TeamBattle | CpuBattle;
export interface StatusEffect {
  id: StatusId;
  turns: number;
}
export type StatusId =
  | 'immobilized'
  | 'guarded'
  | 'evading'
  | 'enraged'
  | 'blessed';

export interface Player {
  id: string;
  name: string;
  teamId: TeamId;
  hp: number;
  maxHp: number;
  status: PlayerStatus;
  ready: boolean;
  connected: boolean;
  breakMeter?: number;
  statusEffects?: StatusEffect[];
}

export type CpuPersonality =
  | 'aggressive' // burns the lowest-HP target
  | 'strategic' // focuses whoever has the highest damage output
  | 'defensive' // targets whoever is healing/buffing
  | 'chaotic' // random, but weighted toward wounded targets
  | 'boss'; // multi-phase, telegraphed, uses signature moves

export interface CpuBattle {
  id: string;
  mode: 'cpu';
  attackerTeamId: TeamId;
  defenderTeamId: TeamId;
  turnTeamId: TeamId;
  status: 'active' | 'victory' | 'defeat';
  log: string[];
  activePlayerId?: string;
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
  enemyAttack: number;
  round: number;

  /** AI tuning */
  personality?: CpuPersonality;
  /** Chance in [0,1] to use a special ability instead of a basic attack. */
  abilityChance?: number;
  /** Every N rounds, the CPU uses a signature move. 0 disables. */
  signatureEveryNRounds?: number;
  /** Extra damage multiplier for signature moves. */
  signatureMultiplier?: number;
  /** If true, the enemy opens with a telegraph line before acting. */
  telegraphs?: boolean;
  /** Boss phases (optional). Each phase kicks in when HP% drops below threshold. */
  phases?: CpuPhase[];
  /** Which phase the boss is currently in. */
  phaseIndex?: number;
}

export interface CpuPhase {
  /** When enemyHp / enemyMaxHp drops at or below this fraction, enter the phase. */
  hpThreshold: number;
  /** Damage multiplier applied while in this phase. */
  attackMultiplier: number;
  /** Short message announced when the phase begins. */
  announcement: string;
  /** Optional stat overrides. */
  healOnEnter?: number;
  /** Optional named signature move to unlock in this phase. */
  signatureName?: string;
}
