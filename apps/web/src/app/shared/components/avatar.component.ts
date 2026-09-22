import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A monogram avatar: a stable gradient derived from the chosen avatar key plus
 * the player's initial. No external image requests, no upload surface.
 */
const PALETTE: Record<string, [string, string]> = {
  fox: ['#f97316', '#b91c1c'],
  panda: ['#64748b', '#0f172a'],
  tiger: ['#f59e0b', '#7c2d12'],
  owl: ['#a78bfa', '#4c1d95'],
  wolf: ['#94a3b8', '#1e293b'],
  koala: ['#67e8f9', '#0e7490'],
  otter: ['#34d399', '#065f46'],
  hawk: ['#fb7185', '#881337'],
  lynx: ['#fcd34d', '#92400e'],
  raven: ['#818cf8', '#1e1b4b'],
  bison: ['#d6d3d1', '#44403c'],
  crab: ['#fb923c', '#9a3412'],
};

const SIZES = {
  xs: 'h-7 w-7 text-[11px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-xl',
  xl: 'h-24 w-24 text-3xl',
} as const;

export type AvatarSize = keyof typeof SIZES;

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      [class]="classes()"
      class="inline-grid place-items-center rounded-full font-display font-black uppercase text-white
             ring-2 ring-white/15"
      [style.background-image]="gradient()"
      [attr.aria-label]="username() ? username() + ' avatar' : null"
      [attr.role]="username() ? 'img' : null"
    >
      {{ initial() }}
    </span>
  `,
})
export class AvatarComponent {
  readonly username = input<string>('');
  readonly avatar = input<string | undefined>('fox');
  readonly size = input<AvatarSize>('md');

  readonly classes = computed(() => SIZES[this.size()]);

  readonly initial = computed(() => (this.username() || '?').trim().charAt(0) || '?');

  readonly gradient = computed(() => {
    const [from, to] = PALETTE[this.avatar() ?? 'fox'] ?? PALETTE['fox'];
    return `linear-gradient(140deg, ${from}, ${to})`;
  });
}

export const AVATAR_KEYS = Object.keys(PALETTE);
