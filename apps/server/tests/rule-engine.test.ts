import { describe, expect, it } from 'vitest';
import { defaultRules } from '../src/game/game-state';
import {
  canStackOnPenalty,
  checkPlayable,
  getPlayableCards,
  isWildDrawFourLegal,
  matchesTopCard,
} from '../src/game/rule-engine';
import type { Card } from '../src/models/card.model';
import { card, num } from './helpers';

const rules = defaultRules({ turnTimeoutSeconds: 0 });
const context = (hand: Card[], top: Card, currentColor = top.color, overrides = {}) => ({
  topCard: top,
  currentColor: currentColor as never,
  rules: { ...rules, ...overrides },
  pendingDrawCount: 0,
  hand,
});

describe('card matching against RED 7', () => {
  const top = num('red', 7);

  it.each([
    ['same colour', num('red', 3)],
    ['same colour action', card('red', 'skip')],
    ['same number, other colour', num('blue', 7)],
    ['same number, third colour', num('green', 7)],
    ['wild', card('wild', 'wild')],
    ['wild draw four', card('wild', 'wild_draw4')],
  ])('accepts %s', (_label, candidate) => {
    expect(matchesTopCard(candidate, top, 'red')).toBe(true);
  });

  it.each([
    ['different colour and number', num('blue', 3)],
    ['different colour and number again', num('green', 8)],
    ['different colour action', card('yellow', 'skip')],
  ])('rejects %s', (_label, candidate) => {
    expect(matchesTopCard(candidate, top, 'red')).toBe(false);
  });
});

describe('matching action cards', () => {
  it('matches Skip on Skip across colours', () => {
    expect(matchesTopCard(card('blue', 'skip'), card('red', 'skip'), 'red')).toBe(true);
  });

  it('matches Draw Two on Draw Two across colours', () => {
    expect(matchesTopCard(card('green', 'draw2'), card('red', 'draw2'), 'red')).toBe(true);
  });

  it('does not treat different action types as a match', () => {
    expect(matchesTopCard(card('blue', 'reverse'), card('red', 'skip'), 'red')).toBe(false);
  });

  it('follows the chosen colour after a wild, not the wild card itself', () => {
    const top = card('wild', 'wild');
    expect(matchesTopCard(num('blue', 2), top, 'blue')).toBe(true);
    expect(matchesTopCard(num('red', 2), top, 'blue')).toBe(false);
  });
});

describe('wild draw four restriction (simplified "restricted" mode)', () => {
  const wild4 = card('wild', 'wild_draw4');
  const restricted = { wildDrawFourMode: 'restricted' as const };

  it('is legal when nothing in hand matches the current colour', () => {
    const hand = [wild4, num('blue', 1), num('green', 2)];
    expect(isWildDrawFourLegal(hand, wild4.id, 'red')).toBe(true);
    expect(checkPlayable(wild4, context(hand, num('red', 7), 'red', restricted)).playable).toBe(true);
  });

  it('is blocked when a colour match is held', () => {
    const hand = [wild4, num('red', 1)];
    expect(isWildDrawFourLegal(hand, wild4.id, 'red')).toBe(false);

    const verdict = checkPlayable(wild4, context(hand, num('red', 7), 'red', restricted));
    expect(verdict.playable).toBe(false);
    expect(verdict.reason).toBe('wild_draw4_restricted');
  });

  it('is allowed in the official challenge mode, where bluffing is legal', () => {
    const hand = [wild4, num('red', 1)];
    expect(checkPlayable(wild4, context(hand, num('red', 7), 'red', { wildDrawFourMode: 'challenge' })).playable).toBe(
      true,
    );
  });

  it('ignores a number match in another colour', () => {
    // Holding BLUE 7 on a RED 7 does not lift the restriction - only colour counts.
    const hand = [wild4, num('blue', 7)];
    expect(isWildDrawFourLegal(hand, wild4.id, 'red')).toBe(true);
  });
});

describe('stacking draw penalties', () => {
  it('allows +2 on +2 and +4 on anything', () => {
    expect(canStackOnPenalty(card('blue', 'draw2'), card('red', 'draw2'))).toBe(true);
    expect(canStackOnPenalty(card('wild', 'wild_draw4'), card('red', 'draw2'))).toBe(true);
    expect(canStackOnPenalty(card('wild', 'wild_draw4'), card('wild', 'wild_draw4'))).toBe(true);
  });

  it('does not allow +2 to answer a +4', () => {
    expect(canStackOnPenalty(card('blue', 'draw2'), card('wild', 'wild_draw4'))).toBe(false);
  });

  it('blocks ordinary cards while a penalty is outstanding', () => {
    const hand = [num('red', 3)];
    const verdict = checkPlayable(hand[0], {
      ...context(hand, card('red', 'draw2')),
      pendingDrawCount: 2,
      rules: { ...rules, allowDrawStacking: true },
    });
    expect(verdict.playable).toBe(false);
    expect(verdict.reason).toBe('must_answer_draw');
  });
});

describe('getPlayableCards', () => {
  it('returns exactly the legal subset of a hand', () => {
    const hand = [num('red', 3), num('blue', 3), num('green', 8), card('wild', 'wild'), card('blue', 'skip')];
    const playable = getPlayableCards(context(hand, num('red', 3), 'red'));
    expect(playable.map((c) => c.id).sort()).toEqual([hand[0].id, hand[1].id, hand[3].id].sort());
  });

  it('returns nothing playable when the hand is dead', () => {
    const hand = [num('blue', 1), num('green', 2)];
    expect(getPlayableCards(context(hand, num('red', 7), 'red'))).toHaveLength(0);
  });
});
