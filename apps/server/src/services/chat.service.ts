import { config } from '../config/env';
import type { ChatMessage } from '../models/room.model';
import { newId } from '../utils/random';
import { sanitizeText } from '../utils/sanitize';

const HISTORY_LIMIT = 50;

/** Room chat lives in memory only - it is transient and never persisted. */
class ChatService {
  private readonly history = new Map<string, ChatMessage[]>();

  add(roomCode: string, message: Omit<ChatMessage, 'id' | 'timestamp' | 'roomCode'>): ChatMessage {
    const entry: ChatMessage = {
      ...message,
      id: newId(),
      roomCode,
      text: sanitizeText(message.text, config.game.chatMaxLength),
      timestamp: new Date().toISOString(),
    };

    const log = this.history.get(roomCode) ?? [];
    log.push(entry);
    if (log.length > HISTORY_LIMIT) log.splice(0, log.length - HISTORY_LIMIT);
    this.history.set(roomCode, log);

    return entry;
  }

  system(roomCode: string, text: string): ChatMessage {
    return this.add(roomCode, { userId: 'system', username: 'UNO Arena', text, system: true });
  }

  recent(roomCode: string): ChatMessage[] {
    return this.history.get(roomCode) ?? [];
  }

  clear(roomCode: string): void {
    this.history.delete(roomCode);
  }
}

export const chatService = new ChatService();
