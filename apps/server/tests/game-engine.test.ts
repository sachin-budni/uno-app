import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/game-engine';
import { AppError } from '../src/utils/errors';
import { card, currentId, handOf, num, table, topOf } from './helpers';

describe('setting up a game', () => {
  const engine = GameEngine.create({
    roomId: 'r1',
    roomCode: 'ABC123',
    seats: [
      { id: 'p1', username: 'Sachin' },
      { id: 'p2', username: 'Rahul' },
      { id: 'p3', username: 'Anil' },
    ],
    rules: { turnTimeoutSeconds: 0 },
  });

  // This engine is built from a real shuffled deck, so the starter card varies
  // run to run. A Skip / Reverse / Draw Two starter legitimately acts on the
  // opening player, so these assertions follow that rule instead of assuming a
  // plain number turns up - otherwise the suite fails roughly one run in four.
  const starter = engine.state.discardPile[0];

  it('deals the configured hand size to everyone', () => {
    const handSize = engine.state.rules.initialHandSize;
    engine.state.players.forEach((player, seat) => {
      // A Draw Two starter makes the opening seat pick up two before play.
      const expected = starter.type === 'draw2' && seat === 0 ? handSize + 2 : handSize;
      expect(player.hand).toHaveLength(expected);
    });
  });

  it('never turns up a Wild Draw Four - that one goes back in the deck', () => {
    expect(engine.state.discardPile).toHaveLength(1);
    expect(starter.type).not.toBe('wild_draw4');
  });

  it('opens on the starter colour, or asks the first player to name one', () => {
    if (starter.type === 'wild') {
      // Official: a Wild turned up means the opening player picks the colour.
      expect(engine.state.currentColor).toBe('wild');
      expect(engine.state.pendingColorChoice).toMatchObject({ playerId: 'p1', isStarter: true });
    } else {
      expect(engine.state.currentColor).toBe(starter.color);
      expect(engine.state.pendingColorChoice).toBeUndefined();
    }
  });

  it('conserves the deck: hands + deck + discard is always 108', () => {
    const inHands = engine.state.players.reduce((total, player) => total + player.hand.length, 0);
    expect(inHands + engine.state.deck.length + engine.state.discardPile.length).toBe(108);
  });

  it('starts as playing, with the starter card deciding who acts first', () => {
    expect(engine.state.status).toBe('playing');
    const active = engine.state.players[engine.state.currentPlayerIndex].id;

    switch (starter.type) {
      case 'skip':
      case 'draw2':
        // The opening seat is skipped (or penalised and skipped).
        expect(active).toBe('p2');
        expect(engine.state.direction).toBe('clockwise');
        break;
      case 'wild':
        // A Wild does not move the turn - p1 names the colour and plays.
        expect(active).toBe('p1');
        expect(engine.state.direction).toBe('clockwise');
        break;
      case 'reverse':
        // Direction flips before the first turn, so play starts the other way.
        expect(active).toBe('p3');
        expect(engine.state.direction).toBe('counter-clockwise');
        break;
      default:
        expect(active).toBe('p1');
        expect(engine.state.direction).toBe('clockwise');
    }
  });

  it('puts the opening turn on the clock', () => {
    // Regression: the first player used to get no turn deadline at all, so the
    // countdown never showed and the timeout never fired until someone moved.
    const timed = GameEngine.create({
      roomId: 'r2',
      roomCode: 'TIMED1',
      seats: [
        { id: 'p1', username: 'Sachin' },
        { id: 'p2', username: 'Rahul' },
      ],
      rules: { turnTimeoutSeconds: 30 },
    });

    expect(timed.state.turnStartedAt).toBeTruthy();
    expect(timed.state.turnDeadline).toBeGreaterThan(Date.now());
    expect(timed.stateFor('p1').turnDeadline).toBe(timed.state.turnDeadline);
  });

  it('leaves the clock off when the timeout is disabled', () => {
    const untimed = GameEngine.create({
      roomId: 'r3',
      roomCode: 'UNTIME',
      seats: [
        { id: 'p1', username: 'Sachin' },
        { id: 'p2', username: 'Rahul' },
      ],
      rules: { turnTimeoutSeconds: 0 },
    });

    expect(untimed.state.turnDeadline).toBeUndefined();
  });
});

