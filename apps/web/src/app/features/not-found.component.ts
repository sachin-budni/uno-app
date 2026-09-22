import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideHouse } from '@lucide/angular';
import { GameCardComponent } from '../shared/components/game-card.component';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, GameCardComponent, LucideHouse],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div class="flex items-end gap-2" aria-hidden="true">
        <span class="-rotate-12"><app-game-card [card]="four" size="lg" /></span>
        <span class="rotate-6"><app-game-card [card]="zero" size="lg" /></span>
        <span class="rotate-[18deg]"><app-game-card [card]="fourTwo" size="lg" /></span>
      </div>

      <h1 class="mt-8 font-display text-3xl font-black text-white">Page not found</h1>
      <p class="mt-2 max-w-sm text-sm text-ink-400">
        That card is not in the deck. Let us get you back to the table.
      </p>

      <a routerLink="/lobby" class="btn-primary btn-lg mt-6">
        <svg lucideHouse class="h-4 w-4" aria-hidden="true"></svg>
        Back to the lobby
      </a>
    </div>
  `,
})
export class NotFoundComponent {
  readonly four = { id: 'nf-4', color: 'red', type: 'number', value: 4 } as const;
  readonly zero = { id: 'nf-0', color: 'yellow', type: 'number', value: 0 } as const;
  readonly fourTwo = { id: 'nf-4b', color: 'blue', type: 'number', value: 4 } as const;
}
