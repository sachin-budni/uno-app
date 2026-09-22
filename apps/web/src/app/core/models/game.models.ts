/**
 * Mirror of the server's public contract. The client only ever *reads* these -
 * game state is produced by the Node game engine and pushed down over sockets.
 */

export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild';
export type PlayableColor = Exclude<CardColor, 'wild'>;
export type CardType = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild_draw4';

export interface Card {
  id: string;
  color: CardColor;
  type: CardType;
  value?: number;
}

export const PLAYABLE_COLORS: readonly PlayableColor[] = ['red', 'yellow', 'green', 'blue'];

export type GameStatus = 'waiting' | 'playing' | 'finished';
export type Direction = 'clockwise' | 'counter-clockwise';

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

export interface GameMove {
  playerId: string;
  action: GameActionType;
  cardId?: string;
  color?: CardColor;
  count?: number;
  timestamp: string;
}

export interface GameRules {
  initialHandSize: number;
  maxPlayers: number;
  allowDrawStacking: boolean;
  /** 'challenge' is the official rule; 'restricted' blocks an illegal +4 instead. */
  wildDrawFourMode: 'challenge' | 'restricted';
  twoPlayerReverseActsAsSkip: boolean;
  unoPenaltyCards: number;
  turnTimeoutSeconds: number;
  unoAutoPenalty: boolean;
  unoGraceSeconds: number;
}

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
  /** The card you just drew and may still play. */
  drawnCardId?: string;
  /** True when you have drawn and may now end your turn. */
  canPass: boolean;
  /** Set while a Wild Draw Four waits to be accepted or challenged. */
  wildDrawFour?: { playedBy: string; playedByName: string; targetPlayerId: string };
  /** A player who can still be caught for not calling UNO. */
  unoVulnerablePlayerId?: string;
  lastAction?: GameAction;
  turnDeadline?: number;
  turnTimeoutSeconds: number;
  rules: GameRules;
  playableCardIds: string[];
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

export interface GameFinishedPayload {
  gameId: string;
  winnerId: string | null;
  winnerUsername: string | null;
  results: GameResultPlayer[];
  durationMs: number;
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
  moves?: GameMove[];
  moveCount: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

/* --------------------------- presentation helpers -------------------------- */

/** Screen-reader and tooltip label for a card, e.g. "Blue Draw Two card". */
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

/** Short face text shown on the card itself. */
export function cardFace(card: Card): string {
  switch (card.type) {
    case 'number':
      return String(card.value ?? '');
    case 'draw2':
      return '+2';
    case 'wild_draw4':
      return '+4';
    case 'skip':
      return 'S';
    case 'reverse':
      return 'R';
    case 'wild':
      return 'W';
  }
}
