import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import type { ClientGameState, GameRules } from '../models/game.models';
import { GameStateService } from './game-state.service';
import { NotificationService } from './notification.service';
import { SocketService } from './socket.service';

const RULES: GameRules = {
  initialHandSize: 7,
  maxPlayers: 4,
  allowDrawStacking: false,
  wildDrawFourMode: 'challenge',
  twoPlayerReverseActsAsSkip: true,
  unoPenaltyCards: 2,
  turnTimeoutSeconds: 30,
  unoAutoPenalty: false,
  unoGraceSeconds: 6,
};

function stateFixture(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    gameId: 'g1',
    roomId: 'r1',
    roomCode: 'ABC123',
    myPlayerId: 'me',
    players: [
      { id: 'me', username: 'Sachin', position: 0, cardCount: 2, isConnected: true, isCurrentTurn: true, hasCalledUno: false },
      { id: 'p2', username: 'Rahul', position: 1, cardCount: 5, isConnected: true, isCurrentTurn: false, hasCalledUno: false },
      { id: 'p3', username: 'Anil', position: 2, cardCount: 3, isConnected: false, isCurrentTurn: false, hasCalledUno: false },
    ],
    myHand: [
      { id: 'c1', color: 'red', type: 'number', value: 7 },
      { id: 'c2', color: 'blue', type: 'number', value: 3 },
    ],
    topCard: { id: 't1', color: 'red', type: 'number', value: 2 },
    discardCount: 1,
    deckCount: 80,
    currentColor: 'red',
    currentPlayerId: 'me',
    direction: 'clockwise',
    status: 'playing',
    pendingDrawCount: 0,
    turnTimeoutSeconds: 30,
    rules: RULES,
    playableCardIds: ['c1'],
    canCallUno: false,
    canPass: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

class SocketStub {
  playCard = jasmine.createSpy('playCard').and.resolveTo({ accepted: true });
  drawCard = jasmine.createSpy('drawCard').and.resolveTo({ accepted: true });
  passTurn = jasmine.createSpy('passTurn').and.resolveTo({ accepted: true });
  catchUno = jasmine.createSpy('catchUno').and.resolveTo({ accepted: true });
  acceptDrawFour = jasmine.createSpy('acceptDrawFour').and.resolveTo({ accepted: true });
  challengeDrawFour = jasmine.createSpy('challengeDrawFour').and.resolveTo({ accepted: true });
  chooseColor = jasmine.createSpy('chooseColor').and.resolveTo({ accepted: true });
  callUno = jasmine.createSpy('callUno').and.resolveTo({ accepted: true });
  requestGameState = jasmine.createSpy('requestGameState').and.resolveTo({ state: stateFixture() });
  on = () => ({ pipe: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }) });
}