describe('a Wild turned up as the starter', () => {
  it('lets the first player name the colour and then still take their turn', () => {
    const { engine } = table({ hands: [[num('blue', 4), num('red', 9)], [num('green', 2)]] });

    // Rebuild the opening position by hand: a Wild showing, colour unset.
    const wild = card('wild', 'wild');
    engine.state.discardPile = [wild];
    engine.state.currentColor = 'wild';
    engine.state.currentPlayerIndex = 0;
    engine.state.pendingColorChoice = { playerId: 'p1', cardId: wild.id, isStarter: true };

    engine.chooseColor('p1', 'blue');

    expect(engine.state.currentColor).toBe('blue');
    expect(engine.state.pendingColorChoice).toBeUndefined();
    // The turn has not moved on - p1 still plays.
    expect(currentId(engine)).toBe('p1');

    engine.playCard('p1', handOf(engine, 'p1')[0].id);
    expect(currentId(engine)).toBe('p2');
  });
});

describe('playing a card', () => {
  it('accepts a legal card, moves it to the discard pile and passes the turn', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3, num('blue', 1)], [num('green', 2)]], top: num('red', 7) });

    engine.playCard('p1', red3.id);

    expect(topOf(engine).id).toBe(red3.id);
    expect(handOf(engine, 'p1')).toHaveLength(1);
    expect(currentId(engine)).toBe('p2');
    expect(engine.state.currentColor).toBe('red');
  });

  it('rejects a card that does not match', () => {
    const blue3 = num('blue', 3);
    const { engine } = table({ hands: [[blue3, num('red', 1)], [num('green', 2)]], top: num('red', 7) });

    expect(() => engine.playCard('p1', blue3.id)).toThrowError(/does not match/i);
    expect(handOf(engine, 'p1')).toHaveLength(2);
    expect(currentId(engine)).toBe('p1');
  });

  it('rejects a card the player does not hold, even if it would be legal', () => {
    const { engine } = table({ hands: [[num('red', 3)], [num('red', 5)]], top: num('red', 7) });
    const stolen = handOf(engine, 'p2')[0];

    expect(() => engine.playCard('p1', stolen.id)).toThrowError(/not in your hand/i);
    expect(() => engine.playCard('p1', 'a-card-that-does-not-exist')).toThrowError(/not in your hand/i);
  });

  it('rejects a play from someone whose turn it is not', () => {
    const p2card = num('red', 5);
    const { engine } = table({ hands: [[num('red', 3)], [p2card]], top: num('red', 7) });

    const error = (() => {
      try {
        engine.playCard('p2', p2card.id);
      } catch (thrown) {
        return thrown as AppError;
      }
    })();

    expect(error?.code).toBe('NOT_YOUR_TURN');
  });

  it('rejects a play from someone who is not in the game at all', () => {
    const { engine } = table();
    expect(() => engine.playCard('intruder', 'x')).toThrowError(/not part of this game/i);
  });
});

describe('skip', () => {
  it('jumps over the next player with three at the table', () => {
    const skip = card('red', 'skip');
    const { engine } = table({ players: 3, hands: [[skip, num('red', 1)], [num('red', 2)], [num('red', 3)]] });

    engine.playCard('p1', skip.id);
    expect(currentId(engine)).toBe('p3');
  });

  it('returns the turn to the same player with two at the table', () => {
    const skip = card('red', 'skip');
    const { engine } = table({ hands: [[skip, num('red', 1)], [num('red', 2)]] });

    engine.playCard('p1', skip.id);
    expect(currentId(engine)).toBe('p1');
  });
});

