import { PLAYABLE_COLORS, type Card, type CardType, type PlayableColor } from '../models/card.model';
import { newId, shuffle } from '../utils/random';

/**
 * The deck is described by data rather than hard-coded, so a variant ruleset only
 * needs a different config object - no engine changes.
 */
export interface DeckConfig {
  colors: readonly PlayableColor[];
  /** Number cards and how many copies of each exist per colour. */
  numbers: ReadonlyArray<{ value: number; copies: number }>;
  /** Coloured action cards and how many copies of each exist per colour. */
  actions: ReadonlyArray<{ type: Extract<CardType, 'skip' | 'reverse' | 'draw2'>; copies: number }>;
  /** Colourless cards and their total count in the deck. */
  wilds: ReadonlyArray<{ type: Extract<CardType, 'wild' | 'wild_draw4'>; copies: number }>;
}

/** The standard 108-card distribution. */
export const STANDARD_DECK_CONFIG: DeckConfig = {
  colors: PLAYABLE_COLORS,
  numbers: [
    { value: 0, copies: 1 },
    { value: 1, copies: 2 },
    { value: 2, copies: 2 },
    { value: 3, copies: 2 },
    { value: 4, copies: 2 },
    { value: 5, copies: 2 },
    { value: 6, copies: 2 },
    { value: 7, copies: 2 },
    { value: 8, copies: 2 },
    { value: 9, copies: 2 },
  ],
  actions: [
    { type: 'skip', copies: 2 },
    { type: 'reverse', copies: 2 },
    { type: 'draw2', copies: 2 },
  ],
  wilds: [
    { type: 'wild', copies: 4 },
    { type: 'wild_draw4', copies: 4 },
  ],
};

export function buildDeck(deckConfig: DeckConfig = STANDARD_DECK_CONFIG): Card[] {
  const cards: Card[] = [];

  for (const color of deckConfig.colors) {
    for (const { value, copies } of deckConfig.numbers) {
      for (let i = 0; i < copies; i++) {
        cards.push({ id: newId(), color, type: 'number', value });
      }
    }
    for (const { type, copies } of deckConfig.actions) {
      for (let i = 0; i < copies; i++) {
        cards.push({ id: newId(), color, type });
      }
    }
  }

  for (const { type, copies } of deckConfig.wilds) {
    for (let i = 0; i < copies; i++) {
      cards.push({ id: newId(), color: 'wild', type });
    }
  }

  return cards;
}

export function buildShuffledDeck(deckConfig: DeckConfig = STANDARD_DECK_CONFIG): Card[] {
  return shuffle(buildDeck(deckConfig));
}

export interface DrawPiles {
  deck: Card[];
  discardPile: Card[];
}

/**
 * Takes the discard pile (except the card currently showing), shuffles it and
 * makes it the new draw deck. Mutates the two arrays in place.
 * Returns the number of cards recycled.
 */
export function recycleDiscardPile(piles: DrawPiles): number {
  if (piles.discardPile.length <= 1) return 0;
  const top = piles.discardPile[piles.discardPile.length - 1];
  const recyclable = piles.discardPile.slice(0, -1);
  piles.discardPile.length = 0;
  piles.discardPile.push(top);
  const reshuffled = shuffle(recyclable);
  piles.deck.push(...reshuffled);
  return reshuffled.length;
}

/**
 * Draws up to `count` cards, recycling the discard pile when the deck runs dry.
 * If every card is already in someone's hand it returns fewer cards than asked -
 * the caller must cope with a short draw rather than dead-locking.
 */
export function drawCards(piles: DrawPiles, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (piles.deck.length === 0 && recycleDiscardPile(piles) === 0) break;
    const card = piles.deck.pop();
    if (!card) break;
    drawn.push(card);
  }
  return drawn;
}
