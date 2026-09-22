/**
 * Guarantees data/db.json exists and is valid JSON with the expected collections.
 * Runs automatically after `npm install` and can be invoked manually.
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, 'data', 'db.json');
const SHAPE = { users: [], rooms: [], games: [], gameHistory: [], leaderboard: [] };

async function main() {
  await mkdir(path.dirname(dbPath), { recursive: true });

  if (!existsSync(dbPath)) {
    await writeFile(dbPath, JSON.stringify(SHAPE, null, 2) + '\n', 'utf8');
    console.log('[ensure-db] created data/db.json');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(dbPath, 'utf8'));
  } catch {
    const backup = path.join(root, 'data', `db.backup-${Date.now()}.json`);
    await copyFile(dbPath, backup);
    await writeFile(dbPath, JSON.stringify(SHAPE, null, 2) + '\n', 'utf8');
    console.warn(`[ensure-db] db.json was malformed. Backed up to ${path.basename(backup)} and recreated.`);
    return;
  }

  let changed = false;
  for (const key of Object.keys(SHAPE)) {
    if (!Array.isArray(parsed[key])) {
      parsed[key] = [];
      changed = true;
    }
  }
  if (changed) {
    await writeFile(dbPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    console.log('[ensure-db] repaired missing collections in data/db.json');
  }
}

main().catch((err) => {
  console.error('[ensure-db] failed:', err.message);
  process.exitCode = 0; // never break install
});
