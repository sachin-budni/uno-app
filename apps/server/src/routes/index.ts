import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/env';
import * as auth from '../controllers/auth.controller';
import * as history from '../controllers/history.controller';
import * as rooms from '../controllers/room.controller';
import * as users from '../controllers/user.controller';
import { optionalAuth, requireAuth } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';
import { validate } from '../middleware/validate';
import {
  createRoomSchema,
  historyQuerySchema,
  leaderboardQuerySchema,
  loginSchema,
  registerSchema,
  updateRoomSchema,
  updateUserSchema,
} from '../models/schemas';
import { db } from '../services/db.service';
import { ERROR_CODES } from '../utils/errors';

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  skip: () => config.isTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many attempts. Please wait a minute and try again.' },
  },
});

export const apiRouter = Router();

/* --------------------------------- health --------------------------------- */

apiRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const persistence = await db.ping();
    res.status(persistence ? 200 : 503).json({
      status: persistence ? 'ok' : 'degraded',
      persistence: persistence ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }),
);

/* ---------------------------------- auth ---------------------------------- */

apiRouter.post('/auth/register', authLimiter, validate(registerSchema), asyncHandler(auth.register));
apiRouter.post('/auth/login', authLimiter, validate(loginSchema), asyncHandler(auth.login));
apiRouter.get('/auth/me', requireAuth, asyncHandler(auth.me));

/* ---------------------------------- users --------------------------------- */

apiRouter.get('/users/:id', optionalAuth, asyncHandler(users.getUser));
apiRouter.get('/users/:id/profile', optionalAuth, asyncHandler(users.getUserProfile));
apiRouter.patch('/users/:id', requireAuth, validate(updateUserSchema), asyncHandler(users.updateUser));

/* ---------------------------------- rooms --------------------------------- */

apiRouter.get('/rooms', requireAuth, asyncHandler(rooms.listRooms));
apiRouter.post('/rooms', requireAuth, validate(createRoomSchema), asyncHandler(rooms.createRoom));
apiRouter.get('/rooms/:id', requireAuth, asyncHandler(rooms.getRoom));
apiRouter.patch('/rooms/:id', requireAuth, validate(updateRoomSchema), asyncHandler(rooms.updateRoom));

/* ------------------------------- lobby stats ------------------------------ */

apiRouter.get('/stats/lobby', requireAuth, asyncHandler(rooms.lobbyStats));

/* -------------------------- history + leaderboard ------------------------- */

apiRouter.get('/game-history', requireAuth, validate(historyQuerySchema, 'query'), asyncHandler(history.listHistory));
apiRouter.get('/game-history/:id', requireAuth, asyncHandler(history.getHistoryEntry));
apiRouter.get(
  '/leaderboard',
  optionalAuth,
  validate(leaderboardQuerySchema, 'query'),
  asyncHandler(history.getLeaderboard),
);
