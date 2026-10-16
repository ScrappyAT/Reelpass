import app from './app';
import { env } from './config/env';
import { resolveDataMode, isPostgresRequired } from './config/dataMode';
import { checkDatabaseConnection, getDbPool, closeDbPool } from './db/pool';
import { runMigrations } from './db/migrate';
import { seedPgDatabase } from './db/seedPg';
import { getPgStore } from './db/store';
import { startWorker } from './queue';

async function bootstrap() {
  console.log('🎬 [ReelPass API] Starting backend services...');

  const mode = resolveDataMode();
  console.log(`🧭 [ReelPass API] Data mode: ${mode}`);

  let sweeper: NodeJS.Timeout | null = null;

  if (mode === 'postgres') {
    // Fail loudly if PostgreSQL is configured but unreachable. Never fall back.
    await checkDatabaseConnection(true);
    await runMigrations();
    await seedPgDatabase();

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

  startWorker();

  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`🚀 [ReelPass API] Server listening on all interfaces at port ${env.PORT}${env.API_PREFIX}`);
    console.log(`📡 [Health Check] Available at http://localhost:${env.PORT}${env.API_PREFIX}/health`);
  });

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