describe('reverse', () => {
  it('flips the direction with more than two players', () => {
    const reverse = card('red', 'reverse');
    const { engine } = table({ players: 4, hands: [[reverse, num('red', 1)], [], [], []] });
    engine.state.players.forEach((player, index) => {
      if (index > 0) player.hand = [num('red', index)];
    });

    engine.playCard('p1', reverse.id);

    expect(engine.state.direction).toBe('counter-clockwise');
    expect(currentId(engine)).toBe('p4');
  });

  it('acts as a skip with two players when configured that way', () => {
    const reverse = card('red', 'reverse');
    const { engine } = table({
      hands: [[reverse, num('red', 1)], [num('red', 2)]],
      rules: { twoPlayerReverseActsAsSkip: true },
    });

    engine.playCard('p1', reverse.id);
    expect(currentId(engine)).toBe('p1');
  });

  it('passes the turn normally with two players when the skip rule is off', () => {
    const reverse = card('red', 'reverse');
    const { engine } = table({
      hands: [[reverse, num('red', 1)], [num('red', 2)]],
      rules: { twoPlayerReverseActsAsSkip: false },
    });

    engine.playCard('p1', reverse.id);
    expect(engine.state.direction).toBe('counter-clockwise');
    expect(currentId(engine)).toBe('p2');
  });
});

describe('draw two', () => {
  it('makes the next player draw two and lose their turn', () => {
    const draw2 = card('red', 'draw2');
    const { engine } = table({ players: 3, hands: [[draw2, num('red', 1)], [num('red', 2)], [num('red', 3)]] });

    engine.playCard('p1', draw2.id);

    expect(handOf(engine, 'p2')).toHaveLength(3);
    expect(currentId(engine)).toBe('p3');
  });

  it('accumulates instead of drawing when stacking is enabled', () => {
    const first = card('red', 'draw2');
    const second = card('blue', 'draw2');
    const { engine } = table({
      hands: [[first, num('red', 1)], [second, num('blue', 1)]],
      rules: { allowDrawStacking: true },
    });

    engine.playCard('p1', first.id);
    expect(engine.state.pendingDrawCount).toBe(2);
    expect(handOf(engine, 'p2')).toHaveLength(2);
    expect(currentId(engine)).toBe('p2');

    engine.playCard('p2', second.id);
    expect(engine.state.pendingDrawCount).toBe(4);
    expect(currentId(engine)).toBe('p1');

    // The player who cannot stack takes the whole pile and loses the turn.
    engine.drawCard('p1');
    expect(handOf(engine, 'p1')).toHaveLength(1 + 4);
    expect(engine.state.pendingDrawCount).toBe(0);
    expect(currentId(engine)).toBe('p2');
  });

  it('refuses an ordinary card while a stacked penalty is outstanding', () => {
    const draw2 = card('red', 'draw2');
    const plain = num('red', 1);
    const { engine } = table({
      hands: [[draw2, num('red', 6)], [plain, num('red', 4)]],
      rules: { allowDrawStacking: true },
    });

    engine.playCard('p1', draw2.id);
    expect(() => engine.playCard('p2', plain.id)).toThrowError(/must draw/i);
  });
});

describe('wild', () => {
  it('sets the colour when one is supplied with the play', () => {
    const wild = card('wild', 'wild');
    const { engine } = table({ hands: [[wild, num('red', 1)], [num('blue', 2)]] });

    engine.playCard('p1', wild.id, 'blue');

    expect(engine.state.currentColor).toBe('blue');
    expect(engine.state.pendingColorChoice).toBeUndefined();
    expect(currentId(engine)).toBe('p2');
  });

  it('freezes the table until a colour is chosen when none was supplied', () => {
    const wild = card('wild', 'wild');
    const { engine } = table({ hands: [[wild, num('red', 1)], [num('blue', 2)]] });

    engine.playCard('p1', wild.id);

    expect(engine.state.pendingColorChoice?.playerId).toBe('p1');
    expect(currentId(engine)).toBe('p1');
    expect(() => engine.drawCard('p1')).toThrowError(/colour/i);

    engine.chooseColor('p1', 'green');
    expect(engine.state.currentColor).toBe('green');
    expect(currentId(engine)).toBe('p2');
  });

  it('only lets the player who played the wild choose', () => {
    const wild = card('wild', 'wild');
    const { engine } = table({ hands: [[wild, num('red', 1)], [num('blue', 2)]] });

    engine.playCard('p1', wild.id);
    expect(() => engine.chooseColor('p2', 'red')).toThrowError(/not your colour/i);
  });

  it('rejects a colour that is not one of the four', () => {
    const wild = card('wild', 'wild');
    const { engine } = table({ hands: [[wild, num('red', 1)], [num('blue', 2)]] });

    engine.playCard('p1', wild.id);
    expect(() => engine.chooseColor('p1', 'purple' as never)).toThrowError(/red, yellow, green or blue/i);
    expect(() => engine.chooseColor('p1', 'wild' as never)).toThrowError(/red, yellow, green or blue/i);
  });

  it('rejects a colour choice when none is pending', () => {
    const { engine } = table();
    expect(() => engine.chooseColor('p1', 'red')).toThrowError(/no colour choice/i);
  });
});

