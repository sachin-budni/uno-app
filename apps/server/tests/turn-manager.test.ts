import { describe, expect, it } from 'vitest';
import { flip, nextSeat, previousSeat, seatAfter, step } from '../src/game/turn-manager';

describe('turn direction', () => {
  it('flips both ways', () => {
    expect(flip('clockwise')).toBe('counter-clockwise');
    expect(flip('counter-clockwise')).toBe('clockwise');
  });

  it('maps direction to a step', () => {
    expect(step('clockwise')).toBe(1);
    expect(step('counter-clockwise')).toBe(-1);
  });
});

describe('seat order with four players', () => {
  it('advances 1 -> 2 -> 3 -> 4 -> 1 clockwise', () => {
    expect([0, 1, 2, 3].map((seat) => nextSeat(seat, 4, 'clockwise'))).toEqual([1, 2, 3, 0]);
  });

  it('advances 4 -> 3 -> 2 -> 1 -> 4 counter-clockwise', () => {
    expect([3, 2, 1, 0].map((seat) => nextSeat(seat, 4, 'counter-clockwise'))).toEqual([2, 1, 0, 3]);
  });

  it('skips a seat when two steps are taken', () => {
    expect(seatAfter(0, 4, 'clockwise', 2)).toBe(2);
    expect(seatAfter(0, 4, 'counter-clockwise', 2)).toBe(2);
  });

  it('wraps correctly for large step counts', () => {
    expect(seatAfter(2, 4, 'clockwise', 6)).toBe(0);
  });

  it('walks backwards with previousSeat', () => {
    expect(previousSeat(0, 4, 'clockwise')).toBe(3);
    expect(previousSeat(0, 4, 'counter-clockwise')).toBe(1);
  });
});

describe('seat order with two players', () => {
  it('alternates on a single step', () => {
    expect(nextSeat(0, 2, 'clockwise')).toBe(1);
    expect(nextSeat(1, 2, 'clockwise')).toBe(0);
  });

  it('returns to the same player on a double step, which is what makes Skip work', () => {
    expect(seatAfter(0, 2, 'clockwise', 2)).toBe(0);
    expect(seatAfter(1, 2, 'counter-clockwise', 2)).toBe(1);
  });
});
