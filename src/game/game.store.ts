import { GameState, Team, TeamId } from './game.types';

export interface RoomSummary {
  roomCode: string;
  phase: GameState['phase'];
  playerCount: number;
  teams: {
    ravens: number;
    wolves: number;
    dragons: number;
    serpents: number;
  };
}

/** Fixed key for the single shared game. */
export const GLOBAL_ROOM_CODE = 'global';

export class GameStore {
  private readonly games = new Map<string, GameState>();

  createGame(roomCode: string): GameState {
    const teams: Record<TeamId, Team> = {
      ravens: { id: 'ravens', name: 'Ravens', players: [] },
      wolves: { id: 'wolves', name: 'Wolves', players: [] },
      dragons: { id: 'dragons', name: 'Dragons', players: [] },
      serpents: { id: 'serpents', name: 'Serpents', players: [] },
    };

    const game: GameState = {
      roomCode,
      phase: 'waiting',
      currentNodeId: 'start',
      currentTeamId: 'ravens',
      teams,
      events: [],
      createdAt: Date.now(),
    };

    this.games.set(roomCode, game);
    return game;
  }

  getGame(roomCode: string): GameState | undefined {
    return this.games.get(roomCode);
  }

  /**
   * Returns the single shared game, creating it on first access.
   * This is the entry point used by the gateway.
   */
  getOrCreateGlobalGame(): GameState {
    let game = this.games.get(GLOBAL_ROOM_CODE);

    if (!game) {
      game = this.createGame(GLOBAL_ROOM_CODE);
    }

    return game;
  }

  hasGame(roomCode: string): boolean {
    return this.games.has(roomCode);
  }

  deleteGame(roomCode: string) {
    this.games.delete(roomCode);
  }

  updateGame(
    roomCode: string,
    updater: (game: GameState) => void,
  ): GameState | undefined {
    const game = this.games.get(roomCode);
    if (!game) return undefined;

    updater(game);
    return game;
  }

  getAllGames() {
    return Array.from(this.games.values());
  }

  getRoomSummaries(): RoomSummary[] {
    return Array.from(this.games.values()).map((game) => {
      const teamCounts = {
        ravens: game.teams.ravens.players.length,
        wolves: game.teams.wolves.players.length,
        dragons: game.teams.dragons.players.length,
        serpents: game.teams.serpents.players.length,
      };

      return {
        roomCode: game.roomCode,
        phase: game.phase,
        playerCount: Object.values(teamCounts).reduce(
          (total, count) => total + count,
          0,
        ),
        teams: teamCounts,
      };
    });
  }

  /**
   * Returns a single summary for the global game, or an empty array
   * if no global game exists yet. Useful if you want the admin panel
   * to show exactly one row.
   */
  getGlobalRoomSummary(): RoomSummary[] {
    const game = this.games.get(GLOBAL_ROOM_CODE);
    if (!game) return [];

    const teamCounts = {
      ravens: game.teams.ravens.players.length,
      wolves: game.teams.wolves.players.length,
      dragons: game.teams.dragons.players.length,
      serpents: game.teams.serpents.players.length,
    };

    return [
      {
        roomCode: game.roomCode,
        phase: game.phase,
        playerCount: Object.values(teamCounts).reduce(
          (total, count) => total + count,
          0,
        ),
        teams: teamCounts,
      },
    ];
  }
}
