import app from './app';
import { env } from './config/env';
import { resolveDataMode, isPostgresRequired } from './config/dataMode';
import { checkDatabaseConnection, getDbPool, closeDbPool } from './db/pool';
import { runMigrations } from './db/migrate';
import { seedPgDatabase } from './db/seedPg';
import { getPgStore } from './db/store';
import { startWorker } from './queue';
import { cache } from './redis/client';

async function bootstrap() {
  console.log('🎬 [ReelPass API] Starting backend services...');

  const mode = resolveDataMode();
  console.log(`🧭 [ReelPass API] Data mode: ${mode}`);

  if (env.NODE_ENV === 'production') {
    console.log('🔒 [ReelPass API] Production JWT security validated: strong custom secret active.');
  }

  let sweeper: NodeJS.Timeout | null = null;

  if (mode === 'postgres') {
    // Fail loudly if PostgreSQL is configured but unreachable. Never fall back.
    await checkDatabaseConnection(true);

    if (process.env.AUTO_MIGRATE !== 'false') {
      console.log('🔄 [ReelPass API] Ensuring PostgreSQL database schema is migrated...');
      try {
        await runMigrations();
      } catch (err: any) {
        console.error('💥 [ReelPass API] Migration error:', err.message || err);
        throw err;
      }

      console.log('🌱 [ReelPass API] Ensuring initial demo catalog is present...');
      try {
        await seedPgDatabase();
      } catch (err: any) {
        console.error('💥 [ReelPass API] Seed error:', err.message || err);
        throw err;
      }
    }

    // Background sweep: release seats from expired pending bookings.
    sweeper = setInterval(() => {
      getPgStore()
        .expireStaleBookings()
        .catch((err) => console.warn('⚠️ [Booking] Expiry sweep failed:', err.message));
    }, 15_000);
  } else {
    if (isPostgresRequired()) {
      throw new Error('DATA_MODE=postgres but no DATABASE_URL was provided');
    }
    await checkDatabaseConnection(false);
    console.log('ℹ️ [ReelPass API] In-memory demo mode. Data is not persisted across restarts.');
  }

  // If Redis is configured, give it a moment to complete initial handshake so worker & health status start live
  if (cache.isConfigured()) {
    const ready = await cache.waitForReady(Number(process.env.REDIS_BOOTSTRAP_WAIT_MS ?? 2500)).catch(() => false);
    if (!ready) {
      console.log('ℹ️ [ReelPass API] Redis not immediately ready during bootstrap; continuing with async background connection.');
    }
  }

  startWorker();

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : env.PORT;
  const server = app.listen(port, '0.0.0.0', 2048, () => {
    console.log(`🚀 [ReelPass API] Server listening on 0.0.0.0:${port}${env.API_PREFIX}`);
    console.log(`📡 [Health Check] Available at http://0.0.0.0:${port}${env.API_PREFIX}/health`);
  });
  server.maxConnections = 10000;

  // Keep-alive tuning: under sustained load, connections can sit idle between a
  // client's requests. Node's default 5s keep-alive timeout would close them and
  // the client's next request would fail with a reset. Keep them open longer so
  // load generators (and real clients) reuse connections cleanly.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const shutdown = () => {
    console.log('\n🛑 [ReelPass API] Graceful shutdown initiated...');
    if (sweeper) clearInterval(sweeper);
    server.close(async () => {
      await closeDbPool().catch(() => undefined);
      await cache.close().catch(() => undefined);
      console.log('✅ Server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('💥 [ReelPass API] Fatal boot error:', err.message || err);
  process.exit(1);
});
