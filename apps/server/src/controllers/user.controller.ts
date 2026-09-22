import type { Request, Response } from 'express';
import { toPublicUser } from '../models/user.model';
import { historyService } from '../services/history.service';
import { AVATAR_KEYS, userService } from '../services/user.service';
import { forbidden } from '../utils/errors';

export async function getUser(req: Request, res: Response): Promise<void> {
  const user = await userService.requireById(req.params.id);
  const isSelf = req.auth?.sub === user.id;
  res.json({ user: toPublicUser(user, isSelf) });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  if (req.auth?.sub !== req.params.id) {
    throw forbidden('You can only edit your own profile.');
  }
  const user = await userService.updateProfile(req.params.id, req.body);
  res.json({ user: toPublicUser(user, true) });
}

/** Profile dashboard payload: stats plus the player's most recent games. */
export async function getUserProfile(req: Request, res: Response): Promise<void> {
  const user = await userService.requireById(req.params.id);
  const recentGames = await historyService.listForUser(user.id, 10);
  res.json({
    user: toPublicUser(user, req.auth?.sub === user.id),
    recentGames,
    avatars: AVATAR_KEYS,
  });
}
