import bcrypt from 'bcryptjs';
import { config } from '../config/env';
import { db } from './db.service';
import { EMPTY_STATS, type UserRecord, type UserStats } from '../models/user.model';
import { ERROR_CODES, badRequest, conflict, notFound, unauthorized } from '../utils/errors';
import { newId } from '../utils/random';
import { sanitizeAvatar, sanitizeUsername } from '../utils/sanitize';

export const AVATAR_KEYS = [
  'fox',
  'panda',
  'tiger',
  'owl',
  'wolf',
  'koala',
  'otter',
  'hawk',
  'lynx',
  'raven',
  'bison',
  'crab',
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

function avatarFor(username: string): AvatarKey {
  let hash = 0;
  for (const char of username) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  return AVATAR_KEYS[hash % AVATAR_KEYS.length];
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

class UserService {
  async findById(id: string): Promise<UserRecord | null> {
    return db.findById<UserRecord>('users', id);
  }

  async requireById(id: string): Promise<UserRecord> {
    const user = await this.findById(id);
    if (!user) throw notFound(ERROR_CODES.USER_NOT_FOUND, 'That player no longer exists.');
    return user;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return db.findOne<UserRecord>('users', { emailLower: email.trim().toLowerCase() });
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    return db.findOne<UserRecord>('users', { usernameLower: username.trim().toLowerCase() });
  }

  async listAll(): Promise<UserRecord[]> {
    return db.list<UserRecord>('users');
  }

  async register(input: RegisterInput): Promise<UserRecord> {
    const username = sanitizeUsername(input.username);
    const email = input.email.trim();
    if (!username) throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Please choose a username.');

    if (await this.findByEmail(email)) {
      throw conflict(ERROR_CODES.EMAIL_TAKEN, 'An account already uses that email address.');
    }
    if (await this.findByUsername(username)) {
      throw conflict(ERROR_CODES.USERNAME_TAKEN, 'That username is already taken.');
    }

    const now = new Date().toISOString();
    const record: UserRecord = {
      id: newId(),
      username,
      usernameLower: username.toLowerCase(),
      email,
      emailLower: email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.password, config.bcryptRounds),
      avatar: avatarFor(username),
      stats: { ...EMPTY_STATS },
      createdAt: now,
      updatedAt: now,
    };

    return db.create<UserRecord>('users', record);
  }

  async verifyCredentials(email: string, password: string): Promise<UserRecord> {
    const user = await this.findByEmail(email);
    // Compare against a dummy hash when the user is missing so that a wrong email
    // and a wrong password cost roughly the same time.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches) {
      throw unauthorized('That email and password combination is not valid.', ERROR_CODES.INVALID_CREDENTIALS);
    }
    return user;
  }

  async updateProfile(id: string, patch: { username?: string; avatar?: string }): Promise<UserRecord> {
    const user = await this.requireById(id);
    const changes: Partial<UserRecord> = { updatedAt: new Date().toISOString() };

    if (patch.username !== undefined) {
      const username = sanitizeUsername(patch.username);
      if (username.length < 3 || username.length > 20) {
        throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Usernames must be 3-20 characters.');
      }
      if (username.toLowerCase() !== user.usernameLower) {
        const existing = await this.findByUsername(username);
        if (existing && existing.id !== id) {
          throw conflict(ERROR_CODES.USERNAME_TAKEN, 'That username is already taken.');
        }
      }
      changes.username = username;
      changes.usernameLower = username.toLowerCase();
    }

    if (patch.avatar !== undefined) {
      const avatar = sanitizeAvatar(patch.avatar);
      if (!(AVATAR_KEYS as readonly string[]).includes(avatar)) {
        throw badRequest(ERROR_CODES.VALIDATION_ERROR, 'Pick one of the available avatars.');
      }
      changes.avatar = avatar;
    }

    return db.update<UserRecord>('users', id, changes);
  }

  /** Applies the outcome of one finished game to a player's lifetime statistics. */
  async applyGameResult(
    userId: string,
    result: { won: boolean; cardsPlayed: number; unoCalls: number; points: number },
  ): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;

    const previous: UserStats = { ...EMPTY_STATS, ...user.stats };
    const currentWinStreak = result.won ? previous.currentWinStreak + 1 : 0;

    const stats: UserStats = {
      gamesPlayed: previous.gamesPlayed + 1,
      gamesWon: previous.gamesWon + (result.won ? 1 : 0),
      gamesLost: previous.gamesLost + (result.won ? 0 : 1),
      unoCalls: previous.unoCalls + result.unoCalls,
      currentWinStreak,
      longestWinStreak: Math.max(previous.longestWinStreak, currentWinStreak),
      totalCardsPlayed: previous.totalCardsPlayed + result.cardsPlayed,
      totalPoints: previous.totalPoints + result.points,
    };

    await db.update<UserRecord>('users', userId, { stats, updatedAt: new Date().toISOString() });
  }
}

export const userService = new UserService();
