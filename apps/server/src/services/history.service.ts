import type { GameHistoryRecord, GameMove, GameResultPlayer, GameState } from '../models/game.model';
import { logger } from '../utils/logger';
import { newId } from '../utils/random';
import { db } from './db.service';
import { userService } from './user.service';

export interface PersistGameInput {
  state: GameState;
  results: GameResultPlayer[];
  winnerId: string | null;
  durationMs: number;
  mode: string;
}

class HistoryService {
  /**
   * Called once, when a game ends. This is the only moment the game touches
   * JSON Server: individual card movements stay in memory for the whole game.
   */
  async persistFinishedGame(input: PersistGameInput): Promise<GameHistoryRecord | null> {
    const { state, results, winnerId, durationMs, mode } = input;
    const winner = results.find((player) => player.id === winnerId) ?? null;
    const finishedAt = state.finishedAt ?? new Date().toISOString();

    const record: GameHistoryRecord = {
      id: newId(),
      gameId: state.gameId,
      roomCode: state.roomCode,
      mode,
      winnerId,
      winnerUsername: winner?.username ?? null,
      playerIds: results.map((player) => player.id),
      players: results,
      moves: this.trimMoves(state.moves),
      moveCount: state.moves.length,
      durationMs,
      startedAt: state.startedAt ?? state.createdAt,
      finishedAt,
      createdAt: new Date().toISOString(),
    };

    try {
      await db.create('gameHistory', record);
      // Statistics are updated sequentially: the db service queues writes anyway,
      // and a partial failure here must not abort the rest.
      for (const player of results) {
        await userService.applyGameResult(player.id, {
          won: player.id === winnerId,
          cardsPlayed: player.cardsPlayed,
          unoCalls: player.unoCalls,
          points: player.isWinner ? this.winnerPoints(results) : 0,
        });
      }
      logger.info('Game history saved', { gameId: state.gameId, winner: winner?.username ?? 'none' });
      return record;
    } catch (error) {
      logger.error('Could not save game history', {
        gameId: state.gameId,
        message: (error as Error).message,
      });
      return null;
    }
  }

  /** The winner scores the total of everyone else's remaining cards. */
  private winnerPoints(results: GameResultPlayer[]): number {
    return results.filter((player) => !player.isWinner).reduce((total, player) => total + player.points, 0);
  }

  /** Keeps history records bounded - a long game can produce hundreds of moves. */
  private trimMoves(moves: GameMove[], limit = 400): GameMove[] {
    return moves.length <= limit ? moves : moves.slice(moves.length - limit);
  }

  async listForUser(userId: string, limit = 20): Promise<GameHistoryRecord[]> {
    const rows = await db.list<GameHistoryRecord>('gameHistory', { _sort: 'finishedAt', _order: 'desc' });
    return rows.filter((row) => row.playerIds?.includes(userId)).slice(0, limit);
  }

  async listAll(limit = 50): Promise<GameHistoryRecord[]> {
    const rows = await db.list<GameHistoryRecord>('gameHistory', { _sort: 'finishedAt', _order: 'desc' });
    return rows.slice(0, limit);
  }

  async findById(id: string): Promise<GameHistoryRecord | null> {
    return db.findById<GameHistoryRecord>('gameHistory', id);
  }
}

export const historyService = new HistoryService();
