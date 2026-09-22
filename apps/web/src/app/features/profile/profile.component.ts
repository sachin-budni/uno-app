import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideCheck,
  LucideFlame,
  LucideGamepad2,
  LucideLayers,
  LucideLogOut,
  LucideTrophy,
} from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import type { GameHistoryRecord } from '../../core/models/game.models';
import type { GameError } from '../../core/models/room.models';
import { EMPTY_STATS } from '../../core/models/user.models';
import { NotificationService, friendlyError } from '../../core/services/notification.service';
import { UserService } from '../../core/services/user.service';
import { AVATAR_KEYS, AvatarComponent } from '../../shared/components/avatar.component';
import { EmptyStateComponent, LoadingPanelComponent, SpinnerComponent } from '../../shared/components/ui.components';
import { DurationPipe, TimeAgoPipe } from '../../shared/pipes/format.pipes';

@Component({
  selector: 'app-profile',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AvatarComponent,
    EmptyStateComponent,
    LoadingPanelComponent,
    SpinnerComponent,
    DurationPipe,
    TimeAgoPipe,
    LucideCheck,
    LucideFlame,
    LucideGamepad2,
    LucideLayers,
    LucideLogOut,
    LucideTrophy,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 class="font-display text-2xl font-black text-white sm:text-3xl">Your profile</h1>
      <p class="mt-1.5 text-sm text-ink-400">Your record, your name, your look.</p>

      @if (loading()) {
        <div class="panel mt-6"><app-loading-panel message="Loading your profile..." /></div>
      } @else {
        <div class="mt-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <!-- identity -->
          <section class="panel p-6" aria-labelledby="identity-heading">
            <h2 id="identity-heading" class="sr-only">Identity</h2>

            <div class="flex flex-col items-center text-center">
              <app-avatar size="xl" [username]="form.controls.username.value" [avatar]="form.controls.avatar.value" />
              <p class="mt-3 font-display text-xl font-bold text-white">{{ auth.username() }}</p>
              <p class="text-xs text-ink-500">Playing since {{ auth.currentUser()?.createdAt | timeAgo }}</p>
            </div>

            <form [formGroup]="form" (ngSubmit)="save()" novalidate class="mt-6 space-y-5">
              @if (serverError(); as error) {
                <div class="rounded-xl border border-uno-red/40 bg-uno-red/10 px-4 py-3 text-sm text-uno-red" role="alert">
                  {{ error }}
                </div>
              }

              <div>
                <label class="label" for="username">Username</label>
                <input
                  id="username"
                  type="text"
                  class="input"
                  formControlName="username"
                  [class.input-error]="invalidUsername()"
                  [attr.aria-invalid]="invalidUsername()"
                />
                @if (invalidUsername()) {
                  <p class="field-error">Usernames are 3 to 20 characters.</p>
                }
              </div>

              <fieldset>
                <legend class="label">Avatar</legend>
                <div class="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Avatar">
                  @for (key of avatars; track key) {
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="form.controls.avatar.value === key"
                      [attr.aria-label]="key + ' avatar'"
                      class="relative grid place-items-center rounded-xl p-1 transition"
                      [class]="form.controls.avatar.value === key ? 'bg-brand-500/20 ring-2 ring-brand-400' : 'hover:bg-white/5'"
                      (click)="form.controls.avatar.setValue(key)"
                    >
                      <app-avatar size="sm" [username]="auth.username()" [avatar]="key" />
                    </button>
                  }
                </div>
              </fieldset>

              <button type="submit" class="btn-primary w-full" [disabled]="saving() || form.pristine">
                @if (saving()) {
                  <app-spinner label="Saving..." size="sm" />
                } @else {
                  <svg lucideCheck class="h-4 w-4" aria-hidden="true"></svg>
                  Save changes
                }
              </button>
            </form>

            <button type="button" class="btn-danger mt-3 w-full" (click)="auth.logout()">
              <svg lucideLogOut class="h-4 w-4" aria-hidden="true"></svg>
              Sign out
            </button>
          </section>

          <!-- stats + recent games -->
          <div class="space-y-6">
            <section aria-labelledby="stats-heading">
              <h2 id="stats-heading" class="section-title mb-3">Career</h2>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div class="panel p-4">
                  <div class="flex items-center gap-2 text-ink-400">
                    <svg lucideGamepad2 class="h-4 w-4" aria-hidden="true"></svg>
                    <span class="stat-label">Played</span>
                  </div>
                  <p class="stat-value mt-1">{{ stats().gamesPlayed }}</p>
                </div>
                <div class="panel p-4">
                  <div class="flex items-center gap-2 text-uno-green">
                    <svg lucideTrophy class="h-4 w-4" aria-hidden="true"></svg>
                    <span class="stat-label">Wins</span>
                  </div>
                  <p class="stat-value mt-1 text-uno-green">{{ stats().gamesWon }}</p>
                </div>
                <div class="panel p-4">
                  <span class="stat-label">Losses</span>
                  <p class="stat-value mt-1">{{ stats().gamesLost }}</p>
                </div>
                <div class="panel p-4">
                  <span class="stat-label">Win rate</span>
                  <p class="stat-value mt-1">{{ winRate() }}%</p>
                </div>
                <div class="panel p-4">
                  <div class="flex items-center gap-2 text-brand-400">
                    <svg lucideFlame class="h-4 w-4" aria-hidden="true"></svg>
                    <span class="stat-label">Best streak</span>
                  </div>
                  <p class="stat-value mt-1">{{ stats().longestWinStreak }}</p>
                </div>
                <div class="panel p-4">
                  <span class="stat-label">UNO calls</span>
                  <p class="stat-value mt-1">{{ stats().unoCalls }}</p>
                </div>
                <div class="panel col-span-2 p-4 sm:col-span-3">
                  <div class="flex items-center gap-2 text-ink-400">
                    <svg lucideLayers class="h-4 w-4" aria-hidden="true"></svg>
                    <span class="stat-label">Cards played all time</span>
                  </div>
                  <p class="stat-value mt-1">{{ stats().totalCardsPlayed }}</p>
                </div>
              </div>
            </section>

            <section aria-labelledby="recent-heading">
              <div class="mb-3 flex items-center justify-between">
                <h2 id="recent-heading" class="section-title">Recent games</h2>
                <a routerLink="/history" class="link text-sm">See all</a>
              </div>

              @if (recentGames().length === 0) {
                <app-empty-state title="No games yet" message="Play your first game to start building a record.">
                  <svg lucideGamepad2 icon class="h-5 w-5" aria-hidden="true"></svg>
                  <a routerLink="/lobby" class="btn-primary mt-2">Find a game</a>
                </app-empty-state>
              } @else {
                <ul class="space-y-2">
                  @for (game of recentGames(); track game.id) {
                    <li>
                      <a
                        [routerLink]="['/history', game.id]"
                        class="panel flex items-center gap-3 p-4 transition hover:border-white/20"
                      >
                        <span
                          class="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black"
                          [class]="
                            game.winnerId === auth.userId()
                              ? 'bg-uno-green/15 text-uno-green'
                              : 'bg-white/5 text-ink-400'
                          "
                        >
                          {{ game.winnerId === auth.userId() ? 'W' : 'L' }}
                        </span>
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm font-semibold text-white">
                            {{ game.winnerUsername ?? 'No winner' }} won
                          </p>
                          <p class="text-xs text-ink-500">
                            {{ game.players.length }} players &middot; {{ game.durationMs | duration }}
                          </p>
                        </div>
                        <span class="shrink-0 text-xs text-ink-500">{{ game.finishedAt | timeAgo }}</span>
                      </a>
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        </div>
      }
    </div>
  `,
})
export class ProfileComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly users = inject(UserService);
  private readonly fb = inject(FormBuilder);
  private readonly notifications = inject(NotificationService);

  readonly avatars = AVATAR_KEYS;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly serverError = signal<string | null>(null);
  readonly recentGames = signal<GameHistoryRecord[]>([]);

  readonly stats = computed(() => this.auth.currentUser()?.stats ?? EMPTY_STATS);
  readonly winRate = computed(() => this.auth.currentUser()?.winRate ?? 0);

  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(20)]],
    avatar: ['fox'],
  });

  ngOnInit(): void {
    const id = this.auth.userId();
    if (!id) return;

    this.users.profile(id).subscribe({
      next: ({ user, recentGames }) => {
        this.auth.setUser(user);
        this.recentGames.set(recentGames);
        this.form.reset({ username: user.username, avatar: user.avatar });
        this.loading.set(false);
      },
      error: () => {
        const user = this.auth.currentUser();
        if (user) this.form.reset({ username: user.username, avatar: user.avatar });
        this.loading.set(false);
      },
    });
  }

  invalidUsername(): boolean {
    const control = this.form.controls.username;
    return control.invalid && (control.touched || control.dirty);
  }

  save(): void {
    this.serverError.set(null);
    const id = this.auth.userId();
    if (!id || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.users.update(id, this.form.getRawValue()).subscribe({
      next: ({ user }) => {
        this.auth.setUser(user);
        this.form.reset({ username: user.username, avatar: user.avatar });
        this.saving.set(false);
        this.notifications.success('Profile updated', 'Your changes are live.');
      },
      error: (error: GameError) => {
        this.saving.set(false);
        this.serverError.set(friendlyError(error?.code, error?.message));
      },
    });
  }
}
