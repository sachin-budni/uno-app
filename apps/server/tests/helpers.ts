import { GameEngine } from '../src/game/game-engine';
import type { Card, CardType, PlayableColor } from '../src/models/card.model';
import type { GameRules } from '../src/models/game.model';

let counter = 0;
export const cardId = () => `card-${++counter}`;

/** Compact card factory: `card('red', 'number', 7)`. */
export function card(color: Card['color'], type: CardType, value?: number): Card {
  return { id: cardId(), color, type, ...(value === undefined ? {} : { value }) };
}

export const num = (color: PlayableColor, value: number) => card(color, 'number', value);

export interface TableOptions {
  players?: number;
  rules?: Partial<GameRules>;
  /** Hands indexed by seat. Any seat left out keeps a single filler card. */
  hands?: Card[][];
  top?: Card;
  deck?: Card[];
}

/**
 * Builds a fully deterministic table: exact hands, an exact card showing and an
 * exact draw deck, so every assertion is about the rules and nothing else.
 */
export function table(options: TableOptions = {}): { engine: GameEngine; ids: string[] } {
  const count = options.players ?? options.hands?.length ?? 2;
  const engine = GameEngine.create({
    roomId: 'room-1',
    roomCode: 'TEST01',
    seats: Array.from({ length: count }, (_, index) => ({
      id: `p${index + 1}`,
      username: `Player ${index + 1}`,
    })),
    rules: { turnTimeoutSeconds: 0, ...options.rules },
  });

  const state = engine.state;
  state.players.forEach((player, index) => {
    player.hand = options.hands?.[index] ?? [num('red', 9)];
    player.hasCalledUno = false;
  });

  const top = options.top ?? num('red', 7);
  state.discardPile = [top];
  state.currentColor = top.color === 'wild' ? 'red' : top.color;
  state.deck = options.deck ?? Array.from({ length: 20 }, () => num('green', 5));
  state.currentPlayerIndex = 0;
  state.direction = 'clockwise';
  state.pendingDrawCount = 0;
  state.unoVulnerable = undefined;
  state.pendingColorChoice = undefined;
  state.drawnCard = undefined;
  state.pendingWildDrawFour = undefined;
  state.status = 'playing';

  return { engine, ids: state.players.map((player) => player.id) };
}

export const handOf = (engine: GameEngine, playerId: string) => engine.player(playerId)!.hand;
export const currentId = (engine: GameEngine) => engine.state.players[engine.state.currentPlayerIndex].id;
export const topOf = (engine: GameEngine) => engine.state.discardPile[engine.state.discardPile.length - 1];
