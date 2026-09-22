export type RoomStatus = 'waiting' | 'starting' | 'playing' | 'finished' | 'closed';
export type GameMode = 'classic' | 'fast' | 'stacking';

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

export interface CreateRoomInput {
  name: string;
  maxPlayers: number;
  mode: GameMode;
  isPrivate: boolean;
}

export interface GameError {
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

export interface LobbyStats {
  onlinePlayers: number;
  activeGames: number;
  openRooms: number;
}

export const GAME_MODE_LABELS: Record<GameMode, { name: string; description: string }> = {
  classic: { name: 'Classic', description: 'Seven cards, standard rules, 30 second turns.' },
  fast: { name: 'Fast', description: 'Five cards and a 15 second turn clock.' },
  stacking: { name: 'Stacking', description: 'Answer a +2 with a +2 and pass the pile along.' },
};
