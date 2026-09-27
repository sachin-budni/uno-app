import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideRefreshCw, LucideTrophy } from '@lucide/angular';
import type { GameFinishedPayload } from '../../core/models/game.models';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { DurationPipe } from '../../shared/pipes/format.pipes';

/** End-of-game screen: who won, the final scores, and what to do next. */
@Component({
  selector: 'app-winner-overlay',
  imports: [AvatarComponent, DurationPipe, LucideRefreshCw, LucideTrophy],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result(); as summary) {
      <div class="fixed inset-0 z-[118] grid place-items-center overflow-y-auto p-4">
        <div class="absolute inset-0 bg-ink-950/90 backdrop-blur-md" aria-hidden="true"></div>

        @if (iWon()) {
          <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            @for (piece of confetti; track piece.id) {
              <span
                class="absolute top-0 h-2.5 w-2 rounded-[2px]"
                [style.left.%]="piece.left"
                [style.background-color]="piece.color"
                [style.animation]="'uno-confetti ' + piece.duration + 's linear ' + piece.delay + 's infinite'"
              ></span>
            }
          </div>
        }

        <div
          class="panel anim-rise relative z-10 w-full max-w-lg p-6 text-center sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="winner-title"
        >
          <span
            class="anim-shout mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-brand-500/20 text-brand-400"
          >
            <svg lucideTrophy class="h-8 w-8" aria-hidden="true"></svg>
          </span>

          <p class="stat-label">{{ iWon() ? 'Victory' : 'Game over' }}</p>
          <h2 id="winner-title" class="mt-1 font-display text-3xl font-black text-white">
            {{ summary.winnerUsername ?? 'No winner' }}
          </h2>
          <p class="mt-2 text-sm text-ink-400">
            {{ iWon() ? 'You won the game!' : summary.winnerUsername ? 'Better luck next round.' : 'Everyone left the table.' }}
          </p>

          <p class="mt-1 text-xs text-ink-500">Game length {{ summary.durationMs | duration }}</p>

          <ul class="mt-6 space-y-2 text-left">
            @for (player of ranked(); track player.id) {
              <li
                class="flex items-center gap-3 rounded-xl border px-4 py-3"
                [class]="player.isWinner ? 'border-brand-400/40 bg-brand-500/10' : 'border-white/5 bg-white/[0.03]'"
              >
                <app-avatar size="sm" [username]="player.username" [avatar]="player.avatar" />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-white">{{ player.username }}</p>
                  <p class="text-xs text-ink-500">
                    {{ player.cardsPlayed }} cards played &middot; {{ player.unoCalls }} UNO calls
                  </p>
                </div>
                <div class="text-right">
                  <p class="font-display text-lg font-black text-white tabular-nums">
                    {{ player.isWinner ? winnerPoints() : player.points }}
                  </p>
                  <p class="text-[11px] text-ink-500">
                    {{ player.isWinner ? 'points won' : player.cardsLeft + ' left' }}
                  </p>
                </div>
              </li>
            }
          </ul>

          <div class="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" class="btn-primary btn-lg flex-1" (click)="playAgain.emit()">
              <svg lucideRefreshCw class="h-4 w-4" aria-hidden="true"></svg>
              Play again
            </button>
            <button type="button" class="btn-secondary btn-lg flex-1" (click)="backToLobby.emit()">
              Back to lobby
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class WinnerOverlayComponent {
  readonly result = input<GameFinishedPayload | null>(null);
  readonly myPlayerId = input<string | null>(null);
  readonly playAgain = output<void>();
  readonly backToLobby = output<void>();

  readonly iWon = computed(() => !!this.myPlayerId() && this.result()?.winnerId === this.myPlayerId());

  /** Winner first, then the rest by fewest points left. */
  readonly ranked = computed(() =>
    [...(this.result()?.results ?? [])].sort(
      (a, b) => Number(b.isWinner) - Number(a.isWinner) || a.points - b.points,
    ),
  );

  /** The winner scores the total of everyone else's remaining cards. */
  readonly winnerPoints = computed(() =>
    (this.result()?.results ?? []).filter((player) => !player.isWinner).reduce((total, player) => total + player.points, 0),
  );

  readonly confetti = Array.from({ length: 36 }, (_, id) => ({
    id,
    left: Math.round(Math.random() * 100),
    color: ['#e8474d', '#f2c236', '#34b866', '#3b82e0', '#f5a623'][id % 5],
    delay: Math.round(Math.random() * 30) / 10,
    duration: 2.6 + Math.round(Math.random() * 20) / 10,
  }));
}
