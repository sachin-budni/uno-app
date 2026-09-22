import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideEye, LucideEyeOff, LucideLogIn } from '@lucide/angular';
import { AuthService } from '../../core/auth/auth.service';
import type { GameError } from '../../core/models/room.models';
import { NotificationService, friendlyError } from '../../core/services/notification.service';
import { SpinnerComponent } from '../../shared/components/ui.components';
import { AuthShellComponent } from './auth-shell.component';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, AuthShellComponent, SpinnerComponent, LucideEye, LucideEyeOff, LucideLogIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-shell title="Welcome back" subtitle="Sign in to take your seat at the table.">
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="space-y-4">
        @if (serverError(); as error) {
          <div class="rounded-xl border border-uno-red/40 bg-uno-red/10 px-4 py-3 text-sm text-uno-red" role="alert">
            {{ error }}
          </div>
        }

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
              autocomplete="current-password"
              class="input pr-12"
              [class.input-error]="invalid('password')"
              [attr.aria-invalid]="invalid('password')"
              [attr.aria-describedby]="invalid('password') ? 'password-error' : null"
              placeholder="Your password"
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
            <p id="password-error" class="field-error">Password is required.</p>
          }
        </div>

        <button type="submit" class="btn-primary btn-lg w-full" [disabled]="loading()">
          @if (loading()) {
            <app-spinner label="Signing in..." size="sm" />
          } @else {
            <svg lucideLogIn class="h-4 w-4" aria-hidden="true"></svg>
            Sign in
          }
        </button>

        <p class="pt-2 text-center text-sm text-ink-400">
          New here?
          <a routerLink="/register" class="link">Create an account</a>
        </p>
      </form>
    </app-auth-shell>
  `,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notifications = inject(NotificationService);

  readonly loading = signal(false);
  readonly showPassword = signal(false);
  readonly serverError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  invalid(field: 'email' | 'password'): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  submit(): void {
    this.serverError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const { email, password } = this.form.getRawValue();

    this.auth.login(email, password).subscribe({
      next: ({ user }) => {
        this.loading.set(false);
        this.notifications.success(`Welcome back, ${user.username}`, 'Time to play.');
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        void this.router.navigateByUrl(returnUrl && !returnUrl.includes('/login') ? returnUrl : '/lobby');
      },
      error: (error: GameError) => {
        this.loading.set(false);
        this.serverError.set(friendlyError(error?.code, error?.message));
      },
    });
  }
}
