import http from 'node:http';
import { createApp } from './config/app';
import { config } from './config/env';
import { db } from './services/db.service';
import { gameManager } from './services/game-manager';
import { roomService } from './services/room.service';
import { createSocketServer } from './sockets';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  roomService.startCleanup();

  httpServer.listen(config.port, () => {
    logger.info('Server started', {
      port: config.port,
      env: config.nodeEnv,
      clientOrigins: config.clientUrls,
      jsonServer: config.jsonServerUrl,
    });
  });

  // A warning, not a failure: the API comes up either way and reports the
  // outage through /api/health and the PERSISTENCE_UNAVAILABLE error code.
  const persistenceUp = await db.ping();
  if (!persistenceUp) {
    logger.warn('JSON Server is not reachable yet', {
      url: config.jsonServerUrl,
      hint: 'Run "npm run dev:json" (or "npm run dev" from the repo root).',
    });
  } else {
    logger.info('Persistence reachable', { url: config.jsonServerUrl });
  }

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    gameManager.shutdown();
    roomService.stopCleanup();
    io.close(() => {
      httpServer.close(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', { message: error.message, stack: error.stack });
  });
}

void bootstrap();
