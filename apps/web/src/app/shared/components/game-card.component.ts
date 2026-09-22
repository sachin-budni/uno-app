import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';
import { LucideBan, LucideRepeat } from '@lucide/angular';
import { cardFace, describeCard, type Card, type CardColor } from '../../core/models/game.models';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

/** Original card artwork - flat colour plates, corner pips and a centre glyph. */
const COLOR_SKIN: Record<CardColor, string> = {
  red: 'from-uno-red to-uno-red-deep',
  yellow: 'from-uno-yellow to-uno-yellow-deep',
  green: 'from-uno-green to-uno-green-deep',
  blue: 'from-uno-blue to-uno-blue-deep',
  wild: 'from-ink-700 to-ink-950',
};

const SIZE_CLASS: Record<CardSize, string> = {
  xs: 'w-9 text-[9px]',
  sm: 'w-12 sm:w-14 text-[11px]',
  md: 'w-16 sm:w-[4.5rem] text-xs',
  lg: 'w-20 sm:w-24 text-sm',
};

const GLYPH_CLASS: Record<CardSize, string> = {
  xs: 'text-base',
  sm: 'text-xl',
  md: 'text-2xl sm:text-3xl',
  lg: 'text-3xl sm:text-4xl',
};

@Component({
  selector: 'app-game-card',
  imports: [NgTemplateOutlet, LucideBan, LucideRepeat],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (faceDown()) {
      <div
        [class]="shellClass()"
        class="relative aspect-[2/3] select-none overflow-hidden rounded-[var(--radius-card)] border border-white/15
               bg-gradient-to-br from-ink-700 via-ink-900 to-ink-950 shadow-lg"
        aria-hidden="true"
      >
        <div class="absolute inset-[7%] rounded-[0.6rem] border border-white/10"></div>
        <div
          class="absolute inset-0 opacity-70"
          style="background-image: repeating-linear-gradient(135deg, rgba(245,166,35,.16) 0 6px, transparent 6px 14px)"
        ></div>
        <div class="absolute inset-0 grid place-items-center">
          <span class="font-display text-[0.55em] font-black uppercase tracking-[0.2em] text-brand-400/80">UNO</span>
        </div>
      </div>
    } @else if (card(); as value) {
      @if (selectable()) {
        <button
          type="button"
          [class]="interactiveClass()"
          [disabled]="disabled()"
          [attr.aria-pressed]="selected()"
          [attr.aria-label]="label()"
          [title]="label()"
          (click)="pick.emit(value)"
        >
          <ng-container [ngTemplateOutlet]="face"></ng-container>
        </button>
      } @else {
        <div [class]="staticClass()" role="img" [attr.aria-label]="label()" [title]="label()">
          <ng-container [ngTemplateOutlet]="face"></ng-container>
        </div>
      }

      <ng-template #face>
        <!-- corner pips -->
        <span class="absolute left-1.5 top-1 font-display font-black leading-none text-white/95 drop-shadow">
          {{ faceText() }}
        </span>
        <span class="absolute bottom-1 right-1.5 rotate-180 font-display font-black leading-none text-white/95 drop-shadow">
          {{ faceText() }}
        </span>

        <!-- centre plate -->
        <span
          class="absolute inset-x-[12%] inset-y-[20%] -rotate-[18deg] rounded-[35%] bg-white/92 shadow-inner"
        ></span>

        <span class="absolute inset-0 grid place-items-center">
          @switch (value.type) {
            @case ('skip') {
              <svg lucideBan [class]="iconClass()" [style.color]="inkColor()" aria-hidden="true"></svg>
            }
            @case ('reverse') {
              <svg lucideRepeat [class]="iconClass()" [style.color]="inkColor()" aria-hidden="true"></svg>
            }
            @case ('wild') {
              <span class="grid h-[42%] w-[42%] grid-cols-2 grid-rows-2 overflow-hidden rounded-full shadow">
                <span class="bg-uno-red"></span>
                <span class="bg-uno-blue"></span>
                <span class="bg-uno-yellow"></span>
                <span class="bg-uno-green"></span>
              </span>
            }
            @case ('wild_draw4') {
              <span class="flex flex-col items-center gap-0.5">
                <span class="grid h-[1.1em] w-[1.1em] grid-cols-2 grid-rows-2 overflow-hidden rounded-full">
                  <span class="bg-uno-red"></span>
                  <span class="bg-uno-blue"></span>
                  <span class="bg-uno-yellow"></span>
                  <span class="bg-uno-green"></span>
                </span>
                <span [class]="glyphClass()" class="font-display font-black leading-none text-ink-900">+4</span>
              </span>
            }
            @default {
              <span [class]="glyphClass()" class="font-display font-black leading-none" [style.color]="inkColor()">
                {{ faceText() }}
              </span>
            }
          }
        </span>
      </ng-template>
    }
  `,
})
export class GameCardComponent {
  readonly card = input<Card | null>(null);
  readonly selectable = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly selected = input(false, { transform: booleanAttribute });
  /** Draws the back of the card - used for opponents' hands and the draw pile. */
  readonly faceDown = input(false, { transform: booleanAttribute });
  readonly size = input<CardSize>('md');
  /**
   * Entry animation. `play-mine` flies up from the hand, `play-theirs` comes
   * down from the far side of the table, so who just played reads instantly.
   */
  readonly animate = input<'none' | 'deal' | 'play' | 'play-mine' | 'play-theirs' | 'draw'>('none');

  readonly pick = output<Card>();

  readonly faceText = computed(() => {
    const card = this.card();
    return card ? cardFace(card) : '';
  });

  readonly label = computed(() => {
    const card = this.card();
    if (!card) return 'Card';
    const base = `${describeCard(card)} card`;
    if (!this.selectable()) return base;
    return this.disabled() ? `${base}, not playable` : `${base}, playable`;
  });

  readonly iconClass = computed(() => (this.size() === 'lg' ? 'h-8 w-8' : this.size() === 'md' ? 'h-7 w-7' : 'h-5 w-5'));
  readonly glyphClass = computed(() => GLYPH_CLASS[this.size()]);

  /** Wild cards keep dark ink; coloured cards use their own deep tone. */
  readonly inkColor = computed(() => {
    const card = this.card();
    if (!card || card.color === 'wild') return 'var(--color-ink-900)';
    return `var(--color-uno-${card.color}-deep)`;
  });

  readonly shellClass = computed(() => [SIZE_CLASS[this.size()], this.animationClass()].join(' '));

  private readonly baseClass = computed(() =>
    [
      'relative aspect-[2/3] select-none overflow-hidden rounded-[var(--radius-card)]',
      'border border-white/25 bg-gradient-to-br shadow-lg shadow-black/40',
      COLOR_SKIN[this.card()?.color ?? 'wild'],
      SIZE_CLASS[this.size()],
      this.animationClass(),
    ].join(' '),
  );

  readonly staticClass = computed(() => this.baseClass());

  readonly interactiveClass = computed(() =>
    [
      this.baseClass(),
      'transition duration-150 will-change-transform',
      this.disabled()
        ? 'cursor-not-allowed opacity-45 saturate-50'
        : 'cursor-pointer hover:-translate-y-2 hover:shadow-xl hover:shadow-black/60 ring-offset-2 ring-offset-ink-950',
      !this.disabled() ? 'ring-2 ring-white/70' : '',
      this.selected() ? '-translate-y-3 ring-4 ring-brand-400' : '',
    ].join(' '),
  );

  private animationClass(): string {
    switch (this.animate()) {
      case 'deal':
        return 'anim-deal';
      case 'play':
        return 'anim-play';
      case 'play-mine':
        return 'anim-play-mine';
      case 'play-theirs':
        return 'anim-play-theirs';
      case 'draw':
        return 'anim-draw';
      default:
        return '';
    }
  }
}
