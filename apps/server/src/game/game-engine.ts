import { cardPoints, describeCard, isPlayableColor, isWildCard, PLAYABLE_COLORS } from '../models/card.model';
import type { Card, CardColor, PlayableColor } from '../models/card.model';
import type {
  ClientGameState,
  GameAction,
  GameActionType,
  GameResultPlayer,
  GameState,
  Player,
} from '../models/game.model';
import { AppError, ERROR_CODES, badRequest, forbidden, notFound } from '../utils/errors';
import { drawCards } from './deck-manager';
import { checkPlayable, drawPenaltyFor, getPlayableCards, isWildDrawFourLegal } from './rule-engine';
import { createGameState, currentPlayer, findPlayer, serializeForPlayer, topCard, type CreateGameOptions } from './game-state';
import { flip, seatAfter } from './turn-manager';

export type EngineEvent =
  | { type: 'card_played'; action: GameAction }
  | { type: 'card_drawn'; playerId: string; username: string; count: number }
  | { type: 'color_choice_required'; playerId: string }
  | { type: 'color_changed'; color: PlayableColor; playerId: string }
  | { type: 'uno_called'; playerId: string; username: string }
  | { type: 'uno_penalty'; playerId: string; username: string; cards: number; caughtBy?: string }
  | { type: 'turn_passed'; playerId: string; username: string }
  | {
      type: 'draw_four_challenge';
      challengerId: string;
      challengerName: string;
      accusedId: string;
      accusedName: string;
      wasBluff: boolean;
      cards: number;
    }
  | { type: 'turn_changed'; currentPlayerId: string; deadline?: number }
  | {
      type: 'game_finished';
      winnerId: string | null;
      winnerUsername: string | null;
      results: GameResultPlayer[];
      durationMs: number;
    };

export interface EngineResult {
  events: EngineEvent[];
}

/**
 * The single source of truth for one game.
 *
 * Nothing here knows about sockets, HTTP or persistence: every method takes a
 * player id plus an intent, validates it against the server's own state, and
 * returns the events that happened. That keeps it exhaustively unit-testable
 * and makes client-supplied state impossible to trust by construction.
 */
export class GameEngine {
  readonly state: GameState;

  /**
   * Whether the Wild Draw Four currently in flight was a bluff. Captured while
   * the card is still in hand, then consumed when the effect resolves - which
   * may be a beat later, if the colour choice was deferred.
   */
  private pendingBluff?: { wasBluff: boolean; colorBefore: CardColor };

  constructor(state: GameState) {
    this.state = state;
  }

  static create(options: CreateGameOptions): GameEngine {
    return new GameEngine(createGameState(options));
  }

  /* ----------------------------- read helpers ----------------------------- */

  get id(): string {
    return this.state.gameId;
  }

  get isFinished(): boolean {
    return this.state.status === 'finished';
  }

  stateFor(playerId: string): ClientGameState {
    return serializeForPlayer(this.state, playerId);
  }

  player(playerId: string): Player | undefined {
    return findPlayer(this.state, playerId);
  }

  /* ------------------------------- actions -------------------------------- */