describe('wild draw four (official challenge rule)', () => {
  const wild4Card = () => card('wild', 'wild_draw4');

  it('offers the next player the choice to accept or challenge', () => {
    const wild4 = wild4Card();
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('blue', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
    });

    engine.playCard('p1', wild4.id, 'green');

    // Nothing is drawn yet - the target decides first.
    expect(engine.state.currentColor).toBe('green');
    expect(handOf(engine, 'p2')).toHaveLength(1);
    expect(engine.state.pendingWildDrawFour).toMatchObject({ playedBy: 'p1', targetPlayerId: 'p2' });
    expect(currentId(engine)).toBe('p2');
  });

  it('accepting draws four and loses the turn', () => {
    const wild4 = wild4Card();
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('blue', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
    });

    engine.playCard('p1', wild4.id, 'green');
    engine.acceptDrawFour('p2');

    expect(handOf(engine, 'p2')).toHaveLength(5);
    expect(currentId(engine)).toBe('p3');
    expect(engine.state.pendingWildDrawFour).toBeUndefined();
  });

  it('a successful challenge makes the bluffer draw four and leaves the turn with the challenger', () => {
    const wild4 = wild4Card();
    // p1 still holds a red, so playing +4 on red is a bluff.
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('red', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
    });

    engine.playCard('p1', wild4.id, 'green');
    const result = engine.challengeDrawFour('p2');

    expect(result.events[0]).toMatchObject({ type: 'draw_four_challenge', wasBluff: true, cards: 4 });
    expect(handOf(engine, 'p1')).toHaveLength(1 + 4);
    expect(handOf(engine, 'p2')).toHaveLength(1);
    expect(currentId(engine)).toBe('p2');
  });

  it('a wrong challenge costs the challenger six cards and the turn', () => {
    const wild4 = wild4Card();
    // p1 holds nothing red, so the +4 was honest.
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('blue', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
    });

    engine.playCard('p1', wild4.id, 'green');
    const result = engine.challengeDrawFour('p2');

    expect(result.events[0]).toMatchObject({ type: 'draw_four_challenge', wasBluff: false, cards: 6 });
    expect(handOf(engine, 'p2')).toHaveLength(1 + 6);
    expect(handOf(engine, 'p1')).toHaveLength(1);
    expect(currentId(engine)).toBe('p3');
  });

  it('only the targeted player may answer it', () => {
    const wild4 = wild4Card();
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('blue', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
    });

    engine.playCard('p1', wild4.id, 'green');
    expect(() => engine.challengeDrawFour('p3')).toThrowError(/not yours to answer/i);
    expect(() => engine.acceptDrawFour('p1')).toThrowError(/not yours to answer/i);
  });

  it('blocks every other action until it is answered', () => {
    const wild4 = wild4Card();
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('blue', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
    });

    engine.playCard('p1', wild4.id, 'green');
    expect(() => engine.drawCard('p2')).toThrowError(/wild draw four has to be answered/i);
  });

  it('waits for the deferred colour before offering the challenge', () => {
    const wild4 = wild4Card();
    const { engine } = table({ hands: [[wild4, num('blue', 1)], [num('red', 2)]], top: num('red', 7) });

    engine.playCard('p1', wild4.id);
    expect(engine.state.pendingWildDrawFour).toBeUndefined();

    engine.chooseColor('p1', 'yellow');
    expect(engine.state.currentColor).toBe('yellow');
    expect(engine.state.pendingWildDrawFour?.targetPlayerId).toBe('p2');
  });

  it('auto-accepts when the target runs out of time', () => {
    const wild4 = wild4Card();
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('blue', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
    });

    engine.playCard('p1', wild4.id, 'green');
    engine.handleTurnTimeout();

    expect(handOf(engine, 'p2')).toHaveLength(5);
    expect(currentId(engine)).toBe('p3');
  });

  it('still refuses an illegal play in the simplified restricted mode', () => {
    const wild4 = wild4Card();
    const { engine } = table({
      hands: [[wild4, num('red', 1)], [num('blue', 2)]],
      top: num('red', 7),
      rules: { wildDrawFourMode: 'restricted' },
    });

    expect(() => engine.playCard('p1', wild4.id, 'green')).toThrowError(/only legal/i);
    expect(handOf(engine, 'p1')).toHaveLength(2);
  });

  it('draws immediately in restricted mode, with no challenge step', () => {
    const wild4 = wild4Card();
    const { engine } = table({
      players: 3,
      hands: [[wild4, num('blue', 1)], [num('red', 2)], [num('red', 3)]],
      top: num('red', 7),
      rules: { wildDrawFourMode: 'restricted' },
    });

    engine.playCard('p1', wild4.id, 'green');

    expect(engine.state.pendingWildDrawFour).toBeUndefined();
    expect(handOf(engine, 'p2')).toHaveLength(5);
    expect(currentId(engine)).toBe('p3');
  });
});

