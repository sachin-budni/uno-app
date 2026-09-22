import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideDoorOpen } from '@lucide/angular';
import type { GameError } from '../../core/models/room.models';
import { NotificationService, friendlyError } from '../../core/services/notification.service';
import { RoomService } from '../../core/services/room.service';
import { SocketService } from '../../core/services/socket.service';
import { SpinnerComponent } from '../../shared/components/ui.components';

@Component({
  selector: 'app-join-room',
  imports: [ReactiveFormsModule, RouterLink, SpinnerComponent, LucideArrowLeft, LucideDoorOpen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-md px-4 py-8 sm:px-6 sm:py-10">
      <a routerLink="/lobby" class="btn-ghost mb-4 -ml-2">
        <svg lucideArrowLeft class="h-4 w-4" aria-hidden="true"></svg>
        Back to lobby
      </a>

      <h1 class="font-display text-2xl font-black text-white sm:text-3xl">Join a room</h1>
      <p class="mt-1.5 text-sm text-ink-400">Enter the six character code your host shared.</p>

      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="panel mt-6 space-y-5 p-6">
        @if (serverError(); as error) {
          <div class="rounded-xl border border-uno-red/40 bg-uno-red/10 px-4 py-3 text-sm text-uno-red" role="alert">
            {{ error }}
          </div>
        }

        <div>
          <label class="label" for="roomCode">Room code</label>
          <input
            id="roomCode"
            type="text"
            formControlName="roomCode"
            class="input text-center font-display text-2xl font-black uppercase tracking-[0.5em]"
            [class.input-error]="invalid()"
            [attr.aria-invalid]="invalid()"
            [attr.aria-describedby]="invalid() ? 'code-error' : null"
            maxlength="6"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="A7K9P2"
            (input)="normalize($event)"
          />
          @if (invalid()) {
            <p id="code-error" class="field-error">Room codes are 6 letters and numbers.</p>
          }
        </div>

        <button type="submit" class="btn-primary btn-lg w-full" [disabled]="loading()">
          @if (loading()) {
            <app-spinner label="Joining..." size="sm" />
          } @else {
            <svg lucideDoorOpen class="h-4 w-4" aria-hidden="true"></svg>
            Join room
          }
        </button>
      </form>
    </div>
  `,
})
export class JoinRoomComponent {
  private readonly fb = inject(FormBuilder);
  private readonly rooms = inject(RoomService);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly loading = signal(false);
  readonly serverError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    roomCode: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{6}$/)]],
  });

  invalid(): boolean {
    const control = this.form.controls.roomCode;
    return control.invalid && (control.touched || control.dirty);
  }

  /** Room codes are upper case and alphanumeric - fix it as the player types. */
  normalize(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (cleaned !== input.value) {
      input.value = cleaned;
      this.form.controls.roomCode.setValue(cleaned, { emitEvent: false });
    }
  }

  async submit(): Promise<void> {
    this.serverError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.socket.isConnected()) {
      this.notifications.warning('Not connected', 'Waiting for the game server. Try again in a moment.');
      return;
    }

    this.loading.set(true);
    const code = this.form.controls.roomCode.value.toUpperCase();
    try {
      await this.rooms.join(code);
      void this.router.navigate(['/room', code]);
    } catch (error) {
      const failure = error as GameError;
      this.serverError.set(friendlyError(failure?.code, failure?.message));
    } finally {
      this.loading.set(false);
    }
  }
}
