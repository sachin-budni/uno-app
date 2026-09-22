import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import type { GameError } from '../models/room.models';
import { NotificationService } from '../services/notification.service';

/**
 * Turns every transport failure into the same `GameError` shape the sockets
 * use, so components have exactly one error type to handle. A 401 also ends
 * the session, because the token is no longer usable.
 */
export const errorInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  return next(request).pipe(
    catchError((response: HttpErrorResponse) => {
      const error: GameError = response.error?.error ?? {
        code: response.status === 0 ? 'NETWORK_ERROR' : 'INTERNAL_ERROR',
        message: response.status === 0 ? 'We could not reach the server.' : response.message,
      };

      if (response.status === 401 && !request.url.includes('/auth/login') && !request.url.includes('/auth/register')) {
        const wasSignedIn = auth.isAuthenticated();
        auth.logout(false);
        if (wasSignedIn) {
          notifications.warning('Session ended', 'Please sign in again to keep playing.');
          void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
        }
      }

      if (error.code === 'PERSISTENCE_UNAVAILABLE' || error.code === 'NETWORK_ERROR') {
        notifications.fromError(error, 'Connection problem');
      }

      return throwError(() => error);
    }),
  );
};
