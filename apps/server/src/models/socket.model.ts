import type { PlayableColor } from './card.model';
import type { ClientGameState, GameAction, GameResultPlayer } from './game.model';
import type { ChatMessage, GameMode, Room } from './room.model';

export interface SocketUser {
  id: string;
  username: string;
  avatar: string;
}

export interface GameErrorPayload {
  code: string;
  message: string;
}

/** Acknowledgement envelope used by every client -> server event. */
export type Ack<T = unknown> = (response: { ok: true; data: T } | { ok: false; error: GameErrorPayload }) => void;

/* ----------------------------- client -> server ---------------------------- */

export interface ClientToServerEvents {
  create_room: (payload: CreateRoomPayload, ack?: Ack<{ room: Room }>) => void;
  join_room: (payload: { roomCode: string }, ack?: Ack<{ room: Room }>) => void;
  leave_room: (payload: { roomCode: string }, ack?: Ack<{ left: true }>) => void;

  player_ready: (payload: { roomCode: string }, ack?: Ack<{ room: Room }>) => void;
  player_unready: (payload: { roomCode: string }, ack?: Ack<{ room: Room }>) => void;

  start_game: (payload: { roomCode: string }, ack?: Ack<{ gameId: string }>) => void;

  play_card: (
    payload: { gameId: string; cardId: string; chosenColor?: PlayableColor },
    ack?: Ack<{ accepted: true }>,
  ) => void;
  draw_card: (payload: { gameId: string }, ack?: Ack<{ accepted: true }>) => void;
  choose_color: (payload: { gameId: string; color: PlayableColor }, ack?: Ack<{ accepted: true }>) => void;
  call_uno: (payload: { gameId: string }, ack?: Ack<{ accepted: true }>) => void;
  /** Official draw rule: end your turn after drawing a card you will not play. */
  pass_turn: (payload: { gameId: string }, ack?: Ack<{ accepted: true }>) => void;
  /** Catch a player who went down to one card without calling UNO. */
  catch_uno: (payload: { gameId: string }, ack?: Ack<{ accepted: true }>) => void;
  /** Answer a Wild Draw Four played against you. */
  accept_draw_four: (payload: { gameId: string }, ack?: Ack<{ accepted: true }>) => void;
  challenge_draw_four: (payload: { gameId: string }, ack?: Ack<{ accepted: true }>) => void;

  send_chat_message: (payload: { roomCode: string; text: string }, ack?: Ack<{ sent: true }>) => void;

  request_game_state: (payload: { gameId: string }, ack?: Ack<{ state: ClientGameState }>) => void;
  request_room_state: (payload: { roomCode: string }, ack?: Ack<{ room: Room }>) => void;

  request_rematch: (payload: { roomCode: string }, ack?: Ack<{ room: Room }>) => void;

  quick_match: (payload: Record<string, never>, ack?: Ack<{ queued: boolean; position: number }>) => void;
  cancel_quick_match: (payload: Record<string, never>, ack?: Ack<{ cancelled: true }>) => void;
}

export interface CreateRoomPayload {
  name: string;
  maxPlayers: number;
  mode: GameMode;
  isPrivate: boolean;
}

/* ----------------------------- server -> client ---------------------------- */

export interface ServerToClientEvents {
  room_created: (payload: { room: Room }) => void;
  room_updated: (payload: { room: Room }) => void;
  room_closed: (payload: { roomCode: string; reason: string }) => void;
  player_joined: (payload: { room: Room; player: { id: string; username: string } }) => void;
  player_left: (payload: { room: Room; playerId: string; username: string }) => void;
  player_ready_changed: (payload: { room: Room; playerId: string; isReady: boolean }) => void;

  game_started: (payload: { gameId: string; roomCode: string }) => void;
  game_state_updated: (payload: { state: ClientGameState }) => void;

  card_played: (payload: { action: GameAction }) => void;
  card_drawn: (payload: { playerId: string; username: string; count: number }) => void;
  turn_changed: (payload: { currentPlayerId: string; deadline?: number }) => void;

  color_changed: (payload: { color: PlayableColor; playerId: string }) => void;
  uno_called: (payload: { playerId: string; username: string }) => void;
  uno_penalty: (payload: { playerId: string; username: string; cards: number; caughtBy?: string }) => void;
  turn_passed: (payload: { playerId: string; username: string }) => void;
  draw_four_challenge: (payload: {
    challengerId: string;
    challengerName: string;
    accusedId: string;
    accusedName: string;
    wasBluff: boolean;
    cards: number;
  }) => void;

  game_finished: (payload: {
    gameId: string;
    winnerId: string | null;
    winnerUsername: string | null;
    results: GameResultPlayer[];
    durationMs: number;
  }) => void;
  player_won: (payload: { gameId: string; winnerId: string; winnerUsername: string }) => void;

  player_disconnected: (payload: { playerId: string; username: string; graceSeconds: number }) => void;
  player_reconnected: (payload: { playerId: string; username: string }) => void;

  chat_message: (payload: ChatMessage) => void;

  match_found: (payload: { roomCode: string }) => void;
  queue_update: (payload: { position: number; size: number; needed: number }) => void;

  game_error: (payload: GameErrorPayload) => void;
  lobby_stats: (payload: { onlinePlayers: number; activeGames: number; openRooms: number }) => void;
}

export interface SocketData {
  user: SocketUser;
  rooms: Set<string>;
}
