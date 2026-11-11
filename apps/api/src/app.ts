import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { isDbLive, getDbPool } from './db/pool';
import { cache } from './redis/client';
import { TMDB_ATTRIBUTION } from './services/tmdb.service';

import authRoutes from './routes/auth.routes';
import movieRoutes from './routes/movie.routes';
import cinemaRoutes from './routes/cinema.routes';
import showtimeRoutes from './routes/showtime.routes';
import bookingRoutes from './routes/booking.routes';
import paymentRoutes from './routes/payment.routes';
import { resolveDataMode } from './config/dataMode';

const app = express();
app.set('trust proxy', env.TRUST_PROXY_HOPS);

// Base Middlewares
const corsOrigins = env.CORS_ORIGIN.includes(',')
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : env.CORS_ORIGIN;
app.use(cors({ origin: corsOrigins }));
app.use(express.json());
app.use(requestIdMiddleware);

// Correlate API results without logging credentials, query strings or payment data.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.endsWith('/health')) return;
    console.log(JSON.stringify({ event: 'http_request', requestId: req.id, userId: req.user?.id,
      method: req.method, route: req.route?.path ? req.baseUrl + req.route.path : req.path,
      status: res.statusCode, elapsedMs: Date.now() - start }));
  });
  next();
});

app.get(['/health', env.API_PREFIX + '/health'], async (req, res) => {
  const mode = resolveDataMode();
  let postgresReady = false;
  if (mode === 'postgres' && isDbLive()) {
    try { postgresReady = Boolean(await getDbPool()?.query('SELECT 1')); } catch { /* readiness failure */ }
  }
  const ready = mode === 'memory' || postgresReady;
  const redis = cache.getDiagnosticInfo();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'unavailable',
    system: 'ReelPass Cinema API',
    dataMode: mode,
    requestId: req.id,
    services: {
      database: mode === 'memory' ? 'In-Memory Demo' : postgresReady ? 'PostgreSQL (live)' : 'PostgreSQL unavailable',
      cache: cache.isLive() ? 'Redis (live)' : 'In-Memory TTL Cache Fallback',
      redis: { configured: redis.configured, status: redis.status, verified: redis.verified, host: redis.host, tls: redis.tls },
    },
    attribution: TMDB_ATTRIBUTION,
  });
});

// Mount Routes
app.use(`${env.API_PREFIX}/auth`, authRoutes);
app.use(`${env.API_PREFIX}/movies`, movieRoutes);
app.use(`${env.API_PREFIX}/cinemas`, cinemaRoutes);
app.use(`${env.API_PREFIX}/showtimes`, showtimeRoutes);
app.use(`${env.API_PREFIX}/bookings`, bookingRoutes);
app.use(`${env.API_PREFIX}/payments`, paymentRoutes);

// Structured Error Handling
app.use(errorHandler);

export default app;
