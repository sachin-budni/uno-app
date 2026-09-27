import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideArrowLeft,
  LucideLayers,
  LucideRepeat,
  LucideTimer,
  LucideUsers,
} from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import type { Card, PlayableColor } from '../../core/models/game.models';
import type { GameError } from '../../core/models/room.models';
import { GameStateService } from '../../core/services/game-state.service';
import { NotificationService } from '../../core/services/notification.service';
import { RoomService } from '../../core/services/room.service';
import { SocketService } from '../../core/services/socket.service';
import { ChatPanelComponent } from '../../shared/components/chat-panel.component';
import { GameCardComponent } from '../../shared/components/game-card.component';
import { LoadingPanelComponent } from '../../shared/components/ui.components';
import { ClockPipe } from '../../shared/pipes/format.pipes';
import { ColorPickerComponent } from './color-picker.component';
import { PlayerSeatComponent } from './player-seat.component';
import { WinnerOverlayComponent } from './winner-overlay.component';

/** Radial wash used when the active colour changes. */
const COLOR_FLASH: Record<string, string> = {
  red: 'radial-gradient(60% 50% at 50% 50%, rgb(232 71 77 / 0.55), transparent 70%)',
  yellow: 'radial-gradient(60% 50% at 50% 50%, rgb(242 194 54 / 0.55), transparent 70%)',
  green: 'radial-gradient(60% 50% at 50% 50%, rgb(52 184 102 / 0.55), transparent 70%)',
  blue: 'radial-gradient(60% 50% at 50% 50%, rgb(59 130 224 / 0.55), transparent 70%)',
  wild: 'radial-gradient(60% 50% at 50% 50%, rgb(255 255 255 / 0.25), transparent 70%)',
};

const COLOR_DOT: Record<string, string> = {
  red: 'bg-uno-red',
  yellow: 'bg-uno-yellow',
  green: 'bg-uno-green',
  blue: 'bg-uno-blue',
  wild: 'bg-ink-600',
};

