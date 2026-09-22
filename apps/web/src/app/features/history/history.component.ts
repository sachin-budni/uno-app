import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideChevronRight, LucideScrollText, LucideUsers } from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import type { GameHistoryRecord } from '../../core/models/game.models';
import { HistoryService } from '../../core/services/history.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyStateComponent, LoadingPanelComponent } from '../../shared/components/ui.components';
import { DurationPipe, TimeAgoPipe } from '../../shared/pipes/format.pipes';

@Component({
  selector: 'app-history',
  imports: [
    RouterLink,
    AvatarComponent,
    EmptyStateComponent,
    LoadingPanelComponent,
    DurationPipe,
    TimeAgoPipe,
    LucideChevronRight,
    LucideScrollText,
    LucideUsers,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 class="font-display text-2xl font-black text-white sm:text-3xl">Game history</h1>
      <p class="mt-1.5 text-sm text-ink-400">Every game you have finished, newest first.</p>

      @if (loading()) {
        <div class="panel mt-6"><app-loading-panel message="Loading your games..." /></div>
      } @else if (games().length === 0) {
        <div class="mt-6">
          <app-empty-state
            title="No game history yet"
            message="Play your first game to see your history here."
          >
            <svg lucideScrollText icon class="h-5 w-5" aria-hidden="true"></svg>
            <a routerLink="/lobby" class="btn-primary mt-2">Find a game</a>
          </app-empty-state>
        </div>
      } @else {
        <ul class="mt-6 space-y-3">
          @for (game of games(); track game.id) {
            <li>
              <a
                [routerLink]="['/history', game.id]"
                class="panel flex flex-wrap items-center gap-4 p-4 transition hover:border-white/20"
              >
                <span
                  class="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-sm font-black"
                  [class]="won(game) ? 'bg-uno-green/15 text-uno-green' : 'bg-white/5 text-ink-400'"
                >
                  {{ won(game) ? 'WIN' : 'LOSS' }}
                </span>

                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold text-white">
                    {{ game.winnerUsername ?? 'No winner' }} took the game
                  </p>
                  <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                    <span class="flex items-center gap-1">
                      <svg lucideUsers class="h-3 w-3" aria-hidden="true"></svg>
                      {{ game.players.length }} players
                    </span>
                    <span>&middot;</span>
                    <span>{{ game.durationMs | duration }}</span>
                    <span>&middot;</span>
                    <span>{{ game.moveCount }} moves</span>
                    <span>&middot;</span>
                    <span>room {{ game.roomCode }}</span>
                  </p>
                </div>

                <div class="flex -space-x-2">
                  @for (player of game.players; track player.id) {
                    <app-avatar size="xs" [username]="player.username" [avatar]="player.avatar" />
                  }
                </div>

                <span class="text-xs text-ink-500">{{ game.finishedAt | timeAgo }}</span>
                <svg lucideChevronRight class="h-4 w-4 text-ink-500" aria-hidden="true"></svg>
              </a>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class HistoryComponent implements OnInit {
  private readonly history = inject(HistoryService);
  private readonly auth = inject(AuthService);

  readonly games = signal<GameHistoryRecord[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.history.list(50).subscribe({
      next: ({ games }) => {
        this.games.set(games);
        this.loading.set(false);
      },
      error: () => {
        this.games.set([]);
        this.loading.set(false);
      },
    });
  }

  won(game: GameHistoryRecord): boolean {
    return game.winnerId === this.auth.userId();
  }
}
