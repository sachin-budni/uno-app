import type { Request, Response } from 'express';
import type { GameMode } from '../models/room.model';
import { gameManager } from '../services/game-manager';
import { roomService } from '../services/room.service';
import { userService } from '../services/user.service';
import { ERROR_CODES, notFound } from '../utils/errors';

/**
 * Rooms are created and joined over Socket.IO during play; these REST routes
 * exist for the lobby listing, deep links and tooling.
 */
export async function listRooms(_req: Request, res: Response): Promise<void> {
  res.json({ rooms: roomService.listJoinable() });
}

export async function createRoom(req: Request, res: Response): Promise<void> {
  const user = await userService.requireById(req.auth!.sub);
  const room = roomService.create(
    { id: user.id, username: user.username, avatar: user.avatar },
    {
      name: req.body.name,
      maxPlayers: req.body.maxPlayers,
      mode: req.body.mode as GameMode,
      isPrivate: req.body.isPrivate,
    },
  );
  res.status(201).json({ room });
}

/** Accepts either a room id or a room code, so /room/:code deep links work. */
export async function getRoom(req: Request, res: Response): Promise<void> {
  const key = req.params.id;
  const room = roomService.get(key) ?? roomService.getById(key);
  if (!room) throw notFound(ERROR_CODES.ROOM_NOT_FOUND, 'That room code does not match an open room.');
  res.json({ room });
}

export async function updateRoom(req: Request, res: Response): Promise<void> {
  const key = req.params.id;
  const existing = roomService.get(key) ?? roomService.getById(key);
  if (!existing) throw notFound(ERROR_CODES.ROOM_NOT_FOUND, 'That room code does not match an open room.');
  const room = roomService.updateSettings(existing.code, req.auth!.sub, req.body);
  res.json({ room });
}

export async function lobbyStats(_req: Request, res: Response): Promise<void> {
  const rooms = roomService.stats();
  res.json({
    openRooms: rooms.openRooms,
    activeGames: gameManager.activeCount(),
    queueSize: gameManager.queueSize(),
  });
}
