import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { getDbPool } from './pool';

/**
 * Minimal, dependency-free forward-only migration runner.
 *
 * - Applies every `migrations/*.sql` file in lexical order exactly once.
 * - Tracks applied files in `schema_migrations`.
 * - Each migration runs inside a transaction; a failure rolls back and aborts.
 *
 * NOTE: never destructive. This runner only ever CREATEs. It never drops or
 * truncates, so it is safe to run repeatedly against a local database.
 */
export async function runMigrations(pool: Pool = getDbPool() as Pool): Promise<number> {
  if (!pool) {
    throw new Error('[migrate] No PostgreSQL pool available');
  }

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`[migrate] migrations directory not found: ${migrationsDir}`);
  }

  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const done = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const alreadyApplied = new Set(done.rows.map((r) => r.name));

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`🌱 [migrate] applying ${file} ...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    if (applied === 0) {
      console.log('ℹ️ [migrate] Database schema is up to date. No migrations applied.');
    } else {
      console.log(`✅ [migrate] Applied ${applied} migration(s).`);
    }
    return applied;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    client.release();
  }
}