describe('GameStateService', () => {
  let service: GameStateService;
  let socket: SocketStub;

  beforeEach(() => {
    socket = new SocketStub();
    TestBed.configureTestingModule({
      providers: [
        GameStateService,
        NotificationService,
        { provide: SocketService, useValue: socket },
        { provide: AuthService, useValue: { userId: () => 'me', username: () => 'Sachin' } },
      ],
    });
    service = TestBed.inject(GameStateService);
  });

  afterEach(() => service.reset());

  describe('turn display', () => {
    it('knows when it is my turn', async () => {
      await service.loadGame('g1');
      expect(service.isMyTurn()).toBe(true);
      expect(service.currentPlayer()?.username).toBe('Sachin');
      expect(service.canDraw()).toBe(true);
    });

    it('knows when it is someone else"s turn', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ currentPlayerId: 'p2' }) });
      await service.loadGame('g1');

      expect(service.isMyTurn()).toBe(false);
      expect(service.canDraw()).toBe(false);
      expect(service.currentPlayer()?.username).toBe('Rahul');
    });

    it('stops accepting actions once the game is finished', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ status: 'finished', winnerId: 'me' }) });
      await service.loadGame('g1');

      expect(service.isMyTurn()).toBe(false);
      expect(service.canDraw()).toBe(false);
      expect(service.isGameOver()).toBe(true);
    });
  });

  describe('card selection', () => {
    it('exposes only the server"s playable ids', async () => {
      await service.loadGame('g1');
      expect(service.playableCardIds().has('c1')).toBe(true);
      expect(service.playableCardIds().has('c2')).toBe(false);
    });

    it('sends a play request rather than changing state locally', async () => {
      await service.loadGame('g1');
      const handBefore = service.myHand().length;

      await service.play('c1');

      expect(socket.playCard).toHaveBeenCalledWith('g1', 'c1', undefined);
      // The hand only shrinks when the server says so.
      expect(service.myHand().length).toBe(handBefore);
    });

    it('passes the chosen colour with a wild', async () => {
      await service.loadGame('g1');
      await service.play('c1', 'blue');
      expect(socket.playCard).toHaveBeenCalledWith('g1', 'c1', 'blue');
    });
  });

  describe('UNO button', () => {
    it('stays disabled until the server says the call is available', async () => {
      await service.loadGame('g1');
      expect(service.canCallUno()).toBe(false);
    });

    it('is enabled when the server allows it', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ canCallUno: true }) });
      await service.loadGame('g1');
      expect(service.canCallUno()).toBe(true);

      await service.callUno();
      expect(socket.callUno).toHaveBeenCalledWith('g1');
    });
  });

  describe('colour choice', () => {
    it('knows when this player owes a colour', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ pendingColorChoiceBy: 'me' }) });
      await service.loadGame('g1');

      expect(service.mustChooseColor()).toBe(true);
      expect(service.canDraw()).toBe(false);

      await service.chooseColor('green');
      expect(socket.chooseColor).toHaveBeenCalledWith('g1', 'green');
    });

    it('knows when it is waiting on someone else', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ pendingColorChoiceBy: 'p2' }) });
      await service.loadGame('g1');

      expect(service.mustChooseColor()).toBe(false);
      expect(service.isWaitingForOtherColor()).toBe(true);
    });
  });

  describe('seating', () => {
    it('lists opponents starting from the seat after mine', async () => {
      await service.loadGame('g1');
      expect(service.opponents().map((player) => player.id)).toEqual(['p2', 'p3']);
    });

    it('never receives another player"s cards', async () => {
      await service.loadGame('g1');
      const opponent = service.opponents()[0] as unknown as Record<string, unknown>;

      expect(opponent['hand']).toBeUndefined();
      expect(service.opponents()[0].cardCount).toBe(5);
    });
  });

  describe('official draw rule', () => {
    it('offers a pass once a drawn card is waiting', async () => {
      socket.requestGameState.and.resolveTo({
        state: stateFixture({ canPass: true, drawnCardId: 'c1' }),
      });
      await service.loadGame('g1');

      expect(service.canPass()).toBe(true);
      expect(service.drawnCardId()).toBe('c1');
      // Drawing again is not an option while that card is unresolved.
      expect(service.canDraw()).toBe(false);

      await service.pass();
      expect(socket.passTurn).toHaveBeenCalledWith('g1');
    });
  });

  describe('wild draw four challenge', () => {
    const challenge = { playedBy: 'p2', playedByName: 'Rahul', targetPlayerId: 'me' };

    it('surfaces a +4 played against me and blocks other actions', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ wildDrawFour: challenge }) });
      await service.loadGame('g1');

      expect(service.wildDrawFourAgainstMe()).toEqual(challenge);
      expect(service.canDraw()).toBe(false);
    });

    it('ignores a +4 aimed at somebody else', async () => {
      socket.requestGameState.and.resolveTo({
        state: stateFixture({ wildDrawFour: { ...challenge, targetPlayerId: 'p3' } }),
      });
      await service.loadGame('g1');

      expect(service.wildDrawFourAgainstMe()).toBeNull();
      expect(service.wildDrawFourPending()).toBe(true);
    });

    it('sends the player"s answer', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ wildDrawFour: challenge }) });
      await service.loadGame('g1');

      await service.acceptDrawFour();
      expect(socket.acceptDrawFour).toHaveBeenCalledWith('g1');

      await service.challengeDrawFour();
      expect(socket.challengeDrawFour).toHaveBeenCalledWith('g1');
    });
  });

  describe('catching a missed UNO', () => {
    it('names the player who can be caught', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ unoVulnerablePlayerId: 'p2' }) });
      await service.loadGame('g1');

      expect(service.catchableUnoPlayer()?.username).toBe('Rahul');

      await service.catchUno();
      expect(socket.catchUno).toHaveBeenCalledWith('g1');
    });

    it('never offers to catch yourself', async () => {
      socket.requestGameState.and.resolveTo({ state: stateFixture({ unoVulnerablePlayerId: 'me' }) });
      await service.loadGame('g1');

      expect(service.catchableUnoPlayer()).toBeNull();
    });
  });

  describe('discard animation state', () => {
    // A played card must arrive as a *new* entry keyed by its id, otherwise
    // Angular reuses the DOM node and the landing animation never replays.
    it('records each newly showing card', async () => {
      await service.loadGame('g1');
      expect(service.discardStack().map((card) => card.id)).toEqual(['t1']);

      socket.requestGameState.and.resolveTo({
        state: stateFixture({ topCard: { id: 't2', color: 'blue', type: 'number', value: 5 } }),
      });
      await service.loadGame('g1');

      expect(service.discardStack().map((card) => card.id)).toEqual(['t1', 't2']);
    });

    it('does not duplicate the card when other state changes', async () => {
      await service.loadGame('g1');
      socket.requestGameState.and.resolveTo({ state: stateFixture({ deckCount: 42 }) });
      await service.loadGame('g1');

      expect(service.discardStack().map((card) => card.id)).toEqual(['t1']);
    });

    it('keeps the stack short', async () => {
      for (const id of ['t2', 't3', 't4', 't5']) {
        socket.requestGameState.and.resolveTo({
          state: stateFixture({ topCard: { id, color: 'red', type: 'number', value: 1 } }),
        });
        await service.loadGame('g1');
      }

      expect(service.discardStack().length).toBe(3);
      expect(service.discardStack().at(-1)?.id).toBe('t5');
    });

    it('knows whether the card showing came from my hand', async () => {
      socket.requestGameState.and.resolveTo({
        state: stateFixture({
          topCard: { id: 'mine', color: 'red', type: 'number', value: 9 },
          lastAction: {
            type: 'play_card',
            playerId: 'me',
            playerName: 'Sachin',
            cardId: 'mine',
            timestamp: new Date().toISOString(),
          },
        }),
      });
      await service.loadGame('g1');
      expect(service.lastPlayWasMine()).toBe(true);

      socket.requestGameState.and.resolveTo({
        state: stateFixture({
          topCard: { id: 'theirs', color: 'red', type: 'number', value: 8 },
          lastAction: {
            type: 'play_card',
            playerId: 'p2',
            playerName: 'Rahul',
            cardId: 'theirs',
            timestamp: new Date().toISOString(),
          },
        }),
      });
      await service.loadGame('g1');
      expect(service.lastPlayWasMine()).toBe(false);
    });
  });

  it('clears everything on reset', async () => {
    await service.loadGame('g1');
    service.reset();

    expect(service.gameState()).toBeNull();
    expect(service.myHand()).toEqual([]);
    expect(service.finished()).toBeNull();
    expect(service.discardStack()).toEqual([]);
    expect(service.drawPulse()).toBe(0);
  });
});
