import type { Pool } from 'pg';

export async function requirePaymentSchema(pool: Pool) {
  const result = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '003_payment_workflow.sql'");
  if (!result.rowCount) throw new Error('Payment schema is missing. Apply reviewed migrations explicitly before starting ReelPass.');
}