  playCard(playerId: string, cardId: string, chosenColor?: PlayableColor): EngineResult {
    const player = this.requireActivePlayer(playerId);
    const top = topCard(this.state);
    if (!top) throw badRequest(ERROR_CODES.INTERNAL_ERROR, 'The discard pile is empty.');
    this.closeUnoWindow(playerId);

    const index = player.hand.findIndex((card) => card.id === cardId);
    if (index === -1) throw badRequest(ERROR_CODES.CARD_NOT_IN_HAND, 'That card is not in your hand.');
    const card = player.hand[index];

    // Official rule: once you have drawn, the only card you may play is the one
    // you just drew. Everything else waits for your next turn.
    const drawn = this.state.drawnCard;
    if (drawn && drawn.playerId === playerId && drawn.cardId !== cardId) {
      throw badRequest(ERROR_CODES.MUST_PLAY_OR_PASS, 'You may only play the card you just drew, or pass.');
    }

    const verdict = checkPlayable(card, {
      topCard: top,
      currentColor: this.state.currentColor,
      rules: this.state.rules,
      pendingDrawCount: this.state.pendingDrawCount,
      hand: player.hand,
    });

    if (!verdict.playable) {
      if (verdict.reason === 'must_answer_draw') {
        throw badRequest(
          ERROR_CODES.MUST_RESOLVE_DRAW,
          `You must draw ${this.state.pendingDrawCount} cards before playing.`,
        );
      }
      if (verdict.reason === 'wild_draw4_restricted') {
        throw badRequest(
          ERROR_CODES.WILD_DRAW_FOUR_ILLEGAL,
          'Wild Draw Four is only legal when you hold no card of the current colour.',
        );
      }
      throw badRequest(ERROR_CODES.INVALID_CARD, `${describeCard(card)} does not match the card in play.`);
    }

    if (chosenColor !== undefined && !isPlayableColor(chosenColor)) {
      throw badRequest(ERROR_CODES.INVALID_COLOR, 'Pick red, yellow, green or blue.');
    }

    // Judged before the card leaves the hand: did they hold the current colour?
    const wasBluff =
      card.type === 'wild_draw4' && !isWildDrawFourLegal(player.hand, card.id, this.state.currentColor);
    const colorBefore = this.state.currentColor;

    // Commit the play.
    this.state.drawnCard = undefined;
    player.hand.splice(index, 1);
    player.cardsPlayed += 1;
    this.state.discardPile.push(card);
    this.recordMove(playerId, 'play_card', { cardId: card.id, color: chosenColor });

    const events: EngineEvent[] = [];
    const action: GameAction = {
      type: 'play_card',
      playerId,
      playerName: player.username,
      cardId: card.id,
      card: { ...card },
      color: chosenColor,
      timestamp: new Date().toISOString(),
    };
    this.state.lastAction = action;
    events.push({ type: 'card_played', action });

    if (card.type === 'wild_draw4') {
      this.pendingBluff = { wasBluff, colorBefore };
    }

    if (isWildCard(card)) {
      if (chosenColor) {
        this.state.currentColor = chosenColor;
        events.push({ type: 'color_changed', color: chosenColor, playerId });
      } else if (player.hand.length > 0) {
        // Freeze the game until this player picks a colour.
        this.state.pendingColorChoice = { playerId, cardId: card.id };
        this.state.turnDeadline = this.deadline();
        this.touch();
        events.push({ type: 'color_choice_required', playerId });
        return { events };
      }
    } else {
      this.state.currentColor = card.color;
    }

    events.push(...this.finalizePlay(card, player));
    this.touch();
    return { events };
  }

  chooseColor(playerId: string, color: PlayableColor): EngineResult {
    this.assertPlaying();
    const pending = this.state.pendingColorChoice;
    if (!pending) throw badRequest(ERROR_CODES.NO_COLOR_PENDING, 'No colour choice is pending.');
    if (pending.playerId !== playerId) {
      throw forbidden('It is not your colour to choose.', ERROR_CODES.NOT_AUTHORIZED);
    }
    if (!isPlayableColor(color)) throw badRequest(ERROR_CODES.INVALID_COLOR, 'Pick red, yellow, green or blue.');

    const player = this.requirePlayer(playerId);
    const played = this.state.discardPile[this.state.discardPile.length - 1];
    const wasStarter = pending.isStarter === true;

    this.state.currentColor = color;
    this.state.pendingColorChoice = undefined;
    this.recordMove(playerId, 'choose_color', { color });

    const events: EngineEvent[] = [{ type: 'color_changed', color, playerId }];

    if (wasStarter) {
      // Official rule: when a Wild is turned up to start, the first player names
      // the colour and then still takes their turn.
      this.state.turnStartedAt = new Date().toISOString();
      this.state.turnDeadline = this.deadline();
      this.touch();
      return { events };
    }

    events.push(...this.finalizePlay(played, player));
    this.touch();
    return { events };
  }

