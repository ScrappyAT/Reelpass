import { checkDatabaseConnection, closeDbPool } from './pool';
import { runMigrations } from './migrate';

/**
 * Migration-only CLI runner:
 *   npm run db:migrate
 *
 * Safe forward-only migration runner. Applies all unapplied SQL migrations
 * without modifying seed or catalog data.
 */
async function main() {
  console.log('🎬 [db:migrate] Starting database migrations...');
  try {
    console.log('🔄 [db:migrate] Checking PostgreSQL connection...');
    await checkDatabaseConnection(true);

    console.log('🔄 [db:migrate] Applying pending migrations...');
    const applied = await runMigrations();
    console.log(`🚀 [db:migrate] Migrations finished. ${applied} migration(s) applied.`);
    process.exitCode = 0;
  } catch (err: any) {
    console.error('💥 [db:migrate] Migration run failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main();
