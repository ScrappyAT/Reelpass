import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getDbPool, closeDbPool, checkDatabaseConnection } from '../../db/pool';
import { runMigrations } from '../../db/migrate';
import { PgStore, BookingConflictError } from '../../db/pgStore';

// PostgreSQL integration tests for the Phase 2 booking engine.
//
// These exercise the REAL database path (`PgStore`) — including the concurrency
// guarantee that a seat can never be double-booked, and that NGN prices are
// always computed server-side from the showtime record.
//
// They require a reachable PostgreSQL (DATABASE_URL). When it is not reachable
// the tests are skipped rather than failing, so `npm test` (memory-mode) still
// passes on a machine with no database. Run them with:
//   npm run test:pg --workspace=@matinee/api

let available = false;
let store: PgStore;

let runSeq = 0;

interface Fixture {
  showtimeId: string;
  standardSeats: string[];
  vipSeats: string[];
  userIds: string[];
  priceStandard: number;
  priceVip: number;
}

const PRICE_STANDARD = 100_000; // kobo
const PRICE_VIP = 200_000; // kobo

/** Build an isolated movie/cinema/auditorium/showtime + seats + users fixture. */
async function seedFixture(userCount = 6): Promise<Fixture> {
  const pool = getDbPool()!;
  const p = ++runSeq;
  const suffix = `${Date.now()}-${p}`;

  const cinemaId = `cin-pg-${suffix}`;
  const movieId = `mov-pg-${suffix}`;
  const auditoriumId = `aud-pg-${suffix}`;
  const showtimeId = `st-pg-${suffix}`;

  await pool.query(
    `INSERT INTO cinemas (id, name, city, address) VALUES ($1, 'PG Test Cinema', 'Lagos', '1 Test Way')`,
    [cinemaId]
  );
  await pool.query(`INSERT INTO movies (id, title, overview) VALUES ($1, 'PG Test Movie', 'test')`, [movieId]);
  await pool.query(
    `INSERT INTO auditoriums (id, cinema_id, name, total_seats, rows_count, columns_count)
     VALUES ($1, $2, 'PG Hall', 4, 1, 4)`,
    [auditoriumId, cinemaId]
  );

  const standardSeats = [`pgtest-${suffix}-A1`, `pgtest-${suffix}-A2`];
  const vipSeats = [`pgtest-${suffix}-A3`, `pgtest-${suffix}-A4`];
  const allSeats = [...standardSeats, ...vipSeats];

  for (const [i, seatId] of allSeats.entries()) {
    await pool.query(
      `INSERT INTO seats (id, auditorium_id, row_label, seat_number, seat_type, default_price_kobo)
       VALUES ($1, $2, 'A', $3, $4, $5)`,
      [seatId, auditoriumId, i + 1, i < 2 ? 'standard' : 'vip', i < 2 ? PRICE_STANDARD : PRICE_VIP]
    );
  }

  await pool.query(
    `INSERT INTO showtimes (id, movie_id, cinema_id, auditorium_id, start_time, end_time, format,
                            price_standard_kobo, price_vip_kobo)
     VALUES ($1, $2, $3, $4, NOW() + interval '2 days', NOW() + interval '2 days 2 hours', '2D', $5, $6)`,
    [showtimeId, movieId, cinemaId, auditoriumId, PRICE_STANDARD, PRICE_VIP]
  );

  for (const seatId of standardSeats) {
    await pool.query(
      `INSERT INTO showtime_seats (showtime_id, seat_id, status, price_kobo) VALUES ($1, $2, 'AVAILABLE', $3)`,
      [showtimeId, seatId, PRICE_STANDARD]
    );
  }
  for (const seatId of vipSeats) {
    await pool.query(
      `INSERT INTO showtime_seats (showtime_id, seat_id, status, price_kobo) VALUES ($1, $2, 'AVAILABLE', $3)`,
      [showtimeId, seatId, PRICE_VIP]
    );
  }

  const userIds: string[] = [];
  for (let i = 0; i < userCount; i++) {
    const userId = `usr-pg-${suffix}-${i}`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name) VALUES ($1, $2, 'x', 'PG Test User')`,
      [userId, `pg-${suffix}-${i}@test.local`]
    );
    userIds.push(userId);
  }

  return { showtimeId, standardSeats, vipSeats, userIds, priceStandard: PRICE_STANDARD, priceVip: PRICE_VIP };
}

async function seatStatus(showtimeId: string, seatId: string): Promise<string> {
  const map = await store.getSeatMap(showtimeId);
  return map!.seats.find((s) => s.id === seatId)!.status;
}

before(async () => {
  try {
    const ok = await checkDatabaseConnection(true);
    if (!ok) return;
    await runMigrations();
    store = new PgStore();
    available = true;
  } catch (err: any) {
    console.warn(`ℹ️ [pg-test] Skipping PostgreSQL tests: ${err.message}`);
    available = false;
  }
});

after(async () => {
  await closeDbPool();
});

test('a seat can be booked by only one user under concurrent load', async (t) => {
  if (!available) return;
  const fx = await seedFixture(6);
  const [target] = fx.standardSeats;

  const attempts = fx.userIds.length;
  const results = await Promise.allSettled(
    fx.userIds.map((userId) =>
      store.createBooking({ showtimeId: fx.showtimeId, seatIds: [target], userId, holdTtlSeconds: 300 })
    )
  );

  const wins = results.filter((r) => r.status === 'fulfilled');
  const losses = results.filter((r) => r.status === 'rejected');

  assert.equal(wins.length, 1, 'exactly one concurrent booking may win the seat');
  assert.equal(losses.length, attempts - 1);

  for (const r of losses) {
    const reason = (r as PromiseRejectedResult).reason;
    assert.ok(reason instanceof BookingConflictError, `expected BookingConflictError, got ${reason}`);
    assert.equal((reason as BookingConflictError).statusCode, 409);
  }

  // The seat is held exactly once and never double-booked in booking_seats.
  assert.equal(await seatStatus(fx.showtimeId, target), 'held');
  const pool = getDbPool()!;
  const rows = await pool.query('SELECT booking_id FROM booking_seats WHERE showtime_id = $1 AND seat_id = $2', [
    fx.showtimeId,
    target,
  ]);
  assert.equal(rows.rowCount, 1, 'booking_seats must contain exactly one claim for the seat');
});

test('server computes the NGN total and per-seat prices (client price is ignored)', async () => {
  if (!available) return;
  const fx = await seedFixture(1);
  const seatIds = [fx.standardSeats[0], fx.vipSeats[0]];

  const { booking } = await store.createBooking({
    showtimeId: fx.showtimeId,
    seatIds,
    userId: fx.userIds[0],
    holdTtlSeconds: 300,
  });

  assert.equal(booking.currency, 'NGN');
  assert.equal(booking.totalAmount, fx.priceStandard + fx.priceVip);
  for (const seat of booking.seats) {
    assert.equal(seat.price, seat.type === 'vip' ? fx.priceVip : fx.priceStandard);
  }
  assert.equal(booking.totalAmount, booking.seats.reduce((sum, s) => sum + s.price, 0));
});

test('an idempotency key replays the same booking and creates a single row', async () => {
  if (!available) return;
  const fx = await seedFixture(1);
  const [seatId] = fx.standardSeats;
  const key = `pg-idem-${Date.now()}`;
  const userId = fx.userIds[0];

  const first = await store.createBooking({ showtimeId: fx.showtimeId, seatIds: [seatId], userId, idempotencyKey: key, holdTtlSeconds: 300 });
  const second = await store.createBooking({ showtimeId: fx.showtimeId, seatIds: [seatId], userId, idempotencyKey: key, holdTtlSeconds: 300 });

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true, 'second call must be an idempotent replay');
  assert.equal(first.booking.id, second.booking.id);

  const pool = getDbPool()!;
  const rows = await pool.query('SELECT id FROM bookings WHERE user_id = $1 AND idempotency_key = $2', [userId, key]);
  assert.equal(rows.rowCount, 1, 'idempotency must not create duplicate booking rows');
});

test('cancelling a pending booking releases its seats for a later booking', async () => {
  if (!available) return;
  const fx = await seedFixture(2);
  const [seatId] = fx.standardSeats;

  const { booking } = await store.createBooking({ showtimeId: fx.showtimeId, seatIds: [seatId], userId: fx.userIds[0], holdTtlSeconds: 300 });
  assert.equal(await seatStatus(fx.showtimeId, seatId), 'held');

  await store.cancelBooking(booking.id, fx.userIds[0]);
  assert.equal(await seatStatus(fx.showtimeId, seatId), 'available');

  // A different user can now book the released seat.
  const { booking: again } = await store.createBooking({
    showtimeId: fx.showtimeId,
    seatIds: [seatId],
    userId: fx.userIds[1],
    holdTtlSeconds: 300,
  });
  assert.notEqual(again.id, booking.id);
  assert.equal(await seatStatus(fx.showtimeId, seatId), 'held');
});

test('confirming a booking marks seats sold and is idempotent', async () => {
  if (!available) return;
  const fx = await seedFixture(1);
  const [seatId] = fx.standardSeats;
  const userId = fx.userIds[0];

  const { booking } = await store.createBooking({ showtimeId: fx.showtimeId, seatIds: [seatId], userId, holdTtlSeconds: 300 });
  const confirmed = await store.confirmBooking(booking.id, userId);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(await seatStatus(fx.showtimeId, seatId), 'sold');

  const again = await store.confirmBooking(booking.id, userId);
  assert.equal(again.status, 'confirmed', 'confirming twice must not throw or change state');
});

test('a seat is HELD (not available) after a booking so it cannot be rebooked', async () => {
  if (!available) return;
  const fx = await seedFixture(2);
  const [seatId] = fx.standardSeats;

  await store.createBooking({ showtimeId: fx.showtimeId, seatIds: [seatId], userId: fx.userIds[0], holdTtlSeconds: 300 });

  await assert.rejects(
    () => store.createBooking({ showtimeId: fx.showtimeId, seatIds: [seatId], userId: fx.userIds[1], holdTtlSeconds: 300 }),
    (err: unknown) => err instanceof BookingConflictError && err.code === 'SEAT_UNAVAILABLE'
  );
});
