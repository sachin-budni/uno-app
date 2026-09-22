import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { SocketService } from './socket.service';

/** Reaches the private socket so we can inspect what is actually bound to it. */
function rawSocket(service: SocketService): { listeners(event: string): Array<(p: unknown) => void> } | null {
  return (service as unknown as { socket: { listeners(event: string): Array<(p: unknown) => void> } | null }).socket;
}

describe('SocketService', () => {
  let service: SocketService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [SocketService, { provide: AuthService, useValue: { accessToken: () => 'a-token', logout: () => undefined } }],
    });
    service = TestBed.inject(SocketService);
  });

  afterEach(() => service.disconnect());

  describe('listeners registered before the socket exists', () => {
    // Regression: the app shell calls RoomService.listen() and
    // GameStateService.listen() from its constructor, but connect() only runs
    // later from an effect. Binding straight to `this.socket` silently dropped
    // every subscription, so room_updated / game_started never arrived and the
    // Start button never enabled.
    it('are bound to the socket once it is created', () => {
      const subscription = service.on('room_updated').subscribe();
      expect(rawSocket(service)).toBeNull();

      service.connect();

      const socket = rawSocket(service);
      expect(socket).not.toBeNull();
      expect(socket!.listeners('room_updated').length).toBe(1);

      subscription.unsubscribe();
    });

    it('deliver their payload to the subscriber', () => {
      const received: unknown[] = [];
      const subscription = service.on<{ room: { code: string } }>('room_updated').subscribe((p) => received.push(p));

      service.connect();

      // Drive the handler the socket actually holds, as the transport would.
      rawSocket(service)!.listeners('room_updated')[0]({ room: { code: 'A7K9P2' } });

      expect(received).toEqual([{ room: { code: 'A7K9P2' } }]);
      subscription.unsubscribe();
    });

    it('supports several subscribers on one event', () => {
      const a = service.on('game_started').subscribe();
      const b = service.on('game_started').subscribe();

      service.connect();
      expect(rawSocket(service)!.listeners('game_started').length).toBe(2);

      a.unsubscribe();
      b.unsubscribe();
    });
  });

  describe('listeners registered after connecting', () => {
    it('are bound immediately', () => {
      service.connect();
      const subscription = service.on('chat_message').subscribe();

      expect(rawSocket(service)!.listeners('chat_message').length).toBe(1);
      subscription.unsubscribe();
    });
  });

  describe('unsubscribing', () => {
    it('detaches the handler from the socket', () => {
      service.connect();
      const subscription = service.on('turn_changed').subscribe();
      expect(rawSocket(service)!.listeners('turn_changed').length).toBe(1);

      subscription.unsubscribe();
      expect(rawSocket(service)!.listeners('turn_changed').length).toBe(0);
    });
  });

  describe('signing out and back in', () => {
    it('re-binds existing subscribers to the replacement socket', () => {
      const subscription = service.on('game_state_updated').subscribe();
      service.connect();
      expect(rawSocket(service)!.listeners('game_state_updated').length).toBe(1);

      service.disconnect();
      expect(rawSocket(service)).toBeNull();

      service.connect();
      expect(rawSocket(service)!.listeners('game_state_updated').length).toBe(1);

      subscription.unsubscribe();
    });
  });

  describe('emitting without a connection', () => {
    it('rejects with a network error rather than hanging', async () => {
      await expectAsync(service.emit('play_card', {})).toBeRejectedWith(
        jasmine.objectContaining({ code: 'NETWORK_ERROR' }),
      );
    });
  });
});