describe('drawing (official rule)', () => {
  it('ends the turn when the drawn card cannot be played', () => {
    const { engine } = table({
      hands: [[num('blue', 1)], [num('green', 2)]],
      top: num('red', 7),
      deck: [num('green', 5)],
    });

    engine.drawCard('p1');

    expect(handOf(engine, 'p1')).toHaveLength(2);
    expect(currentId(engine)).toBe('p2');
  });

  it('keeps the turn when the drawn card is playable, so it may be played', () => {
    const { engine } = table({
      hands: [[num('blue', 1)], [num('green', 2)]],
      top: num('red', 7),
      deck: [num('red', 4)],
    });

    engine.drawCard('p1');

    // Still p1's turn: official UNO lets you play the card you just drew.
    expect(currentId(engine)).toBe('p1');
    expect(engine.state.drawnCard?.playerId).toBe('p1');
    expect(engine.stateFor('p1').canPass).toBe(true);
  });

  it('only lets the drawn card be played, not the rest of the hand', () => {
    const keep = num('red', 1);
    const { engine } = table({
      hands: [[keep, num('blue', 9)], [num('green', 2)]],
      top: num('red', 7),
      deck: [num('red', 4)],
    });

    engine.drawCard('p1');
    const drawnId = engine.state.drawnCard!.cardId;

    expect(() => engine.playCard('p1', keep.id)).toThrowError(/only play the card you just drew/i);
    expect(engine.stateFor('p1').playableCardIds).toEqual([drawnId]);

    engine.playCard('p1', drawnId);
    expect(currentId(engine)).toBe('p2');
  });

  it('passes the turn on when the player declines the drawn card', () => {
    const { engine } = table({
      hands: [[num('blue', 1)], [num('green', 2)]],
      top: num('red', 7),
      deck: [num('red', 4)],
    });

    engine.drawCard('p1');
    engine.pass('p1');

    expect(engine.state.drawnCard).toBeUndefined();
    expect(currentId(engine)).toBe('p2');
  });

  it('refuses a second draw in the same turn', () => {
    const { engine } = table({ hands: [[num('blue', 1)], [num('green', 2)]], deck: [num('red', 4)] });
    engine.drawCard('p1');
    expect(() => engine.drawCard('p1')).toThrowError(/already drawn/i);
  });

  it('refuses a pass when nothing was drawn', () => {
    const { engine } = table();
    expect(() => engine.pass('p1')).toThrowError(/only pass after drawing/i);
  });

  it('refuses a draw out of turn', () => {
    const { engine } = table();
    expect(() => engine.drawCard('p2')).toThrowError(/not your turn/i);
  });

  it('recycles the discard pile when the deck runs out', () => {
    const { engine } = table({ hands: [[num('blue', 1)], [num('green', 2)]], deck: [] });
    engine.state.discardPile = [num('red', 1), num('red', 2), num('red', 7)];

    engine.drawCard('p1');

    expect(handOf(engine, 'p1')).toHaveLength(2);
    expect(engine.state.discardPile).toHaveLength(1);
  });
});

