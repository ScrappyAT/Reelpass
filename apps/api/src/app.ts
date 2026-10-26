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

// Base Middlewares
const corsOrigins = env.CORS_ORIGIN.includes(',')
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : env.CORS_ORIGIN;
app.use(cors({ origin: corsOrigins }));
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
app.get(['/health', `${env.API_PREFIX}/health`], async (req, res) => {
  const hasTmdbKey = Boolean(env.TMDB_API_KEY && !env.TMDB_API_KEY.includes('your_tmdb_api_key'));
  const mode = resolveDataMode();
  let dbTables: { cinemas?: number; users?: number; showtimes?: number } | null = null;
  let dbError: string | null = null;
  let autoMigrated = false;

  if (mode === 'postgres' && isDbLive()) {
    try {
      const p = getDbPool();
      if (p) {
        const cRes = await p.query('SELECT COUNT(*)::int AS c FROM cinemas');
        const uRes = await p.query('SELECT COUNT(*)::int AS c FROM users');
        const sRes = await p.query('SELECT COUNT(*)::int AS c FROM showtimes');
        dbTables = { cinemas: cRes.rows[0].c, users: uRes.rows[0].c, showtimes: sRes.rows[0].c };

        // If tables exist but have 0 rows (e.g. initial deployment before seed completed), trigger seed!
        if (dbTables.cinemas === 0 || dbTables.showtimes === 0) {
          try {
            const { seedPgDatabase } = await import('./db/seedPg');
            await seedPgDatabase();
            autoMigrated = true;
            const cRes2 = await p.query('SELECT COUNT(*)::int AS c FROM cinemas');
            const uRes2 = await p.query('SELECT COUNT(*)::int AS c FROM users');
            const sRes2 = await p.query('SELECT COUNT(*)::int AS c FROM showtimes');
            dbTables = { cinemas: cRes2.rows[0].c, users: uRes2.rows[0].c, showtimes: sRes2.rows[0].c };
          } catch (seedErr: any) {
            dbError = `Seed check failed: ${seedErr.message}`;
          }
        }
      }
    } catch (err: any) {
      dbError = err.message;
      // If tables are missing, auto-run safe migrations and seed check on demand
      if (err.message && (err.message.includes('does not exist') || err.message.includes('relation'))) {
        try {
          const { runMigrations } = await import('./db/migrate');
          const { seedPgDatabase } = await import('./db/seedPg');
          await runMigrations();
          await seedPgDatabase();
          autoMigrated = true;
          const p = getDbPool();
          if (p) {
            const cRes = await p.query('SELECT COUNT(*)::int AS c FROM cinemas');
            const uRes = await p.query('SELECT COUNT(*)::int AS c FROM users');
            const sRes = await p.query('SELECT COUNT(*)::int AS c FROM showtimes');
            dbTables = { cinemas: cRes.rows[0].c, users: uRes.rows[0].c, showtimes: sRes.rows[0].c };
            dbError = null;
          }
        } catch (initErr: any) {
          dbError = `Auto-migrate failed: ${initErr.message}`;
        }
      }
    }
  }

  res.json({
    status: 'ok',
    system: 'ReelPass Cinema API',
    version: '2.0.3',
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
      dbTables,
      dbError,
      autoMigrated,
      cache: cache.isLive() ? 'Redis (live)' : 'In-Memory TTL Cache Fallback',
      redis: cache.getDiagnosticInfo(),
      tmdb: hasTmdbKey ? 'TMDB v3 API (live)' : 'Rich Demo Movie Catalog',
    },
    attribution: TMDB_ATTRIBUTION,
  });
});

app.post(['/health/init', `${env.API_PREFIX}/health/init`], async (req, res) => {
  if (env.NODE_ENV === 'production' && req.headers['x-admin-key'] !== env.JWT_SECRET) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  try {
    const { runMigrations } = await import('./db/migrate');
    const { seedPgDatabase } = await import('./db/seedPg');
    const applied = await runMigrations();
    await seedPgDatabase();
    return res.json({ success: true, applied, message: 'Database migrations and seed completed' });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message,
      ...(env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
    });
  }
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
