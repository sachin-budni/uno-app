import { randomInt, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

/**
 * Fisher-Yates shuffle backed by a CSPRNG. Returns a new array; the input is untouched.
 * `rng` is injectable so tests can make shuffles deterministic.
 */
export function shuffle<T>(items: readonly T[], rng: (maxExclusive: number) => number = randomInt): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** Room codes avoid 0/O/1/I so they can be read aloud without ambiguity. */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

export function pickRandom<T>(items: readonly T[]): T {
  return items[randomInt(items.length)];
}