  /**
   * Official draw rule: take one card, and if it can be played you *may* play
   * it - otherwise your turn ends there. An outstanding stacked penalty is
   * taken in full instead, and always costs you the turn.
   */
  drawCard(playerId: string): EngineResult {
    const player = this.requireActivePlayer(playerId);
    if (this.state.drawnCard?.playerId === playerId) {
      throw badRequest(ERROR_CODES.MUST_PLAY_OR_PASS, 'You have already drawn. Play that card or pass.');
    }
    this.closeUnoWindow(playerId);

    const events: EngineEvent[] = [];
    const penalty = this.state.pendingDrawCount;
    const drawn = this.draw(player, penalty > 0 ? penalty : 1);
    this.state.pendingDrawCount = 0;

    this.recordMove(playerId, 'draw_card', { count: drawn.length });
    this.state.lastAction = {
      type: 'draw_card',
      playerId,
      playerName: player.username,
      count: drawn.length,
      timestamp: new Date().toISOString(),
    };
    events.push({ type: 'card_drawn', playerId, username: player.username, count: drawn.length });

    const top = topCard(this.state);
    const canPlayIt =
      penalty === 0 &&
      drawn.length === 1 &&
      !!top &&
      checkPlayable(drawn[0], {
        topCard: top,
        currentColor: this.state.currentColor,
        rules: this.state.rules,
        pendingDrawCount: 0,
        hand: player.hand,
      }).playable;

    if (canPlayIt) {
      // The turn stays put: they play the drawn card, or pass.
      this.state.drawnCard = { playerId, cardId: drawn[0].id };
      this.state.turnStartedAt = new Date().toISOString();
      this.state.turnDeadline = this.deadline();
      this.touch();
      return { events };
    }

    this.advance(1);
    events.push(...this.turnChangedEvent());
    this.touch();
    return { events };
  }

  /** Ends your turn after drawing a card you have chosen not to play. */
  pass(playerId: string): EngineResult {
    const player = this.requireActivePlayer(playerId);
    const drawn = this.state.drawnCard;
    if (!drawn || drawn.playerId !== playerId) {
      throw badRequest(ERROR_CODES.CANNOT_PASS, 'You can only pass after drawing a card.');
    }

    this.closeUnoWindow(playerId);
    this.state.drawnCard = undefined;
    this.recordMove(playerId, 'pass_turn', {});
    this.state.lastAction = {
      type: 'pass_turn',
      playerId,
      playerName: player.username,
      timestamp: new Date().toISOString(),
    };

    this.advance(1);
    this.touch();
    return {
      events: [{ type: 'turn_passed', playerId, username: player.username }, ...this.turnChangedEvent()],
    };
  }

  /* ------------------------ Wild Draw Four challenge ----------------------- */

  /** Take the four cards without arguing, and lose the turn. */
  acceptDrawFour(playerId: string): EngineResult {
    this.requireChallenge(playerId);
    const player = this.requirePlayer(playerId);

    this.state.pendingWildDrawFour = undefined;
    const drawn = this.draw(player, 4);
    this.recordMove(playerId, 'accept_draw_four', { count: drawn.length });

    const events: EngineEvent[] = [
      { type: 'card_drawn', playerId, username: player.username, count: drawn.length },
    ];
    this.advance(1);
    events.push(...this.turnChangedEvent());
    this.touch();
    return { events };
  }

