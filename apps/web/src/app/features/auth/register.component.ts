import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type ValidationErrors,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideEye, LucideEyeOff, LucideUserPlus } from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import type { GameError } from '../../core/models/room.models';
import { NotificationService, friendlyError } from '../../core/services/notification.service';
import { SpinnerComponent } from '../../shared/components/ui.components';
import { AuthShellComponent } from './auth-shell.component';

/** Cross-field check: the confirmation must match the password. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return !confirm || password === confirm ? null : { mismatch: true };
}

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AuthShellComponent,
    SpinnerComponent,
    LucideEye,
    LucideEyeOff,
    LucideUserPlus,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-shell title="Create your account" subtitle="Pick a name, and you are ready to deal.">
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="space-y-4">
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
            formControlName="username"
            autocomplete="nickname"
            class="input"
            [class.input-error]="invalid('username')"
            [attr.aria-invalid]="invalid('username')"
            [attr.aria-describedby]="invalid('username') ? 'username-error' : null"
            placeholder="How should we call you?"
          />
          @if (invalid('username')) {
            <p id="username-error" class="field-error">{{ usernameError() }}</p>
          }
        </div>

        <div>
          <label class="label" for="email">Email</label>
          <input
            id="email"
            type="email"
            formControlName="email"
            autocomplete="email"
            class="input"
            [class.input-error]="invalid('email')"
            [attr.aria-invalid]="invalid('email')"
            [attr.aria-describedby]="invalid('email') ? 'email-error' : null"
            placeholder="you@example.com"
          />
          @if (invalid('email')) {
            <p id="email-error" class="field-error">
              {{ form.controls.email.hasError('required') ? 'Email is required.' : 'Enter a valid email address.' }}
            </p>
          }
        </div>

        <div>
          <label class="label" for="password">Password</label>
          <div class="relative">
            <input
              id="password"
              [type]="showPassword() ? 'text' : 'password'"
              formControlName="password"
              autocomplete="new-password"
              class="input pr-12"
              [class.input-error]="invalid('password')"
              [attr.aria-invalid]="invalid('password')"
              [attr.aria-describedby]="'password-hint'"
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-400 hover:text-ink-200"
              (click)="showPassword.set(!showPassword())"
              [attr.aria-label]="showPassword() ? 'Hide password' : 'Show password'"
            >
              @if (showPassword()) {
                <svg lucideEyeOff class="h-4 w-4" aria-hidden="true"></svg>
              } @else {
                <svg lucideEye class="h-4 w-4" aria-hidden="true"></svg>
              }
            </button>
          </div>
          @if (invalid('password')) {
            <p class="field-error">Password must be at least 8 characters.</p>
          } @else {
            <p id="password-hint" class="mt-1.5 text-xs text-ink-500">At least 8 characters.</p>
          }
        </div>

        <div>
          <label class="label" for="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            [type]="showPassword() ? 'text' : 'password'"
            formControlName="confirmPassword"
            autocomplete="new-password"
            class="input"
            [class.input-error]="showMismatch()"
            [attr.aria-invalid]="showMismatch()"
            [attr.aria-describedby]="showMismatch() ? 'confirm-error' : null"
            placeholder="Type it again"
          />
          @if (showMismatch()) {
            <p id="confirm-error" class="field-error">Passwords do not match.</p>
          }
        </div>

        <button type="submit" class="btn-primary btn-lg w-full" [disabled]="loading()">
          @if (loading()) {
            <app-spinner label="Creating account..." size="sm" />
          } @else {
            <svg lucideUserPlus class="h-4 w-4" aria-hidden="true"></svg>
            Create account
          }
        </button>

        <p class="pt-2 text-center text-sm text-ink-400">
          Already have an account?
          <a routerLink="/login" class="link">Sign in</a>
        </p>
      </form>
    </app-auth-shell>
  `,
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly loading = signal(false);
  readonly showPassword = signal(false);
  readonly serverError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      username: [
        '',
        [Validators.required, Validators.minLength(3), Validators.maxLength(20), Validators.pattern(/^[a-zA-Z0-9 _-]+$/)],
      ],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  invalid(field: 'username' | 'email' | 'password'): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  showMismatch(): boolean {
    const control = this.form.controls.confirmPassword;
    return this.form.hasError('mismatch') && (control.touched || control.dirty);
  }

  usernameError(): string {
    const control = this.form.controls.username;
    if (control.hasError('required')) return 'Username is required.';
    if (control.hasError('minlength')) return 'Username must be at least 3 characters.';
    if (control.hasError('maxlength')) return 'Username must be at most 20 characters.';
    return 'Use letters, numbers, spaces, hyphens or underscores.';
  }

  submit(): void {
    this.serverError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.auth.register(this.form.getRawValue()).subscribe({
      next: ({ user }) => {
        this.loading.set(false);
        this.notifications.success(`Welcome, ${user.username}`, 'Your account is ready.');
        void this.router.navigateByUrl('/lobby');
      },
      error: (error: GameError) => {
        this.loading.set(false);
        // Field-level messages from the server land on the right inputs.
        for (const issue of error?.details ?? []) {
          const control = this.form.get(issue.field);
          control?.setErrors({ server: issue.message });
          control?.markAsTouched();
        }
        this.serverError.set(friendlyError(error?.code, error?.message));
      },
    });
  }
}
