import type { Direction } from '../models/game.model';

export const step = (direction: Direction): 1 | -1 => (direction === 'clockwise' ? 1 : -1);

export function flip(direction: Direction): Direction {
  return direction === 'clockwise' ? 'counter-clockwise' : 'clockwise';
}

/**
 * Index of the seat `steps` places away from `currentIndex`, wrapping in the
 * current direction. `steps` of 1 is the next player, 2 skips one, and so on.
 */
export function seatAfter(currentIndex: number, playerCount: number, direction: Direction, steps = 1): number {
  if (playerCount <= 0) return 0;
  const delta = step(direction) * steps;
  return ((currentIndex + delta) % playerCount + playerCount) % playerCount;
}

export function nextSeat(currentIndex: number, playerCount: number, direction: Direction): number {
  return seatAfter(currentIndex, playerCount, direction, 1);
}

export function previousSeat(currentIndex: number, playerCount: number, direction: Direction): number {
  return seatAfter(currentIndex, playerCount, direction, -1);
}
