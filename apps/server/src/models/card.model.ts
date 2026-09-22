/** Card colour identity. `wild` is used for cards that have no colour until played. */
export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild';

/** Playable colours a wild card can resolve to. */
export type PlayableColor = Exclude<CardColor, 'wild'>;

export type CardType = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild_draw4';

export interface Card {
  id: string;
  color: CardColor;
  type: CardType;
  /** Present only for `number` cards (0-9). */
  value?: number;
}

export const PLAYABLE_COLORS: readonly PlayableColor[] = ['red', 'yellow', 'green', 'blue'] as const;

export function isWildCard(card: Card): boolean {
  return card.type === 'wild' || card.type === 'wild_draw4';
}

export function isPlayableColor(value: unknown): value is PlayableColor {
  return typeof value === 'string' && (PLAYABLE_COLORS as readonly string[]).includes(value);
}

/** Human / screen-reader friendly label, e.g. "Red 7", "Blue Draw Two", "Wild Draw Four". */
export function describeCard(card: Card): string {
  const color = card.color === 'wild' ? '' : card.color[0].toUpperCase() + card.color.slice(1);
  switch (card.type) {
    case 'number':
      return `${color} ${card.value}`;
    case 'skip':
      return `${color} Skip`;
    case 'reverse':
      return `${color} Reverse`;
    case 'draw2':
      return `${color} Draw Two`;
    case 'wild':
      return 'Wild';
    case 'wild_draw4':
      return 'Wild Draw Four';
  }
}

/** Standard UNO scoring, used to score the losers' hands when a game ends. */
export function cardPoints(card: Card): number {
  switch (card.type) {
    case 'number':
      return card.value ?? 0;
    case 'skip':
    case 'reverse':
    case 'draw2':
      return 20;
    case 'wild':
    case 'wild_draw4':
      return 50;
  }
}
