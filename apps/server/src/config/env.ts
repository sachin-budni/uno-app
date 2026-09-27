import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

/**
 * Configuration precedence, highest first:
 *   1. real environment variables (what a host or `PORT=3010 npm start` sets)
 *   2. apps/server/.env   - package specific overrides
 *   3. .env at the repo root - the shared defaults
 *
 * dotenv never overwrites a value that is already set, so loading the most
 * specific file first gives exactly that order.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
for (const candidate of [path.resolve(__dirname, '..', '..', '.env'), path.join(repoRoot, '.env')]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
// Vitest sets VITEST; honour it even if a local .env pins NODE_ENV.
const isTest = nodeEnv === 'test' || process.env.VITEST === 'true';

const DEV_JWT_SECRET = 'uno-arena-development-secret-do-not-use-in-production';
const jwtSecret = str('JWT_SECRET', '');

if (isProduction && (!jwtSecret || jwtSecret === DEV_JWT_SECRET || jwtSecret.length < 32)) {
  throw new Error(
    'JWT_SECRET must be set to a strong value (>= 32 chars) when NODE_ENV=production. Refusing to start.',
  );
}

export const config = {
  nodeEnv,
  isProduction,
  isTest,
  port: int('PORT', 3000),
  /**
   * Interface to bind. 0.0.0.0 is required in a container - a process bound to
   * 127.0.0.1 is unreachable from outside it, so platform health checks fail.
   * Set HOST=127.0.0.1 to keep a local run off the network.
   */
  host: str('HOST', '0.0.0.0'),

  jsonServerUrl: str('JSON_SERVER_URL', 'http://127.0.0.1:3001').replace(/\/+$/, ''),
  jsonServerTimeoutMs: int('JSON_SERVER_TIMEOUT_MS', 8000),

  jwtSecret: jwtSecret || DEV_JWT_SECRET,
  jwtExpiresIn: str('JWT_EXPIRES_IN', '2h'),
  bcryptRounds: int('BCRYPT_ROUNDS', 10),

  clientUrls: str('CLIENT_URL', 'http://localhost:4200')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),

  /**
   * Built Angular client. When this directory exists the API also serves the
   * app, which makes a single-service deployment same-origin - exactly what
   * `environment.production.ts` already assumes. Absent in development, where
   * `ng serve` owns the client on :4200.
   */
  clientDist: str('CLIENT_DIST', path.resolve(repoRoot, 'apps', 'web', 'dist', 'uno-arena-web', 'browser')),

  game: {
    maxPlayers: int('MAX_PLAYERS', 4),
    minPlayers: int('MIN_PLAYERS', 2),
    initialHandSize: int('INITIAL_HAND_SIZE', 7),
    turnTimeoutSeconds: int('TURN_TIMEOUT_SECONDS', 30),
    reconnectGraceSeconds: int('RECONNECT_GRACE_SECONDS', 60),
    allowDrawStacking: bool('ALLOW_DRAW_STACKING', false),
    // Official UNO allows the bluff and polices it with a challenge.
    wildDrawFourMode: (str('WILD_DRAW_FOUR_MODE', 'challenge') === 'restricted'
      ? 'restricted'
      : 'challenge') as 'challenge' | 'restricted',
    twoPlayerReverseActsAsSkip: bool('TWO_PLAYER_REVERSE_ACTS_AS_SKIP', true),
    unoPenaltyCards: int('UNO_PENALTY_CARDS', 2),
    // Official UNO only penalises a missed UNO when someone catches it.
    unoAutoPenalty: bool('UNO_AUTO_PENALTY', false),
    abandonedRoomTtlMs: int('ABANDONED_ROOM_TTL_MS', 15 * 60 * 1000),
    chatMaxLength: int('CHAT_MAX_LENGTH', 240),
  },

  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    max: int('RATE_LIMIT_MAX', 300),
    authMax: int('AUTH_RATE_LIMIT_MAX', 20),
  },

  logLevel: str('LOG_LEVEL', 'info'),
} as const;

export type AppConfig = typeof config;
