import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideCircleAlert, LucideCircleCheck, LucideInfo, LucideTriangleAlert, LucideX } from '@lucide/angular';
import { NotificationService } from '../../core/services/notification.service';

/**
 * Toast stack. Announced politely to screen readers so a player who cannot see
 * the corner of the screen still hears "Your turn" or "Invalid move".
 */
@Component({
  selector: 'app-toast-host',
  imports: [LucideCircleAlert, LucideCircleCheck, LucideInfo, LucideTriangleAlert, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="pointer-events-none fixed inset-x-0 bottom-0 z-[120] flex flex-col items-center gap-2 p-4
             sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:items-end"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      @for (toast of notifications.toasts(); track toast.id) {
        <div
          class="anim-slide-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3
                 shadow-xl backdrop-blur-xl"
          [class]="shell(toast.kind)"
        >
          <span class="mt-0.5 shrink-0" [class]="iconTone(toast.kind)">
            @switch (toast.kind) {
              @case ('success') {
                <svg lucideCircleCheck class="h-5 w-5" aria-hidden="true"></svg>
              }
              @case ('error') {
                <svg lucideCircleAlert class="h-5 w-5" aria-hidden="true"></svg>
              }
              @case ('warning') {
                <svg lucideTriangleAlert class="h-5 w-5" aria-hidden="true"></svg>
              }
              @default {
                <svg lucideInfo class="h-5 w-5" aria-hidden="true"></svg>
              }
            }
          </span>

          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-white">{{ toast.title }}</p>
            @if (toast.message) {
              <p class="mt-0.5 text-xs leading-relaxed text-ink-300">{{ toast.message }}</p>
            }
          </div>

          <button
            type="button"
            class="-mr-1 -mt-1 rounded-lg p-1 text-ink-400 transition hover:bg-white/10 hover:text-white"
            (click)="notifications.dismiss(toast.id)"
            [attr.aria-label]="'Dismiss: ' + toast.title"
          >
            <svg lucideX class="h-4 w-4" aria-hidden="true"></svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent {
  readonly notifications = inject(NotificationService);

  shell(kind: string): string {
    switch (kind) {
      case 'success':
        return 'border-uno-green/40 bg-uno-green/10';
      case 'error':
        return 'border-uno-red/40 bg-uno-red/10';
      case 'warning':
        return 'border-brand-500/40 bg-brand-500/10';
      default:
        return 'border-white/10 bg-ink-900/90';
    }
  }

  iconTone(kind: string): string {
    switch (kind) {
      case 'success':
        return 'text-uno-green';
      case 'error':
        return 'text-uno-red';
      case 'warning':
        return 'text-brand-400';
      default:
        return 'text-ink-300';
    }
  }
}
