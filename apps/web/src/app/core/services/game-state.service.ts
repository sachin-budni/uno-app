import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../auth/auth.service';
import type {
  Card,
  ClientGameState,
  GameAction,
  GameFinishedPayload,
  PlayableColor,
  PublicPlayer,
} from '../models/game.models';
import { describeCard } from '../models/game.models';
import type { GameError } from '../models/room.models';
import { NotificationService } from './notification.service';
import { SocketService } from './socket.service';

export interface FeedEntry {
  id: number;
  text: string;
  kind: 'play' | 'draw' | 'uno' | 'turn' | 'system';
  at: number;
}

/**
 * The client's view of the current game.
 *
 * Everything here is derived from `game_state_updated`, which the server pushes
 * after it has validated an action. The service never mutates game data itself:
 * its `play`/`draw`/`callUno` methods send intents and wait for the next state.
 */
@Injectable({ providedIn: 'root' })
export class GameStateService {
  private readonly socket = inject(SocketService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  private feedId = 0;
  private listening = false;
  private tickHandle?: ReturnType<typeof setInterval>;
  private lastTurnOwner: string | null = null;

  /* ------------------------------ raw state ------------------------------- */

  readonly gameState = signal<ClientGameState | null>(null);
  readonly finished = signal<GameFinishedPayload | null>(null);
  readonly feed = signal<FeedEntry[]>([]);
  readonly lastPlayedCardId = signal<string | null>(null);
  readonly unoShoutBy = signal<string | null>(null);
  /**
   * The last few cards that landed on the discard pile, newest last. The table
   * renders them as a real stack, and because each entry is keyed by card id a
   * newly played card gets a fresh DOM node - which is what lets its entry
   * animation actually run. Binding the animation to a reused element would
   * only ever play it once.
   */
  readonly discardStack = signal<Card[]>([]);
  /** Whether the card now showing was played by this player. Drives its direction. */
  readonly lastPlayWasMine = signal(false);
  /** Bumped every time cards are drawn, so the deck can react. */
  readonly drawPulse = signal(0);
  /** Seconds left on the current turn, or null when there is no clock. */
  readonly secondsLeft = signal<number | null>(null);
  readonly isBusy = signal(false);

  /* ---------------------------- derived state ----------------------------- */

  readonly gameId = computed(() => this.gameState()?.gameId ?? null);
  readonly players = computed<PublicPlayer[]>(() => this.gameState()?.players ?? []);
  readonly myHand = computed<Card[]>(() => this.gameState()?.myHand ?? []);
  readonly topCard = computed<Card | null>(() => this.gameState()?.topCard ?? null);
  readonly currentColor = computed(() => this.gameState()?.currentColor ?? 'wild');
  readonly status = computed(() => this.gameState()?.status ?? 'waiting');
  readonly direction = computed(() => this.gameState()?.direction ?? 'clockwise');
  readonly deckCount = computed(() => this.gameState()?.deckCount ?? 0);
  readonly pendingDrawCount = computed(() => this.gameState()?.pendingDrawCount ?? 0);
  readonly playableCardIds = computed(() => new Set(this.gameState()?.playableCardIds ?? []));

  readonly me = computed<PublicPlayer | null>(() => {
    const id = this.gameState()?.myPlayerId;
    return this.players().find((player) => player.id === id) ?? null;
  });

  readonly currentPlayer = computed<PublicPlayer | null>(() => {
    const id = this.gameState()?.currentPlayerId;
    return this.players().find((player) => player.id === id) ?? null;
  });

  readonly isMyTurn = computed(() => {
    const state = this.gameState();
    return !!state && state.status === 'playing' && state.currentPlayerId === state.myPlayerId;
  });

  /** True while *this* player still owes the table a colour choice. */
  readonly mustChooseColor = computed(() => {
    const state = this.gameState();
    return !!state && state.pendingColorChoiceBy === state.myPlayerId;
  });

  readonly isWaitingForOtherColor = computed(() => {
    const state = this.gameState();
    return !!state?.pendingColorChoiceBy && state.pendingColorChoiceBy !== state.myPlayerId;
  });

  /** A Wild Draw Four aimed at me that I have not yet accepted or challenged. */
  readonly wildDrawFourAgainstMe = computed(() => {
    const state = this.gameState();
    const pending = state?.wildDrawFour;
    return pending && pending.targetPlayerId === state?.myPlayerId ? pending : null;
  });

  readonly wildDrawFourPending = computed(() => !!this.gameState()?.wildDrawFour);

  /** The card I just drew and may still play. */
  readonly drawnCardId = computed(() => this.gameState()?.drawnCardId ?? null);
  readonly canPass = computed(() => !!this.gameState()?.canPass && this.status() === 'playing');

  /** Someone else who can still be caught for a missed UNO. */
  readonly catchableUnoPlayer = computed(() => {
    const state = this.gameState();
    const id = state?.unoVulnerablePlayerId;
    if (!state || !id || id === state.myPlayerId) return null;
    return this.players().find((player) => player.id === id) ?? null;
  });

  readonly canDraw = computed(
    () =>
      this.isMyTurn() &&
      !this.mustChooseColor() &&
      !this.wildDrawFourPending() &&
      !this.canPass() &&
      this.status() === 'playing',
  );
  readonly canCallUno = computed(() => !!this.gameState()?.canCallUno && this.status() === 'playing');

  /**
   * Opponents in seating order starting from the seat after mine, so the table
   * always reads left-to-right the way it would in person.
   */
  readonly opponents = computed<PublicPlayer[]>(() => {
    const state = this.gameState();
    if (!state) return [];
    const ordered = [...state.players].sort((a, b) => a.position - b.position);
    const myIndex = ordered.findIndex((player) => player.id === state.myPlayerId);
    if (myIndex === -1) return ordered;
    return [...ordered.slice(myIndex + 1), ...ordered.slice(0, myIndex)];
  });

  readonly isGameOver = computed(() => this.status() === 'finished');

  /* -------------------------------- wiring -------------------------------- */

  /** Subscribes to the game channel. Called once, from the app shell. */
  listen(): void {
    if (this.listening) return;
    this.listening = true;

    this.socket
      .on<{ state: ClientGameState }>('game_state_updated')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ state }) => this.applyState(state));

    this.socket
      .on<{ action: GameAction }>('card_played')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ action }) => {
        this.lastPlayedCardId.set(action.cardId ?? null);
        const label = action.card ? describeCard(action.card) : 'a card';
        this.pushFeed('play', `${action.playerName} played ${label}.`);
      });

    this.socket
      .on<{ playerId: string; username: string; count: number }>('card_drawn')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ username, count }) => {
        this.drawPulse.update((value) => value + 1);
        this.pushFeed('draw', `${username} drew ${count} card${count === 1 ? '' : 's'}.`);
      });

    this.socket
      .on<{ color: PlayableColor; playerId: string }>('color_changed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ color, playerId }) => {
        const name = this.nameOf(playerId);
        this.pushFeed('play', `${name} changed the colour to ${color}.`);
      });

    this.socket
      .on<{ playerId: string; username: string }>('uno_called')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ playerId, username }) => {
        this.unoShoutBy.set(username);
        setTimeout(() => this.unoShoutBy.set(null), 1800);
        this.pushFeed('uno', `${username} called UNO!`);
        if (playerId !== this.auth.userId()) this.notifications.warning('UNO!', `${username} is down to one card.`);
      });

    this.socket
      .on<{ playerId: string; username: string; cards: number; caughtBy?: string }>('uno_penalty')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ playerId, username, cards, caughtBy }) => {
        const by = caughtBy ? ` ${caughtBy} caught them.` : '';
        this.pushFeed('uno', `${username} forgot to call UNO and drew ${cards}.${by}`);
        if (playerId === this.auth.userId()) {
          this.notifications.warning(
            'You forgot to call UNO',
            caughtBy ? `${caughtBy} caught you - you drew ${cards} cards.` : `You drew ${cards} penalty cards.`,
          );
        }
      });

    this.socket
      .on<{ playerId: string; username: string }>('turn_passed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ username }) => this.pushFeed('turn', `${username} passed.`));

    this.socket
      .on<{
        challengerName: string;
        accusedName: string;
        wasBluff: boolean;
        cards: number;
        challengerId: string;
      }>('draw_four_challenge')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ challengerName, accusedName, wasBluff, cards }) => {
        const text = wasBluff
          ? `${challengerName} challenged ${accusedName} and was right - ${accusedName} drew ${cards}.`
          : `${challengerName} challenged ${accusedName} and was wrong - ${challengerName} drew ${cards}.`;
        this.pushFeed('system', text);
        this.notifications.info(wasBluff ? 'Bluff called' : 'Challenge failed', text);
      });

    this.socket
      .on<GameFinishedPayload>('game_finished')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => {
        this.finished.set(payload);
        this.stopClock();
        this.pushFeed('system', payload.winnerUsername ? `${payload.winnerUsername} won the game.` : 'Game over.');
      });

    this.socket
      .on<{ playerId: string; username: string }>('player_disconnected')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ username }) => {
        this.pushFeed('system', `${username} lost connection.`);
        this.notifications.warning('Player disconnected', `${username} is trying to reconnect.`);
      });

    this.socket
      .on<{ playerId: string; username: string }>('player_reconnected')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ username }) => {
        this.pushFeed('system', `${username} is back.`);
        this.notifications.success('Player reconnected', `${username} rejoined the table.`);
      });

    this.socket
      .on<GameError>('game_error')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((error) => this.notifications.fromError(error, 'Invalid move'));
  }

  /* ------------------------------- actions -------------------------------- */

  /** Asks the server to play a card. The card only moves once the server agrees. */
  async play(cardId: string, chosenColor?: PlayableColor): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.playCard(gameId, cardId, chosenColor));
  }

  async draw(): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.drawCard(gameId));
  }

  async chooseColor(color: PlayableColor): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.chooseColor(gameId, color));
  }

  async callUno(): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.callUno(gameId));
  }

  /** Ends the turn after drawing a card you have chosen not to play. */
  async pass(): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.passTurn(gameId));
  }

  /** Calls out the player who forgot to say UNO. */
  async catchUno(): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.catchUno(gameId));
  }

  async acceptDrawFour(): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.acceptDrawFour(gameId));
  }

  async challengeDrawFour(): Promise<void> {
    const gameId = this.gameId();
    if (!gameId) return;
    await this.run(() => this.socket.challengeDrawFour(gameId));
  }

  /** Pulls the authoritative state, e.g. after a reconnect or a page refresh. */
  async loadGame(gameId: string): Promise<void> {
    const { state } = await this.socket.requestGameState(gameId);
    this.applyState(state);
  }

  /** Clears everything when leaving the table. */
  reset(): void {
    this.gameState.set(null);
    this.clearForNewGame();
  }

  /**
   * Drops everything tied to a particular game while leaving the connection
   * alone. Used both when leaving the table and when state for a different
   * game arrives.
   */
  private clearForNewGame(): void {
    this.finished.set(null);
    this.feed.set([]);
    this.lastPlayedCardId.set(null);
    this.unoShoutBy.set(null);
    this.discardStack.set([]);
    this.lastPlayWasMine.set(false);
    this.drawPulse.set(0);
    this.lastTurnOwner = null;
    this.stopClock();
  }

  /* ------------------------------ internals ------------------------------- */

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.isBusy.set(true);
    try {
      await action();
    } catch (error) {
      this.notifications.fromError(error as GameError, 'Invalid move');
    } finally {
      this.isBusy.set(false);
    }
  }

  private applyState(state: ClientGameState): void {
    // A finish belongs to the game it came from. Seeing state for a different
    // game means we have moved on, so drop anything left over - otherwise the
    // winner overlay from the last game reappears on top of the new one.
    if (this.finished() && this.finished()!.gameId !== state.gameId) this.clearForNewGame();

    this.gameState.set(state);
    this.trackDiscard(state);

    if (state.status === 'playing' && state.currentPlayerId !== this.lastTurnOwner) {
      this.lastTurnOwner = state.currentPlayerId;
      if (state.currentPlayerId === state.myPlayerId) {
        this.notifications.info('Your turn', 'Play a card or draw.');
      }
    }

    if (state.status === 'finished') this.stopClock();
    else this.startClock();
  }

  /** Records a newly showing card so the table can animate it landing. */
  private trackDiscard(state: ClientGameState): void {
    const top = state.topCard;
    if (!top) return;

    const current = this.discardStack();
    if (current.at(-1)?.id === top.id) return;

    this.lastPlayWasMine.set(
      state.lastAction?.type === 'play_card' && state.lastAction.playerId === state.myPlayerId,
    );
    this.discardStack.set([...current, top].slice(-3));
  }

  private startClock(): void {
    this.tick();
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tick(), 500);
  }

  private stopClock(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.tickHandle = undefined;
    this.secondsLeft.set(null);
  }

  private tick(): void {
    const deadline = this.gameState()?.turnDeadline;
    if (!deadline) {
      this.secondsLeft.set(null);
      return;
    }
    this.secondsLeft.set(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  }

  private nameOf(playerId: string): string {
    return this.players().find((player) => player.id === playerId)?.username ?? 'Someone';
  }

  private pushFeed(kind: FeedEntry['kind'], text: string): void {
    this.feed.update((entries) => [...entries, { id: ++this.feedId, kind, text, at: Date.now() }].slice(-40));
  }
}
