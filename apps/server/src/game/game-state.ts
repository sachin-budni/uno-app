import { config } from '../config/env';
import type { Card } from '../models/card.model';
import type {
  ClientGameState,
  GameRules,
  GameState,
  Player,
  PublicPlayer,
} from '../models/game.model';
import { buildShuffledDeck, drawCards, type DeckConfig } from './deck-manager';
import { getPlayableCards } from './rule-engine';
import { newId, shuffle } from '../utils/random';

export function defaultRules(overrides: Partial<GameRules> = {}): GameRules {
  return {
    initialHandSize: config.game.initialHandSize,
    maxPlayers: config.game.maxPlayers,
    allowDrawStacking: config.game.allowDrawStacking,
    wildDrawFourMode: config.game.wildDrawFourMode,
    twoPlayerReverseActsAsSkip: config.game.twoPlayerReverseActsAsSkip,
    unoPenaltyCards: config.game.unoPenaltyCards,
    turnTimeoutSeconds: config.game.turnTimeoutSeconds,
    unoAutoPenalty: config.game.unoAutoPenalty,
    unoGraceSeconds: 6,
    ...overrides,
  };
}

export interface SeatInput {
  id: string;
  username: string;
  avatar?: string;
  socketId?: string;
}

export interface CreateGameOptions {
  roomId: string;
  roomCode: string;
  seats: SeatInput[];
  rules?: Partial<GameRules>;
  deckConfig?: DeckConfig;
}

/**
 * Builds a ready-to-play state: deck shuffled, hands dealt, and the starter card
 * turned up. The starter is handled the way the published rules describe - see
 * the branch below for Wild, Wild Draw Four and the action cards.
 */
export function createGameState(options: CreateGameOptions): GameState {
  const rules = defaultRules(options.rules);
  const now = new Date().toISOString();

  const players: Player[] = options.seats.map((seat, index) => ({
    id: seat.id,
    username: seat.username,
    avatar: seat.avatar,
    socketId: seat.socketId,
    position: index,
    hand: [],
    isReady: true,
    isConnected: true,
    hasCalledUno: false,
    cardsPlayed: 0,
    unoCalls: 0,
  }));

  const piles = { deck: buildShuffledDeck(options.deckConfig), discardPile: [] as Card[] };

  for (let round = 0; round < rules.initialHandSize; round++) {
    for (const player of players) {
      player.hand.push(...drawCards(piles, 1));
    }
  }

  // Official rule: a Wild Draw Four turned up as the starter is returned to the
  // deck and another card drawn. A plain Wild stays - the first player simply
  // chooses the colour to open with.
  let starter = piles.deck.pop();
  const returned: Card[] = [];
  while (starter && starter.type === 'wild_draw4') {
    returned.push(starter);
    starter = piles.deck.pop();
  }
  if (!starter) starter = { id: newId(), color: 'red', type: 'number', value: 0 };
  piles.deck.unshift(...shuffle(returned));
  piles.discardPile.push(starter);

  const state: GameState = {
    gameId: newId(),
    roomId: options.roomId,
    roomCode: options.roomCode,
    players,
    deck: piles.deck,
    discardPile: piles.discardPile,
    currentPlayerIndex: 0,
    direction: 'clockwise',
    currentColor: starter.color,
    status: 'playing',
    pendingDrawCount: 0,
    moves: [],
    rules,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  };

  if (starter.type === 'wild') {
    // The opening player names the colour, then takes their turn as normal.
    state.currentColor = 'wild';
    state.pendingColorChoice = { playerId: players[0].id, cardId: starter.id, isStarter: true };
  } else {
    // Skip / Reverse / Draw Two turned up as the starter act on the first player.
    applyStarterEffect(state, starter);
  }

  // Start the clock on the opening turn too, not just on later ones.
  state.turnStartedAt = now;
  if (rules.turnTimeoutSeconds > 0) state.turnDeadline = Date.now() + rules.turnTimeoutSeconds * 1000;

  return state;
}

