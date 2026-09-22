import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';
import { LucideLoaderCircle, LucideX } from '@lucide/angular';

/** Inline spinner with an accessible label. */
@Component({
  selector: 'app-spinner',
  imports: [LucideLoaderCircle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-2 text-ink-300" role="status">
      <svg lucideLoaderCircle [class]="sizeClass()" class="anim-spin" aria-hidden="true"></svg>
      @if (label()) {
        <span class="text-sm">{{ label() }}</span>
      }
      <span class="sr-only">{{ label() || 'Loading' }}</span>
    </span>
  `,
})
export class SpinnerComponent {
  readonly label = input<string>('');
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  readonly sizeClass = computed(
    () => ({ sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' })[this.size()],
  );
}

/** Full-panel loading state, so a page never shows blank while it waits. */
@Component({
  selector: 'app-loading-panel',
  imports: [SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-48 flex-col items-center justify-center gap-3 py-12 text-center">
      <app-spinner size="lg" />
      <p class="text-sm text-ink-400">{{ message() }}</p>
    </div>
  `,
})
export class LoadingPanelComponent {
  readonly message = input('Loading...');
}

/** Empty state: says what is missing and what to do about it. */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      <div class="grid h-12 w-12 place-items-center rounded-full bg-white/5 text-brand-400">
        <ng-content select="[icon]" />
      </div>
      <p class="font-display text-base font-bold text-white">{{ title() }}</p>
      @if (message()) {
        <p class="max-w-sm text-sm leading-relaxed text-ink-400">{{ message() }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly message = input<string>('');
}

/** Stat tile used on the profile and lobby dashboards. */
@Component({
  selector: 'app-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel flex flex-col gap-1 p-4">
      <div class="flex items-center gap-2 text-ink-400">
        <ng-content select="[icon]" />
        <span class="stat-label">{{ label() }}</span>
      </div>
      <p class="stat-value">{{ value() }}</p>
      @if (hint()) {
        <p class="text-xs text-ink-500">{{ hint() }}</p>
      }
    </div>
  `,
})
export class StatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly hint = input<string>('');
}

/**
 * Accessible dialog: focus stays on the panel, Escape closes it, and the
 * backdrop is inert to pointer events that should not reach the table.
 */
@Component({
  selector: 'app-modal',
  imports: [LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-[110] grid place-items-center p-4">
        <div class="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" (click)="onBackdrop()" aria-hidden="true"></div>

        <div
          class="panel anim-rise relative z-10 w-full max-w-md p-6"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="title()"
          tabindex="-1"
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 class="font-display text-xl font-bold text-white">{{ title() }}</h2>
              @if (subtitle()) {
                <p class="mt-1 text-sm text-ink-400">{{ subtitle() }}</p>
              }
            </div>
            @if (dismissible()) {
              <button type="button" class="btn-ghost -mr-2 -mt-2 p-2" (click)="closed.emit()" aria-label="Close dialog">
                <svg lucideX class="h-5 w-5" aria-hidden="true"></svg>
              </button>
            }
          </div>

          <ng-content />
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  readonly open = input(false, { transform: booleanAttribute });
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly dismissible = input(true, { transform: booleanAttribute });
  readonly closed = output<void>();

  onEscape(): void {
    if (this.open() && this.dismissible()) this.closed.emit();
  }

  onBackdrop(): void {
    if (this.dismissible()) this.closed.emit();
  }
}