  /**
   * Official challenge: the accused shows their hand.
   *  - Bluffing (they held the colour): they draw 4, and the challenger plays on.
   *  - Honest: the challenger draws the 4 plus 2 more, and loses the turn.
   */
  challengeDrawFour(playerId: string): EngineResult {
    const pending = this.requireChallenge(playerId);
    const challenger = this.requirePlayer(playerId);
    const accused = this.requirePlayer(pending.playedBy);

    this.state.pendingWildDrawFour = undefined;
    this.recordMove(playerId, 'challenge_draw_four', {});

    const events: EngineEvent[] = [];
    const punished = pending.wasBluff ? accused : challenger;
    const cards = pending.wasBluff ? 4 : 6;
    const drawn = this.draw(punished, cards);

    events.push({
      type: 'draw_four_challenge',
      challengerId: challenger.id,
      challengerName: challenger.username,
      accusedId: accused.id,
      accusedName: accused.username,
      wasBluff: pending.wasBluff,
      cards: drawn.length,
    });
    events.push({
      type: 'card_drawn',
      playerId: punished.id,
      username: punished.username,
      count: drawn.length,
    });

    if (pending.wasBluff) {
      // The challenge stuck: the turn is still the challenger's to play.
      this.state.turnStartedAt = new Date().toISOString();
      this.state.turnDeadline = this.deadline();
    } else {
      this.advance(1);
    }

    events.push(...this.turnChangedEvent());
    this.touch();
    return { events };
  }

  private requireChallenge(playerId: string) {
    this.assertPlaying();
    const pending = this.state.pendingWildDrawFour;
    if (!pending) throw badRequest(ERROR_CODES.NO_CHALLENGE_PENDING, 'There is no Wild Draw Four to answer.');
    if (pending.targetPlayerId !== playerId) {
      throw forbidden('That Wild Draw Four is not yours to answer.', ERROR_CODES.NOT_CHALLENGE_TARGET);
    }
    return pending;
  }

  callUno(playerId: string): EngineResult {
    this.assertPlaying();
    const player = this.requirePlayer(playerId);

    if (player.hasCalledUno) {
      throw badRequest(ERROR_CODES.INVALID_UNO_CALL, 'You have already called UNO.');
    }
    // Legal either as a pre-call on your own turn with two cards, or once you
    // are actually down to one.
    const isMyTurn = currentPlayer(this.state)?.id === playerId;
    const legal = player.hand.length === 1 || (player.hand.length === 2 && isMyTurn);
    if (!legal) {
      throw badRequest(ERROR_CODES.INVALID_UNO_CALL, 'You can only call UNO when you are down to your last card.');
    }

    player.hasCalledUno = true;
    player.unoCalls += 1;
    if (this.state.unoVulnerable?.playerId === playerId) this.state.unoVulnerable = undefined;
    this.recordMove(playerId, 'call_uno', {});
    this.touch();

    return { events: [{ type: 'uno_called', playerId, username: player.username }] };
  }

  /**
   * Official UNO: forgetting to call it only costs you if somebody notices.
   * Any other player may catch the offender until the next player has taken
   * their turn, at which point the window closes.
   */
  catchUno(catcherId: string): EngineResult {
    this.assertPlaying();
    const catcher = this.requirePlayer(catcherId);

    const vulnerable = this.state.unoVulnerable;
    if (!vulnerable) throw badRequest(ERROR_CODES.INVALID_UNO_CATCH, 'Nobody has forgotten to call UNO.');
    if (vulnerable.playerId === catcherId) {
      throw badRequest(ERROR_CODES.INVALID_UNO_CATCH, 'You cannot catch yourself - just call UNO.');
    }

    const target = findPlayer(this.state, vulnerable.playerId);
    this.state.unoVulnerable = undefined;
    if (!target || target.hasCalledUno || target.hand.length !== 1) {
      throw badRequest(ERROR_CODES.INVALID_UNO_CATCH, 'Too late - that call is no longer open.');
    }

    const drawn = this.draw(target, this.state.rules.unoPenaltyCards);
    this.recordMove(catcherId, 'uno_penalty', { count: drawn.length });
    this.touch();

    return {
      events: [
        {
          type: 'uno_penalty',
          playerId: target.id,
          username: target.username,
          cards: drawn.length,
          caughtBy: catcher.username,
        },
      ],
    };
  }