describe('calling UNO', () => {
  it('is accepted once the player is down to one card', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3, num('red', 1)], [num('green', 2)]] });

    engine.playCard('p1', red3.id);
    engine.callUno('p1');

    expect(engine.player('p1')!.hasCalledUno).toBe(true);
    expect(engine.player('p1')!.unoCalls).toBe(1);
    expect(engine.state.unoVulnerable).toBeUndefined();
  });

  it('cannot be called twice', () => {
    const { engine } = table({ hands: [[num('red', 3)], [num('green', 2)]] });
    engine.callUno('p1');
    expect(() => engine.callUno('p1')).toThrowError(/already called/i);
  });

  it('cannot be called while holding a full hand', () => {
    const { engine } = table({ hands: [[num('red', 3), num('red', 4), num('red', 5)], [num('green', 2)]] });
    expect(() => engine.callUno('p1')).toThrowError(/last card/i);
  });

  it('leaves a silent player open to being caught', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3, num('red', 1)], [num('green', 2)]] });

    engine.playCard('p1', red3.id);
    expect(engine.state.unoVulnerable?.playerId).toBe('p1');

    const result = engine.catchUno('p2');

    expect(result.events[0]).toMatchObject({ type: 'uno_penalty', playerId: 'p1', caughtBy: 'Player 2' });
    expect(handOf(engine, 'p1')).toHaveLength(1 + engine.state.rules.unoPenaltyCards);
  });

  it('cannot be caught once the player has called', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3, num('red', 1)], [num('green', 2)]] });

    engine.playCard('p1', red3.id);
    engine.callUno('p1');

    expect(() => engine.catchUno('p2')).toThrowError(/nobody has forgotten/i);
    expect(handOf(engine, 'p1')).toHaveLength(1);
  });

  it('cannot be caught by the offender themselves', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3, num('red', 1)], [num('green', 2)]] });

    engine.playCard('p1', red3.id);
    expect(() => engine.catchUno('p1')).toThrowError(/cannot catch yourself/i);
  });

  it('closes the window once the next player has taken their turn', () => {
    const red3 = num('red', 3);
    const p2card = num('red', 6);
    // p2 keeps three cards, so their own play does not make them vulnerable.
    const { engine } = table({ hands: [[red3, num('red', 1)], [p2card, num('blue', 4), num('blue', 5)]] });

    engine.playCard('p1', red3.id);
    engine.playCard('p2', p2card.id);

    expect(engine.state.unoVulnerable).toBeUndefined();
    expect(() => engine.catchUno('p2')).toThrowError(/nobody has forgotten/i);
  });

  it('still supports the automatic penalty as a house rule', () => {
    const red3 = num('red', 3);
    const { engine } = table({
      hands: [[red3, num('red', 1)], [num('green', 2)]],
      rules: { unoAutoPenalty: true },
    });

    engine.playCard('p1', red3.id);
    expect(engine.state.unoVulnerable?.deadline).toBeGreaterThan(Date.now());

    const result = engine.resolveUnoPenalty('p1');
    expect(result.events[0]).toMatchObject({ type: 'uno_penalty', playerId: 'p1' });
  });

  it('clears the call when the hand grows again', () => {
    const { engine } = table({ hands: [[num('red', 3)], [num('green', 2)]] });
    engine.callUno('p1');

    engine.drawCard('p1');
    expect(engine.player('p1')!.hasCalledUno).toBe(false);
  });
});

