import type { GameHistoryRecord } from '../models/game.model';
import type { LeaderboardEntry, UserRecord } from '../models/user.model';
import { db } from './db.service';

export type LeaderboardWindow = 'all' | 'monthly' | 'weekly';

interface Tally {
  userId: string;
  username: string;
  avatar: string;
  gamesPlayed: number;
  gamesWon: number;
  unoCalls: number;
  points: number;
}

const CACHE_TTL_MS = 10_000;

/**
 * There is no database to aggregate for us, so the board is derived from the
 * persisted game history on demand and cached briefly. That keeps every window
 * (all time / monthly / weekly) consistent with the same source of truth.
 */
class LeaderboardService {
  private cache = new Map<string, { at: number; entries: LeaderboardEntry[] }>();

  async get(window: LeaderboardWindow = 'all', limit = 50): Promise<LeaderboardEntry[]> {
    const key = `${window}:${limit}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.entries;

    const [history, users] = await Promise.all([
      db.list<GameHistoryRecord>('gameHistory'),
      db.list<UserRecord>('users'),
    ]);

    const since = this.since(window);
    const profiles = new Map(users.map((user) => [user.id, user]));
    const tallies = new Map<string, Tally>();

    for (const game of history) {
      const finishedAt = Date.parse(game.finishedAt ?? game.createdAt);
      if (since && (!Number.isFinite(finishedAt) || finishedAt < since)) continue;

      for (const player of game.players ?? []) {
        const profile = profiles.get(player.id);
        const tally: Tally = tallies.get(player.id) ?? {
          userId: player.id,
          username: profile?.username ?? player.username,
          avatar: profile?.avatar ?? 'fox',
          gamesPlayed: 0,
          gamesWon: 0,
          unoCalls: 0,
          points: 0,
        };
        tally.gamesPlayed += 1;
        tally.unoCalls += player.unoCalls ?? 0;
        if (player.id === game.winnerId) {
          tally.gamesWon += 1;
          tally.points += (game.players ?? [])
            .filter((other) => other.id !== player.id)
            .reduce((total, other) => total + (other.points ?? 0), 0);
        }
        tallies.set(player.id, tally);
      }
    }

    const entries = [...tallies.values()]
      .map((tally) => ({
        ...tally,
        winRate: tally.gamesPlayed ? Math.round((tally.gamesWon / tally.gamesPlayed) * 1000) / 10 : 0,
      }))
      .sort(
        (a, b) =>
          b.gamesWon - a.gamesWon ||
          b.winRate - a.winRate ||
          b.points - a.points ||
          a.username.localeCompare(b.username),
      )
      .slice(0, limit)
      .map<LeaderboardEntry>((tally, index) => ({
        rank: index + 1,
        userId: tally.userId,
        username: tally.username,
        avatar: tally.avatar,
        gamesPlayed: tally.gamesPlayed,
        gamesWon: tally.gamesWon,
        winRate: tally.winRate,
        unoCalls: tally.unoCalls,
        points: tally.points,
      }));

    this.cache.set(key, { at: Date.now(), entries });
    return entries;
  }

  /** Drops the cache so a freshly finished game shows up immediately. */
  invalidate(): void {
    this.cache.clear();
  }

  private since(window: LeaderboardWindow): number | null {
    const now = Date.now();
    if (window === 'weekly') return now - 7 * 24 * 60 * 60 * 1000;
    if (window === 'monthly') return now - 30 * 24 * 60 * 60 * 1000;
    return null;
  }
}

export const leaderboardService = new LeaderboardService();
