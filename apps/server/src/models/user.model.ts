export interface UserStats {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  unoCalls: number;
  longestWinStreak: number;
  currentWinStreak: number;
  totalCardsPlayed: number;
  totalPoints: number;
}

export interface UserRecord {
  id: string;
  username: string;
  usernameLower: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  avatar: string;
  stats: UserStats;
  createdAt: string;
  updatedAt: string;
}

/** Everything that leaves the server. Never includes passwordHash. */
export interface PublicUser {
  id: string;
  username: string;
  email?: string;
  avatar: string;
  stats: UserStats;
  winRate: number;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  unoCalls: number;
  points: number;
}

export const EMPTY_STATS: UserStats = {
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  unoCalls: 0,
  longestWinStreak: 0,
  currentWinStreak: 0,
  totalCardsPlayed: 0,
  totalPoints: 0,
};

export function winRateOf(stats: UserStats): number {
  if (!stats.gamesPlayed) return 0;
  return Math.round((stats.gamesWon / stats.gamesPlayed) * 1000) / 10;
}

export function toPublicUser(user: UserRecord, includeEmail = false): PublicUser {
  const stats: UserStats = { ...EMPTY_STATS, ...user.stats };
  return {
    id: user.id,
    username: user.username,
    ...(includeEmail ? { email: user.email } : {}),
    avatar: user.avatar,
    stats,
    winRate: winRateOf(stats),
    createdAt: user.createdAt,
  };
}
