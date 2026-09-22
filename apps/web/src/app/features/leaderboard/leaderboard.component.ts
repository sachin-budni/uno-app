import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideMedal, LucideTrophy } from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import type { LeaderboardEntry, LeaderboardWindow } from '../../core/models/user.models';
import { LeaderboardService } from '../../core/services/leaderboard.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyStateComponent, LoadingPanelComponent } from '../../shared/components/ui.components';

const WINDOWS: Array<{ key: LeaderboardWindow; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'weekly', label: 'Weekly' },
];

@Component({
  selector: 'app-leaderboard',
  imports: [RouterLink, AvatarComponent, EmptyStateComponent, LoadingPanelComponent, LucideMedal, LucideTrophy],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-black text-white sm:text-3xl">Leaderboard</h1>
          <p class="mt-1.5 text-sm text-ink-400">Ranked by wins, then win rate. Built from finished games.</p>
        </div>

        <div class="flex rounded-xl border border-white/10 bg-white/5 p-1" role="tablist" aria-label="Leaderboard range">
          @for (option of windows; track option.key) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="active() === option.key"
              class="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
              [class]="active() === option.key ? 'bg-brand-500 text-ink-950' : 'text-ink-300 hover:text-white'"
              (click)="select(option.key)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="panel mt-6"><app-loading-panel message="Counting the wins..." /></div>
      } @else if (entries().length === 0) {
        <div class="mt-6">
          <app-empty-state
            title="Nothing here yet"
            [message]="
              active() === 'all'
                ? 'The board fills up as soon as the first game finishes.'
                : 'No games finished in this period yet.'
            "
          >
            <svg lucideTrophy icon class="h-5 w-5" aria-hidden="true"></svg>
            <a routerLink="/lobby" class="btn-primary mt-2">Play a game</a>
          </app-empty-state>
        </div>
      } @else {
        <div class="panel mt-6 overflow-x-auto">
          <table class="w-full min-w-[34rem] text-sm">
            <caption class="sr-only">Player rankings</caption>
            <thead>
              <tr class="border-b border-white/5 text-left">
                <th scope="col" class="px-4 py-3 stat-label">Rank</th>
                <th scope="col" class="px-4 py-3 stat-label">Player</th>
                <th scope="col" class="px-4 py-3 text-right stat-label">Games</th>
                <th scope="col" class="px-4 py-3 text-right stat-label">Wins</th>
                <th scope="col" class="px-4 py-3 text-right stat-label">Win rate</th>
                <th scope="col" class="px-4 py-3 text-right stat-label">UNO calls</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              @for (entry of entries(); track entry.userId) {
                <tr [class]="isMe(entry) ? 'bg-brand-500/10' : ''">
                  <td class="px-4 py-3">
                    <span class="flex items-center gap-2 font-display font-black tabular-nums" [class]="rankTone(entry.rank)">
                      @if (entry.rank <= 3) {
                        <svg lucideMedal class="h-4 w-4" aria-hidden="true"></svg>
                      }
                      {{ entry.rank }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span class="flex items-center gap-2.5">
                      <app-avatar size="xs" [username]="entry.username" [avatar]="entry.avatar" />
                      <span class="font-semibold text-white">{{ entry.username }}</span>
                      @if (isMe(entry)) {
                        <span class="text-xs text-brand-400">you</span>
                      }
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right text-ink-300 tabular-nums">{{ entry.gamesPlayed }}</td>
                  <td class="px-4 py-3 text-right font-semibold text-uno-green tabular-nums">{{ entry.gamesWon }}</td>
                  <td class="px-4 py-3 text-right text-ink-200 tabular-nums">{{ entry.winRate }}%</td>
                  <td class="px-4 py-3 text-right text-ink-300 tabular-nums">{{ entry.unoCalls }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class LeaderboardComponent implements OnInit {
  private readonly leaderboard = inject(LeaderboardService);
  private readonly auth = inject(AuthService);

  readonly windows = WINDOWS;
  readonly active = signal<LeaderboardWindow>('all');
  readonly entries = signal<LeaderboardEntry[]>([]);
  readonly loading = signal(true);

  private readonly myId = computed(() => this.auth.userId());

  ngOnInit(): void {
    this.load();
  }

  select(window: LeaderboardWindow): void {
    if (this.active() === window) return;
    this.active.set(window);
    this.load();
  }

  isMe(entry: LeaderboardEntry): boolean {
    return entry.userId === this.myId();
  }

  rankTone(rank: number): string {
    if (rank === 1) return 'text-brand-400';
    if (rank === 2) return 'text-ink-200';
    if (rank === 3) return 'text-uno-yellow-deep';
    return 'text-ink-400';
  }

  private load(): void {
    this.loading.set(true);
    this.leaderboard.get(this.active()).subscribe({
      next: ({ entries }) => {
        this.entries.set(entries);
        this.loading.set(false);
      },
      error: () => {
        this.entries.set([]);
        this.loading.set(false);
      },
    });
  }
}
