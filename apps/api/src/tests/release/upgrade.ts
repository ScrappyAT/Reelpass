import '../pg/isolatedEnv';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDbPool, getDbPool } from '../../db/pool';
import { runMigrations } from '../../db/migrate';
import { refreshDemoShowtimes } from '../../db/refreshDemoShowtimes';

const pool = getDbPool()!;
const preservedFields = {
  bookings: ['hold_token', 'request_fingerprint', 'service_fee_kobo'],
  payments: ['checkout_key', 'checkout_link', 'checkout_uncertain'],
  showtimes: ['cancelled_at'],
  booking_seats: [],
  showtime_seats: [],
  tickets: [],
};

async function historicalRecords() {
  const records: Record<string, unknown[]> = {};
  for (const [table, addedFields] of Object.entries(preservedFields)) {
    const { rows } = await pool.query<{ snapshot: unknown }>(
      `SELECT to_jsonb(t) - $1::text[] AS snapshot FROM ${table} t ORDER BY to_jsonb(t)::text`, [addedFields],
    );
    records[table] = rows.map(row => row.snapshot);
  }
  return records;
}

after(async () => { await closeDbPool(); });

test('migration 003 preserves historical rows and adds valid constraints on the copied legacy schema', async () => {
  const identity = await pool.query('SELECT current_database() AS name');
  assert.match(identity.rows[0].name, /^reelpass_it_[a-f0-9]{12}$/);
  assert.equal((await pool.query("SELECT to_regclass('public.payment_events') AS name")).rows[0].name, null);
  await pool.query(`
    INSERT INTO schema_migrations (name) VALUES ('001_init.sql'), ('002_flutterwave_payments.sql');
    INSERT INTO users (id, email, password_hash, full_name) VALUES ('legacy-user', 'legacy@example.test', 'fixture-only', 'Legacy Customer');
    INSERT INTO cinemas (id, name, city, address, is_demo) VALUES ('legacy-cinema', 'Legacy Demo Cinema', 'Lagos', 'Fixture address', TRUE);
    INSERT INTO movies (id, title) VALUES ('legacy-movie', 'Legacy Demo Film');
    INSERT INTO auditoriums (id, cinema_id, name, total_seats, rows_count, columns_count) VALUES ('legacy-auditorium','legacy-cinema','Screen 1',2,1,2);
    INSERT INTO seats (id, auditorium_id, row_label, seat_number) VALUES ('legacy-seat','legacy-auditorium','A',1), ('legacy-second-seat','legacy-auditorium','A',2);
    INSERT INTO showtimes (id, movie_id, cinema_id, auditorium_id, start_time, end_time, price_standard_kobo, price_vip_kobo)
      VALUES ('legacy-showtime','legacy-movie','legacy-cinema','legacy-auditorium',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'+INTERVAL '2 hours',450000,650000);
    INSERT INTO showtime_seats (showtime_id, seat_id, status, price_kobo) VALUES ('legacy-showtime','legacy-seat','SOLD',450000);
    INSERT INTO bookings (id, booking_reference, user_id, showtime_id, total_amount_kobo, status, payment_status, payment_id, qr_code)
      VALUES ('legacy-confirmed','LEGACY-1','legacy-user','legacy-showtime',450000,'confirmed','successful','legacy-payment','REELPASS-LEGACY'),
             ('legacy-expired','LEGACY-2','legacy-user','legacy-showtime',650000,'expired','pending',NULL,'');
    INSERT INTO booking_seats (booking_id, showtime_id, seat_id, seat_label, seat_type, price_kobo)
      VALUES ('legacy-confirmed','legacy-showtime','legacy-seat','A1','standard',450000);
    INSERT INTO tickets (id, booking_id, showtime_id, seat_id, price_kobo, qr_code_data)
      VALUES ('legacy-ticket','legacy-confirmed','legacy-showtime','legacy-seat',450000,'REELPASS-LEGACY');
    INSERT INTO payments (id, booking_id, amount_kobo, reference, transaction_id, status, raw_response, user_id, verified_at, failure_reason)
      VALUES ('legacy-payment','legacy-confirmed',450000,'legacy-ref-1','990001','successful','{"fixture":"verified"}','legacy-user',NOW(),NULL),
             ('legacy-failed','legacy-confirmed',450000,'legacy-ref-2',NULL,'failed',NULL,'legacy-user',NULL,'fixture declined'),
             ('legacy-pending','legacy-expired',650000,'legacy-ref-3',NULL,'pending',NULL,NULL,NULL,NULL),
             ('legacy-cancelled','legacy-expired',650000,'legacy-ref-4',NULL,'cancelled',NULL,'legacy-user',NULL,NULL);
  `);

  const before = await historicalRecords();
  assert.equal(await runMigrations(pool), 1);
  assert.deepEqual(await historicalRecords(), before);
  assert.equal(await runMigrations(pool), 0);
  const indexes = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    AND indexname IN ('uq_checkout_booking','uq_checkout_user_key','uq_capture_booked','uq_payment_transaction_id') ORDER BY indexname`);
  assert.equal(indexes.rowCount, 4);
  const defaults = await pool.query('SELECT service_fee_kobo, hold_token, request_fingerprint FROM bookings WHERE id = $1', ['legacy-confirmed']);
  assert.deepEqual(defaults.rows[0], { service_fee_kobo: 0, hold_token: null, request_fingerprint: null });
  const priorPayments = await pool.query('SELECT checkout_key, checkout_link, checkout_uncertain FROM payments');
  assert.ok(priorPayments.rows.every(row => row.checkout_key === null && row.checkout_link === null && row.checkout_uncertain === false));

  const preview = await refreshDemoShowtimes(pool);
  assert.ok(preview.planned >= 6 && preview.planned <= 7);
  assert.deepEqual(await historicalRecords(), before);
  const applied = await refreshDemoShowtimes(pool, true);
  assert.equal(applied.created, preview.planned);
  assert.equal(applied.seats, applied.created * 2);
  assert.equal((await refreshDemoShowtimes(pool, true)).created, 0);
  const screenings = await pool.query(`SELECT COUNT(*)::int AS future,
    MIN((start_time AT TIME ZONE 'Africa/Lagos')::date)::text AS first_date,
    MAX((start_time AT TIME ZONE 'Africa/Lagos')::date)::text AS last_date
    FROM showtimes WHERE id LIKE 'demo-next-%' AND start_time > NOW()`);
  assert.equal(screenings.rows[0].future, applied.created);
  const after = await historicalRecords();
  after.showtimes = after.showtimes.filter(row => (row as { id: string }).id === 'legacy-showtime');
  after.showtime_seats = after.showtime_seats.filter(row => (row as { showtime_id: string }).showtime_id === 'legacy-showtime');
  assert.deepEqual(after, before);
  console.log(JSON.stringify({
    migration: '003_payment_workflow.sql',
    historical: Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length])),
    showtimes: screenings.rows[0], newSeatRows: applied.seats,
  }));
});
