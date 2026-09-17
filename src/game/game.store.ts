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
  /** Which kind of fight the room is hosting, if any. */
  battleMode?: 'pvp' | 'cpu';
  /** The player who created the room. */
  hostPlayerId?: string;
}

/** Fixed key for the single shared story game. */
export const GLOBAL_ROOM_CODE = 'global';

export class GameStore {
  private readonly games = new Map<string, GameState>();

  /* ------------------------------------------------------------------ */
  /* Creation                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Creates a new empty room with a fresh team roster.
   * Called by `createRoom` in the gateway for lobbied battle rooms.
   */
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

  /**
   * Alias kept for symmetry with the gateway's `createRoom` handler.
   * Same behaviour as `createGame`.
   */
  createRoom(roomCode: string): GameState {
    return this.createGame(roomCode);
  }

  /* ------------------------------------------------------------------ */
  /* Access                                                              */
  /* ------------------------------------------------------------------ */

  getGame(roomCode: string): GameState | undefined {
    return this.games.get(roomCode);
  }

  hasGame(roomCode: string): boolean {
    return this.games.has(roomCode);
  }

  /**
   * Returns the single shared story game, creating it on first access.
   * Used when a player joins without specifying a room code.
   */
  getOrCreateGlobalGame(): GameState {
    let game = this.games.get(GLOBAL_ROOM_CODE);

    if (!game) {
      game = this.createGame(GLOBAL_ROOM_CODE);
    }

    return game;
  }

  /** Every active game, ordered by creation time (oldest first). */
  getAllGames(): GameState[] {
    return Array.from(this.games.values()).sort(
      (a, b) => a.createdAt - b.createdAt,
    );
  }

  /** Just the room codes. */
  getAllRoomCodes(): string[] {
    return Array.from(this.games.keys());
  }

  /* ------------------------------------------------------------------ */
  /* Mutation                                                            */
  /* ------------------------------------------------------------------ */

  updateGame(
    roomCode: string,
    updater: (game: GameState) => void,
  ): GameState | undefined {
    const game = this.games.get(roomCode);
    if (!game) return undefined;

    updater(game);
    return game;
  }

  deleteGame(roomCode: string): void {
    this.games.delete(roomCode);
  }

  /* ------------------------------------------------------------------ */
  /* Summaries (admin panel + spectator lobby)                           */
  /* ------------------------------------------------------------------ */

  getRoomSummaries(): RoomSummary[] {
    return this.getAllGames().map((game) => this.summarize(game));
  }

  /**
   * Returns a summary for every game in the store.
   * Named `getGlobalRoomSummary` for backward-compatibility with the
   * earlier single-room gateway — it now returns all rooms, not just
   * the global one. If you have a place that depended on the old
   * "only the global room" behaviour, use `getOnlyGlobalSummary`.
   */
  getGlobalRoomSummary(): RoomSummary[] {
    return this.getAllGames().map((game) => this.summarize(game));
  }

  /**
   * Returns a single summary for the global story room, or an empty
   * array if the global room hasn't been created yet.
   */
  getOnlyGlobalSummary(): RoomSummary[] {
    const game = this.games.get(GLOBAL_ROOM_CODE);
    if (!game) return [];
    return [this.summarize(game)];
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private summarize(game: GameState): RoomSummary {
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
      battleMode: game.battleMode,
      hostPlayerId: game.hostPlayerId,
    };
  }
}
