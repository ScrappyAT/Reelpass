import './testEnv';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import net from 'node:net';
import { formatNaira, koboToNaira } from '@matinee/shared';
import app from '../app';
import { cache } from '../redis/client';
import { memoryStore, SUPPORTED_CITIES } from '../db/memoryStore';

// End-to-end booking regression tests.
//
// The primary regression covered here is the original production bug:
// `createBookingSchema` used to require `showtimeId` to be a UUID, but the API
// uses internal ids such as "st-1". Every booking therefore failed with
//   400 VALIDATION_ERROR "Request input validation failed".
//
// These tests boot the real Express app against the in-memory demo store (no
// PostgreSQL/Redis needed) and exercise it over HTTP with the built-in fetch.

let server: Server;
let baseUrl = '';
let token = '';
let showtimeId = '';
let standardSeatId = '';
let vipSeatId = '';
let createdBookingId = '';

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function postBooking(body: unknown, opts: { auth?: boolean } = {}) {
  const auth = opts.auth ?? true;
  const res = await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: auth ? authHeaders() : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  return { res, json };
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}/api/v1`;
      resolve();
    });
  });

  const loginRes = await fetch(`${baseUrl}/auth/demo-login`, { method: 'POST' });
  assert.equal(loginRes.status, 200, 'demo-login should succeed');
  const loginJson: any = await loginRes.json();
  token = loginJson.data.token;
  assert.ok(token, 'expected a demo JWT token');

  // Find a showtime that has both an available standard and an available VIP seat.
  for (const showtime of memoryStore.showtimes.values()) {
    const seats = memoryStore.getSeats(showtime.auditoriumId);
    const standard = seats.find((s) => s.status === 'available' && s.type === 'standard');
    const vip = seats.find((s) => s.status === 'available' && s.type === 'vip');
    if (standard && vip) {
      showtimeId = showtime.id;
      standardSeatId = standard.id;
      vipSeatId = vip.id;
      break;
    }
  }
  assert.ok(showtimeId, 'expected a showtime with available standard and VIP seats');
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Release the Redis connection opened by the app's cache client so the test
  // process can exit cleanly.
  await cache.close();
});

test('money helpers format NGN naira and convert integer kobo', () => {
  assert.equal(koboToNaira(450_000), 4500);
  const formatted = formatNaira(450_000);
  assert.match(formatted, /4,500/);
  assert.ok(!formatted.includes('$'), 'NGN output must not contain a dollar sign');
});

test('creates a booking for an internal showtime id (regression: no UUID requirement)', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;

  const { res, json } = await postBooking({ showtimeId, seatIds: [standardSeatId] });

  assert.equal(res.status, 201, `unexpected status: ${JSON.stringify(json)}`);
  assert.equal(json.success, true);
  createdBookingId = json.data.id;

  assert.equal(json.data.currency, 'NGN');
  assert.equal(json.data.status, 'pending');
  assert.match(json.data.bookingReference, /^RP-/);
  assert.equal(json.data.seats.length, 1);

  // Total is computed server-side from the showtime record (integer kobo NGN).
  assert.equal(json.data.totalAmount, showtime.priceStandard);

  // The reserved seat is now marked sold in the live seat map.
  const seat = memoryStore.getSeats(showtime.auditoriumId).find((s) => s.id === standardSeatId)!;
  assert.equal(seat.status, 'sold');
});

test('rejects re-booking an already reserved seat with 409 SEAT_UNAVAILABLE', async () => {
  const { res, json } = await postBooking({ showtimeId, seatIds: [standardSeatId] });
  assert.equal(res.status, 409);
  assert.equal(json.error.code, 'SEAT_UNAVAILABLE');
});

test('rejects a seat id that does not exist in the auditorium', async () => {
  const { res, json } = await postBooking({ showtimeId, seatIds: ['aud-000-Z99'] });
  assert.equal(res.status, 400);
  assert.equal(json.error.code, 'INVALID_SEATS');
});

test('returns 404 for a well-formed but unknown showtime id', async () => {
  const { res, json } = await postBooking({ showtimeId: 'st-999999', seatIds: [vipSeatId] });
  assert.equal(res.status, 404);
  assert.equal(json.error.code, 'SHOWTIME_NOT_FOUND');
});

test('returns 400 VALIDATION_ERROR with field details for missing required fields', async () => {
  const { res, json } = await postBooking({});
  assert.equal(res.status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
  assert.equal(json.error.message, 'Request input validation failed');
  const fields = (json.error.details ?? []).map((d: any) => d.field);
  assert.ok(fields.includes('showtimeId'), 'details should flag showtimeId');
  assert.ok(fields.includes('seatIds'), 'details should flag seatIds');
});

test('returns 400 VALIDATION_ERROR for malformed ids with whitespace/symbols', async () => {
  const { res, json } = await postBooking({ showtimeId: 'not a valid id!', seatIds: ['x y'] });
  assert.equal(res.status, 400);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
});

test('requires authentication to create a booking', async () => {
  const { res, json } = await postBooking({ showtimeId, seatIds: [vipSeatId] }, { auth: false });
  assert.equal(res.status, 401);
  assert.equal(json.error.code, 'UNAUTHORIZED');
});

test('retrieves the created booking via GET /bookings/my-tickets', async () => {
  const res = await fetch(`${baseUrl}/bookings/my-tickets`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  const ids = json.data.map((b: any) => b.id);
  assert.ok(ids.includes(createdBookingId), 'my-tickets should include the created booking');

  const mine = json.data.find((b: any) => b.id === createdBookingId);
  assert.equal(mine.currency, 'NGN');
  assert.equal(mine.totalAmount, mine.tickets.reduce((sum: number, t: any) => sum + t.price, 0));
});

test('every showtime maps to its own cinema in a supported Nigerian city', () => {
  for (const showtime of memoryStore.showtimes.values()) {
    const auditorium = memoryStore.auditoriums.get(showtime.auditoriumId);
    assert.ok(auditorium, `auditorium missing for showtime ${showtime.id}`);
    assert.equal(auditorium!.cinemaId, showtime.cinemaId, 'showtime cinema must own its auditorium');

    const cinema = memoryStore.cinemas.get(showtime.cinemaId);
    assert.ok(cinema, `cinema missing for showtime ${showtime.id}`);
    assert.equal(cinema!.city, showtime.cinemaCity, 'showtime city must match its cinema');
    assert.ok(
      (SUPPORTED_CITIES as readonly string[]).includes(showtime.cinemaCity),
      `unexpected city ${showtime.cinemaCity}`
    );
  }
});

test('books a mixed standard + VIP selection with server-computed NGN prices', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seats = memoryStore.getSeats(showtime.auditoriumId);
  const standard = seats.find((s) => s.status === 'available' && s.type === 'standard')!;
  const vip = seats.find((s) => s.status === 'available' && s.type === 'vip')!;

  // Client-supplied prices are stripped by the schema and never trusted.
  const { res, json } = await postBooking({
    showtimeId,
    seatIds: [standard.id, vip.id],
    totalAmount: 1,
    price: 1,
    currency: 'USD',
  });

  assert.equal(res.status, 201, `unexpected status: ${JSON.stringify(json)}`);
  assert.equal(json.data.totalAmount, showtime.priceStandard + showtime.priceVip);
  assert.equal(json.data.currency, 'NGN');

  const standardSeat = json.data.seats.find((s: any) => s.id === standard.id);
  const vipSeat = json.data.seats.find((s: any) => s.id === vip.id);
  assert.equal(standardSeat.price, showtime.priceStandard, 'standard seat must use the showtime price');
  assert.equal(vipSeat.price, showtime.priceVip, 'VIP seat must use the showtime price');
  assert.equal(
    json.data.totalAmount,
    json.data.seats.reduce((sum: number, s: any) => sum + s.price, 0)
  );
});

test('an idempotency key replays the original booking instead of double-charging', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seat = memoryStore.getSeats(showtime.auditoriumId).find((s) => s.status === 'available')!;
  const key = `idem-${Date.now()}`;

  const first = await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': key },
    body: JSON.stringify({ showtimeId, seatIds: [seat.id] }),
  });
  const second = await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': key },
    body: JSON.stringify({ showtimeId, seatIds: [seat.id] }),
  });

  const firstJson: any = await first.json();
  const secondJson: any = await second.json();

  assert.equal(first.status, 201);
  assert.equal(second.status, 201, 'a replayed request must still succeed');
  assert.equal(firstJson.data.id, secondJson.data.id, 'same booking returned for the same idempotency key');
  assert.equal(firstJson.data.bookingReference, secondJson.data.bookingReference);
});

test('cancelling a pending booking releases its seat for rebooking', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seat = memoryStore.getSeats(showtime.auditoriumId).find((s) => s.status === 'available')!;

  const createRes = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(createRes.res.status, 201);
  const bookingId = createRes.json.data.id;
  assert.equal(memoryStore.getSeats(showtime.auditoriumId).find((s) => s.id === seat.id)!.status, 'sold');

  const cancelRes = await fetch(`${baseUrl}/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  });
  assert.equal(cancelRes.status, 200);
  const cancelJson: any = await cancelRes.json();
  assert.equal(cancelJson.data.status, 'cancelled');
  assert.equal(
    memoryStore.getSeats(showtime.auditoriumId).find((s) => s.id === seat.id)!.status,
    'available',
    'cancelled seat must return to available'
  );

  const rebook = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(rebook.res.status, 201, 'released seat can be booked again');
});

