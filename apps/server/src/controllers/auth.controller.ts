import type { Request, Response } from 'express';
import { toPublicUser } from '../models/user.model';
import type { LoginInput, RegisterInput } from '../models/schemas';
import { signAccessToken } from '../services/token.service';
import { userService } from '../services/user.service';
import { logger } from '../utils/logger';

export async function register(req: Request, res: Response): Promise<void> {
  const { username, email, password } = req.body as RegisterInput;
  const user = await userService.register({ username, email, password });
  logger.info('User registered', { username: user.username });

  res.status(201).json({
    accessToken: signAccessToken({ sub: user.id, username: user.username, avatar: user.avatar }),
    user: toPublicUser(user, true),
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;
  const user = await userService.verifyCredentials(email, password);
  logger.info('User signed in', { username: user.username });

  res.json({
    accessToken: signAccessToken({ sub: user.id, username: user.username, avatar: user.avatar }),
    user: toPublicUser(user, true),
  });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await userService.requireById(req.auth!.sub);
  res.json({ user: toPublicUser(user, true) });
}
