import type { Request, Response } from 'express';
import { historyService } from '../services/history.service';
import { leaderboardService, type LeaderboardWindow } from '../services/leaderboard.service';
import { ERROR_CODES, forbidden, notFound } from '../utils/errors';

export async function listHistory(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { userId?: string; limit: number };
  const games = query.userId
    ? await historyService.listForUser(query.userId, query.limit)
    : await historyService.listForUser(req.auth!.sub, query.limit);
  res.json({ games });
}

export async function getHistoryEntry(req: Request, res: Response): Promise<void> {
  const game = await historyService.findById(req.params.id);
  if (!game) throw notFound(ERROR_CODES.NOT_FOUND, 'That game is not in your history.');

  // Detail view is limited to the people who actually played the game.
  if (!game.playerIds?.includes(req.auth!.sub)) {
    throw forbidden('You can only open games you took part in.');
  }
  res.json({ game });
}

export async function getLeaderboard(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { window: LeaderboardWindow; limit: number };
  const entries = await leaderboardService.get(query.window, query.limit);
  res.json({ window: query.window, entries });
}
