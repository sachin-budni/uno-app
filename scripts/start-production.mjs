/**
 * Production entrypoint: runs JSON Server and the API together in one process
 * tree, so the whole app can be deployed as a single service.
 *
 * Deliberately dependency-free (`concurrently` is a devDependency and is not
 * installed in a production image). Starts JSON Server, waits until it actually
 * answers, then starts the API - which serves the built Angular client too, so
 * one port serves everything.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DB_PATH = process.env.DB_PATH ?? path.join(root, 'data', 'db.json');
const JSON_SERVER_PORT = process.env.JSON_SERVER_PORT ?? '3001';
const JSON_SERVER_HOST = '127.0.0.1';
const API_ENTRY = path.join(root, 'apps', 'server', 'dist', 'server.js');
// Run json-server's bin with node directly. Going through `npx` would need a
// shell on Windows, and a shell splits paths like "C:\Program Files\nodejs".
const JSON_SERVER_BIN = path.join(root, 'node_modules', 'json-server', 'lib', 'cli', 'bin.js');
const EMPTY_DB = { users: [], rooms: [], games: [], gameHistory: [], leaderboard: [] };

const children = [];
let shuttingDown = false;

function log(message) {
  console.log(`${new Date().toISOString()} [INFO] ${message}`);
}

/** A mounted disk starts empty, so make sure the file exists before JSON Server opens it. */
function ensureDatabase() {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!existsSync(DB_PATH)) {
    writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2) + '\n', 'utf8');
    log(`created an empty database at ${DB_PATH}`);
  }
}

/** Always spawns a node script by absolute path - no shell, so paths with spaces are safe. */
function start(name, scriptPath, args, env = {}) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`${name} exited unexpectedly (code ${code}, signal ${signal}). Shutting down.`);
    shutdown(code ?? 1);
  });

  children.push({ name, child });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  // Do not hang on a child that ignores SIGTERM.
  const failsafe = setTimeout(() => process.exit(code), 5000);
  failsafe.unref();

  Promise.all(
    children.map(
      ({ child }) =>
        new Promise((resolve) => (child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve))),
    ),
  ).then(() => {
    clearTimeout(failsafe);
    process.exit(code);
  });
}

async function waitForJsonServer(timeoutMs = 60_000) {
  const url = `http://${JSON_SERVER_HOST}:${JSON_SERVER_PORT}/users`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function main() {
  ensureDatabase();

  if (!existsSync(JSON_SERVER_BIN)) {
    console.error(`Cannot find json-server at ${JSON_SERVER_BIN}. Run "npm ci" first.`);
    process.exit(1);
  }

  log(`starting JSON Server on ${JSON_SERVER_HOST}:${JSON_SERVER_PORT} (${DB_PATH})`);
  start('json-server', JSON_SERVER_BIN, [
    '--watch',
    DB_PATH,
    '--port',
    JSON_SERVER_PORT,
    '--host',
    JSON_SERVER_HOST,
    '--quiet',
  ]);

  if (!(await waitForJsonServer())) {
    console.error('JSON Server did not become reachable in time. Shutting down.');
    shutdown(1);
    return;
  }
  log('JSON Server is up');

  log('starting the API');
  start('api', API_ENTRY, [], {
    JSON_SERVER_URL: `http://${JSON_SERVER_HOST}:${JSON_SERVER_PORT}`,
  });
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

main().catch((error) => {
  console.error('Failed to start:', error);
  shutdown(1);
});
