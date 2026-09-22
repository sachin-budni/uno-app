import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { LucideWifiOff } from '@lucide/angular';
import type { PublicPlayer } from '../../core/models/game.models';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { GameCardComponent } from '../../shared/components/game-card.component';

/**
 * One opponent at the table: who they are, how many cards they hold (shown as
 * a fan of card backs - never their faces) and whether it is their turn.
 */
@Component({
  selector: 'app-player-seat',
  imports: [AvatarComponent, GameCardComponent, LucideWifiOff],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex min-w-0 flex-col items-center gap-2 rounded-2xl border px-3 py-3 transition"
      [class]="shell()"
      [attr.aria-label]="ariaLabel()"
      role="group"
    >
      <div class="relative">
        <app-avatar
          size="md"
          [username]="player().username"
          [avatar]="player().avatar"
          [class.anim-turn-ring]="player().isCurrentTurn"
          class="rounded-full"
        />
        @if (!player().isConnected) {
          <span
            class="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-800 text-brand-400 ring-2 ring-ink-950"
            title="Reconnecting"
          >
            <svg lucideWifiOff class="h-3 w-3" aria-hidden="true"></svg>
          </span>
        }
      </div>

      <p class="max-w-[8rem] truncate text-xs font-semibold text-white">{{ player().username }}</p>

      <!-- card fan: counts only, faces never leave the server -->
      <div class="flex h-9 items-center justify-center" [class.anim-seat-bump]="bumped()">
        @for (slot of fan(); track slot) {
          <span class="-ml-5 first:ml-0" [style.transform]="'rotate(' + tilt(slot) + 'deg)'">
            <app-game-card faceDown size="xs" />
          </span>
        }
      </div>

      <div class="flex items-center gap-1.5">
        <span class="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-ink-300 tabular-nums">
          {{ player().cardCount }} {{ player().cardCount === 1 ? 'card' : 'cards' }}
        </span>
        @if (player().cardCount === 1 && player().hasCalledUno) {
          <span class="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-black text-ink-950">UNO</span>
        }
      </div>
    </div>
  `,
})
export class PlayerSeatComponent {
  readonly player = input.required<PublicPlayer>();

  private readonly destroyRef = inject(DestroyRef);

  /** Briefly true when this player's hand grows or shrinks. */
  readonly bumped = signal(false);

  constructor() {
    let previous: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    effect((onCleanup) => {
      const count = this.player().cardCount;
      if (previous === null || previous === count) {
        previous = count;
        return;
      }
      previous = count;

      this.bumped.set(false);
      const start = setTimeout(() => this.bumped.set(true), 16);
      timer = setTimeout(() => this.bumped.set(false), 400);

      onCleanup(() => {
        clearTimeout(start);
        clearTimeout(timer);
      });
    });

    this.destroyRef.onDestroy(() => clearTimeout(timer));
  }

  /** Cap the fan so a 20-card hand does not overflow the seat. */
  readonly fan = computed(() =>
    Array.from({ length: Math.min(this.player().cardCount, 5) }, (_, index) => index),
  );

  readonly shell = computed(() => {
    const player = this.player();
    if (player.isCurrentTurn) return 'border-brand-400/60 bg-brand-500/10';
    if (!player.isConnected) return 'border-white/5 bg-white/[0.02] opacity-60';
    return 'border-white/5 bg-white/[0.03]';
  });

  readonly ariaLabel = computed(() => {
    const player = this.player();
    const parts = [`${player.username}, ${player.cardCount} cards`];
    if (player.isCurrentTurn) parts.push('their turn');
    if (!player.isConnected) parts.push('reconnecting');
    if (player.hasCalledUno) parts.push('called UNO');
    return parts.join(', ');
  });

  tilt(index: number): number {
    const spread = Math.min(this.player().cardCount, 5);
    return (index - (spread - 1) / 2) * 7;
  }
}
