import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';
import { isDbLive } from './db/pool';
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

// Base Middlewares
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());
app.use(requestIdMiddleware);

// Development-only request diagnostics: method, path, status, timing.
// Never logs headers, bodies, tokens, or credentials.
if (env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.endsWith('/health')) return;
      console.log(
        `🔎 [dev] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms) [${req.id}]`
      );
    });
    next();
  });
}

// Health check endpoint (available at both root /health and API prefix /api/v1/health)
app.get(['/health', `${env.API_PREFIX}/health`], (req, res) => {
  const hasTmdbKey = Boolean(env.TMDB_API_KEY && !env.TMDB_API_KEY.includes('your_tmdb_api_key'));
  const mode = resolveDataMode();
  res.json({
    status: 'ok',
    system: 'ReelPass Cinema API',
    version: '2.0.0',
    mode: env.NODE_ENV,
    dataMode: mode === 'postgres' ? 'PostgreSQL' : 'In-Memory Demo',
    requestId: req.id,
    timestamp: new Date().toISOString(),
    services: {
      database:
        mode === 'postgres'
          ? isDbLive()
            ? 'PostgreSQL (live)'
            : 'PostgreSQL (configured but not connected)'
          : 'In-Memory Resilient Demo Store',
      cache: cache.isLive() ? 'Redis (live)' : 'In-Memory TTL Cache Fallback',
      tmdb: hasTmdbKey ? 'TMDB v3 API (live)' : 'Rich Demo Movie Catalog',
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
