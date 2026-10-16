import { checkDatabaseConnection, closeDbPool } from './pool';
import { runMigrations } from './migrate';
import { seedPgDatabase } from './seedPg';

/**
 * Safe, explicit production database setup CLI:
 *   npm run db:setup
 *
 * Connects (failing loudly), applies forward-only migrations, then seeds the
 * catalog if empty. Safe to run repeatedly: never drops or truncates existing data.
 */
async function main() {
  console.log('🎬 [db:setup] Starting PostgreSQL database setup...');
  try {
    console.log('🔄 [db:setup] 1/3 Connecting to PostgreSQL...');
    await checkDatabaseConnection(true);

    console.log('🔄 [db:setup] 2/3 Applying pending migrations...');
    const applied = await runMigrations();
    console.log(`✅ [db:setup] Migrations up to date (${applied} applied).`);

    console.log('🔄 [db:setup] 3/3 Checking seed data...');
    await seedPgDatabase();

    console.log('🚀 [db:setup] Database setup complete and ready for production!');
    process.exitCode = 0;
  } catch (err: any) {
    console.error('💥 [db:setup] Database setup failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

main();
