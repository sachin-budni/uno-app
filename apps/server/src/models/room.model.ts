export type RoomStatus = 'waiting' | 'starting' | 'playing' | 'finished' | 'closed';
export type GameMode = 'classic' | 'fast' | 'stacking';

export const GAME_MODES: readonly GameMode[] = ['classic', 'fast', 'stacking'] as const;

export interface RoomPlayer {
  id: string;
  username: string;
  avatar?: string;
  isReady: boolean;
  isConnected: boolean;
  isHost: boolean;
  joinedAt: string;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  hostId: string;
  maxPlayers: number;
  mode: GameMode;
  isPrivate: boolean;
  status: RoomStatus;
  players: RoomPlayer[];
  gameId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  roomCode: string;
  userId: string;
  username: string;
  avatar?: string;
  text: string;
  system?: boolean;
  timestamp: string;
}
