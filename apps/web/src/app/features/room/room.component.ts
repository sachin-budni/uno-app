import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideCheck,
  LucideCopy,
  LucideCrown,
  LucidePlay,
  LucideUsers,
} from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import { GAME_MODE_LABELS, type GameError } from '../../core/models/room.models';
import { NotificationService } from '../../core/services/notification.service';
import { RoomService } from '../../core/services/room.service';
import { SocketService } from '../../core/services/socket.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ChatPanelComponent } from '../../shared/components/chat-panel.component';
import { LoadingPanelComponent, SpinnerComponent } from '../../shared/components/ui.components';

@Component({
  selector: 'app-room',
  imports: [
    RouterLink,
    AvatarComponent,
    ChatPanelComponent,
    LoadingPanelComponent,
    SpinnerComponent,
    LucideArrowLeft,
    LucideCheck,
    LucideCopy,
    LucideCrown,
    LucidePlay,
    LucideUsers,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <button type="button" class="btn-ghost mb-4 -ml-2" (click)="leave()">
        <svg lucideArrowLeft class="h-4 w-4" aria-hidden="true"></svg>
        Leave room
      </button>

      @if (loading()) {
        <div class="panel"><app-loading-panel message="Joining the room..." /></div>
      } @else if (notFound()) {
        <div class="panel p-8 text-center">
          <p class="font-display text-xl font-bold text-white">That room is not available</p>
          <p class="mx-auto mt-2 max-w-sm text-sm text-ink-400">
            It may have closed, filled up, or the game already started.
          </p>
          <a routerLink="/lobby" class="btn-primary mt-5">Back to lobby</a>
        </div>
      } @else if (rooms.room(); as room) {
        <div class="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <!-- header -->
            <div class="panel p-6">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="min-w-0">
                  <h1 class="font-display text-2xl font-black text-white">{{ room.name }}</h1>
                  <p class="mt-1 text-sm text-ink-400">
                    {{ modeLabel() }} &middot; up to {{ room.maxPlayers }} players
                    @if (room.isPrivate) {
                      &middot; private
                    }
                  </p>
                </div>

                <div class="text-right">
                  <p class="stat-label">Room code</p>
                  <div class="mt-1 flex items-center gap-2">
                    <span class="font-display text-2xl font-black tracking-[0.3em] text-brand-400">{{ room.code }}</span>
                    <button
                      type="button"
                      class="btn-ghost p-2"
                      (click)="copyCode(room.code)"
                      [attr.aria-label]="copied() ? 'Room code copied' : 'Copy room code'"
                    >
                      @if (copied()) {
                        <svg lucideCheck class="h-4 w-4 text-uno-green" aria-hidden="true"></svg>
                      } @else {
                        <svg lucideCopy class="h-4 w-4" aria-hidden="true"></svg>
                      }
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- players -->
            <section class="panel mt-4 overflow-hidden" aria-labelledby="players-heading">
              <h2
                id="players-heading"
                class="flex items-center gap-2 border-b border-white/5 px-5 py-3 font-display text-sm font-bold uppercase tracking-wider text-ink-300"
              >
                <svg lucideUsers class="h-4 w-4" aria-hidden="true"></svg>
                Players ({{ room.players.length }}/{{ room.maxPlayers }})
              </h2>

              <ul class="divide-y divide-white/5">
                @for (player of room.players; track player.id) {
                  <li class="anim-rise flex items-center gap-3 px-5 py-4">
                    <app-avatar [username]="player.username" [avatar]="player.avatar" />
                    <div class="min-w-0 flex-1">
                      <p class="flex items-center gap-2 truncate font-semibold text-white">
                        {{ player.username }}
                        @if (player.id === auth.userId()) {
                          <span class="text-xs font-normal text-ink-500">(you)</span>
                        }
                      </p>
                      <p class="mt-0.5 flex items-center gap-1.5 text-xs">
                        <span
                          class="inline-block h-1.5 w-1.5 rounded-full"
                          [class]="player.isConnected ? 'bg-uno-green' : 'bg-ink-500'"
                        ></span>
                        <span class="text-ink-500">{{ player.isConnected ? 'Online' : 'Offline' }}</span>
                      </p>
                    </div>

                    @if (player.isHost) {
                      <span class="badge-host">
                        <svg lucideCrown class="h-3 w-3" aria-hidden="true"></svg>
                        Host
                      </span>
                    }
                    @if (player.isReady) {
                      <span class="badge-ready">Ready</span>
                    } @else {
                      <span class="badge-waiting">Not ready</span>
                    }
                  </li>
                }

                @for (slot of emptySlots(); track slot) {
                  <li class="flex items-center gap-3 px-5 py-4 opacity-50">
                    <span class="grid h-11 w-11 place-items-center rounded-full border border-dashed border-white/15">
                      <svg lucideUsers class="h-4 w-4 text-ink-500" aria-hidden="true"></svg>
                    </span>
                    <p class="text-sm text-ink-500">Waiting for a player...</p>
                  </li>
                }
              </ul>
            </section>

            <!-- actions -->
            <div class="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                class="flex-1"
                [class]="rooms.isReady() ? 'btn-secondary btn-lg' : 'btn-primary btn-lg'"
                (click)="toggleReady()"
                [disabled]="busy()"
                [attr.aria-pressed]="rooms.isReady()"
              >
                @if (rooms.isReady()) {
                  <svg lucideCheck class="h-4 w-4" aria-hidden="true"></svg>
                  You are ready
                } @else {
                  Ready up
                }
              </button>

              @if (rooms.isHost()) {
                <button type="button" class="btn-primary btn-lg flex-1" (click)="start()" [disabled]="!canStart() || busy()">
                  @if (starting()) {
                    <app-spinner label="Starting..." size="sm" />
                  } @else {
                    <svg lucidePlay class="h-4 w-4" aria-hidden="true"></svg>
                    Start game
                  }
                </button>
              }
            </div>

            @if (rooms.isHost() && !canStart()) {
              <p class="mt-2 text-center text-xs text-ink-500">
                {{ startHint() }}
              </p>
            }
            @if (!rooms.isHost()) {
              <p class="mt-2 text-center text-xs text-ink-500">
                Waiting for the host to start the game.
              </p>
            }
          </div>

          <div class="h-[26rem] lg:h-auto lg:min-h-[32rem]">
            <app-chat-panel />
          </div>
        </div>
      }
    </div>
  `,
})
export class RoomComponent implements OnInit {
  /** Bound from the :roomCode route parameter. */
  readonly roomCode = input.required<string>();

  readonly rooms = inject(RoomService);
  readonly auth = inject(AuthService);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly busy = signal(false);
  readonly starting = signal(false);
  readonly copied = signal(false);

  readonly canStart = computed(() => this.rooms.canStart());

  readonly modeLabel = computed(() => {
    const room = this.rooms.room();
    return room ? GAME_MODE_LABELS[room.mode]?.name ?? room.mode : '';
  });

  readonly emptySlots = computed(() => {
    const room = this.rooms.room();
    if (!room) return [];
    return Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }, (_, index) => index);
  });

  readonly startHint = computed(() => {
    const players = this.rooms.players();
    if (players.length < 2) return 'You need at least two players to start.';
    const waiting = players.filter((player) => !player.isReady).map((player) => player.username);
    return waiting.length ? `Waiting for ${waiting.join(', ')} to ready up.` : '';
  });

  ngOnInit(): void {
    void this.sync();
  }

  /** Joins (or re-joins) the room; a refresh lands here too. */
  private async sync(): Promise<void> {
    const code = this.roomCode().toUpperCase();
    this.loading.set(true);

    // The socket may still be connecting on a cold page load.
    for (let attempt = 0; attempt < 20 && !this.socket.isConnected(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    try {
      const room = await this.rooms.join(code);
      this.notFound.set(false);

      // Opening the room URL while our own game is running belongs at the table.
      if (room.status === 'playing' && room.gameId) {
        void this.router.navigate(['/game', room.gameId]);
        return;
      }
    } catch (error) {
      const failure = error as GameError;
      if (failure?.code === 'GAME_ALREADY_STARTED' && this.rooms.room()?.gameId) {
        void this.router.navigate(['/game', this.rooms.room()!.gameId]);
        return;
      }
      this.notFound.set(true);
      this.notifications.fromError(failure, 'Could not open that room');
    } finally {
      this.loading.set(false);
    }
  }

  async toggleReady(): Promise<void> {
    this.busy.set(true);
    try {
      await this.rooms.toggleReady();
    } catch (error) {
      this.notifications.fromError(error as GameError, 'Could not update your status');
    } finally {
      this.busy.set(false);
    }
  }

  async start(): Promise<void> {
    this.starting.set(true);
    this.busy.set(true);
    try {
      const gameId = await this.rooms.start();
      void this.router.navigate(['/game', gameId]);
    } catch (error) {
      this.notifications.fromError(error as GameError, 'Could not start the game');
    } finally {
      this.starting.set(false);
      this.busy.set(false);
    }
  }

  async leave(): Promise<void> {
    await this.rooms.leave();
    void this.router.navigate(['/lobby']);
  }

  async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
      this.notifications.success('Code copied', 'Share it with your friends.');
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.notifications.info('Copy the code', code);
    }
  }
}
