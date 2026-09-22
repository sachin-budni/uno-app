import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCrown } from '@lucide/angular';
import type { GameHistoryRecord } from '../../core/models/game.models';
import { HistoryService } from '../../core/services/history.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { LoadingPanelComponent } from '../../shared/components/ui.components';
import { DurationPipe } from '../../shared/pipes/format.pipes';

const ACTION_LABEL: Record<string, string> = {
  play_card: 'played a card',
  draw_card: 'drew',
  choose_color: 'chose a colour',
  call_uno: 'called UNO',
  uno_penalty: 'took an UNO penalty',
  turn_timeout: 'ran out of time',
};

@Component({
  selector: 'app-history-detail',
  imports: [RouterLink, DatePipe, AvatarComponent, LoadingPanelComponent, DurationPipe, LucideArrowLeft, LucideCrown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <a routerLink="/history" class="btn-ghost mb-4 -ml-2">
        <svg lucideArrowLeft class="h-4 w-4" aria-hidden="true"></svg>
        Back to history
      </a>

      @if (loading()) {
        <div class="panel"><app-loading-panel message="Loading the game..." /></div>
      } @else if (!game()) {
        <div class="panel p-8 text-center">
          <p class="font-display text-xl font-bold text-white">Game not found</p>
          <p class="mt-2 text-sm text-ink-400">It may have been removed, or you were not part of it.</p>
          <a routerLink="/history" class="btn-primary mt-5">Back to history</a>
        </div>
      } @else if (game(); as record) {
        <header class="panel p-6">
          <p class="stat-label">Room {{ record.roomCode }}</p>
          <h1 class="mt-1 font-display text-2xl font-black text-white">
            {{ record.winnerUsername ?? 'No winner' }} won
          </h1>
          <dl class="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt class="stat-label">Started</dt>
              <dd class="mt-0.5 text-ink-200">{{ record.startedAt | date: 'MMM d, HH:mm' }}</dd>
            </div>
            <div>
              <dt class="stat-label">Ended</dt>
              <dd class="mt-0.5 text-ink-200">{{ record.finishedAt | date: 'MMM d, HH:mm' }}</dd>
            </div>
            <div>
              <dt class="stat-label">Duration</dt>
              <dd class="mt-0.5 text-ink-200">{{ record.durationMs | duration }}</dd>
            </div>
            <div>
              <dt class="stat-label">Moves</dt>
              <dd class="mt-0.5 text-ink-200 tabular-nums">{{ record.moveCount }}</dd>
            </div>
          </dl>
        </header>

        <section class="mt-6" aria-labelledby="players-heading">
          <h2 id="players-heading" class="section-title mb-3">Final standings</h2>
          <ul class="space-y-2">
            @for (player of ranked(); track player.id) {
              <li
                class="panel flex items-center gap-3 p-4"
                [class]="player.isWinner ? 'border-brand-400/40' : ''"
              >
                <app-avatar size="sm" [username]="player.username" [avatar]="player.avatar" />
                <div class="min-w-0 flex-1">
                  <p class="flex items-center gap-2 truncate font-semibold text-white">
                    {{ player.username }}
                    @if (player.isWinner) {
                      <svg lucideCrown class="h-4 w-4 text-brand-400" aria-hidden="true"></svg>
                    }
                  </p>
                  <p class="text-xs text-ink-500">
                    {{ player.cardsPlayed }} cards played &middot; {{ player.unoCalls }} UNO calls
                  </p>
                </div>
                <div class="text-right">
                  <p class="font-display font-bold text-white tabular-nums">{{ player.points }}</p>
                  <p class="text-[11px] text-ink-500">{{ player.cardsLeft }} cards left</p>
                </div>
              </li>
            }
          </ul>
        </section>

        @if (record.moves?.length) {
          <section class="mt-6" aria-labelledby="moves-heading">
            <h2 id="moves-heading" class="section-title mb-3">Move log</h2>
            <ol class="panel max-h-96 divide-y divide-white/5 overflow-y-auto">
              @for (move of record.moves; track $index) {
                <li class="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span class="w-8 shrink-0 text-xs text-ink-600 tabular-nums">{{ $index + 1 }}</span>
                  <span class="min-w-0 flex-1 truncate text-ink-300">
                    <span class="font-semibold text-white">{{ nameOf(move.playerId) }}</span>
                    {{ label(move.action) }}
                    @if (move.count) {
                      {{ move.count }}
                    }
                    @if (move.color) {
                      ({{ move.color }})
                    }
                  </span>
                  <span class="shrink-0 text-xs text-ink-600">{{ move.timestamp | date: 'HH:mm:ss' }}</span>
                </li>
              }
            </ol>
          </section>
        }
      }
    </div>
  `,
})
export class HistoryDetailComponent implements OnInit {
  /** Bound from the :id route parameter. */
  readonly id = input.required<string>();

  private readonly history = inject(HistoryService);

  readonly game = signal<GameHistoryRecord | null>(null);
  readonly loading = signal(true);

  readonly ranked = computed(() =>
    [...(this.game()?.players ?? [])].sort(
      (a, b) => Number(b.isWinner) - Number(a.isWinner) || a.points - b.points,
    ),
  );

  ngOnInit(): void {
    this.history.get(this.id()).subscribe({
      next: ({ game }) => {
        this.game.set(game);
        this.loading.set(false);
      },
      error: () => {
        this.game.set(null);
        this.loading.set(false);
      },
    });
  }

  nameOf(playerId: string): string {
    return this.game()?.players.find((player) => player.id === playerId)?.username ?? 'Player';
  }

  label(action: string): string {
    return ACTION_LABEL[action] ?? action;
  }
}
