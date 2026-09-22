import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/db.service', async () => {
  const { createFakeDb } = await import('./fake-db');
  return { db: createFakeDb() };
});

import { createApp } from '../src/config/app';
import { db } from '../src/services/db.service';
import { roomService } from '../src/services/room.service';
import type { FakeDb } from './fake-db';

const fake = db as unknown as FakeDb;

let server: http.Server;
let base: string;

async function api(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const VALID_USER = { username: 'Sachin', email: 'sachin@example.com', password: 'super-secret-1', confirmPassword: 'super-secret-1' };

async function registerUser(overrides: Partial<typeof VALID_USER> = {}) {
  const payload = { ...VALID_USER, ...overrides };
  if (overrides.password && overrides.confirmPassword === undefined) payload.confirmPassword = overrides.password;
  return api('/api/auth/register', { method: 'POST', body: payload });
}

beforeAll(async () => {
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  fake.__reset();
  roomService.clear();
});

describe('POST /api/auth/register', () => {
  it('creates an account and returns a token', async () => {
    const { status, body } = await registerUser();

    expect(status).toBe(201);
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user).toMatchObject({ username: 'Sachin', email: 'sachin@example.com' });
    expect(body.user.stats.gamesPlayed).toBe(0);
  });

  it('never returns or stores the plain password', async () => {
    const { body } = await registerUser();
    expect(JSON.stringify(body)).not.toContain(VALID_USER.password);

    const [stored] = fake.__rows('users') as unknown as Array<Record<string, string>>;
    expect(stored.passwordHash).toBeTypeOf('string');
    expect(stored.passwordHash).not.toBe(VALID_USER.password);
    expect(stored.passwordHash.startsWith('$2')).toBe(true);
    expect(stored).not.toHaveProperty('password');
  });

  it('rejects a duplicate email', async () => {
    await registerUser();
    const { status, body } = await registerUser({ username: 'Someone Else' });

    expect(status).toBe(409);
    expect(body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects a duplicate username regardless of case', async () => {
    await registerUser();
    const { status, body } = await registerUser({ username: 'sachin', email: 'other@example.com' });

    expect(status).toBe(409);
    expect(body.error.code).toBe('USERNAME_TAKEN');
  });

  it.each([
    ['a short password', { password: 'short', confirmPassword: 'short' }, 'password'],
    ['a bad email', { email: 'not-an-email' }, 'email'],
    ['a short username', { username: 'ab' }, 'username'],
    ['mismatched confirmation', { confirmPassword: 'something-else' }, 'confirmPassword'],
  ])('rejects %s', async (_label, overrides, field) => {
    const { status, body } = await api('/api/auth/register', {
      method: 'POST',
      body: { ...VALID_USER, ...overrides },
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.map((issue: { field: string }) => issue.field)).toContain(field);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with the right credentials', async () => {
    await registerUser();
    const { status, body } = await api('/api/auth/login', {
      method: 'POST',
      body: { email: VALID_USER.email, password: VALID_USER.password },
    });

    expect(status).toBe(200);
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.user.username).toBe('Sachin');
  });

  it('rejects a wrong password with a generic message', async () => {
    await registerUser();
    const { status, body } = await api('/api/auth/login', {
      method: 'POST',
      body: { email: VALID_USER.email, password: 'wrong-password' },
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.message).not.toMatch(/user|account/i);
  });

  it('rejects an unknown email with the same error', async () => {
    const { status, body } = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.com', password: 'super-secret-1' },
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('protected routes', () => {
  it('refuses /api/auth/me without a token', async () => {
    const { status, body } = await api('/api/auth/me');
    expect(status).toBe(401);
    expect(body.error.code).toBe('NOT_AUTHORIZED');
  });

  it('refuses a malformed token', async () => {
    const { status } = await api('/api/auth/me', { token: 'not.a.jwt' });
    expect(status).toBe(401);
  });

  it('returns the caller with a valid token', async () => {
    const { body: registered } = await registerUser();
    const { status, body } = await api('/api/auth/me', { token: registered.accessToken });

    expect(status).toBe(200);
    expect(body.user.id).toBe(registered.user.id);
  });
});

describe('profile updates', () => {
  it('renames the caller', async () => {
    const { body: registered } = await registerUser();
    const { status, body } = await api(`/api/users/${registered.user.id}`, {
      method: 'PATCH',
      token: registered.accessToken,
      body: { username: 'Sachin S' },
    });

    expect(status).toBe(200);
    expect(body.user.username).toBe('Sachin S');
  });

  it('refuses to edit someone else', async () => {
    const { body: mine } = await registerUser();
    const { body: theirs } = await registerUser({ username: 'Rahul', email: 'rahul@example.com' });

    const { status } = await api(`/api/users/${theirs.user.id}`, {
      method: 'PATCH',
      token: mine.accessToken,
      body: { username: 'Hacked' },
    });

    expect(status).toBe(403);
  });

  it('rejects an unknown avatar', async () => {
    const { body: registered } = await registerUser();
    const { status } = await api(`/api/users/${registered.user.id}`, {
      method: 'PATCH',
      token: registered.accessToken,
      body: { avatar: 'definitely-not-an-avatar' },
    });

    expect(status).toBe(400);
  });
});

describe('rooms', () => {
  const roomBody = { name: 'Friday Night', maxPlayers: 4, mode: 'classic', isPrivate: false };

  it('requires authentication', async () => {
    const { status } = await api('/api/rooms', { method: 'POST', body: roomBody });
    expect(status).toBe(401);
  });

  it('creates a room with a six character code', async () => {
    const { body: auth } = await registerUser();
    const { status, body } = await api('/api/rooms', { method: 'POST', token: auth.accessToken, body: roomBody });

    expect(status).toBe(201);
    expect(body.room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(body.room.hostId).toBe(auth.user.id);
    expect(body.room.players).toHaveLength(1);
    expect(body.room.status).toBe('waiting');
  });

  it('caps maxPlayers at the configured limit', async () => {
    const { body: auth } = await registerUser();
    const { status, body } = await api('/api/rooms', {
      method: 'POST',
      token: auth.accessToken,
      body: { ...roomBody, maxPlayers: 9 },
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('finds a room by its code and lists public ones', async () => {
    const { body: auth } = await registerUser();
    const { body: created } = await api('/api/rooms', { method: 'POST', token: auth.accessToken, body: roomBody });

    const fetched = await api(`/api/rooms/${created.room.code}`, { token: auth.accessToken });
    expect(fetched.status).toBe(200);
    expect(fetched.body.room.id).toBe(created.room.id);

    const listed = await api('/api/rooms', { token: auth.accessToken });
    expect(listed.body.rooms.map((room: { code: string }) => room.code)).toContain(created.room.code);
  });

  it('hides private rooms from the public listing', async () => {
    const { body: auth } = await registerUser();
    await api('/api/rooms', { method: 'POST', token: auth.accessToken, body: { ...roomBody, isPrivate: true } });

    const listed = await api('/api/rooms', { token: auth.accessToken });
    expect(listed.body.rooms).toHaveLength(0);
  });

  it('404s on an unknown code', async () => {
    const { body: auth } = await registerUser();
    const { status, body } = await api('/api/rooms/ZZZZZZ', { token: auth.accessToken });

    expect(status).toBe(404);
    expect(body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it('lets only the host change settings', async () => {
    const { body: host } = await registerUser();
    const { body: other } = await registerUser({ username: 'Rahul', email: 'rahul@example.com' });
    const { body: created } = await api('/api/rooms', { method: 'POST', token: host.accessToken, body: roomBody });

    const asHost = await api(`/api/rooms/${created.room.code}`, {
      method: 'PATCH',
      token: host.accessToken,
      body: { name: 'Renamed Table' },
    });
    expect(asHost.body.room.name).toBe('Renamed Table');

    const asOther = await api(`/api/rooms/${created.room.code}`, {
      method: 'PATCH',
      token: other.accessToken,
      body: { name: 'Hijacked' },
    });
    expect(asOther.status).toBe(403);
    expect(asOther.body.error.code).toBe('NOT_HOST');
  });
});

describe('history and leaderboard', () => {
  it('returns an empty history for a new player', async () => {
    const { body: auth } = await registerUser();
    const { status, body } = await api('/api/game-history', { token: auth.accessToken });

    expect(status).toBe(200);
    expect(body.games).toEqual([]);
  });

  it('builds the leaderboard from persisted game history', async () => {
    const { body: auth } = await registerUser();
    await fake.create('gameHistory', {
      id: 'g1',
      gameId: 'game-1',
      roomCode: 'ABC123',
      winnerId: auth.user.id,
      winnerUsername: 'Sachin',
      playerIds: [auth.user.id, 'other'],
      players: [
        { id: auth.user.id, username: 'Sachin', points: 0, unoCalls: 2, cardsPlayed: 9, cardsLeft: 0, isWinner: true },
        { id: 'other', username: 'Rahul', points: 34, unoCalls: 0, cardsPlayed: 6, cardsLeft: 3, isWinner: false },
      ],
      finishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    } as never);

    const { status, body } = await api('/api/leaderboard', { token: auth.accessToken });

    expect(status).toBe(200);
    expect(body.entries[0]).toMatchObject({ rank: 1, username: 'Sachin', gamesWon: 1, winRate: 100, points: 34 });
  });

  it('keeps game details private to the people who played', async () => {
    const { body: auth } = await registerUser();
    const { body: stranger } = await registerUser({ username: 'Rahul', email: 'rahul@example.com' });

    await fake.create('gameHistory', {
      id: 'g2',
      gameId: 'game-2',
      playerIds: [auth.user.id],
      players: [],
      finishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    } as never);

    expect((await api('/api/game-history/g2', { token: auth.accessToken })).status).toBe(200);
    expect((await api('/api/game-history/g2', { token: stranger.accessToken })).status).toBe(403);
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const { status, body } = await api('/api/nope');
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
