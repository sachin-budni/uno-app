import { config } from '../config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = ORDER[(config.logLevel as Level) in ORDER ? (config.logLevel as Level) : 'info'];

const REDACT = /(password|passwordhash|token|accesstoken|authorization|secret|jwt)/i;

/** Shallow-redacts anything that looks like a credential before it reaches the log. */
function safe(meta: unknown): unknown {
  if (!meta || typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) return meta.map(safe);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    out[key] = REDACT.test(key) ? '[redacted]' : value && typeof value === 'object' ? safe(value) : value;
  }
  return out;
}

function emit(level: Level, message: string, meta?: unknown): void {
  if (ORDER[level] < THRESHOLD) return;
  const stamp = new Date().toISOString();
  const tag = `[${level.toUpperCase()}]`;
  const line = `${stamp} ${tag} ${message}`;
  const payload = meta === undefined ? '' : ` ${JSON.stringify(safe(meta))}`;
  if (level === 'error') console.error(line + payload);
  else if (level === 'warn') console.warn(line + payload);
  else console.log(line + payload);
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
};