/** Skip / Reverse / Draw Two showing as the first card act on the opening player. */
function applyStarterEffect(state: GameState, starter: Card): void {
  const count = state.players.length;
  switch (starter.type) {
    case 'skip':
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % count;
      break;
    case 'reverse':
      if (count === 2 && state.rules.twoPlayerReverseActsAsSkip) {
        state.currentPlayerIndex = (state.currentPlayerIndex + 1) % count;
      } else {
        state.direction = 'counter-clockwise';
        state.currentPlayerIndex = (state.currentPlayerIndex - 1 + count) % count;
      }
      break;
    case 'draw2': {
      const victim = state.players[state.currentPlayerIndex];
      const piles = { deck: state.deck, discardPile: state.discardPile };
      victim.hand.push(...drawCards(piles, 2));
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % count;
      break;
    }
    default:
      break;
  }
}

export function currentPlayer(state: GameState): Player | undefined {
  return state.players[state.currentPlayerIndex];
}

export function findPlayer(state: GameState, playerId: string): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

export function topCard(state: GameState): Card | null {
  return state.discardPile[state.discardPile.length - 1] ?? null;
}

export function toPublicPlayer(state: GameState, player: Player): PublicPlayer {
  return {
    id: player.id,
    username: player.username,
    avatar: player.avatar,
    position: player.position,
    cardCount: player.hand.length,
    isConnected: player.isConnected,
    isCurrentTurn: state.status === 'playing' && state.players[state.currentPlayerIndex]?.id === player.id,
    hasCalledUno: player.hasCalledUno,
  };
}

/**
 * The only state that ever reaches a browser. Other players contribute a card
 * *count* and nothing else - their actual cards never leave the server.
 */
export function serializeForPlayer(state: GameState, playerId: string): ClientGameState {
  const me = findPlayer(state, playerId);
  const top = topCard(state);
  const active = state.players[state.currentPlayerIndex];

  const canAct =
    !!me &&
    state.status === 'playing' &&
    active?.id === playerId &&
    !state.pendingColorChoice &&
    !state.pendingWildDrawFour &&
    !!top;

  // After drawing, the official rule lets you play *that* card - nothing else.
  const legal = canAct
    ? getPlayableCards({
        topCard: top!,
        currentColor: state.currentColor,
        rules: state.rules,
        pendingDrawCount: state.pendingDrawCount,
        hand: me!.hand,
      })
    : [];

  const drawnForMe = state.drawnCard?.playerId === playerId ? state.drawnCard.cardId : undefined;
  const playableCardIds = (drawnForMe ? legal.filter((card) => card.id === drawnForMe) : legal).map(
    (card) => card.id,
  );

  const winner = state.winnerId ? findPlayer(state, state.winnerId) : undefined;
  const challenge = state.pendingWildDrawFour;
  const bluffer = challenge ? findPlayer(state, challenge.playedBy) : undefined;

  return {
    gameId: state.gameId,
    roomId: state.roomId,
    roomCode: state.roomCode,
    players: state.players.map((player) => toPublicPlayer(state, player)),
    myHand: me ? me.hand.map((card) => ({ ...card })) : [],
    myPlayerId: playerId,
    topCard: top ? { ...top } : null,
    discardCount: state.discardPile.length,
    deckCount: state.deck.length,
    currentColor: state.currentColor,
    currentPlayerId: active?.id ?? null,
    direction: state.direction,
    status: state.status,
    winnerId: state.winnerId,
    winnerUsername: winner?.username,
    pendingColorChoiceBy: state.pendingColorChoice?.playerId,
    pendingDrawCount: state.pendingDrawCount,
    drawnCardId: drawnForMe,
    canPass: state.drawnCard?.playerId === playerId && state.status === 'playing',
    wildDrawFour: challenge
      ? {
          playedBy: challenge.playedBy,
          playedByName: bluffer?.username ?? 'A player',
          targetPlayerId: challenge.targetPlayerId,
        }
      : undefined,
    unoVulnerablePlayerId: state.unoVulnerable?.playerId,
    lastAction: state.lastAction,
    turnDeadline: state.turnDeadline,
    turnTimeoutSeconds: state.rules.turnTimeoutSeconds,
    rules: state.rules,
    playableCardIds,
    canCallUno: !!me && state.status === 'playing' && !me.hasCalledUno && me.hand.length <= 2 && me.hand.length > 0,
    updatedAt: state.updatedAt,
  };
}
