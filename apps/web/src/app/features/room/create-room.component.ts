import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucidePlus } from '@lucide/angular';
import { GAME_MODE_LABELS, type GameError, type GameMode } from '../../core/models/room.models';
import { NotificationService } from '../../core/services/notification.service';
import { RoomService } from '../../core/services/room.service';
import { SocketService } from '../../core/services/socket.service';
import { SpinnerComponent } from '../../shared/components/ui.components';

@Component({
  selector: 'app-create-room',
  imports: [ReactiveFormsModule, RouterLink, SpinnerComponent, LucideArrowLeft, LucidePlus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <a routerLink="/lobby" class="btn-ghost mb-4 -ml-2">
        <svg lucideArrowLeft class="h-4 w-4" aria-hidden="true"></svg>
        Back to lobby
      </a>

      <h1 class="font-display text-2xl font-black text-white sm:text-3xl">Create a room</h1>
      <p class="mt-1.5 text-sm text-ink-400">Your table, your rules. We will generate a code to share.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="panel mt-6 space-y-6 p-6">
        <div>
          <label class="label" for="name">Room name</label>
          <input
            id="name"
            type="text"
            formControlName="name"
            class="input"
            [class.input-error]="invalidName()"
            [attr.aria-invalid]="invalidName()"
            placeholder="Friday night cards"
          />
          @if (invalidName()) {
            <p class="field-error">Room names are 3 to 40 characters.</p>
          }
        </div>

        <fieldset>
          <legend class="label">Maximum players</legend>
          <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Maximum players">
            @for (count of playerCounts; track count) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="form.controls.maxPlayers.value === count"
                class="rounded-xl border px-4 py-3 font-display text-lg font-bold transition"
                [class]="
                  form.controls.maxPlayers.value === count
                    ? 'border-brand-400 bg-brand-500/15 text-brand-300'
                    : 'border-white/10 bg-white/5 text-ink-300 hover:bg-white/10'
                "
                (click)="form.controls.maxPlayers.setValue(count)"
              >
                {{ count }}
              </button>
            }
          </div>
        </fieldset>

        <fieldset>
          <legend class="label">Game mode</legend>
          <div class="space-y-2" role="radiogroup" aria-label="Game mode">
            @for (mode of modes; track mode) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="form.controls.mode.value === mode"
                class="w-full rounded-xl border px-4 py-3 text-left transition"
                [class]="
                  form.controls.mode.value === mode
                    ? 'border-brand-400 bg-brand-500/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                "
                (click)="form.controls.mode.setValue(mode)"
              >
                <span class="block font-semibold text-white">{{ label(mode).name }}</span>
                <span class="mt-0.5 block text-xs text-ink-400">{{ label(mode).description }}</span>
              </button>
            }
          </div>
        </fieldset>

        <div class="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <input
            id="isPrivate"
            type="checkbox"
            formControlName="isPrivate"
            class="mt-0.5 h-4 w-4 rounded border-white/20 bg-ink-950 accent-brand-500"
          />
          <label for="isPrivate" class="cursor-pointer">
            <span class="block text-sm font-semibold text-white">Private room</span>
            <span class="mt-0.5 block text-xs text-ink-400">
              Hidden from the lobby. Only people with the code can join.
            </span>
          </label>
        </div>

        <button type="submit" class="btn-primary btn-lg w-full" [disabled]="loading()">
          @if (loading()) {
            <app-spinner label="Creating room..." size="sm" />
          } @else {
            <svg lucidePlus class="h-4 w-4" aria-hidden="true"></svg>
            Create room
          }
        </button>
      </form>
    </div>
  `,
})
export class CreateRoomComponent {
  private readonly fb = inject(FormBuilder);
  private readonly rooms = inject(RoomService);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly playerCounts = [2, 3, 4] as const;
  readonly modes: GameMode[] = ['classic', 'fast', 'stacking'];
  readonly loading = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(40)]],
    maxPlayers: [4 as number, [Validators.required]],
    mode: ['classic' as GameMode, [Validators.required]],
    isPrivate: [true],
  });

  label(mode: GameMode) {
    return GAME_MODE_LABELS[mode];
  }

  invalidName(): boolean {
    const control = this.form.controls.name;
    return control.invalid && (control.touched || control.dirty);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.socket.isConnected()) {
      this.notifications.warning('Not connected', 'Waiting for the game server. Try again in a moment.');
      return;
    }

    this.loading.set(true);
    try {
      const room = await this.rooms.create(this.form.getRawValue());
      this.notifications.success('Room created', `Share the code ${room.code} with your friends.`);
      void this.router.navigate(['/room', room.code]);
    } catch (error) {
      this.notifications.fromError(error as GameError, 'Could not create the room');
    } finally {
      this.loading.set(false);
    }
  }
}
