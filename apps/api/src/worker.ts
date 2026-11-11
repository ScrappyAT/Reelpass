import { resolveDataMode } from './config/dataMode';
import { checkDatabaseConnection, closeDbPool, getDbPool } from './db/pool';
import { requirePaymentSchema } from './db/requirePaymentSchema';
import { cache } from './redis/client';
import { startPaymentWorker } from './queue';

async function main() {
  if (resolveDataMode() !== 'postgres' || !cache.isConfigured()) {
    throw new Error('Payment worker requires PostgreSQL and Redis configuration.');
  }
  await checkDatabaseConnection(true);
  const pool = getDbPool()!;
  await requirePaymentSchema(pool);
  if (!(await cache.waitForReady(10_000))) throw new Error('Payment worker could not connect to Redis.');
  const worker = await startPaymentWorker(pool, cache.getRedisClient()!);
  console.log(JSON.stringify({ event: 'payment_worker_ready' }));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.close();
    await Promise.allSettled([cache.close(), closeDbPool()]);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
main().catch(async error => {
  console.error(JSON.stringify({ event: 'payment_worker_startup_failed', code: error.code ?? error.name }));
  await Promise.allSettled([cache.close(), closeDbPool()]);
  process.exitCode = 1;
});
