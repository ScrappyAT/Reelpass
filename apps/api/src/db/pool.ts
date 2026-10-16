import { Pool } from 'pg';
import { env } from '../config/env';

let pool: Pool | null = null;
let isPostgresConnected = false;

export function getDbPool(): Pool | null {
  if (pool) return pool;

  try {
    const connectionString =
      env.DATABASE_URL ||
      `postgresql://${env.PGUSER}:${env.PGPASSWORD}@${env.PGHOST}:${env.PGPORT}/${env.PGDATABASE}`;

    pool = new Pool({
      connectionString,
      // Requests queue for a connection up to 30s instead of failing fast under
      // heavy seat contention (FOR UPDATE row locks can hold connections busy).
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 30000),
      idleTimeoutMillis: 30000,
      // Sized so the 500-VU seat-contention benchmark queues cleanly at the pool
      // instead of exhausting PostgreSQL connections. Overridable per environment.
      max: Number(process.env.PG_POOL_MAX ?? 100),
      // Never let a single statement hang a pooled connection forever. Must exceed
      // the worst-case FOR UPDATE lock wait under contention.
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 30000),
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 30000),
    });

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