describe('winning', () => {
  it('ends the game when the last card is played', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3], [num('green', 2), num('blue', 5)]] });

    const result = engine.playCard('p1', red3.id);

    expect(engine.state.status).toBe('finished');
    expect(engine.state.winnerId).toBe('p1');
    expect(engine.state.finishedAt).toBeTruthy();
    expect(result.events.at(-1)).toMatchObject({ type: 'game_finished', winnerId: 'p1' });
  });

  it('scores the losers by the cards left in hand', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3], [num('green', 2), card('blue', 'skip'), card('wild', 'wild')]] });

    engine.playCard('p1', red3.id);
    const results = engine.results();

    expect(results.find((player) => player.id === 'p1')).toMatchObject({ isWinner: true, points: 0, cardsLeft: 0 });
    // 2 (number) + 20 (skip) + 50 (wild)
    expect(results.find((player) => player.id === 'p2')).toMatchObject({ points: 72, cardsLeft: 3 });
  });

  it('refuses any further action once finished', () => {
    const red3 = num('red', 3);
    const { engine } = table({ hands: [[red3], [num('green', 2)]] });

    engine.playCard('p1', red3.id);
    expect(() => engine.drawCard('p2')).toThrowError(/already finished/i);
  });

  it('can be awarded early when everyone else abandons the table', () => {
    const { engine } = table({ players: 3 });
    const result = engine.finishGame('p2');

    expect(engine.state.winnerId).toBe('p2');
    expect(result.events[0]).toMatchObject({ type: 'game_finished', winnerId: 'p2' });
  });
});

describe('turn timeout', () => {
  it('draws only when the player has no legal move', () => {
    // BLUE 1 cannot follow RED 7, so drawing is the correct move.
    const { engine } = table({ hands: [[num('blue', 1)], [num('green', 2)]], top: num('red', 7) });

    engine.handleTurnTimeout();

    expect(handOf(engine, 'p1')).toHaveLength(2);
    expect(currentId(engine)).toBe('p2');
  });

  it('plays a legal card rather than dealing another one out', () => {
    // Regression: the timeout used to draw even with playable cards in hand, so
    // an idle table's hands grew forever and no game could ever end.
    const playable = num('red', 3);
    const { engine } = table({ hands: [[playable, num('blue', 9)], [num('green', 2)]], top: num('red', 7) });

    engine.handleTurnTimeout();

    expect(topOf(engine).id).toBe(playable.id);
    expect(handOf(engine, 'p1')).toHaveLength(1);
    expect(currentId(engine)).toBe('p2');
  });

  it('prefers an ordinary card, so it is not choosing a colour for them', () => {
    const wild = card('wild', 'wild');
    const plain = num('red', 3);
    const { engine } = table({ hands: [[wild, plain], [num('green', 2)]], top: num('red', 7) });

    engine.handleTurnTimeout();

    expect(topOf(engine).id).toBe(plain.id);
  });

  it('leaves Wild Draw Four until last, to avoid an accidental bluff', () => {
    const wild4 = card('wild', 'wild_draw4');
    const wild = card('wild', 'wild');
    const { engine } = table({ hands: [[wild4, wild], [num('green', 2)]], top: num('red', 7) });

    engine.handleTurnTimeout();

    expect(topOf(engine).id).toBe(wild.id);
    expect(engine.state.pendingWildDrawFour).toBeUndefined();
  });

  it('plays a card that was drawn rather than stalling the table twice', () => {
    // Drawing kept the turn, so a second timeout was needed just to pass it on.
    const { engine } = table({
      hands: [[num('blue', 1)], [num('green', 2)]],
      top: num('red', 7),
      deck: [num('red', 4)],
    });

    engine.handleTurnTimeout();
    expect(engine.state.drawnCard?.playerId).toBe('p1');

    engine.handleTurnTimeout();
    expect(engine.state.drawnCard).toBeUndefined();
    expect(topOf(engine).value).toBe(4);
    expect(currentId(engine)).toBe('p2');
  });

  it('lets a wholly idle table finish instead of growing without bound', () => {
    const engine = GameEngine.create({
      roomId: 'r-idle',
      roomCode: 'IDLE01',
      seats: [
        { id: 'p1', username: 'Sachin' },
        { id: 'p2', username: 'Rahul' },
      ],
      rules: { turnTimeoutSeconds: 30 },
    });
    if (engine.state.pendingColorChoice) engine.chooseColor('p1', 'red');

    const dealt = engine.state.players.reduce((total, player) => total + player.hand.length, 0);

    // Nobody ever acts; only the clock does.
    for (let i = 0; i < 300 && !engine.isFinished; i++) engine.handleTurnTimeout();

    expect(engine.isFinished).toBe(true);
    const left = engine.state.players.reduce((total, player) => total + player.hand.length, 0);
    expect(left).toBeLessThan(dealt);
  });

  it('picks a colour for a stalled wild', () => {
    const wild = card('wild', 'wild');
    const { engine } = table({ hands: [[wild, num('blue', 1), num('blue', 4)], [num('green', 2)]] });

    engine.playCard('p1', wild.id);
    engine.handleTurnTimeout();

    // It chooses the colour the player holds most of.
    expect(engine.state.currentColor).toBe('blue');
    expect(engine.state.pendingColorChoice).toBeUndefined();
    expect(currentId(engine)).toBe('p2');
  });
});

