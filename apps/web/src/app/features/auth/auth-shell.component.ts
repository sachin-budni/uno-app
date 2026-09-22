import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Shared frame for the sign-in and sign-up screens. */
@Component({
  selector: 'app-auth-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6">
      <div class="w-full max-w-md">
        <div class="mb-8 text-center">
          <div class="mb-4 inline-flex items-center gap-3">
            <span class="relative grid h-12 w-12 place-items-center">
              <span class="absolute h-10 w-7 -rotate-[14deg] rounded-lg bg-uno-blue shadow-lg"></span>
              <span class="absolute h-10 w-7 rotate-[14deg] rounded-lg bg-uno-red shadow-lg"></span>
              <span class="relative h-4 w-4 rounded-full bg-brand-400"></span>
            </span>
            <span class="font-display text-3xl font-black tracking-tight text-white">
              UNO <span class="text-brand-400">Arena</span>
            </span>
          </div>
          <h1 class="font-display text-2xl font-bold text-white">{{ title() }}</h1>
          <p class="mt-1.5 text-sm text-ink-400">{{ subtitle() }}</p>
        </div>

        <div class="panel p-6 sm:p-8">
          <ng-content />
        </div>

        <p class="mt-6 text-center text-xs leading-relaxed text-ink-500">
          An original, fan-made card game. Not affiliated with, or endorsed by, any commercial card game publisher.
        </p>
      </div>
    </div>
  `,
})
export class AuthShellComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}
