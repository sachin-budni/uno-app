/** Resets data/db.json to an empty state (keeps a timestamped backup). */
import { writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, 'data', 'db.json');
const SHAPE = { users: [], rooms: [], games: [], gameHistory: [], leaderboard: [] };

if (existsSync(dbPath)) {
  const backup = path.join(root, 'data', `db.backup-${Date.now()}.json`);
  await copyFile(dbPath, backup);
  console.log(`[reset-db] backup written to ${path.basename(backup)}`);
}
await writeFile(dbPath, JSON.stringify(SHAPE, null, 2) + '\n', 'utf8');
console.log('[reset-db] data/db.json reset');
