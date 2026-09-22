import { describe, expect, it } from 'vitest';
import {
  buildDeck,
  buildShuffledDeck,
  drawCards,
  recycleDiscardPile,
  STANDARD_DECK_CONFIG,
} from '../src/game/deck-manager';
import { card, num } from './helpers';

describe('deck generation', () => {
  const deck = buildDeck();

  it('produces the standard 108 card deck', () => {
    expect(deck).toHaveLength(108);
  });

  it('gives every card a unique id', () => {
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });

  it('has one zero and two of each other number per colour', () => {
    for (const color of STANDARD_DECK_CONFIG.colors) {
      const numbers = deck.filter((c) => c.color === color && c.type === 'number');
      expect(numbers.filter((c) => c.value === 0)).toHaveLength(1);
      for (let value = 1; value <= 9; value++) {
        expect(numbers.filter((c) => c.value === value)).toHaveLength(2);
      }
    }
  });

  it('has two of each action card per colour', () => {
    for (const color of STANDARD_DECK_CONFIG.colors) {
      for (const type of ['skip', 'reverse', 'draw2'] as const) {
        expect(deck.filter((c) => c.color === color && c.type === type)).toHaveLength(2);
      }
    }
  });

  it('has four wilds and four wild draw fours', () => {
    expect(deck.filter((c) => c.type === 'wild')).toHaveLength(4);
    expect(deck.filter((c) => c.type === 'wild_draw4')).toHaveLength(4);
  });

  it('honours a custom deck configuration', () => {
    const small = buildDeck({
      colors: ['red', 'blue'],
      numbers: [{ value: 1, copies: 1 }],
      actions: [{ type: 'skip', copies: 1 }],
      wilds: [{ type: 'wild', copies: 2 }],
    });
    expect(small).toHaveLength(2 * 2 + 2);
  });
});

describe('shuffling', () => {
  it('keeps every card and changes the order', () => {
    const ordered = buildDeck();
    const shuffled = buildShuffledDeck();
    expect(shuffled).toHaveLength(ordered.length);

    // Same multiset of card faces.
    const face = (c: { color: string; type: string; value?: number }) => `${c.color}:${c.type}:${c.value ?? ''}`;
    expect(shuffled.map(face).sort()).toEqual(ordered.map(face).sort());

    // Two independent shuffles matching exactly would be a 1-in-108! event.
    expect(buildShuffledDeck().map(face)).not.toEqual(shuffled.map(face));
  });
});

describe('drawing and recycling', () => {
  it('draws from the top of the deck', () => {
    const piles = { deck: [num('red', 1), num('red', 2), num('red', 3)], discardPile: [num('blue', 0)] };
    const drawn = drawCards(piles, 2);
    expect(drawn.map((c) => c.value)).toEqual([3, 2]);
    expect(piles.deck).toHaveLength(1);
  });

  it('recycles the discard pile, keeping the card that is showing', () => {
    const top = num('green', 4);
    const piles = { deck: [], discardPile: [num('red', 1), num('red', 2), top] };
    const recycled = recycleDiscardPile(piles);

    expect(recycled).toBe(2);
    expect(piles.discardPile).toEqual([top]);
    expect(piles.deck).toHaveLength(2);
  });

  it('refills an empty deck automatically mid-draw', () => {
    const top = num('green', 4);
    const piles = { deck: [num('red', 9)], discardPile: [num('red', 1), num('red', 2), top] };
    const drawn = drawCards(piles, 3);

    expect(drawn).toHaveLength(3);
    expect(piles.discardPile).toEqual([top]);
  });

  it('returns a short draw rather than hanging when no cards are left anywhere', () => {
    const piles = { deck: [], discardPile: [card('red', 'skip')] };
    expect(drawCards(piles, 4)).toHaveLength(0);
  });
});
