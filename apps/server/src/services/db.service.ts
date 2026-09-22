import axios, { AxiosError, type AxiosInstance } from 'axios';
import { config } from '../config/env';
import { AppError, ERROR_CODES, internal, notFound } from '../utils/errors';
import { logger } from '../utils/logger';

export type Collection = 'users' | 'rooms' | 'games' | 'gameHistory' | 'leaderboard';

/**
 * Thin, typed gateway in front of JSON Server.
 *
 * Everything that touches db.json goes through here, which buys us three things:
 *  1. JSON Server can be swapped for a real database by rewriting this one file.
 *  2. Writes are serialised (JSON Server rewrites the whole file, so two
 *     concurrent writes can lose data - the queue removes that race).
 *  3. Transport failures become a single, user-presentable error code.
 */
class DbService {
  private readonly http: AxiosInstance;
  /** Tail of the write chain: every mutation awaits the previous one. */
  private writeChain: Promise<unknown> = Promise.resolve();
  private lastOutageLoggedAt = 0;

  constructor() {
    this.http = axios.create({
      baseURL: config.jsonServerUrl,
      timeout: config.jsonServerTimeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Serialises mutations so concurrent requests cannot clobber db.json. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeChain.then(operation, operation);
    // Keep the chain alive even when an individual write rejects.
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private fail(error: unknown, context: string): never {
    if (error instanceof AppError) throw error;
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    if (status === 404) throw notFound(ERROR_CODES.NOT_FOUND, 'That record does not exist.');

    const offline =
      !axiosError.response &&
      ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(axiosError.code ?? '');

    if (offline) {
      // Throttle the noise when JSON Server is down for a while.
      const now = Date.now();
      if (now - this.lastOutageLoggedAt > 5000) {
        this.lastOutageLoggedAt = now;
        logger.error('JSON Server unavailable', { context, url: config.jsonServerUrl, code: axiosError.code });
      }
      throw new AppError(
        ERROR_CODES.PERSISTENCE_UNAVAILABLE,
        'The data service is unavailable. Start JSON Server and try again.',
        503,
      );
    }

    logger.error('Persistence request failed', { context, status, message: axiosError.message });
    throw internal('Could not reach the data service.');
  }

  async list<T>(collection: Collection, params?: Record<string, unknown>): Promise<T[]> {
    try {
      const { data } = await this.http.get<T[]>(`/${collection}`, { params });
      return Array.isArray(data) ? data : [];
    } catch (error) {
      this.fail(error, `list:${collection}`);
    }
  }

  async findById<T>(collection: Collection, id: string): Promise<T | null> {
    try {
      const { data } = await this.http.get<T>(`/${collection}/${encodeURIComponent(id)}`);
      return data ?? null;
    } catch (error) {
      if ((error as AxiosError).response?.status === 404) return null;
      this.fail(error, `findById:${collection}`);
    }
  }

  /** Exact-match query helper (JSON Server filters on equality by default). */
  async findOne<T>(collection: Collection, query: Record<string, unknown>): Promise<T | null> {
    const rows = await this.list<T>(collection, { ...query, _limit: 1 });
    return rows[0] ?? null;
  }

  async create<T extends { id: string }>(collection: Collection, record: T): Promise<T> {
    return this.enqueue(async () => {
      try {
        const { data } = await this.http.post<T>(`/${collection}`, record);
        return data;
      } catch (error) {
        this.fail(error, `create:${collection}`);
      }
    });
  }

  async update<T>(collection: Collection, id: string, patch: Partial<T>): Promise<T> {
    return this.enqueue(async () => {
      try {
        const { data } = await this.http.patch<T>(`/${collection}/${encodeURIComponent(id)}`, patch);
        return data;
      } catch (error) {
        this.fail(error, `update:${collection}`);
      }
    });
  }

  async replace<T extends { id: string }>(collection: Collection, record: T): Promise<T> {
    return this.enqueue(async () => {
      try {
        const { data } = await this.http.put<T>(`/${collection}/${encodeURIComponent(record.id)}`, record);
        return data;
      } catch (error) {
        this.fail(error, `replace:${collection}`);
      }
    });
  }

  async remove(collection: Collection, id: string): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.http.delete(`/${collection}/${encodeURIComponent(id)}`);
      } catch (error) {
        if ((error as AxiosError).response?.status === 404) return;
        this.fail(error, `remove:${collection}`);
      }
    });
  }

  /** Used by /api/health and by startup diagnostics. */
  async ping(): Promise<boolean> {
    try {
      await this.http.get('/users', { params: { _limit: 1 }, timeout: 2500 });
      return true;
    } catch {
      return false;
    }
  }
}

export const db = new DbService();
