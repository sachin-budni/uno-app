import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { io, type Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import type { CreateRoomInput, GameError } from '../models/room.models';
import type { PlayableColor } from '../models/game.models';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type SocketHandler = (payload: unknown) => void;

type AckResponse<T> = { ok: true; data: T } | { ok: false; error: GameError };

const ACK_TIMEOUT_MS = 8000;

/**
 * The app's only Socket.IO connection.
 *
 * Every real-time action goes through here as a *request*: the client asks to
 * play a card, and the server decides what actually happened. Nothing in this
 * file changes game state - it only sends intents and surfaces what comes back.
 */
@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private socket: Socket | null = null;
  private connectedWithToken: string | null = null;
  /** Event name -> live subscriber handlers, re-bound to every new socket. */
  private readonly listeners = new Map<string, Set<SocketHandler>>();

  readonly status = signal<ConnectionStatus>('disconnected');
  readonly lastError = signal<GameError | null>(null);
  readonly isConnected = computed(() => this.status() === 'connected');

  /** Opens the connection, or reuses the existing one. Safe to call repeatedly. */
  connect(): void {
    const token = this.auth.accessToken();
    if (!token) return;

    if (this.socket) {
      if (this.connectedWithToken === token) {
        if (!this.socket.connected) this.socket.connect();
        return;
      }
      // A different identity: tear the old socket down first.
      this.disconnect();
    }

    this.connectedWithToken = token;
    this.status.set('connecting');

    // Socket.IO callbacks fire outside Angular; run them inside so signals
    // and change detection stay in step.
    this.socket = io(environment.socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 6000,
      timeout: 10_000,
    });

    this.socket.on('connect', () => this.zone.run(() => this.status.set('connected')));
    this.socket.on('disconnect', (reason) =>
      this.zone.run(() => this.status.set(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting')),
    );
    this.socket.io.on('reconnect_attempt', () => this.zone.run(() => this.status.set('reconnecting')));
    this.socket.on('connect_error', (error: Error & { data?: { code?: string } }) =>
      this.zone.run(() => {
        this.status.set('reconnecting');
        this.lastError.set({ code: error.data?.code ?? 'NETWORK_ERROR', message: error.message });
        // A rejected identity will never succeed on retry.
        if (error.data?.code === 'NOT_AUTHORIZED' || error.data?.code === 'USER_NOT_FOUND') {
          this.disconnect();
          this.auth.logout();
        }
      }),
    );

    // Anything that subscribed before this socket existed gets bound now.
    this.attachRegisteredListeners();
  }

  /**
   * Closes the connection but keeps the listener registry, so a later
   * `connect()` (a re-login, or a different account) re-binds every subscriber.
   */
  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.connectedWithToken = null;
    this.status.set('disconnected');
  }

  /**
   * Stream of a server event, cleaned up when the subscription ends.
   *
   * Handlers are kept in a registry rather than bound straight to the live
   * socket, because subscribers appear before the socket exists: the app shell
   * calls `listen()` in its constructor, while `connect()` runs from an effect
   * afterwards. The registry also survives the socket being replaced when a
   * different player signs in.
   */
  on<T>(event: string): Observable<T> {
    return new Observable<T>((subscriber) => {
      const handler = (payload: unknown) => this.zone.run(() => subscriber.next(payload as T));

      const handlers = this.listeners.get(event) ?? new Set<SocketHandler>();
      handlers.add(handler);
      this.listeners.set(event, handlers);
      this.socket?.on(event, handler as never);

      return () => {
        handlers.delete(handler);
        this.socket?.off(event, handler as never);
      };
    });
  }

  /** Binds every registered handler to a freshly created socket. */
  private attachRegisteredListeners(): void {
    if (!this.socket) return;
    for (const [event, handlers] of this.listeners) {
      for (const handler of handlers) this.socket.on(event, handler as never);
    }
  }

  /**
   * Sends an intent and resolves with the server's acknowledgement.
   * Rejects with a `GameError`, so callers get one predictable failure shape.
   */
  emit<T = unknown>(event: string, payload: unknown = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject({ code: 'NETWORK_ERROR', message: 'You are not connected to the game server.' } satisfies GameError);
        return;
      }

      const timer = setTimeout(() => {
        reject({ code: 'NETWORK_ERROR', message: 'The server did not respond in time.' } satisfies GameError);
      }, ACK_TIMEOUT_MS);

      this.socket.emit(event, payload, (response: AckResponse<T>) => {
        clearTimeout(timer);
        this.zone.run(() => {
          if (response?.ok) resolve(response.data);
          else reject(response?.error ?? { code: 'INTERNAL_ERROR', message: 'That did not work.' });
        });
      });
    });
  }

  /* ------------------------- intent helpers (rooms) ------------------------ */

  createRoom(input: CreateRoomInput) {
    return this.emit<{ room: import('../models/room.models').Room }>('create_room', input);
  }

  joinRoom(roomCode: string) {
    return this.emit<{ room: import('../models/room.models').Room }>('join_room', { roomCode });
  }

  leaveRoom(roomCode: string) {
    return this.emit<{ left: true }>('leave_room', { roomCode });
  }

  setReady(roomCode: string, ready: boolean) {
    return this.emit<{ room: import('../models/room.models').Room }>(ready ? 'player_ready' : 'player_unready', {
      roomCode,
    });
  }

  startGame(roomCode: string) {
    return this.emit<{ gameId: string }>('start_game', { roomCode });
  }

  requestRoomState(roomCode: string) {
    return this.emit<{ room: import('../models/room.models').Room }>('request_room_state', { roomCode });
  }

  requestRematch(roomCode: string) {
    return this.emit<{ room: import('../models/room.models').Room }>('request_rematch', { roomCode });
  }

  /* ------------------------- intent helpers (game) ------------------------- */

  playCard(gameId: string, cardId: string, chosenColor?: PlayableColor) {
    return this.emit<{ accepted: true }>('play_card', { gameId, cardId, chosenColor });
  }

  drawCard(gameId: string) {
    return this.emit<{ accepted: true }>('draw_card', { gameId });
  }

  chooseColor(gameId: string, color: PlayableColor) {
    return this.emit<{ accepted: true }>('choose_color', { gameId, color });
  }

  callUno(gameId: string) {
    return this.emit<{ accepted: true }>('call_uno', { gameId });
  }

  /** Official draw rule: end the turn after declining the card you drew. */
  passTurn(gameId: string) {
    return this.emit<{ accepted: true }>('pass_turn', { gameId });
  }

  /** Catch a player who went to one card without calling UNO. */
  catchUno(gameId: string) {
    return this.emit<{ accepted: true }>('catch_uno', { gameId });
  }

  acceptDrawFour(gameId: string) {
    return this.emit<{ accepted: true }>('accept_draw_four', { gameId });
  }

  challengeDrawFour(gameId: string) {
    return this.emit<{ accepted: true }>('challenge_draw_four', { gameId });
  }

  requestGameState(gameId: string) {
    return this.emit<{ state: import('../models/game.models').ClientGameState }>('request_game_state', { gameId });
  }

  sendChatMessage(roomCode: string, text: string) {
    return this.emit<{ sent: true }>('send_chat_message', { roomCode, text });
  }

  /* ----------------------------- matchmaking ------------------------------ */

  quickMatch() {
    return this.emit<{ queued: boolean; position: number }>('quick_match', {});
  }

  cancelQuickMatch() {
    return this.emit<{ cancelled: true }>('cancel_quick_match', {});
  }
}
