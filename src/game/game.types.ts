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

export type ChoiceResult =
  | 'safe'
  | 'battle'
  | 'random'
  | 'elimination'
  | 'credits';

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
  breakMeter?: number;
  statusEffects?: StatusEffect[];

  /** Remaining skill uses this battle. Reset when a battle starts. */
  skillCharges?: number;
  /** Remaining heal uses this battle. Reset when a battle starts. */
  healCharges?: number;
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

  /** Plays when this choice is selected, before the result resolves. */
  cutscene?: Cutscene;

  /** Plays when the choice resolves into a battle. */
  onBattle?: Cutscene;

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
  /** Plays when the node is entered. */
  onEnter?: Cutscene;

  /** Optional cutscene for specific choices. Keyed by choice id. */
  onChoice?: Record<string, Cutscene>;
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
type GamePhase =
  | 'waiting'
  | 'story'
  | 'combat'
  | 'ended'
  | 'battle'
  | 'credits';
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
  /** The specific player whose turn it is within the active team. */
  activePlayerId?: string;
  creditsStartedAt?: number; // optional, useful for syncing the scroll
  creditsDurationMs?: number; // optional
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
      activePlayerId?: string;
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
      actingPlayerId?: string;
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
  | { type: 'LEAVE_GAME'; playerId: string }
  | {
      type: 'CUTSCENE';
      cutscene: Cutscene;
      /** Where it came from — used by the client to know when to return. */
      context: 'story' | 'battle';
      /** Optional: pause the current phase until the cutscene finishes. */
      pausePhase?: boolean;
    }
  | {
      type: 'CUTSCENE_DONE';
      cutsceneId: string;
    }
  | {
      type: 'COMBAT_QUEUE_ACTION';
      playerId: string;
      action: CombatAction;
      variant?: CombatVariant;
      targetId?: string;
    }
  | {
      type: 'COMBAT_ROUND_UPDATE';
      /** Player ids whose actions are still expected. */
      waitingOn: string[];
      /** Total players expected this round. */
      expected: number;
    }
  | { type: 'ROUND_TIMER'; remainingMs: number }
  | { type: 'CREDITS'; durationMs?: number; startedAt?: number }
  | { type: 'CREDITS_DONE' };

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
  intro?: Cutscene;
  victory?: Cutscene;
  defeat?: Cutscene;

  /** New: queued actions for the current round. */
  queuedActions?: QueuedAction[];
  /** New: player ids that have already submitted this round. */
  readyPlayerIds?: string[];
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
  intro?: Cutscene;
  victory?: Cutscene;
  defeat?: Cutscene;

  queuedActions?: QueuedAction[];
  readyPlayerIds?: string[];
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

export interface QueuedAction {
  playerId: string;
  action: CombatAction;
  variant?: CombatVariant;
  targetId?: string;
  /** Set by the server once resolved. */
  resolved?: boolean;
  /** Log lines produced by this action. */
  log?: string[];
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

type Tone =
  | 'mystic'
  | 'danger'
  | 'calm'
  | 'fear'
  | 'sad'
  | 'angry'
  | 'ominous'
  | 'whisper'
  | 'emotional'
  | 'neutral'
  | 'cold'
  | 'desperate'
  | 'broken'
  | 'melancholic'
  | 'sincere'
  | 'aggressive'
  | 'rage'
  | 'distorted'
  | 'hollow'
  | 'exhausted'
  | 'dark'
  | 'horror'
  | 'worried'
  | 'tragic'
  | 'accusing'
  | 'gentle'
  | 'tempting'
  | 'pleased'
  | 'determined'
  | 'quiet'
  | 'regret'
  | 'philosophical'
  | 'hurt'
  | 'confession'
  | 'serious'
  | 'furious'
  | 'accepting'
  | 'reflective';

export interface CutsceneLine {
  id: string;
  /** Big text displayed in the center. */
  text: string;
  /** Optional speaker shown above the text. */
  speaker?: string;
  /** Optional voice-over clip. Plays if present. */
  voice?: string;
  /** How long to display this line, in ms. Defaults to 3200. */
  duration?: number;
  /** Optional background image override for this line. */
  background?: string;
  /** Optional tint: 'neutral' | 'danger' | 'mystic'. */
  tone?: Tone;
}

export interface Cutscene {
  id: string;
  lines: CutsceneLine[];
  /** Play once per game, or every time the trigger fires. */
  once?: boolean;
}
