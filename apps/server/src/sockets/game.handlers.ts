import { parseOrThrow } from '../middleware/validate';
import type { PlayableColor } from '../models/card.model';
import {
  socketChooseColorSchema,
  socketGameIdSchema,
  socketPlayCardSchema,
} from '../models/schemas';
import { gameManager, gameRoomKey } from '../services/game-manager';
import { ERROR_CODES, badRequest, forbidden } from '../utils/errors';
import { handleEvent, RateBucket, type AppSocket } from './helpers';

export function registerGameHandlers(socket: AppSocket): void {
  const user = socket.data.user;
  // Sized for the fastest a person can genuinely play - a burst of 20 actions
  // then ~8/second sustained - so legitimate rapid play is never blocked while
  // a flood still is.
  const bucket = new RateBucket(20, 8);

  /**
   * Resolves the game *from the server's own records* and checks the caller is
   * actually seated at it. The client's claim about who it is never enters here.
   */
  const requireSeat = (gameId: string) => {
    if (!bucket.take()) {
      throw badRequest(ERROR_CODES.RATE_LIMITED, 'Slow down a moment.');
    }
    const engine = gameManager.require(gameId);
    if (!engine.player(user.id)) {
      throw forbidden('You are not seated at this game.', ERROR_CODES.PLAYER_NOT_IN_GAME);
    }
    // Late joiners (reconnects) need the channel too.
    void socket.join(gameRoomKey(gameId));
    return engine;
  };

  socket.on('play_card', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketPlayCardSchema, payload);
      requireSeat(input.gameId);
      gameManager.playCard(input.gameId, user.id, input.cardId, input.chosenColor as PlayableColor | undefined);
      return { accepted: true as const };
    }),
  );

  socket.on('draw_card', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketGameIdSchema, payload);
      requireSeat(input.gameId);
      gameManager.drawCard(input.gameId, user.id);
      return { accepted: true as const };
    }),
  );

  socket.on('choose_color', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketChooseColorSchema, payload);
      requireSeat(input.gameId);
      gameManager.chooseColor(input.gameId, user.id, input.color as PlayableColor);
      return { accepted: true as const };
    }),
  );

  socket.on('call_uno', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketGameIdSchema, payload);
      requireSeat(input.gameId);
      gameManager.callUno(input.gameId, user.id);
      return { accepted: true as const };
    }),
  );

  socket.on('pass_turn', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketGameIdSchema, payload);
      requireSeat(input.gameId);
      gameManager.pass(input.gameId, user.id);
      return { accepted: true as const };
    }),
  );

  socket.on('catch_uno', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketGameIdSchema, payload);
      requireSeat(input.gameId);
      gameManager.catchUno(input.gameId, user.id);
      return { accepted: true as const };
    }),
  );

  socket.on('accept_draw_four', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketGameIdSchema, payload);
      requireSeat(input.gameId);
      gameManager.acceptDrawFour(input.gameId, user.id);
      return { accepted: true as const };
    }),
  );

  socket.on('challenge_draw_four', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketGameIdSchema, payload);
      requireSeat(input.gameId);
      gameManager.challengeDrawFour(input.gameId, user.id);
      return { accepted: true as const };
    }),
  );

  socket.on('request_game_state', (payload, ack) =>
    handleEvent(socket, ack, () => {
      const input = parseOrThrow(socketGameIdSchema, payload);
      const engine = requireSeat(input.gameId);
      // Re-establish presence in case this is a reconnect.
      engine.setConnection(user.id, true, socket.id);
      return { state: engine.stateFor(user.id) };
    }),
  );

}
