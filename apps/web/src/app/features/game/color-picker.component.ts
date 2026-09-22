import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { PLAYABLE_COLORS, type PlayableColor } from '../../core/models/game.models';

const SWATCH: Record<PlayableColor, string> = {
  red: 'bg-gradient-to-br from-uno-red to-uno-red-deep',
  yellow: 'bg-gradient-to-br from-uno-yellow to-uno-yellow-deep',
  green: 'bg-gradient-to-br from-uno-green to-uno-green-deep',
  blue: 'bg-gradient-to-br from-uno-blue to-uno-blue-deep',
};

/** Modal colour chooser shown after a wild card is played. */
@Component({
  selector: 'app-color-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-[115] grid place-items-center p-4">
        <div class="absolute inset-0 bg-ink-950/85 backdrop-blur-sm" aria-hidden="true"></div>

        <div
          #panel
          class="panel anim-rise relative z-10 w-full max-w-sm p-6 text-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="color-picker-title"
          tabindex="-1"
        >
          <h2 id="color-picker-title" class="font-display text-xl font-black text-white">Choose a colour</h2>
          <p class="mt-1 text-sm text-ink-400">The next player has to follow it.</p>

          <div class="mt-6 grid grid-cols-2 gap-3">
            @for (color of colors; track color) {
              <button
                type="button"
                class="anim-rise group flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-4
                       transition hover:border-white/30 hover:bg-white/10"
                [style.animation-delay]="delay(color)"
                (click)="pick.emit(color)"
              >
                <span
                  class="h-14 w-14 rounded-full shadow-lg ring-2 ring-white/20 transition group-hover:scale-110"
                  [class]="swatch(color)"
                ></span>
                <span class="font-display text-sm font-bold uppercase tracking-wider text-white">{{ color }}</span>
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class ColorPickerComponent {
  readonly open = input(false, { transform: booleanAttribute });
  readonly pick = output<PlayableColor>();

  readonly colors = PLAYABLE_COLORS;
  private readonly panel = viewChild<ElementRef<HTMLDivElement>>('panel');

  constructor() {
    // Move focus into the dialog so the keyboard lands where the choice is.
    effect(() => {
      if (this.open()) queueMicrotask(() => this.panel()?.nativeElement.focus());
    });
  }

  swatch(color: PlayableColor): string {
    return SWATCH[color];
  }

  delay(color: PlayableColor): string {
    return `${this.colors.indexOf(color) * 45}ms`;
  }
}
