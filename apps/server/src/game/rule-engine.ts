import { isWildCard, type Card, type CardColor } from '../models/card.model';
import type { GameRules } from '../models/game.model';

export interface PlayContext {
  topCard: Card;
  currentColor: CardColor;
  rules: GameRules;
  /** Outstanding +2 / +4 penalty. Non-zero only while stacking is enabled. */
  pendingDrawCount: number;
  /** The player's full hand - needed for the Wild Draw Four restriction. */
  hand: readonly Card[];
}

/**
 * Core matching rule: a card may be played when it shares the active colour, the
 * number, or the action with the card showing - and wilds are always welcome.
 */
export function matchesTopCard(card: Card, topCard: Card, currentColor: CardColor): boolean {
  if (isWildCard(card)) return true;
  if (card.color === currentColor) return true;
  if (card.type === 'number' && topCard.type === 'number') return card.value === topCard.value;
  if (card.type !== 'number' && card.type === topCard.type) return true;
  return false;
}

/**
 * While a draw penalty is outstanding (stacking enabled) the only legal replies
 * are other draw cards: a +2 may answer a +2, and a +4 may answer either.
 */
export function canStackOnPenalty(card: Card, topCard: Card): boolean {
  if (card.type === 'wild_draw4') return true;
  if (card.type === 'draw2') return topCard.type === 'draw2';
  return false;
}

/**
 * Wild Draw Four is only legal when the player holds nothing matching the active
 * colour. Number/action matches on the top card do not lift the restriction -
 * that is the official reading of the rule.
 */
export function isWildDrawFourLegal(hand: readonly Card[], cardId: string, currentColor: CardColor): boolean {
  return !hand.some((card) => card.id !== cardId && card.color === currentColor);
}

export interface PlayabilityResult {
  playable: boolean;
  /** Set when the card matches but is blocked by a rule (used for the error message). */
  reason?: 'no_match' | 'must_answer_draw' | 'wild_draw4_restricted';
}

export function checkPlayable(card: Card, context: PlayContext): PlayabilityResult {
  const { topCard, currentColor, rules, pendingDrawCount, hand } = context;

  if (pendingDrawCount > 0) {
    if (!rules.allowDrawStacking) return { playable: false, reason: 'must_answer_draw' };
    if (!canStackOnPenalty(card, topCard)) return { playable: false, reason: 'must_answer_draw' };
  } else if (!matchesTopCard(card, topCard, currentColor)) {
    return { playable: false, reason: 'no_match' };
  }

  // In the official ruleset a Wild Draw Four may always be *played* - bluffing is
  // part of the game, and the next player polices it with a challenge. Only the
  // simplified 'restricted' mode refuses it outright.
  if (
    card.type === 'wild_draw4' &&
    rules.wildDrawFourMode === 'restricted' &&
    !isWildDrawFourLegal(hand, card.id, currentColor)
  ) {
    return { playable: false, reason: 'wild_draw4_restricted' };
  }

  return { playable: true };
}

export function isPlayable(card: Card, context: PlayContext): boolean {
  return checkPlayable(card, context).playable;
}

/** Every card in hand that could legally be played right now. */
export function getPlayableCards(context: PlayContext): Card[] {
  return context.hand.filter((card) => isPlayable(card, context));
}

/** How many cards a played draw card adds to the penalty pool. */
export function drawPenaltyFor(card: Card): number {
  if (card.type === 'draw2') return 2;
  if (card.type === 'wild_draw4') return 4;
  return 0;
}
