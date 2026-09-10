import { RoomSummary } from './game.store';

export type TeamId = 'ravens' | 'wolves' | 'dragons' | 'serpents';

export type CombatAction = 'attack' | 'skill' | 'heal' | 'block' | 'dodge';

export type SkillId =
  | 'shadow_strike'
  | 'blood_rage'
  | 'fire_burst'
  | 'void_blast';

export type HealId = 'minor_heal' | 'major_heal';

export type PlayerStatus = 'alive' | 'eliminated' | 'spectator';

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

  enemyTeamId?: TeamId;

  enemyName?: string;
  enemyHp?: number;
  enemyMaxHp?: number;
}

export interface StoryNode {
  id: string;
  title: string;
  text: string;

  background?: string;

  choices: StoryChoice[];
}

export interface Battle {
  id: string;

  attackerTeamId: TeamId;
  defenderTeamId: TeamId;

  enemyName: string;

  enemyHp: number;
  enemyMaxHp: number;

  activePlayerId?: string;

  turnTeamId: TeamId;

  status: 'active' | 'victory' | 'defeat';

  log: string[];
}

export interface GameState {
  roomCode: string;

  phase: 'waiting' | 'story' | 'battle' | 'finished';

  currentNodeId: string;

  currentTeamId: TeamId;

  teams: Record<TeamId, Team>;

  battle?: Battle;

  events: GameEvent[];

  createdAt: number;
  teamCaps?: TeamCaps;
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
      enemyName: string;
      enemyHp: number;
      enemyMaxHp: number;
      message: string;
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
    };
