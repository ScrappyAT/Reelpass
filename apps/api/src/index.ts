import app from './app';
import { env } from './config/env';
import { resolveDataMode } from './config/dataMode';
import { checkDatabaseConnection, getDbPool, closeDbPool } from './db/pool';
import { requirePaymentSchema } from './db/requirePaymentSchema';
import { cache } from './redis/client';

async function bootstrap() {
  const mode = resolveDataMode();
  if (mode === 'postgres') {
    await checkDatabaseConnection(true);
    await requirePaymentSchema(getDbPool()!);
  }
  const server = app.listen(env.PORT, env.NODE_ENV === 'test' ? '127.0.0.1' : '0.0.0.0', 2048, () => {
    const address = server.address();
    console.log(JSON.stringify({ event: 'reelpass_api_ready', port: typeof address === 'object' ? address?.port : env.PORT, mode }));
  });
  server.maxConnections = 10_000;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  const stop = () => server.close(async () => {
    await Promise.allSettled([closeDbPool(), cache.close()]);
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
bootstrap().catch(async error => {
  console.error(JSON.stringify({ event: 'api_startup_failed', code: error.code ?? error.name }));
  await Promise.allSettled([closeDbPool(), cache.close()]);
  process.exitCode = 1;
});
