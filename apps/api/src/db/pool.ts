import { Pool, PoolConfig } from 'pg';
import { env } from '../config/env';

let pool: Pool | null = null;
let isPostgresConnected = false;

export function getDbPool(): Pool | null {
  if (pool) return pool;

  try {
    const connectionString =
      env.DATABASE_URL ||
      `postgresql://${env.PGUSER}:${env.PGPASSWORD}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`;

    const isRemote =
      connectionString.includes('neon.tech') ||
      (!connectionString.includes('localhost') && !connectionString.includes('127.0.0.1'));

    // Determine TLS requirement
    const sslEnv = (process.env.PGSSL || '').toLowerCase();
    const sslModeEnv = (process.env.PGSSLMODE || '').toLowerCase();
    const hasSslModeInUrl = connectionString.includes('sslmode=');

    let ssl: boolean | { rejectUnauthorized: boolean } | undefined = undefined;

    if (
      !hasSslModeInUrl &&
      (connectionString.includes('neon.tech') ||
        sslEnv === 'true' ||
        sslModeEnv === 'require' ||
        (isRemote && process.env.NODE_ENV === 'production'))
    ) {
      // For Neon and cloud databases without an explicit sslmode in query string,
      // enable TLS with rejectUnauthorized: false for maximum compatibility.
      ssl = { rejectUnauthorized: false };
    }

    const poolConfig: PoolConfig = {
      connectionString,
      ...(ssl ? { ssl } : {}),
      // Requests queue for a connection up to 30s instead of failing fast under
      // heavy seat contention (FOR UPDATE row locks can hold connections busy).
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 30000),
      idleTimeoutMillis: 30000,
      // Default to 20 on remote/serverless Neon databases to prevent connection limits,
      // or 100 for local high-concurrency benchmarks. Configurable via PG_POOL_MAX.
      max: Number(process.env.PG_POOL_MAX ?? (isRemote ? 20 : 100)),
      // Never let a single statement hang a pooled connection forever. Must exceed
      // the worst-case FOR UPDATE lock wait under contention.
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 60000),
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 60000),
    };

    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.warn('⚠️ [Database] Unexpected PostgreSQL error on idle client:', err.message);
    });

    return pool;
  } catch (error) {
    console.warn('⚠️ [Database] Unable to initialize PostgreSQL pool:', error);
    return null;
  }
}

/**
 * Verify the PostgreSQL connection.
 *
 * Returns true when reachable. When `required` is true an unreachable database
 * throws instead of degrading — callers must never silently fall back to the
 * in-memory store when PostgreSQL has been explicitly configured.
 */
export async function checkDatabaseConnection(required = false): Promise<boolean> {
  const p = getDbPool();
  if (!p) {
    isPostgresConnected = false;
    if (required) throw new Error('PostgreSQL pool could not be initialised');
    return false;
  }

  try {
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    isPostgresConnected = true;
    console.log('✅ [Database] PostgreSQL connected successfully.');
    return true;
  } catch (error: any) {
    isPostgresConnected = false;
    if (required) {
      throw new Error(
        `PostgreSQL is configured (DATA_MODE=postgres) but unreachable: ${error.message}`
      );
    }
    console.log(
      `ℹ️ [Database] PostgreSQL not connected (${error.message || 'connection failed'}). Running in resilient demo mode.`
    );
    return false;
  }
}

export function isDbLive(): boolean {
  return isPostgresConnected;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    isPostgresConnected = false;
  }
}