  /**
   * House-rule fallback used only when `rules.unoAutoPenalty` is on: the server
   * plays the part of the player who would otherwise have shouted "caught you".
   */
  resolveUnoPenalty(playerId: string): EngineResult {
    const vulnerable = this.state.unoVulnerable;
    if (this.isFinished || !this.state.rules.unoAutoPenalty) return { events: [] };
    if (!vulnerable || vulnerable.playerId !== playerId) return { events: [] };

    const player = findPlayer(this.state, playerId);
    this.state.unoVulnerable = undefined;
    if (!player || player.hasCalledUno || player.hand.length !== 1) return { events: [] };

    const drawn = this.draw(player, this.state.rules.unoPenaltyCards);
    this.recordMove(playerId, 'uno_penalty', { count: drawn.length });
    this.touch();

    return {
      events: [{ type: 'uno_penalty', playerId, username: player.username, cards: drawn.length }],
    };
  }

  /** The UNO window shuts as soon as the next player acts. */
  private closeUnoWindow(actorId: string): void {
    const vulnerable = this.state.unoVulnerable;
    if (vulnerable && vulnerable.playerId !== actorId) this.state.unoVulnerable = undefined;
  }

  /**
   * The turn clock ran out. Picks a colour for a stalled wild, otherwise draws
   * for the player and passes the turn on.
   */
  handleTurnTimeout(): EngineResult {
    if (this.isFinished) return { events: [] };

    // An unanswered Wild Draw Four is simply accepted.
    const challenge = this.state.pendingWildDrawFour;
    if (challenge) {
      this.recordMove(challenge.targetPlayerId, 'turn_timeout', {});
      return this.acceptDrawFour(challenge.targetPlayerId);
    }

    // A drawn card left unplayed ends the turn.
    const drawn = this.state.drawnCard;
    if (drawn) {
      this.recordMove(drawn.playerId, 'turn_timeout', {});
      return this.pass(drawn.playerId);
    }

    const pending = this.state.pendingColorChoice;
    if (pending) {
      const player = findPlayer(this.state, pending.playerId);
      const color = this.mostCommonColorIn(player) ?? 'red';
      this.recordMove(pending.playerId, 'turn_timeout', { color });
      return this.chooseColor(pending.playerId, color);
    }

    const active = currentPlayer(this.state);
    if (!active) return { events: [] };
    this.recordMove(active.id, 'turn_timeout', {});
    return this.drawCard(active.id);
  }

  /* --------------------------- presence handling --------------------------- */

  setConnection(playerId: string, isConnected: boolean, socketId?: string): boolean {
    const player = findPlayer(this.state, playerId);
    if (!player) return false;
    player.isConnected = isConnected;
    player.socketId = isConnected ? socketId : undefined;
    player.disconnectedAt = isConnected ? undefined : Date.now();
    this.touch();
    return true;
  }

  connectedPlayers(): Player[] {
    return this.state.players.filter((player) => player.isConnected);
  }

  /** Ends the game early, e.g. when everyone else abandoned the table. */
  finishGame(winnerId: string | null): EngineResult {
    if (this.isFinished) return { events: [] };
    return { events: [this.finish(winnerId)] };
  }

  /* ------------------------------- internals ------------------------------- */

  private finalizePlay(card: Card, player: Player): EngineEvent[] {
    const events: EngineEvent[] = [];

    // Down to one card without calling it: open to being caught until the next
    // player acts. `unoAutoPenalty` adds a deadline for the house-rule variant.
    if (player.hand.length === 1 && !player.hasCalledUno) {
      this.state.unoVulnerable = {
        playerId: player.id,
        deadline: this.state.rules.unoAutoPenalty
          ? Date.now() + this.state.rules.unoGraceSeconds * 1000
          : undefined,
      };
    }
    if (player.hand.length !== 1) {
      player.hasCalledUno = false;
      if (this.state.unoVulnerable?.playerId === player.id) this.state.unoVulnerable = undefined;
    }

    // Winner check happens before any turn movement.
    if (player.hand.length === 0) {
      this.applyCardEffect(card, player, { advanceAfterEffect: false });
      events.push(this.finish(player.id));
      return events;
    }

    events.push(...this.applyCardEffect(card, player, { advanceAfterEffect: true }));
    events.push(...this.turnChangedEvent());
    return events;
  }

