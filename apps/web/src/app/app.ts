import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import {
  LucideLogOut,
  LucideScrollText,
  LucideTrophy,
  LucideUser,
  LucideWifiOff,
} from '@lucide/angular';
import { AuthService } from './core/auth/auth.service';
import { GameStateService } from './core/services/game-state.service';
import { RoomService } from './core/services/room.service';
import { SocketService } from './core/services/socket.service';
import { AvatarComponent } from './shared/components/avatar.component';
import { ToastHostComponent } from './shared/components/toast-host.component';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AvatarComponent,
    ToastHostComponent,
    LucideLogOut,
    LucideScrollText,
    LucideTrophy,
    LucideUser,
    LucideWifiOff,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="sr-only-focusable absolute left-4 top-4 z-[200] btn-primary" href="#main">Skip to main content</a>

    @if (showHeader()) {
      <header class="sticky top-0 z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-xl">
        <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <a routerLink="/lobby" class="group flex items-center gap-2.5" aria-label="UNO Arena home">
            <span class="relative grid h-9 w-9 place-items-center">
              <span class="absolute h-7 w-5 -rotate-12 rounded-md bg-uno-blue shadow"></span>
              <span class="absolute h-7 w-5 rotate-12 rounded-md bg-uno-red shadow"></span>
              <span class="relative h-3 w-3 rounded-full bg-brand-400"></span>
            </span>
            <span class="font-display text-lg font-black tracking-tight text-white">
              UNO <span class="text-brand-400">Arena</span>
            </span>
          </a>

          <nav class="ml-auto flex items-center gap-1" aria-label="Main">
            <a routerLink="/lobby" routerLinkActive="bg-white/10 text-white" class="btn-ghost hidden sm:inline-flex">
              Play
            </a>
            <a routerLink="/leaderboard" routerLinkActive="bg-white/10 text-white" class="btn-ghost" title="Leaderboard">
              <svg lucideTrophy class="h-4 w-4" aria-hidden="true"></svg>
              <span class="hidden sm:inline">Leaderboard</span>
              <span class="sr-only sm:hidden">Leaderboard</span>
            </a>
            <a routerLink="/history" routerLinkActive="bg-white/10 text-white" class="btn-ghost" title="History">
              <svg lucideScrollText class="h-4 w-4" aria-hidden="true"></svg>
              <span class="hidden sm:inline">History</span>
              <span class="sr-only sm:hidden">History</span>
            </a>
            <a routerLink="/profile" routerLinkActive="bg-white/10 text-white" class="btn-ghost" title="Profile">
              <svg lucideUser class="h-4 w-4" aria-hidden="true"></svg>
              <span class="hidden sm:inline">Profile</span>
              <span class="sr-only sm:hidden">Profile</span>
            </a>
          </nav>

          <div class="ml-1 flex items-center gap-2 border-l border-white/10 pl-3">
            <app-avatar size="sm" [username]="auth.username()" [avatar]="auth.currentUser()?.avatar" />
            <span class="hidden text-sm font-semibold text-ink-200 md:inline">{{ auth.username() }}</span>
            <button type="button" class="btn-ghost p-2" (click)="logout()" aria-label="Sign out" title="Sign out">
              <svg lucideLogOut class="h-4 w-4" aria-hidden="true"></svg>
            </button>
          </div>
        </div>
      </header>
    }

    @if (auth.isAuthenticated() && !socket.isConnected()) {
      <div
        class="flex items-center justify-center gap-2 bg-brand-500/15 px-4 py-2 text-center text-xs font-semibold text-brand-300"
        role="status"
      >
        <svg lucideWifiOff class="h-4 w-4" aria-hidden="true"></svg>
        {{ connectionMessage() }}
      </div>
    }

    <main id="main" class="min-h-[calc(100dvh-3.5rem)]">
      <router-outlet />
    </main>

    <app-toast-host />
  `,
})
export class App {
  readonly auth = inject(AuthService);
  readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  private readonly rooms = inject(RoomService);
  private readonly game = inject(GameStateService);

  private readonly url = signal(this.router.url);

  /** The game table brings its own chrome, so the global header steps aside. */
  readonly showHeader = computed(() => this.auth.isAuthenticated() && !this.url().startsWith('/game/'));

  readonly connectionMessage = computed(() =>
    this.socket.status() === 'reconnecting'
      ? 'Reconnecting to the game server...'
      : 'Not connected to the game server.',
  );

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.url.set(event.urlAfterRedirects));

    // One socket for the whole session: opened when signed in, closed on sign out.
    effect(() => {
      if (this.auth.isAuthenticated()) this.socket.connect();
      else this.socket.disconnect();
    });

    this.rooms.listen();
    this.game.listen();
  }

  logout(): void {
    this.game.reset();
    this.socket.disconnect();
    this.auth.logout();
  }
}
