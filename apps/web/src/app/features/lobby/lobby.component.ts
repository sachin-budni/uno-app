import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  LucideDices,
  LucideDoorOpen,
  LucideFlame,
  LucideGamepad2,
  LucidePlus,
  LucideTrophy,
  LucideUsers,
  LucideZap,
} from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import { GAME_MODE_LABELS, type GameError, type Room } from '../../core/models/room.models';
import { NotificationService } from '../../core/services/notification.service';
import { RoomService } from '../../core/services/room.service';
import { SocketService } from '../../core/services/socket.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyStateComponent, SpinnerComponent } from '../../shared/components/ui.components';

@Component({
  selector: 'app-lobby',
  imports: [
    RouterLink,
    AvatarComponent,
    EmptyStateComponent,
    SpinnerComponent,
    LucideDices,
    LucideDoorOpen,
    LucideFlame,
    LucideGamepad2,
    LucidePlus,
    LucideTrophy,
    LucideUsers,
    LucideZap,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <!-- greeting -->
      <div class="mb-8 flex flex-wrap items-center gap-4">
        <app-avatar size="lg" [username]="auth.username()" [avatar]="auth.currentUser()?.avatar" />
        <div>
          <h1 class="font-display text-2xl font-black text-white sm:text-3xl">
            Welcome, {{ auth.username() }}
          </h1>
          <p class="mt-1 text-sm text-ink-400">Create a table, join with a code, or let us find you a game.</p>
        </div>
      </div>

      <!-- primary actions -->
      <div class="grid gap-4 sm:grid-cols-3">
        <button
          type="button"
          class="panel group relative overflow-hidden p-6 text-left transition hover:border-brand-400/40"
          (click)="quickMatch()"
          [disabled]="queueing()"
        >
          <div
            class="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-500/20 blur-2xl transition group-hover:bg-brand-500/30"
          ></div>
          <span class="mb-3 inline-grid h-11 w-11 place-items-center rounded-xl bg-brand-500/15 text-brand-400">
            <svg lucideZap class="h-5 w-5" aria-hidden="true"></svg>
          </span>
          <p class="font-display text-lg font-bold text-white">Quick match</p>
          @if (rooms.queuePosition(); as position) {
            <p class="mt-1 flex items-center gap-2 text-sm text-brand-300">
              <app-spinner size="sm" />
              In queue - position {{ position }}
            </p>
          } @else {
            <p class="mt-1 text-sm text-ink-400">Pair up with the next player looking for a game.</p>
          }
        </button>

        <a
          routerLink="/room/create"
          class="panel group relative overflow-hidden p-6 transition hover:border-uno-green/40"
        >
          <div
            class="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-uno-green/20 blur-2xl transition group-hover:bg-uno-green/30"
          ></div>
          <span class="mb-3 inline-grid h-11 w-11 place-items-center rounded-xl bg-uno-green/15 text-uno-green">
            <svg lucidePlus class="h-5 w-5" aria-hidden="true"></svg>
          </span>
          <p class="font-display text-lg font-bold text-white">Create room</p>
          <p class="mt-1 text-sm text-ink-400">Set the rules and share a six character code.</p>
        </a>

        <a routerLink="/room/join" class="panel group relative overflow-hidden p-6 transition hover:border-uno-blue/40">
          <div
            class="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-uno-blue/20 blur-2xl transition group-hover:bg-uno-blue/30"
          ></div>
          <span class="mb-3 inline-grid h-11 w-11 place-items-center rounded-xl bg-uno-blue/15 text-uno-blue">
            <svg lucideDoorOpen class="h-5 w-5" aria-hidden="true"></svg>
          </span>
          <p class="font-display text-lg font-bold text-white">Join room</p>
          <p class="mt-1 text-sm text-ink-400">Got a code from a friend? Drop it in here.</p>
        </a>
      </div>

      @if (rooms.queuePosition() !== null) {
        <div class="mt-4 flex items-center justify-between rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3">
          <p class="text-sm text-brand-200">Looking for an opponent...</p>
          <button type="button" class="btn-secondary" (click)="cancelQueue()">Cancel</button>
        </div>
      }

      <!-- live counters -->
      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <div class="panel flex items-center gap-4 p-4">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-uno-green">
            <svg lucideUsers class="h-5 w-5" aria-hidden="true"></svg>
          </span>
          <div>
            <p class="stat-label">Online players</p>
            <p class="font-display text-2xl font-extrabold text-white tabular-nums">
              {{ rooms.lobbyStats().onlinePlayers }}
            </p>
          </div>
        </div>
        <div class="panel flex items-center gap-4 p-4">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-uno-blue">
            <svg lucideGamepad2 class="h-5 w-5" aria-hidden="true"></svg>
          </span>
          <div>
            <p class="stat-label">Active games</p>
            <p class="font-display text-2xl font-extrabold text-white tabular-nums">
              {{ rooms.lobbyStats().activeGames }}
            </p>
          </div>
        </div>
        <div class="panel flex items-center gap-4 p-4">
          <span class="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-brand-400">
            <svg lucideDoorOpen class="h-5 w-5" aria-hidden="true"></svg>
          </span>
          <div>
            <p class="stat-label">Open rooms</p>
            <p class="font-display text-2xl font-extrabold text-white tabular-nums">
              {{ rooms.lobbyStats().openRooms }}
            </p>
          </div>
        </div>
      </div>

      <div class="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <!-- public rooms -->
        <section aria-labelledby="open-rooms-heading">
          <div class="mb-3 flex items-center justify-between">
            <h2 id="open-rooms-heading" class="section-title">Open tables</h2>
            <button type="button" class="btn-ghost text-xs" (click)="loadRooms()" [disabled]="loadingRooms()">
              Refresh
            </button>
          </div>

          @if (loadingRooms()) {
            <div class="panel p-6"><app-spinner label="Loading tables..." /></div>
          } @else if (openRooms().length === 0) {
            <app-empty-state title="No public tables right now" message="Create one and share the code, or try a quick match.">
              <svg lucideDices icon class="h-5 w-5" aria-hidden="true"></svg>
              <a routerLink="/room/create" class="btn-primary mt-2">Create a room</a>
            </app-empty-state>
          } @else {
            <ul class="space-y-3">
              @for (room of openRooms(); track room.id) {
                <li class="panel flex flex-wrap items-center gap-4 p-4">
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold text-white">{{ room.name }}</p>
                    <p class="mt-0.5 text-xs text-ink-400">
                      {{ modeName(room) }} &middot; {{ room.players.length }}/{{ room.maxPlayers }} players
                    </p>
                  </div>
                  <div class="flex -space-x-2">
                    @for (player of room.players; track player.id) {
                      <app-avatar size="xs" [username]="player.username" [avatar]="player.avatar" />
                    }
                  </div>
                  <button type="button" class="btn-secondary" (click)="join(room.code)">Join</button>
                </li>
              }
            </ul>
          }
        </section>

        <!-- personal stats -->
        <section aria-labelledby="your-stats-heading">
          <h2 id="your-stats-heading" class="section-title mb-3">Your statistics</h2>
          <div class="panel divide-y divide-white/5">
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-sm text-ink-400">Games played</span>
              <span class="font-display font-bold text-white tabular-nums">{{ stats().gamesPlayed }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-sm text-ink-400">Wins</span>
              <span class="font-display font-bold text-uno-green tabular-nums">{{ stats().gamesWon }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-sm text-ink-400">Win rate</span>
              <span class="font-display font-bold text-white tabular-nums">{{ winRate() }}%</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="flex items-center gap-2 text-sm text-ink-400">
                <svg lucideFlame class="h-4 w-4 text-brand-400" aria-hidden="true"></svg>
                Best streak
              </span>
              <span class="font-display font-bold text-white tabular-nums">{{ stats().longestWinStreak }}</span>
            </div>
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-sm text-ink-400">UNO calls</span>
              <span class="font-display font-bold text-white tabular-nums">{{ stats().unoCalls }}</span>
            </div>
          </div>

          <a routerLink="/leaderboard" class="btn-secondary mt-3 w-full">
            <svg lucideTrophy class="h-4 w-4" aria-hidden="true"></svg>
            See the leaderboard
          </a>
        </section>
      </div>
    </div>
  `,
})
export class LobbyComponent implements OnInit {
  readonly auth = inject(AuthService);
  readonly rooms = inject(RoomService);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly openRooms = signal<Room[]>([]);
  readonly loadingRooms = signal(true);
  readonly queueing = signal(false);

  readonly stats = computed(
    () =>
      this.auth.currentUser()?.stats ?? {
        gamesPlayed: 0,
        gamesWon: 0,
        gamesLost: 0,
        unoCalls: 0,
        longestWinStreak: 0,
        currentWinStreak: 0,
        totalCardsPlayed: 0,
        totalPoints: 0,
      },
  );

  readonly winRate = computed(() => this.auth.currentUser()?.winRate ?? 0);

  ngOnInit(): void {
    this.loadRooms();
    this.refreshStats();
    this.rooms.loadLobbyStats().subscribe({
      next: (stats) =>
        this.rooms.lobbyStats.set({
          onlinePlayers: this.rooms.lobbyStats().onlinePlayers,
          activeGames: stats.activeGames,
          openRooms: stats.openRooms,
        }),
      error: () => undefined,
    });
  }

  modeName(room: Room): string {
    return GAME_MODE_LABELS[room.mode]?.name ?? room.mode;
  }

  loadRooms(): void {
    this.loadingRooms.set(true);
    this.rooms.listOpenRooms().subscribe({
      next: ({ rooms }) => {
        this.openRooms.set(rooms);
        this.loadingRooms.set(false);
      },
      error: () => {
        this.openRooms.set([]);
        this.loadingRooms.set(false);
      },
    });
  }

  /** Keeps the dashboard honest after games played in another tab. */
  private refreshStats(): void {
    this.auth.refreshProfile().subscribe({ error: () => undefined });
  }

  async join(code: string): Promise<void> {
    try {
      await this.rooms.join(code);
      void this.router.navigate(['/room', code]);
    } catch (error) {
      this.notifications.fromError(error as GameError, 'Could not join');
      this.loadRooms();
    }
  }

  async quickMatch(): Promise<void> {
    if (!this.socket.isConnected()) {
      this.notifications.warning('Not connected', 'Waiting for the game server. Try again in a moment.');
      return;
    }
    this.queueing.set(true);
    try {
      await this.rooms.quickMatch();
    } catch (error) {
      this.notifications.fromError(error as GameError, 'Matchmaking failed');
    } finally {
      this.queueing.set(false);
    }
  }

  async cancelQueue(): Promise<void> {
    try {
      await this.rooms.cancelQuickMatch();
    } catch {
      this.rooms.queuePosition.set(null);
    }
  }
}
