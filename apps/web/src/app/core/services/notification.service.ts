import { Injectable, signal } from '@angular/core';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  /** ms; 0 keeps it until dismissed. */
  duration: number;
}

/**
 * Friendly copy for every error code the server can return, so the UI never
 * shows a raw code. Unknown codes fall back to the server's own message.
 */
const ERROR_COPY: Record<string, string> = {
  VALIDATION_ERROR: 'Please check the highlighted fields.',
  NOT_AUTHORIZED: 'You need to sign in to do that.',
  INVALID_CREDENTIALS: 'That email and password combination is not valid.',
  EMAIL_TAKEN: 'An account already uses that email address.',
  USERNAME_TAKEN: 'That username is already taken.',
  USER_NOT_FOUND: 'We could not find that player.',
  TOKEN_EXPIRED: 'Your session expired. Please sign in again.',
  RATE_LIMITED: 'You are going a little too fast. Try again in a moment.',

  ROOM_NOT_FOUND: 'No open room matches that code.',
  ROOM_FULL: 'That room is already full.',
  ROOM_CLOSED: 'That room has closed.',
  ALREADY_IN_ROOM: 'You are already in that room.',
  NOT_IN_ROOM: 'You are not in that room.',
  NOT_HOST: 'Only the host can do that.',
  GAME_ALREADY_STARTED: 'That game has already started.',
  PLAYER_NOT_READY: 'Everyone needs to be ready first.',
  NOT_ENOUGH_PLAYERS: 'You need at least two players to start.',

  GAME_NOT_FOUND: 'That game is no longer running.',
  GAME_FINISHED: 'This game has already finished.',
  GAME_NOT_STARTED: 'The game has not started yet.',
  NOT_YOUR_TURN: 'Hold on - it is not your turn.',
  CARD_NOT_IN_HAND: 'That card is not in your hand.',
  INVALID_CARD: 'That card does not match the card in play.',
  INVALID_COLOR: 'Pick red, yellow, green or blue.',
  COLOR_REQUIRED: 'Choose a colour first.',
  NO_COLOR_PENDING: 'There is no colour to choose right now.',
  WILD_DRAW_FOUR_ILLEGAL: 'You can only play +4 when you hold nothing of the current colour.',
  INVALID_UNO_CALL: 'You can only call UNO on your last card.',
  MUST_RESOLVE_DRAW: 'Draw the pending cards first.',
  PLAYER_NOT_IN_GAME: 'You are not seated at that game.',

  PERSISTENCE_UNAVAILABLE: 'The data service is offline. Start JSON Server and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
  NOT_FOUND: 'We could not find what you were looking for.',
  NETWORK_ERROR: 'We could not reach the server. Check your connection.',
};

export function friendlyError(code: string | undefined, fallback?: string): string {
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  return fallback || ERROR_COPY['INTERNAL_ERROR'];
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private nextId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly toasts = signal<Toast[]>([]);

  show(kind: ToastKind, title: string, message?: string, duration = 4200): number {
    const id = ++this.nextId;
    this.toasts.update((list) => [...list, { id, kind, title, message, duration }].slice(-4));

    if (duration > 0) {
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), duration),
      );
    }
    return id;
  }

  info = (title: string, message?: string) => this.show('info', title, message);
  success = (title: string, message?: string) => this.show('success', title, message);
  warning = (title: string, message?: string) => this.show('warning', title, message);
  error = (title: string, message?: string) => this.show('error', title, message, 6000);

  /** Shows a server error with friendly copy for its code. */
  fromError(error: { code?: string; message?: string } | null | undefined, title = 'That did not work'): void {
    this.error(title, friendlyError(error?.code, error?.message));
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.toasts.set([]);
  }
}
