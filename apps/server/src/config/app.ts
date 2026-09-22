import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import { errorHandler, notFoundHandler } from '../middleware/error.middleware';
import { apiRouter } from '../routes';
import { ERROR_CODES } from '../utils/errors';
import { logger } from '../utils/logger';
import { config } from './env';

export function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
  // Same-origin requests and non-browser clients send no Origin header.
  if (!origin) return callback(null, true);
  if (config.clientUrls.includes(origin)) return callback(null, true);
  callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      skip: () => config.isTest,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: { code: ERROR_CODES.RATE_LIMITED, message: 'You are sending requests too quickly.' },
      },
    }),
  );

  app.use('/api', apiRouter);

  serveClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Serves the built Angular client from the same origin as the API, so one
 * deployed service answers for everything: `/api/*`, `/socket.io/*` and the app
 * itself. Does nothing when the build is absent, which is the normal case in
 * development - there `ng serve` owns the client and proxies nothing here.
 */
function serveClient(app: Express): void {
  const clientDist = config.clientDist;
  const indexHtml = path.join(clientDist, 'index.html');

  if (!fs.existsSync(indexHtml)) {
    logger.debug('No client build found; serving the API only', { clientDist });
    return;
  }

  // Fingerprinted assets can be cached hard; the shell must not be.
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders: (res, filePath) => {
        const immutable = /\.(?:js|css|woff2?|svg|png|jpe?g|webp|ico)$/i.test(filePath);
        res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );

  // The Angular router owns every remaining path, so a refresh on /room/A7K9P2
  // has to return the shell rather than a 404. API and socket paths are left
  // alone so an unknown /api route still gets a structured JSON error.
  app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(indexHtml, (error) => (error ? next(error) : undefined));
  });

  logger.info('Serving the web client', { clientDist });
}
