import { z } from 'zod';
import { config } from '../config/env';
import { PLAYABLE_COLORS } from './card.model';
import { GAME_MODES } from './room.model';

export const usernameSchema = z
  .string({ required_error: 'Username is required.' })
  .trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(20, 'Username must be at most 20 characters.')
  .regex(/^[a-zA-Z0-9 _-]+$/, 'Use letters, numbers, spaces, hyphens or underscores.');

export const emailSchema = z
  .string({ required_error: 'Email is required.' })
  .trim()
  .min(1, 'Email is required.')
  .email('Enter a valid email address.')
  .max(120, 'That email address is too long.');

export const passwordSchema = z
  .string({ required_error: 'Password is required.' })
  .min(8, 'Password must be at least 8 characters.')
  .max(100, 'Password must be at most 100 characters.');

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().optional(),
  })
  .refine((data) => data.confirmPassword === undefined || data.confirmPassword === data.password, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

export const updateUserSchema = z
  .object({
    username: usernameSchema.optional(),
    avatar: z.string().trim().min(1).max(32).optional(),
  })
  .refine((data) => data.username !== undefined || data.avatar !== undefined, {
    message: 'Nothing to update.',
  });

export const createRoomSchema = z.object({
  name: z.string().trim().min(3, 'Room names need at least 3 characters.').max(40, 'Room name is too long.'),
  maxPlayers: z.coerce
    .number()
    .int('Choose a whole number of players.')
    .min(2, 'A room needs at least 2 seats.')
    .max(config.game.maxPlayers, `A room can hold at most ${config.game.maxPlayers} players.`),
  mode: z.enum(GAME_MODES as unknown as [string, ...string[]]).default('classic'),
  isPrivate: z.coerce.boolean().default(true),
});

export const roomCodeSchema = z
  .string({ required_error: 'Enter a room code.' })
  .trim()
  .toUpperCase()
  .length(6, 'Room codes are 6 characters.')
  .regex(/^[A-Z0-9]+$/, 'Room codes use letters and numbers only.');

export const joinRoomSchema = z.object({ roomCode: roomCodeSchema });

export const updateRoomSchema = z
  .object({
    name: z.string().trim().min(3).max(40).optional(),
    isPrivate: z.coerce.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.isPrivate !== undefined, { message: 'Nothing to update.' });

export const leaderboardQuerySchema = z.object({
  window: z.enum(['all', 'monthly', 'weekly']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const historyQuerySchema = z.object({
  userId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const colorSchema = z.enum(PLAYABLE_COLORS as unknown as [string, ...string[]], {
  errorMap: () => ({ message: 'Pick red, yellow, green or blue.' }),
});

/* ------------------------------ socket payloads ----------------------------- */

export const socketGameIdSchema = z.object({ gameId: z.string().trim().min(1) });
export const socketRoomSchema = z.object({ roomCode: roomCodeSchema });
export const socketPlayCardSchema = z.object({
  gameId: z.string().trim().min(1),
  cardId: z.string().trim().min(1),
  chosenColor: colorSchema.optional(),
});
export const socketChooseColorSchema = z.object({
  gameId: z.string().trim().min(1),
  color: colorSchema,
});
export const socketChatSchema = z.object({
  roomCode: roomCodeSchema,
  text: z.string().min(1, 'Type a message first.').max(config.game.chatMaxLength),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
