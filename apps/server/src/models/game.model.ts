import type { Card, CardColor } from './card.model';

export type GameStatus = 'waiting' | 'playing' | 'finished';
export type Direction = 'clockwise' | 'counter-clockwise';

export interface Player {
  id: string;
  username: string;
  avatar?: string;
  socketId?: string;
  position: number;
  hand: Card[];
  isReady: boolean;
  isConnected: boolean;
  hasCalledUno: boolean;
  /** Epoch ms of the moment the player dropped; drives the reconnect grace period. */
  disconnectedAt?: number;
  /** Per-game counters rolled into lifetime stats when the game ends. */
  cardsPlayed: number;
  unoCalls: number;
}

export type GameActionType =
  | 'play_card'
  | 'draw_card'
  | 'pass_turn'
  | 'choose_color'
  | 'call_uno'
  | 'uno_penalty'
  | 'challenge_draw_four'
  | 'accept_draw_four'
  | 'turn_timeout';

export interface GameMove {
  playerId: string;
  action: GameActionType;
  cardId?: string;
  color?: CardColor;
  /** Number of cards drawn, when relevant. */
  count?: number;
  timestamp: string;
}

export interface GameAction {
  type: GameActionType;
  playerId: string;
  playerName: string;
  cardId?: string;
  card?: Card;
  color?: CardColor;
  count?: number;
  timestamp: string;
}

/** Tunable ruleset - everything the engine branches on lives here. */
export interface GameRules {
  initialHandSize: number;
  maxPlayers: number;
  /** Allow +2 / +4 to be answered with another draw card, accumulating the penalty. */
  allowDrawStacking: boolean;
  /**
   * How Wild Draw Four is policed.
   *  - 'challenge' (official): you may play it at any time, even as a bluff. The
   *    next player may challenge; a guilty bluffer draws 4, a wrong challenger
   *    draws 6.
   *  - 'restricted': the server simply refuses an illegal play. Simpler, but not
   *    the published rule.
   */
  wildDrawFourMode: 'challenge' | 'restricted';
  /** With exactly two players, Reverse behaves like Skip. */
  twoPlayerReverseActsAsSkip: boolean;
  /** Cards handed to a player who is caught not having called UNO. */
  unoPenaltyCards: number;
  /** Seconds a player has to act before the server acts for them. 0 disables. */
  turnTimeoutSeconds: number;
  /**
   * Official UNO only punishes a forgotten UNO when another player catches it.
   * Turn this on for an automatic penalty instead (a house rule).
   */
  unoAutoPenalty: boolean;
  /** Seconds the automatic penalty waits, when `unoAutoPenalty` is on. */
  unoGraceSeconds: number;
}

export interface GameState {
  gameId: string;
  roomId: string;
  roomCode: string;

  players: Player[];

  deck: Card[];
  discardPile: Card[];

  currentPlayerIndex: number;
  direction: Direction;
  currentColor: CardColor;

  status: GameStatus;
  winnerId?: string;

  /**
   * Set while a wild card waits for its colour; blocks every other action.
   * `isStarter` marks the opening card turned up as a Wild - the first player
   * picks the colour and then still takes their turn, rather than passing it on.
   */
  pendingColorChoice?: { playerId: string; cardId: string; isStarter?: boolean };

  /**
   * A card just drawn that its owner may still play. Official rule: you draw
   * one, and if it can be played you may play it - otherwise your turn ends.
   */
  drawnCard?: { playerId: string; cardId: string };

  /** A Wild Draw Four waiting for the next player to accept it or challenge it. */
  pendingWildDrawFour?: {
    playedBy: string;
    targetPlayerId: string;
    /** Did the player actually hold the current colour when they played it? */
    wasBluff: boolean;
    /** The colour in play *before* the wild, which is what a challenge tests. */
    colorBefore: CardColor;
  };
  /** Accumulated draw penalty while stacking is enabled. */
  pendingDrawCount: number;
  /**
   * A player is sitting on one card without having called UNO. Any other player
   * may catch them until the next player has taken their turn.
   */
  unoVulnerable?: { playerId: string; deadline?: number };

  lastAction?: GameAction;
  moves: GameMove[];

  rules: GameRules;

  turnStartedAt?: string;
  /** Epoch ms after which the server acts on the current player's behalf. */
  turnDeadline?: number;

  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

/* -------------------------------------------------------------------------- */
/* Client-facing projections - these never contain another player's cards.     */
/* -------------------------------------------------------------------------- */

export interface PublicPlayer {
  id: string;
  username: string;
  avatar?: string;
  position: number;
  cardCount: number;
  isConnected: boolean;
  isCurrentTurn: boolean;
  hasCalledUno: boolean;
}

export interface ClientGameState {
  gameId: string;
  roomId: string;
  roomCode: string;
  players: PublicPlayer[];
  myHand: Card[];
  myPlayerId: string;
  topCard: Card | null;
  discardCount: number;
  deckCount: number;
  currentColor: CardColor;
  currentPlayerId: string | null;
  direction: Direction;
  status: GameStatus;
  winnerId?: string;
  winnerUsername?: string;
  pendingColorChoiceBy?: string;
  pendingDrawCount: number;
  /** The card you just drew and may still play; null when there is none. */
  drawnCardId?: string;
  /** True when you drew an unplayable-by-choice card and may end your turn. */
  canPass: boolean;
  /** Set while a Wild Draw Four is waiting to be accepted or challenged. */
  wildDrawFour?: { playedBy: string; playedByName: string; targetPlayerId: string };
  /** A player who may still be caught for not calling UNO. */
  unoVulnerablePlayerId?: string;
  lastAction?: GameAction;
  turnDeadline?: number;
  turnTimeoutSeconds: number;
  rules: GameRules;
  /** Card ids in `myHand` that are legal right now. Server computed; UI hint only. */
  playableCardIds: string[];
  /** True when this player is down to one card and has not yet called UNO. */
  canCallUno: boolean;
  updatedAt: string;
}

export interface GameResultPlayer {
  id: string;
  username: string;
  avatar?: string;
  cardsLeft: number;
  points: number;
  cardsPlayed: number;
  unoCalls: number;
  isWinner: boolean;
}

export interface GameHistoryRecord {
  id: string;
  gameId: string;
  roomCode: string;
  mode: string;
  winnerId: string | null;
  winnerUsername: string | null;
  playerIds: string[];
  players: GameResultPlayer[];
  moves: GameMove[];
  moveCount: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}