  /**
   * Moves the turn on and applies Skip / Reverse / Draw penalties.
   * With stacking enabled a draw card only grows the pending pool - the next
   * player then chooses between stacking again and taking the whole pile.
   */
  private applyCardEffect(
    card: Card,
    actor: Player,
    options: { advanceAfterEffect: boolean },
  ): EngineEvent[] {
    const events: EngineEvent[] = [];
    const count = this.state.players.length;
    const twoPlayerSkip = count === 2 && this.state.rules.twoPlayerReverseActsAsSkip;

    switch (card.type) {
      case 'skip':
        if (options.advanceAfterEffect) this.advance(2);
        break;

      case 'reverse':
        if (twoPlayerSkip) {
          if (options.advanceAfterEffect) this.advance(2);
        } else {
          this.state.direction = flip(this.state.direction);
          if (options.advanceAfterEffect) this.advance(1);
        }
        break;

      case 'draw2':
      case 'wild_draw4': {
        const penalty = drawPenaltyFor(card);
        const bluff = this.pendingBluff;
        this.pendingBluff = undefined;

        if (this.state.rules.allowDrawStacking) {
          this.state.pendingDrawCount += penalty;
          if (options.advanceAfterEffect) this.advance(1);
          break;
        }

        // Official Wild Draw Four: the next player gets to accept it or call the
        // bluff before anything is drawn. (Skipped on a winning card - the hand
        // is already over, so the penalty just applies.)
        if (
          card.type === 'wild_draw4' &&
          this.state.rules.wildDrawFourMode === 'challenge' &&
          options.advanceAfterEffect
        ) {
          this.advance(1);
          const target = currentPlayer(this.state);
          if (target) {
            this.state.pendingWildDrawFour = {
              playedBy: actor.id,
              targetPlayerId: target.id,
              wasBluff: bluff?.wasBluff ?? false,
              colorBefore: bluff?.colorBefore ?? this.state.currentColor,
            };
          }
          break;
        }

        const victimIndex = seatAfter(this.state.currentPlayerIndex, count, this.state.direction, 1);
        const victim = this.state.players[victimIndex];
        if (victim) {
          const drawn = this.draw(victim, penalty);
          events.push({ type: 'card_drawn', playerId: victim.id, username: victim.username, count: drawn.length });
        }
        // The penalised player also loses their turn.
        if (options.advanceAfterEffect) this.advance(2);
        break;
      }

      default:
        if (options.advanceAfterEffect) this.advance(1);
        break;
    }

    return events;
  }

  private advance(steps: number): void {
    this.state.currentPlayerIndex = seatAfter(
      this.state.currentPlayerIndex,
      this.state.players.length,
      this.state.direction,
      steps,
    );
    this.state.turnStartedAt = new Date().toISOString();
    this.state.turnDeadline = this.deadline();
  }

  private deadline(): number | undefined {
    const seconds = this.state.rules.turnTimeoutSeconds;
    return seconds > 0 ? Date.now() + seconds * 1000 : undefined;
  }

  private turnChangedEvent(): EngineEvent[] {
    const active = currentPlayer(this.state);
    if (!active) return [];
    return [{ type: 'turn_changed', currentPlayerId: active.id, deadline: this.state.turnDeadline }];
  }

  private draw(player: Player, count: number): Card[] {
    const drawn = drawCards({ deck: this.state.deck, discardPile: this.state.discardPile }, count);
    player.hand.push(...drawn);
    if (player.hand.length > 1) {
      player.hasCalledUno = false;
      if (this.state.unoVulnerable?.playerId === player.id) this.state.unoVulnerable = undefined;
    }
    return drawn;
  }

