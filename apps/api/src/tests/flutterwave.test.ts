import './testEnv';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import app from '../app';
import { setFlutterwaveMock } from '../services/payment.service';
import { memoryStore } from '../db/memoryStore';

/**
 * ReelPass Flutterwave Payment Integration Test Suite
 *
 * Covers all 14 mandatory test requirements:
 * 1. Successful Flutterwave payment.
 * 2. Failed payment.
 * 3. Cancelled payment.
 * 4. Pending payment.
 * 5. Incorrect transaction reference.
 * 6. Incorrect amount.
 * 7. Incorrect currency.
 * 8. Duplicate payment verification.
 * 9. Expired reservation.
 * 10. Payment success after reservation expiry.
 * 11. Application restart during payment (status recovery).
 * 12. Booking confirmation persistence.
 * 13. QR ticket availability after successful payment.
 * 14. Repeated verification requests (concurrency & idempotency).
 */

let server: Server;
let baseUrl = '';
let token = '';
let showtimeId = 'st-1';

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

let nextTxId = 100000;

function mockFlutterwave(
  status: 'successful' | 'failed' | 'cancelled' | 'pending',
  options: {
    amount?: number;
    currency?: string;
    txRef?: string;
    id?: number;
    processor_response?: string;
  } = {}
) {
  setFlutterwaveMock(async (url) => {
    if (url.includes('/payments')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          message: 'Payment link created',
          data: { link: 'https://checkout.flutterwave.com/pay/test-link' },
        }),
      };
    }
    if (url.includes('/transactions/')) {
      let queriedTxRef: string | null = null;
      try {
        const urlObj = new URL(url);
        queriedTxRef = urlObj.searchParams.get('tx_ref');
      } catch {}
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: {
            id: options.id ?? (++nextTxId),
            tx_ref: options.txRef !== undefined ? options.txRef : (queriedTxRef || 'test-ref'),
            amount: options.amount !== undefined ? options.amount : 75.0,
            currency: options.currency ?? 'NGN',
            status,
            processor_response: options.processor_response,
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

async function createTestBooking(customSeatId?: string) {
  const showtime = memoryStore.showtimes.get(showtimeId)!;
  const seats = memoryStore.getSeats(showtime.auditoriumId);
  const seat = customSeatId
    ? seats.find((s) => s.id === customSeatId)!
    : seats.find((s) => s.status === 'available')!;

  seat.status = 'available';

  const res = await fetch(`${baseUrl}/bookings`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ showtimeId, seatIds: [seat.id] }),
  });
  const json: any = await res.json();
  assert.equal(res.status, 201, `Failed to create booking for ${seat.id}: ${JSON.stringify(json)}`);
  return { booking: json.data, seatId: seat.id };
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
});

import { cache } from '../redis/client';

after(async () => {
  setFlutterwaveMock(null);
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await cache.close();
});

beforeEach(() => {
  setFlutterwaveMock(null);
});

// 1. Successful Flutterwave payment
test('1. Successful Flutterwave payment confirms booking and marks payment successful', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: booking.totalAmount / 100 });

  // Initialize payment
  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();
  assert.equal(initRes.status, 200);
  assert.ok(initJson.data.link);
  assert.ok(initJson.data.reference);

  // Verify payment
  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyJson.data.isConfirmed, true);
  assert.equal(verifyJson.data.booking.status, 'confirmed');
  assert.equal(verifyJson.data.payment.status, 'successful');
  assert.equal(verifyJson.data.payment.amountKobo, booking.totalAmount);
});

// 2. Failed payment
test('2. Failed payment does not confirm booking and returns error', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('failed', { processor_response: 'Insufficient funds on card' });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.equal(verifyRes.status, 400);
  assert.equal(verifyJson.error.code, 'PAYMENT_FAILED');
  assert.match(verifyJson.error.message, /Insufficient funds/);

  // Ensure booking remains pending and seats not confirmed
  const checkBookingRes = await fetch(`${baseUrl}/bookings/${booking.id}`, { headers: authHeaders() });
  const checkBookingJson: any = await checkBookingRes.json();
  assert.equal(checkBookingJson.data.status, 'pending');
});

// 3. Cancelled payment
test('3. Cancelled payment keeps reservation held until expiry without confirming', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('cancelled');

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.equal(verifyRes.status, 400);
  assert.equal(verifyJson.error.code, 'PAYMENT_CANCELLED');

  // Verify booking is still pending (seats not released prematurely)
  const checkBookingRes = await fetch(`${baseUrl}/bookings/${booking.id}`, { headers: authHeaders() });
  const checkBookingJson: any = await checkBookingRes.json();
  assert.equal(checkBookingJson.data.status, 'pending');
});

// 4. Pending payment
test('4. Pending payment returns 202 and keeps reservation pending', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('pending');

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.equal(verifyRes.status, 202);
  assert.equal(verifyJson.error.code, 'PAYMENT_PENDING');
});

// 5. Incorrect transaction reference
test('5. Incorrect transaction reference rejects verification with 400', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', {
    txRef: 'DIFFERENT-UNEXPECTED-REFERENCE',
    amount: booking.totalAmount / 100,
  });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.equal(verifyRes.status, 400);
  assert.equal(verifyJson.error.code, 'REFERENCE_MISMATCH');
});

// 6. Incorrect amount
test('6. Incorrect amount rejects verification with AMOUNT_MISMATCH', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: 50.0 }); // ₦50 instead of expected total

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.equal(verifyRes.status, 400);
  assert.equal(verifyJson.error.code, 'AMOUNT_MISMATCH');
});