@Component({
  selector: 'app-game',
  imports: [
    ChatPanelComponent,
    GameCardComponent,
    LoadingPanelComponent,
    ColorPickerComponent,
    PlayerSeatComponent,
    WinnerOverlayComponent,
    ClockPipe,
    LucideArrowLeft,
    LucideLayers,
    LucideRepeat,
    LucideTimer,
    LucideUsers,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="flex min-h-dvh flex-col">
      <!-- top bar -->
      <header class="flex items-center gap-3 border-b border-white/5 bg-ink-950/80 px-3 py-2.5 backdrop-blur-xl sm:px-5">
        <button type="button" class="btn-ghost -ml-1 p-2" (click)="leave()" aria-label="Leave the game">
          <svg lucideArrowLeft class="h-4 w-4" aria-hidden="true"></svg>
        </button>

        <span class="font-display text-sm font-black tracking-tight text-white sm:text-base">
          UNO <span class="text-brand-400">Arena</span>
        </span>

        @if (state(); as game) {
          <span class="ml-auto flex items-center gap-3 text-xs text-ink-400">
            <span class="hidden items-center gap-1.5 sm:flex">
              <svg lucideUsers class="h-3.5 w-3.5" aria-hidden="true"></svg>
              {{ game.players.length }}
            </span>
            <span class="hidden items-center gap-1.5 sm:flex" [title]="directionLabel()">
              <svg lucideRepeat class="h-3.5 w-3.5" aria-hidden="true"></svg>
              {{ directionLabel() }}
            </span>
            <span class="rounded-lg bg-white/5 px-2 py-1 font-display font-bold tracking-[0.2em] text-brand-400">
              {{ game.roomCode }}
            </span>
          </span>
        }

        <div class="sm:hidden">
          <app-chat-panel collapsible />
        </div>
      </header>

      @if (!state()) {
        <div class="grid flex-1 place-items-center">
          <app-loading-panel [message]="loadError() ?? 'Dealing the cards...'" />
        </div>
      } @else if (state(); as game) {
        <div class="flex flex-1 gap-4 p-3 sm:p-5">
          <div class="flex min-w-0 flex-1 flex-col">
            <!-- opponents -->
            <div class="flex flex-wrap items-start justify-center gap-3">
              @for (player of game.opponents; track player.id) {
                <app-player-seat [player]="player" />
              }
            </div>

            <!-- table -->
            <div class="table-felt relative my-4 flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8">
              <!-- A wash of the new colour when a wild resolves. -->
              @if (colorFlash()) {
                <span
                  class="anim-color-flash pointer-events-none absolute inset-0 z-0"
                  [style.background]="flashGradient()"
                  aria-hidden="true"
                ></span>
              }
              <!-- A light sweep across the felt as the turn moves on. -->
              @if (turnSweep()) {
                <span
                  class="anim-turn-sweep pointer-events-none absolute inset-y-0 left-0 z-0 w-1/2
                         bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  aria-hidden="true"
                ></span>
              }
              <!-- current colour + pending penalty -->
              <div class="flex items-center gap-3">
                <span class="flex items-center gap-2 rounded-full border border-white/10 bg-ink-950/60 px-3 py-1.5">
                  <span class="h-3 w-3 rounded-full" [class]="colorDot()"></span>
                  <span class="text-xs font-semibold uppercase tracking-wider text-ink-300">
                    {{ game.currentColor === 'wild' ? 'Any colour' : game.currentColor }}
                  </span>
                </span>

                @if (game.pendingDrawCount > 0) {
                  <span class="anim-penalty rounded-full bg-uno-red/20 px-3 py-1.5 text-xs font-bold text-uno-red">
                    +{{ game.pendingDrawCount }} pending
                  </span>
                }
              </div>

              <!-- piles -->
              <div class="flex items-end gap-6 sm:gap-10">
                <div class="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    class="transition"
                    [class]="canDraw() ? 'cursor-pointer hover:-translate-y-1' : 'cursor-not-allowed opacity-60'"
                    [class.anim-deck-thump]="deckThump()"
                    [disabled]="!canDraw() || busy()"
                    (click)="draw()"
                    [attr.aria-label]="'Draw a card. ' + game.deckCount + ' cards left in the deck'"
                  >
                    <app-game-card faceDown size="lg" />
                  </button>
                  <span class="flex items-center gap-1.5 text-[11px] font-semibold text-ink-400">
                    <svg lucideLayers class="h-3.5 w-3.5" aria-hidden="true"></svg>
                    {{ game.deckCount }}
                  </span>
                </div>

                <div class="flex flex-col items-center gap-2">
                  <!-- Keyed by card id: each new card gets its own node, which is
                       what lets the landing animation run every time. -->
                  <div class="relative aspect-[2/3] w-20 sm:w-24">
                    @for (entry of discardStack(); track entry.id; let index = $index; let isTop = $last) {
                      <span
                        class="absolute inset-0 transition-transform duration-300 ease-out"
                        [style.transform]="stackTransform(index)"
                        [style.zIndex]="index"
                        [style.opacity]="isTop ? 1 : 0.55"
                      >
                        <app-game-card [card]="entry" size="lg" [animate]="isTop ? playAnimation() : 'none'" />
                      </span>
                    } @empty {
                      @if (game.topCard; as top) {
                        <app-game-card [card]="top" size="lg" />
                      }
                    }
                  </div>
                  <span class="text-[11px] font-semibold text-ink-400">In play</span>
                </div>
              </div>

              <!-- turn banner -->
              <div class="flex min-h-12 flex-col items-center gap-1.5 text-center">
                @if (game.status === 'finished') {
                  <p class="font-display text-lg font-black text-brand-400">Game over</p>
                } @else if (mustChooseColor()) {
                  <p class="font-display text-lg font-black text-brand-400">Choose a colour</p>
                } @else if (waitingForColor()) {
                  <p class="text-sm text-ink-300">Waiting for a colour...</p>
                } @else if (challengeAgainstMe()) {
                  <p class="font-display text-lg font-black text-uno-red">Wild Draw Four played on you</p>
                } @else if (canPass()) {
                  <p class="font-display text-lg font-black text-brand-400">Play the card you drew, or pass</p>
                } @else if (isMyTurn()) {
                  <p class="anim-shout font-display text-xl font-black text-brand-400">YOUR TURN</p>
                  @if (secondsLeft() !== null) {
                    <p class="flex items-center gap-1.5 text-sm font-bold tabular-nums" [class]="clockTone()">
                      <svg lucideTimer class="h-4 w-4" aria-hidden="true"></svg>
                      {{ secondsLeft() | clock }}
                    </p>
                  }
                } @else {
                  <p class="text-sm text-ink-300">
                    Waiting for <span class="font-semibold text-white">{{ currentPlayerName() }}</span>
                  </p>
                  @if (secondsLeft() !== null) {
                    <p class="text-xs text-ink-500 tabular-nums">{{ secondsLeft() | clock }}</p>
                  }
                }
              </div>

              <!-- UNO shout -->
              @if (unoShout(); as shouter) {
                <div class="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
                  <span class="anim-shout font-display text-6xl font-black text-brand-400 drop-shadow-2xl sm:text-8xl">
                    UNO!
                  </span>
                  <span class="sr-only">{{ shouter }} called UNO</span>
                </div>
              }
            </div>

            <!-- my hand -->
            <section aria-labelledby="hand-heading">
              <div class="mb-2 flex items-center justify-between gap-3">
                <h2 id="hand-heading" class="stat-label">
                  Your hand ({{ game.myHand.length }})
                </h2>
                <div class="flex items-center gap-2">
                  @if (catchable(); as offender) {
                    <button
                      type="button"
                      class="btn-danger anim-turn-ring"
                      [disabled]="busy()"
                      (click)="catchUno()"
                      [attr.aria-label]="'Catch ' + offender.username + ' for not calling UNO'"
                      [title]="offender.username + ' never called UNO'"
                    >
                      Catch {{ offender.username }}!
                    </button>
                  }

                  @if (canPass()) {
                    <!-- Official rule: you drew a playable card - play it or end your turn. -->
                    <button type="button" class="btn-secondary" [disabled]="busy()" (click)="pass()" title="Pass (P)">
                      Pass
                    </button>
                  }

                  <button
                    type="button"
                    class="btn-secondary"
                    [disabled]="!canDraw() || busy()"
                    (click)="draw()"
                    title="Draw a card (D)"
                  >
                    Draw
                  </button>
                  <button
                    type="button"
                    class="btn-primary"
                    [class.anim-turn-ring]="canCallUno()"
                    [disabled]="!canCallUno() || busy()"
                    (click)="callUno()"
                    title="Call UNO (U)"
                  >
                    UNO
                  </button>
                </div>
              </div>

              <div
                class="-mx-1 flex snap-x items-end gap-1.5 overflow-x-auto px-1 pb-3 pt-4 sm:justify-center sm:gap-2"
                role="group"
                aria-label="Your cards"
              >
                @for (card of game.myHand; track card.id) {
                  <span class="shrink-0 snap-center">
                    <app-game-card
                      [card]="card"
                      selectable
                      [disabled]="!isPlayable(card) || busy()"
                      [selected]="pendingWild()?.id === card.id"
                      [animate]="'deal'"
                      (pick)="select($event)"
                    />
                  </span>
                } @empty {
                  <p class="w-full py-6 text-center text-sm text-ink-500">No cards left.</p>
                }
              </div>
            </section>
          </div>

          <!-- desktop chat -->
          <aside class="hidden w-80 shrink-0 lg:block">
            <div class="sticky top-4 h-[calc(100dvh-7rem)]">
              <app-chat-panel />
            </div>
          </aside>
        </div>
      }
    </div>

    <!-- Official Wild Draw Four: accept the four, or call the bluff. -->
    @if (challengeAgainstMe(); as challenge) {
      <div class="fixed inset-0 z-[116] grid place-items-center p-4">
        <div class="absolute inset-0 bg-ink-950/85 backdrop-blur-sm" aria-hidden="true"></div>

        <div
          class="panel anim-rise relative z-10 w-full max-w-md p-6 text-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="challenge-title"
        >
          <h2 id="challenge-title" class="font-display text-xl font-black text-white">
            {{ challenge.playedByName }} played a Wild Draw Four
          </h2>
          <p class="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
            Take the four cards, or challenge. A +4 is only legal when they held nothing of the previous
            colour - if you are right they draw four instead, but if you are wrong you draw six.
          </p>

          <div class="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" class="btn-secondary btn-lg flex-1" [disabled]="busy()" (click)="acceptDrawFour()">
              Accept +4
            </button>
            <button type="button" class="btn-primary btn-lg flex-1" [disabled]="busy()" (click)="challengeDrawFour()">
              Challenge
            </button>
          </div>
        </div>
      </div>
    }

    <app-color-picker [open]="colorPickerOpen()" (pick)="applyColor($event)" />

    <app-winner-overlay
      [result]="finished()"
      [myPlayerId]="myPlayerId()"
      (playAgain)="playAgain()"
      (backToLobby)="leave()"
    />
  `,
})
export class GameComponent implements OnInit, OnDestroy {
  /** Bound from the :gameId route parameter. */
  readonly gameId = input.required<string>();

  private readonly game = inject(GameStateService);
  private readonly rooms = inject(RoomService);
  private readonly socket = inject(SocketService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  private readonly destroyRef = inject(DestroyRef);

  readonly loadError = signal<string | null>(null);
  /** A wild card waiting for its colour before we send the play. */
  readonly pendingWild = signal<Card | null>(null);

  /* ------------------------------ animation ------------------------------- */

  readonly discardStack = this.game.discardStack;
  readonly deckThump = signal(false);
  readonly colorFlash = signal(false);
  readonly turnSweep = signal(false);

  /** Cards you played rise from your hand; everyone else's drop in from the table edge. */
  readonly playAnimation = computed<'play-mine' | 'play-theirs'>(() =>
    this.game.lastPlayWasMine() ? 'play-mine' : 'play-theirs',
  );

  readonly flashGradient = computed(() => COLOR_FLASH[this.game.currentColor()] ?? COLOR_FLASH['wild']);

  /**
   * Just the id, not the player object. `currentPlayer()` returns a fresh object
   * on every state push, so watching it directly would sweep the table on every
   * broadcast instead of only when the turn genuinely moves.
   */
  private readonly currentTurnId = computed(() => this.game.currentPlayer()?.id ?? null);

  readonly state = computed(() => {
    const value = this.game.gameState();
    if (!value) return null;
    return { ...value, opponents: this.game.opponents() };
  });

  readonly isMyTurn = this.game.isMyTurn;
  readonly canDraw = this.game.canDraw;
  readonly canCallUno = this.game.canCallUno;
  readonly busy = this.game.isBusy;
  readonly secondsLeft = this.game.secondsLeft;
  readonly finished = this.game.finished;
  readonly unoShout = this.game.unoShoutBy;
  readonly mustChooseColor = this.game.mustChooseColor;
  readonly canPass = this.game.canPass;
  readonly challengeAgainstMe = this.game.wildDrawFourAgainstMe;
  readonly catchable = this.game.catchableUnoPlayer;
  readonly waitingForColor = this.game.isWaitingForOtherColor;
  readonly myPlayerId = computed(() => this.game.gameState()?.myPlayerId ?? null);

  /** Opens for a local wild pick, or when the server says we owe a colour. */
  readonly colorPickerOpen = computed(() => !!this.pendingWild() || this.mustChooseColor());

  readonly currentPlayerName = computed(() => this.game.currentPlayer()?.username ?? 'the next player');

  readonly directionLabel = computed(() => (this.game.direction() === 'clockwise' ? 'Clockwise' : 'Reversed'));

  readonly colorDot = computed(() => COLOR_DOT[this.game.currentColor()] ?? COLOR_DOT['wild']);

  readonly clockTone = computed(() => {
    const seconds = this.secondsLeft();
    if (seconds === null) return 'text-ink-300';
    if (seconds <= 5) return 'text-uno-red';
    if (seconds <= 10) return 'text-brand-400';
    return 'text-ink-300';
  });

  constructor() {
    // Each of these is a one-shot class: it goes on, then off again after the
    // animation, so the next event can re-trigger it. Leaving the class in
    // place would mean the animation only ever ran once.
    this.pulse(() => this.game.drawPulse(), this.deckThump, 450);
    this.pulse(() => this.game.currentColor(), this.colorFlash, 700);
    this.pulse(() => this.currentTurnId(), this.turnSweep, 900);
  }

  /**
   * Flips `flag` on whenever `source` changes, then off once `duration` has
   * passed. Timers are cleared on destroy so a fast exit leaves nothing behind.
   */
  private pulse(source: () => unknown, flag: ReturnType<typeof signal<boolean>>, duration: number): void {
    let first = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    effect((onCleanup) => {
      source();
      // Skip the initial read; only real changes should animate.
      if (first) {
        first = false;
        return;
      }

      flag.set(false);
      // A frame's gap lets the browser restart the animation from the top.
      const start = setTimeout(() => flag.set(true), 16);
      timer = setTimeout(() => flag.set(false), duration + 16);

      onCleanup(() => {
        clearTimeout(start);
        clearTimeout(timer);
      });
    });

    this.destroyRef.onDestroy(() => clearTimeout(timer));
  }

  ngOnInit(): void {
    void this.load();
  }

  /** Fans the discard pile: older cards sit deeper, rotated a little. */
  stackTransform(index: number): string {
    const depth = Math.max(0, this.discardStack().length - 1 - index);
    if (depth === 0) return 'rotate(0deg)';
    return `rotate(${depth * 8 - 4}deg) translate(${depth * 3}px, ${depth * 2}px)`;
  }

  ngOnDestroy(): void {
    // Covers every way out of the table - Play again, Back to lobby, the
    // browser back button - so no game state outlives the view.
    this.pendingWild.set(null);
    this.game.reset();
  }

  private async load(): Promise<void> {
    // The socket may still be connecting on a cold load or a refresh.
    for (let attempt = 0; attempt < 30 && !this.socket.isConnected(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    try {
      await this.game.loadGame(this.gameId());
      this.loadError.set(null);
    } catch (error) {
      const failure = error as GameError;
      this.loadError.set(failure?.message ?? 'We could not load that game.');
      this.notifications.fromError(failure, 'Could not open the game');
      setTimeout(() => void this.router.navigate(['/lobby']), 2500);
    }
  }

  isPlayable(card: Card): boolean {
    return this.game.playableCardIds().has(card.id);
  }

  /** A wild needs a colour first; everything else goes straight to the server. */
  select(card: Card): void {
    if (!this.isPlayable(card)) return;
    if (card.type === 'wild' || card.type === 'wild_draw4') {
      this.pendingWild.set(card);
      return;
    }
    void this.game.play(card.id);
  }

  applyColor(color: PlayableColor): void {
    const card = this.pendingWild();
    this.pendingWild.set(null);

    if (card) void this.game.play(card.id, color);
    else if (this.mustChooseColor()) void this.game.chooseColor(color);
  }

  draw(): void {
    if (!this.canDraw()) return;
    void this.game.draw();
  }

  callUno(): void {
    if (!this.canCallUno()) return;
    void this.game.callUno();
  }

  pass(): void {
    if (!this.canPass()) return;
    void this.game.pass();
  }

  catchUno(): void {
    if (!this.catchable()) return;
    void this.game.catchUno();
  }

  acceptDrawFour(): void {
    void this.game.acceptDrawFour();
  }

  challengeDrawFour(): void {
    void this.game.challengeDrawFour();
  }

  /** Keyboard shortcuts, skipped while the player is typing in chat. */
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      this.draw();
    }
    if (event.key === 'u' || event.key === 'U') {
      event.preventDefault();
      this.callUno();
    }
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      this.pass();
    }
    if (event.key === 'c' || event.key === 'C') {
      event.preventDefault();
      this.catchUno();
    }
    if (event.key === 'Escape' && this.pendingWild()) {
      event.preventDefault();
      this.pendingWild.set(null);
    }
  }

  /** Sends the table back to the waiting room for another round. */
  async playAgain(): Promise<void> {
    const code = this.game.gameState()?.roomCode;
    this.game.reset();
    if (!code) {
      void this.router.navigate(['/lobby']);
      return;
    }

    try {
      await this.rooms.rematch();
    } catch {
      /* the room may already be gone - the waiting room will say so */
    }
    void this.router.navigate(['/room', code]);
  }

  async leave(): Promise<void> {
    const finished = this.game.isGameOver();
    this.game.reset();
    if (finished) await this.rooms.leave();
    void this.router.navigate(['/lobby']);
    void this.auth.refreshProfile().subscribe({ error: () => undefined });
  }
}
