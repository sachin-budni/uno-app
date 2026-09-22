import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import type { ChatMessage, CreateRoomInput, LobbyStats, Room } from '../models/room.models';
import { ApiService } from './api.service';
import { NotificationService } from './notification.service';
import { SocketService } from './socket.service';

/**
 * The waiting room: who is seated, who is ready, and the chat that runs
 * alongside it. The server owns all of it; this mirrors what it broadcasts.
 */
@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly socket = inject(SocketService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  private listening = false;

  readonly room = signal<Room | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly lobbyStats = signal<LobbyStats>({ onlinePlayers: 0, activeGames: 0, openRooms: 0 });
  readonly queuePosition = signal<number | null>(null);

  readonly players = computed(() => this.room()?.players ?? []);
  readonly roomCode = computed(() => this.room()?.code ?? null);

  readonly isHost = computed(() => {
    const room = this.room();
    return !!room && room.hostId === this.auth.userId();
  });

  readonly meInRoom = computed(() => {
    const id = this.auth.userId();
    return this.players().find((player) => player.id === id) ?? null;
  });

  readonly isReady = computed(() => !!this.meInRoom()?.isReady);
  readonly everyoneReady = computed(() => {
    const players = this.players();
    return players.length >= 2 && players.every((player) => player.isReady);
  });
  readonly canStart = computed(() => this.isHost() && this.everyoneReady());

  /** Subscribes to room broadcasts. Called once, from the app shell. */
  listen(): void {
    if (this.listening) return;
    this.listening = true;

    this.socket
      .on<{ room: Room }>('room_updated')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ room }) => this.room.set(room));

    this.socket
      .on<{ room: Room; player: { username: string } }>('player_joined')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ room, player }) => {
        this.room.set(room);
        if (player.username !== this.auth.username()) {
          this.notifications.info('Player joined', `${player.username} took a seat.`);
        }
      });

    this.socket
      .on<{ room: Room; username: string }>('player_left')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ room, username }) => {
        this.room.set(room);
        this.notifications.info('Player left', `${username} left the room.`);
      });

    this.socket
      .on<{ roomCode: string; reason: string }>('room_closed')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ reason }) => {
        this.room.set(null);
        this.messages.set([]);
        this.notifications.warning('Room closed', reason);
        void this.router.navigate(['/lobby']);
      });

    this.socket
      .on<ChatMessage>('chat_message')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((message) =>
        this.messages.update((list) => (list.some((m) => m.id === message.id) ? list : [...list, message].slice(-80))),
      );

    this.socket
      .on<LobbyStats>('lobby_stats')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((stats) => this.lobbyStats.set(stats));

    this.socket
      .on<{ gameId: string; roomCode: string }>('game_started')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ gameId }) => {
        this.notifications.success('Game on', 'Cards are being dealt.');
        void this.router.navigate(['/game', gameId]);
      });

    this.socket
      .on<{ roomCode: string }>('match_found')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ roomCode }) => {
        this.queuePosition.set(null);
        this.notifications.success('Match found', 'Joining your table.');
        void this.router.navigate(['/room', roomCode]);
      });

    this.socket
      .on<{ position: number }>('queue_update')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ position }) => this.queuePosition.set(position));
  }

  /* ------------------------------- actions -------------------------------- */

  async create(input: CreateRoomInput): Promise<Room> {
    const { room } = await this.socket.createRoom(input);
    this.room.set(room);
    this.messages.set([]);
    return room;
  }

  async join(roomCode: string): Promise<Room> {
    const { room } = await this.socket.joinRoom(roomCode.trim().toUpperCase());
    this.room.set(room);
    return room;
  }

  /** Re-syncs after a refresh or a reconnect. */
  async refresh(roomCode: string): Promise<Room> {
    const { room } = await this.socket.requestRoomState(roomCode);
    this.room.set(room);
    return room;
  }

  async leave(): Promise<void> {
    const code = this.roomCode();
    if (!code) return;
    try {
      await this.socket.leaveRoom(code);
    } finally {
      this.room.set(null);
      this.messages.set([]);
    }
  }

  async toggleReady(): Promise<void> {
    const code = this.roomCode();
    if (!code) return;
    const { room } = await this.socket.setReady(code, !this.isReady());
    this.room.set(room);
  }

  async start(): Promise<string> {
    const code = this.roomCode();
    if (!code) throw { code: 'ROOM_NOT_FOUND', message: 'You are not in a room.' };
    const { gameId } = await this.socket.startGame(code);
    return gameId;
  }

  async rematch(): Promise<void> {
    const code = this.roomCode();
    if (!code) return;
    const { room } = await this.socket.requestRematch(code);
    this.room.set(room);
  }

  async sendMessage(text: string): Promise<void> {
    const code = this.roomCode();
    if (!code || !text.trim()) return;
    await this.socket.sendChatMessage(code, text.trim());
  }

  /* ------------------------------- lobby ---------------------------------- */

  listOpenRooms() {
    return this.api.get<{ rooms: Room[] }>('/rooms');
  }

  loadLobbyStats() {
    return this.api.get<{ openRooms: number; activeGames: number; queueSize: number }>('/stats/lobby');
  }

  async quickMatch(): Promise<void> {
    const { position } = await this.socket.quickMatch();
    this.queuePosition.set(position);
  }

  async cancelQuickMatch(): Promise<void> {
    await this.socket.cancelQuickMatch();
    this.queuePosition.set(null);
  }
}
