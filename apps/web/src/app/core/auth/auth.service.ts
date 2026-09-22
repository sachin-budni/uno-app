import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import type { Observable } from 'rxjs';
import type { AuthResponse, User } from '../models/user.models';
import { ApiService } from '../services/api.service';

const TOKEN_KEY = 'uno-arena.token';
const USER_KEY = 'uno-arena.user';

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

/**
 * Holds the signed-in identity.
 *
 * The access token lives in localStorage so a refresh or a second tab keeps the
 * session. That is the usual trade-off for a token-based SPA: it survives
 * reloads but is readable by script, so the token is short lived (2h by
 * default) and the password itself is never stored anywhere on the client.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly token = signal<string | null>(readStorage(TOKEN_KEY));
  readonly currentUser = signal<User | null>(readJson<User>(USER_KEY));

  readonly isAuthenticated = computed(() => !!this.token() && !!this.currentUser());
  readonly username = computed(() => this.currentUser()?.username ?? '');
  readonly userId = computed(() => this.currentUser()?.id ?? null);

  accessToken(): string | null {
    return this.token();
  }

  register(payload: RegisterPayload): Observable<AuthResponse> {
    return this.api.post<AuthResponse>('/auth/register', payload).pipe(tap((result) => this.persist(result)));
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.api.post<AuthResponse>('/auth/login', { email, password }).pipe(tap((result) => this.persist(result)));
  }

  /** Re-reads the profile from the server; also validates the stored token. */
  refreshProfile(): Observable<{ user: User }> {
    return this.api.get<{ user: User }>('/auth/me').pipe(tap(({ user }) => this.setUser(user)));
  }

  setUser(user: User): void {
    this.currentUser.set(user);
    writeStorage(USER_KEY, JSON.stringify(user));
  }

  logout(redirect = true): void {
    this.token.set(null);
    this.currentUser.set(null);
    removeStorage(TOKEN_KEY);
    removeStorage(USER_KEY);
    if (redirect) void this.router.navigate(['/login']);
  }

  private persist(result: AuthResponse): void {
    this.token.set(result.accessToken);
    writeStorage(TOKEN_KEY, result.accessToken);
    this.setUser(result.user);
  }
}

/* Storage helpers that tolerate private mode and disabled storage. */

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const raw = readStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable - the session simply will not survive a refresh */
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
