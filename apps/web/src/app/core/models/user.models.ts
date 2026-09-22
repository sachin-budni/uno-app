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

export interface User {
  id: string;
  username: string;
  email?: string;
  avatar: string;
  stats: UserStats;
  winRate: number;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
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

export type LeaderboardWindow = 'all' | 'monthly' | 'weekly';

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