describe('personalised state', () => {
  it('never exposes another player\'s cards', () => {
    const { engine } = table({ players: 3, hands: [[num('red', 1)], [num('blue', 2)], [num('green', 3)]] });

    const view = engine.stateFor('p1');
    const serialised = JSON.stringify(view);

    expect(view.myHand).toHaveLength(1);
    expect(view.players.find((player) => player.id === 'p2')).toMatchObject({ cardCount: 1 });
    expect(view.players.find((player) => player.id === 'p2')).not.toHaveProperty('hand');
    expect(serialised).not.toContain(handOf(engine, 'p2')[0].id);
    expect(serialised).not.toContain(handOf(engine, 'p3')[0].id);
  });

  it('tells the active player which cards are legal and tells nobody else', () => {
    const playable = num('red', 1);
    const dead = num('blue', 9);
    const { engine } = table({ hands: [[playable, dead], [num('green', 2)]], top: num('red', 7) });

    expect(engine.stateFor('p1').playableCardIds).toEqual([playable.id]);
    expect(engine.stateFor('p2').playableCardIds).toEqual([]);
  });

  it('exposes the deck and discard as counts only', () => {
    const { engine } = table();
    const view = engine.stateFor('p1');

    expect(view.deckCount).toBe(engine.state.deck.length);
    expect(JSON.stringify(view)).not.toContain(engine.state.deck[0].id);
  });
});

describe('connection handling', () => {
  it('tracks connect and disconnect without removing the seat', () => {
    const { engine } = table({ players: 3 });

    engine.setConnection('p2', false);
    expect(engine.player('p2')!.isConnected).toBe(false);
    expect(engine.state.players).toHaveLength(3);
    expect(engine.connectedPlayers()).toHaveLength(2);

    engine.setConnection('p2', true, 'socket-9');
    expect(engine.player('p2')!.isConnected).toBe(true);
    expect(engine.player('p2')!.socketId).toBe('socket-9');
  });
});

describe('move log', () => {
  it('records every action in order for the game history', () => {
    const wild = card('wild', 'wild');
    const { engine } = table({ hands: [[wild, num('red', 1)], [num('green', 2)]] });

    engine.playCard('p1', wild.id);
    engine.chooseColor('p1', 'green');
    engine.drawCard('p2');

    expect(engine.state.moves.map((move) => move.action)).toEqual(['play_card', 'choose_color', 'draw_card']);
    expect(engine.state.moves[0]).toMatchObject({ playerId: 'p1', cardId: wild.id });
  });
});