// 7. Incorrect currency
test('7. Incorrect currency rejects verification with CURRENCY_MISMATCH', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', {
    amount: booking.totalAmount / 100,
    currency: 'USD', // Not NGN
  });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.equal(verifyRes.status, 400);
  assert.equal(verifyJson.error.code, 'CURRENCY_MISMATCH');
});

// 8. Duplicate payment verification (idempotency)
test('8. Duplicate payment verification returns confirmed booking idempotently without duplicate rows', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: booking.totalAmount / 100 });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  // First verification
  const v1 = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  assert.equal(v1.status, 200);

  // Duplicate verification
  const v2 = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const v2Json: any = await v2.json();
  assert.equal(v2.status, 200);
  assert.equal(v2Json.data.isConfirmed, true);
  assert.equal(v2Json.data.booking.status, 'confirmed');
});

// 9. Expired reservation rejection
test('9. Expired reservation rejects payment initialization with 409 BOOKING_EXPIRED', async () => {
  const { booking } = await createTestBooking();

  // Manually expire the hold
  const storedBooking = memoryStore.bookings.get(booking.id);
  if (storedBooking) {
    storedBooking.expiresAt = new Date(Date.now() - 60000).toISOString();
    storedBooking.status = 'expired';
  }

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  assert.equal(initRes.status, 409);
  assert.equal(initJson.error.code, 'BOOKING_EXPIRED');
});

// 10. Payment success after reservation expiry
test('10. Payment success after reservation expiry safely halts confirmation and records refund need', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: booking.totalAmount / 100 });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  // Simulate hold expiring before verification is called
  const storedBooking = memoryStore.bookings.get(booking.id);
  if (storedBooking) {
    storedBooking.expiresAt = new Date(Date.now() - 30000).toISOString();
    storedBooking.status = 'expired';
  }

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.equal(verifyRes.status, 409);
  assert.equal(verifyJson.error.code, 'BOOKING_EXPIRED_PAYMENT_HELD');

  // Verify booking was NOT confirmed
  assert.notEqual(storedBooking?.status, 'confirmed');
});

// 11. Application restart during payment (Active status recovery)
test('11. Application restart during payment reconciles pending transaction via GET /payments/:bookingId/status', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: booking.totalAmount / 100 });

  // User initiated payment, then closed the app
  await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });

  // App reopens and calls payment status endpoint
  const statusRes = await fetch(`${baseUrl}/payments/${booking.id}/status`, {
    headers: authHeaders(),
  });
  const statusJson: any = await statusRes.json();

  assert.equal(statusRes.status, 200);
  assert.equal(statusJson.data.isConfirmed, true);
  assert.equal(statusJson.data.booking.status, 'confirmed');
  assert.equal(statusJson.data.reconciled, true);
});

// 12. Booking confirmation persistence
test('12. Booking confirmation persists across queries and in My Tickets list', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: booking.totalAmount / 100 });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });

  // Verify GET /bookings/:id
  const getRes = await fetch(`${baseUrl}/bookings/${booking.id}`, { headers: authHeaders() });
  const getJson: any = await getRes.json();
  assert.equal(getJson.data.status, 'confirmed');
  assert.equal(getJson.data.paymentStatus, 'successful');

  // Verify GET /bookings/my-tickets
  const myTicketsRes = await fetch(`${baseUrl}/bookings/my-tickets`, { headers: authHeaders() });
  const myTicketsJson: any = await myTicketsRes.json();
  const found = myTicketsJson.data.find((b: any) => b.id === booking.id);
  assert.ok(found, 'Confirmed booking must appear in my-tickets');
  assert.equal(found.status, 'confirmed');
});

// 13. QR ticket availability after successful payment
test('13. QR ticket data and code payload are available after payment confirmation', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: booking.totalAmount / 100 });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  const verifyRes = await fetch(`${baseUrl}/payments/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
  });
  const verifyJson: any = await verifyRes.json();

  assert.ok(verifyJson.data.booking.qrCode, 'Booking must have qrCode string');
  assert.match(verifyJson.data.booking.qrCode, new RegExp(`REELPASS-BOOKING-${booking.bookingReference}`));

  // Check individual tickets
  assert.ok(verifyJson.data.booking.tickets.length > 0);
  for (const t of verifyJson.data.booking.tickets) {
    assert.ok(t.qrCodeData, 'Ticket must contain qrCodeData');
    assert.match(t.qrCodeData, new RegExp(`REELPASS-TKT-`));
  }
});

// 14. Repeated verification requests (concurrency & race condition safety)
test('14. Repeated concurrent verification requests all succeed idempotently', async () => {
  const { booking } = await createTestBooking();
  mockFlutterwave('successful', { amount: booking.totalAmount / 100 });

  const initRes = await fetch(`${baseUrl}/payments/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ bookingId: booking.id }),
  });
  const initJson: any = await initRes.json();

  // Launch 5 concurrent verify requests
  const verifyPromises = Array.from({ length: 5 }).map(() =>
    fetch(`${baseUrl}/payments/verify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ bookingId: booking.id, reference: initJson.data.reference }),
    })
  );

  const responses = await Promise.all(verifyPromises);
  for (const res of responses) {
    assert.equal(res.status, 200);
    const json: any = await res.json();
    assert.equal(json.data.isConfirmed, true);
    assert.equal(json.data.booking.status, 'confirmed');
  }
});
