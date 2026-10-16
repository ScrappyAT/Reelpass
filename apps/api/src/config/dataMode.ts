import { env } from './env';

export type DataMode = 'postgres' | 'memory';

/**
 * Resolve the active data mode.
 *
 *   DATA_MODE=memory   -> always the in-memory demo store.
 *   DATA_MODE=postgres -> always PostgreSQL. If it is unreachable the API fails
 *                         loudly; it never silently falls back to memory.
 *   DATA_MODE=auto     -> PostgreSQL when DATABASE_URL is present, otherwise the
 *                         in-memory demo store (logged explicitly).
 *
 * Read lazily from `process.env` first so tests can override the mode.
 */
export function resolveDataMode(): DataMode {
  const raw = (process.env.DATA_MODE || env.DATA_MODE || 'auto').toLowerCase();
  if (raw === 'memory') return 'memory';
  if (raw === 'postgres') return 'postgres';
  return process.env.DATABASE_URL || env.DATABASE_URL ? 'postgres' : 'memory';
}

export function isPostgresRequired(): boolean {
  return (process.env.DATA_MODE || env.DATA_MODE) === 'postgres';
}
