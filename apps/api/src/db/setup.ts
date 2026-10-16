import { checkDatabaseConnection } from './pool';
import { runMigrations } from './migrate';
import { seedPgDatabase } from './seedPg';

/**
 * Reproducible database setup CLI:
 *   npm run db:setup --workspace=@matinee/api
 *
 * Connects (failing loudly), applies forward-only migrations, then seeds the
 * demo catalog. Safe to run repeatedly.
 */
(async () => {
  try {
    await checkDatabaseConnection(true);
    await runMigrations();
    await seedPgDatabase();
    console.log('✅ [db:setup] PostgreSQL is ready.');
    process.exit(0);
  } catch (err: any) {
    console.error('💥 [db:setup] Failed:', err.message || err);
    process.exit(1);
  }
})();