  private finish(winnerId: string | null): EngineEvent {
    const now = new Date().toISOString();
    this.state.status = 'finished';
    this.state.winnerId = winnerId ?? undefined;
    this.state.finishedAt = now;
    this.state.turnDeadline = undefined;
    this.state.pendingColorChoice = undefined;
    this.state.unoVulnerable = undefined;
    this.state.drawnCard = undefined;
    this.state.pendingWildDrawFour = undefined;
    this.touch();

    const winner = winnerId ? findPlayer(this.state, winnerId) : undefined;
    const results = this.results(winnerId);
    const startedAt = this.state.startedAt ? Date.parse(this.state.startedAt) : Date.parse(this.state.createdAt);

    return {
      type: 'game_finished',
      winnerId: winnerId,
      winnerUsername: winner?.username ?? null,
      results,
      durationMs: Math.max(0, Date.parse(now) - startedAt),
    };
  }

  results(winnerId: string | null = this.state.winnerId ?? null): GameResultPlayer[] {
    return this.state.players.map((player) => ({
      id: player.id,
      username: player.username,
      avatar: player.avatar,
      cardsLeft: player.hand.length,
      points: player.hand.reduce((total, card) => total + cardPoints(card), 0),
      cardsPlayed: player.cardsPlayed,
      unoCalls: player.unoCalls,
      isWinner: player.id === winnerId,
    }));
  }

  private mostCommonColorIn(player: Player | undefined): PlayableColor | null {
    if (!player || player.hand.length === 0) return null;
    const tally = new Map<PlayableColor, number>();
    for (const card of player.hand) {
      if (card.color === 'wild') continue;
      tally.set(card.color, (tally.get(card.color) ?? 0) + 1);
    }
    let best: PlayableColor | null = null;
    let bestCount = -1;
    for (const color of PLAYABLE_COLORS) {
      const value = tally.get(color) ?? 0;
      if (value > bestCount) {
        best = color;
        bestCount = value;
      }
    }
    return best;
  }

  private recordMove(
    playerId: string,
    action: GameActionType,
    extra: { cardId?: string; color?: CardColor; count?: number },
  ): void {
    this.state.moves.push({
      playerId,
      action,
      cardId: extra.cardId,
      color: extra.color,
      count: extra.count,
      timestamp: new Date().toISOString(),
    });
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
  }

  /* ------------------------------- guards --------------------------------- */

  private assertPlaying(): void {
    if (this.state.status === 'finished') {
      throw new AppError(ERROR_CODES.GAME_FINISHED, 'This game has already finished.', 409);
    }
    if (this.state.status !== 'playing') {
      throw new AppError(ERROR_CODES.GAME_NOT_STARTED, 'This game has not started yet.', 409);
    }
  }

  private requirePlayer(playerId: string): Player {
    const player = findPlayer(this.state, playerId);
    if (!player) throw notFound(ERROR_CODES.PLAYER_NOT_IN_GAME, 'You are not part of this game.');
    return player;
  }

  private requireActivePlayer(playerId: string): Player {
    this.assertPlaying();
    if (this.state.pendingColorChoice) {
      throw badRequest(ERROR_CODES.COLOR_REQUIRED, 'Waiting for a colour to be chosen.');
    }
    if (this.state.pendingWildDrawFour) {
      throw badRequest(ERROR_CODES.CHALLENGE_PENDING, 'The Wild Draw Four has to be answered first.');
    }
    const player = this.requirePlayer(playerId);
    const active = currentPlayer(this.state);
    if (!active || active.id !== playerId) {
      throw badRequest(ERROR_CODES.NOT_YOUR_TURN, 'It is not your turn.');
    }
    return player;
  }

  /** Exposed for tests and for the "can I act?" hints the client renders. */
  playableCardsFor(playerId: string): Card[] {
    const player = findPlayer(this.state, playerId);
    const top = topCard(this.state);
    if (!player || !top) return [];
    return getPlayableCards({
      topCard: top,
      currentColor: this.state.currentColor,
      rules: this.state.rules,
      pendingDrawCount: this.state.pendingDrawCount,
      hand: player.hand,
    });
  }
}