test('confirming without a configured payment provider fails with 503 (no fake success)', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seat = memoryStore.getSeats(showtime.auditoriumId).find((s) => s.status === 'available')!;

  const createRes = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(createRes.res.status, 201);

  const confirmRes = await fetch(`${baseUrl}/bookings/${createRes.json.data.id}/confirm`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  const confirmJson: any = await confirmRes.json();

  assert.equal(confirmRes.status, 503);
  assert.equal(confirmJson.error.code, 'PAYMENT_NOT_CONFIGURED');
  assert.equal(
    memoryStore.getSeats(showtime.auditoriumId).find((s) => s.id === seat.id)!.status,
    'sold',
    'the hold is still active until payment is verified'
  );
});

test('backend-unreachable booking fails loudly instead of faking success', async () => {
  const port = await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const assigned = typeof addr === 'object' && addr ? addr.port : 0;
      probe.close(() => resolve(assigned));
    });
  });

  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/api/v1/bookings`, { method: 'POST' }),
    'a booking POST with no backend must reject'
  );
});

test('concurrent or duplicate seat booking attempt returns 409 SEAT_UNAVAILABLE with conflict details', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seat = memoryStore.getSeats(showtime.auditoriumId).find((s) => s.status === 'available')!;

  // First user claims the seat
  const first = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(first.res.status, 201, 'initial reservation should succeed');

  // Second user attempts to claim the exact same seat for the same showtime
  const second = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(second.res.status, 409, 'competing reservation must be rejected with 409');
  assert.equal(second.json.error.code, 'SEAT_UNAVAILABLE');
  assert.ok(second.json.error.details?.conflicts?.length > 0, 'must report conflicting seat');
  assert.equal(second.json.error.details.conflicts[0].seatId, seat.id);
});

test('persisted reservations maintain accurate pending status and never mark unpaid bookings as confirmed', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seat = memoryStore.getSeats(showtime.auditoriumId).find((s) => s.status === 'available')!;

  const created = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(created.res.status, 201);
  const bookingId = created.json.data.id;

  // Retrieve booking via single GET
  const getRes = await fetch(`${baseUrl}/bookings/${bookingId}`, { headers: authHeaders() });
  assert.equal(getRes.status, 200);
  const getJson: any = await getRes.json();
  assert.equal(getJson.data.status, 'pending', 'unpaid booking must have pending status');
  assert.equal(getJson.data.paymentStatus, 'pending', 'payment status must be pending');

  // Retrieve via my-tickets list
  const listRes = await fetch(`${baseUrl}/bookings/my-tickets`, { headers: authHeaders() });
  assert.equal(listRes.status, 200);
  const listJson: any = await listRes.json();
  const found = listJson.data.find((b: any) => b.id === bookingId);
  assert.ok(found, 'booking must persist and appear in my-tickets');
  assert.equal(found.status, 'pending');
});

test('expired reservations are automatically marked expired and release their seats', async () => {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seat = memoryStore.getSeats(showtime.auditoriumId).find((s) => s.status === 'available')!;

  const created = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(created.res.status, 201);
  const bookingId = created.json.data.id;

  // Simulate hold expiration by setting expiresAt to the past in memoryStore
  const booking = memoryStore.bookings.get(bookingId)!;
  booking.expiresAt = new Date(Date.now() - 60000).toISOString();

  // Fetching the booking should report expired status
  const getRes = await fetch(`${baseUrl}/bookings/${bookingId}`, { headers: authHeaders() });
  assert.equal(getRes.status, 200);
  const getJson: any = await getRes.json();
  assert.equal(getJson.data.status, 'expired', 'expired hold must have status expired');

  // Creating a new booking for the same seat should now succeed because the expired hold is cleared
  const rebook = await postBooking({ showtimeId, seatIds: [seat.id] });
  assert.equal(rebook.res.status, 201, 'expired seat must be re-bookable');
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await cache.close();
});
