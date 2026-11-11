import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { getDbPool } from '../db/pool';
import { withTransaction } from '../db/migrate';
import { releasePendingSeats, ReleasedHold } from '../db/bookingHolds';
import { resolveDataMode } from '../config/dataMode';
import { AppError } from '../middleware/errorHandler';
import { seatHolds } from '../redis/seatHolds';
import {
  GatewayError, getPaymentCurrency, initializePayment, isPaymentConfigured, isWebhookConfigured,
  providerId, verifyTransactionById, VerifiedTransaction,
} from './payment.service';

export const identifier = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const idempotencyKey = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
export const transactionIdentifier = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const id = providerId(value);
  if (id) return id;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid transaction ID' });
  return z.NEVER;
});

export function paymentPool(): Pool {
  const pool = resolveDataMode() === 'postgres' ? getDbPool() : null;
  if (!pool) throw new AppError(503, 'PAYMENTS_REQUIRE_POSTGRES', 'Payments require the persistent database.');
  return pool;
}

type BookingRow = {
  id: string; user_id: string; showtime_id: string; hold_token: string | null;
  status: string; expires_at: Date | null; total_amount_kobo: number; currency: string;
  payment_id: string | null;
};
type ShowtimeRow = { id: string; start_time: Date; cancelled_at: Date | null };
type PaymentRow = {
  id: string; booking_id: string; user_id: string | null; reference: string; provider: string;
  amount_kobo: number; currency: string; checkout_link: string | null; checkout_uncertain: boolean;
  transaction_id: string | null; status: string;
};

async function lockBooking(client: PoolClient, id: string) {
  // Same lock order as showtime cancellation and seat creation: showtime, booking, inventory.
  const { rows: [showtime] } = await client.query<ShowtimeRow>(
    `SELECT s.id, s.start_time, s.cancelled_at FROM showtimes s
      JOIN bookings b ON b.showtime_id = s.id WHERE b.id = $1 FOR SHARE OF s`, [id],
  );
  const { rows: [booking] } = await client.query<BookingRow>('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
  return { booking, showtime };
}

export async function createCheckout(bookingId: string, userId: string, key: string) {
  if (!isPaymentConfigured()) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Sandbox checkout is unavailable.');
  if (!isWebhookConfigured()) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Payment confirmation is unavailable.');
  const pool = paymentPool();
  const reserved = await withTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('checkout:' || $1 || ':' || $2, 0))", [userId, key]);
    const { booking, showtime } = await lockBooking(client, bookingId);
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    if (booking.user_id !== userId) throw new AppError(403, 'FORBIDDEN', 'This booking belongs to another account.');
    const { rows: [sameKey] } = await client.query<PaymentRow>(
      'SELECT * FROM payments WHERE user_id = $1 AND checkout_key = $2', [userId, key],
    );
    if (sameKey && sameKey.booking_id !== bookingId) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This checkout key belongs to a different booking.');
    }
    if (booking.status !== 'pending' || !booking.expires_at || booking.expires_at.getTime() <= Date.now()
        || showtime.cancelled_at || showtime.start_time.getTime() <= Date.now()) {
      throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'This reservation can no longer be paid.');
    }
    const { rows: [existing] } = await client.query<PaymentRow>(
      `SELECT * FROM payments WHERE booking_id = $1 AND
        (checkout_key IS NOT NULL OR status IN ('pending','successful'))
        ORDER BY (checkout_key IS NOT NULL) DESC, created_at DESC LIMIT 1`, [bookingId],
    );
    if (existing) return { payment: existing };
    if (booking.currency !== getPaymentCurrency() || booking.total_amount_kobo <= 0) {
      throw new AppError(409, 'INVALID_BOOKING_TOTAL', 'This booking is not eligible for sandbox checkout.');
    }
    const { rows: [user] } = await client.query<{ email: string; full_name: string }>(
      'SELECT email, full_name FROM users WHERE id = $1', [userId],
    );
    if (!user) throw new AppError(403, 'FORBIDDEN', 'Account not found.');
    const id = randomUUID();
    const { rows: [payment] } = await client.query<PaymentRow>(
      `INSERT INTO payments (id, booking_id, user_id, amount_kobo, currency, provider, reference, checkout_key)
        VALUES ($1,$2,$3,$4,$5,'flutterwave',$6,$7) RETURNING *`,
      [id, booking.id, userId, booking.total_amount_kobo, booking.currency, 'RP-PAY-' + id, key],
    );
    return { payment, user };
  });

  const { payment, user } = reserved;
  let link = payment.checkout_link;
  if (user) {
    try {
      link = await initializePayment({
        reference: payment.reference, amountKobo: payment.amount_kobo, currency: payment.currency,
        email: user.email, name: user.full_name,
      });
      await pool.query('UPDATE payments SET checkout_link = $2 WHERE id = $1', [payment.id, link]);
    } catch (error) {
      await pool.query('UPDATE payments SET checkout_uncertain = TRUE WHERE id = $1', [payment.id]);
      console.warn(JSON.stringify({ event: 'checkout_uncertain', paymentId: payment.id,
        code: error instanceof GatewayError ? error.code : 'CHECKOUT_PERSIST_FAILED' }));
      throw new AppError(502, 'CHECKOUT_UNCERTAIN', 'Checkout could not be opened. Check the booking status or cancel and reserve again.');
    }
  }
  if (!link && payment.checkout_uncertain) {
    throw new AppError(409, 'CHECKOUT_UNCERTAIN', 'Checkout could not be opened. Check the booking status or cancel and reserve again.');
  }
  return { link: link ?? undefined, reference: payment.reference, amountKobo: payment.amount_kobo,
    currency: payment.currency, paymentId: payment.id };
}

const webhookSchema = z.object({
  event: z.literal('charge.completed'),
  data: z.object({
    id: transactionIdentifier, tx_ref: identifier, status: z.enum(['successful', 'failed', 'cancelled']),
  }),
});

export async function acceptPaymentEvent(payload: unknown) {
  const { data } = webhookSchema.parse(payload);
  // Flutterwave v3 charge.completed has a transaction ID, not a distinct event ID.
  // Include the state so an earlier failed delivery cannot suppress a later success.
  const eventKey = createHash('sha256').update(JSON.stringify([data.id, data.tx_ref, data.status])).digest('hex');
  await paymentPool().query(
    `INSERT INTO payment_events (event_key, reference, transaction_id, reported_status)
      VALUES ($1,$2,$3,$4) ON CONFLICT (event_key) DO NOTHING`,
    [eventKey, data.tx_ref, data.id, data.status],
  );
  return eventKey;
}

export async function queueRefund(client: PoolClient, capture: {
  transactionId: string; amountKobo: number; currency: string; reason: string;
}) {
  const id = randomUUID();
  await client.query(
    `WITH inserted AS (
      INSERT INTO refunds (id, transaction_id, amount_kobo, currency, reason)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (transaction_id) DO NOTHING RETURNING *
    ) INSERT INTO refund_ledger (refund_id, status, amount_kobo, currency, detail_code)
      SELECT id, status, amount_kobo, currency, reason FROM inserted`,
    [id, capture.transactionId, capture.amountKobo, capture.currency, capture.reason],
  );
}

interface EventRow { event_key: string; reference: string; transaction_id: string; reported_status: string; attempts: number }
export function validateTransaction(verified: VerifiedTransaction, expected: {
  id: string; reference: string; amount: number; currency: string; status: string;
}) {
  if (verified.transactionId !== expected.id) return 'TRANSACTION_ID_MISMATCH';
  if (verified.reference !== expected.reference) return 'REFERENCE_MISMATCH';
  if (verified.currency !== expected.currency) return 'CURRENCY_MISMATCH';
  if (verified.amountKobo !== expected.amount) return 'AMOUNT_MISMATCH';
  if (verified.status !== expected.status) return 'PAYMENT_STATUS_MISMATCH';
  return null;
}

async function settleEvent(client: PoolClient, event: EventRow, verified: VerifiedTransaction):
  Promise<{ code: string; rejected?: boolean; release?: ReleasedHold }> {
  const reject = (code: string) => ({ code, rejected: true });
  const { rows: [attempt] } = await client.query<PaymentRow>(
    'SELECT * FROM payments WHERE reference = $1', [event.reference],
  );
  if (!attempt) return reject('UNKNOWN_REFERENCE');
  const { booking, showtime } = await lockBooking(client, attempt.booking_id);
  const { rows: [payment] } = await client.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [attempt.id]);
  if (!booking || !payment || payment.provider !== 'flutterwave' || payment.booking_id !== booking.id
      || booking.user_id !== payment.user_id) return reject('BOOKING_OWNER_MISMATCH');
  if (payment.amount_kobo !== booking.total_amount_kobo || payment.currency !== booking.currency) {
    return reject('BOOKING_TOTAL_MISMATCH');
  }
  const mismatch = validateTransaction(verified, {
    id: event.transaction_id, reference: payment.reference, amount: payment.amount_kobo,
    currency: payment.currency, status: event.reported_status,
  });
  if (mismatch) return reject(mismatch);

  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('flutterwave:' || $1, 0))", [event.transaction_id]);
  const { rows: [capture] } = await client.query<{ payment_id: string }>(
    'SELECT payment_id FROM payment_captures WHERE transaction_id = $1', [event.transaction_id],
  );
  const { rows: [legacy] } = await client.query<{ id: string }>(
    "SELECT id FROM payments WHERE transaction_id = $1 AND status = 'successful'", [event.transaction_id],
  );
  if ((capture && capture.payment_id !== payment.id) || (legacy && legacy.id !== payment.id)) {
    return reject('TRANSACTION_ALREADY_USED');
  }
  if (capture || (legacy && booking.status === 'confirmed')) {
    return { code: 'ALREADY_CAPTURED' };
  }

  if (event.reported_status !== 'successful') {
    if (payment.status === 'successful') return { code: 'ALREADY_SETTLED' };
    await client.query(
      'UPDATE payments SET status = $2, failure_reason = $3, verified_at = NOW() WHERE id = $1',
      [payment.id, event.reported_status, 'PROVIDER_' + event.reported_status.toUpperCase()],
    );
    const other = await client.query(
      "SELECT 1 FROM payments WHERE booking_id = $1 AND id <> $2 AND status IN ('pending','successful') LIMIT 1",
      [booking.id, payment.id],
    );
    if (booking.status !== 'pending' || other.rowCount) return { code: 'PAYMENT_FAILED' };
    const release = await releasePendingSeats(client, booking);
    await client.query("UPDATE bookings SET status = 'cancelled', payment_status = 'failed' WHERE id = $1", [booking.id]);
    return { code: 'PAYMENT_FAILED_HOLD_RELEASED', release };
  }

  const payable = booking.status === 'pending' && (payment.status !== 'successful' || Boolean(legacy)) && !showtime.cancelled_at
    && !!booking.expires_at && booking.expires_at.getTime() > Date.now() && showtime.start_time.getTime() > Date.now();
  const held = payable ? await client.query<{ valid: boolean }>(
    `SELECT (ss.status = 'HELD' AND ss.held_by_user_id = $2 AND
              ss.hold_expires_at > clock_timestamp()) AS valid
       FROM booking_seats bs JOIN showtime_seats ss USING (showtime_id, seat_id)
       WHERE bs.booking_id = $1 ORDER BY ss.seat_id FOR UPDATE OF ss`, [booking.id, booking.user_id],
  ) : null;
  // An expired/missing claim is never resurrected, even if payment succeeded.
  const canBook = Boolean(held?.rows.length && held.rows.every(row => row.valid)
    && booking.expires_at!.getTime() > Date.now() && showtime.start_time.getTime() > Date.now());
  await client.query(
    `INSERT INTO payment_captures (transaction_id, payment_id, booking_id, amount_kobo, currency, disposition)
      VALUES ($1,$2,$3,$4,$5,$6)`,
    [event.transaction_id, payment.id, booking.id, payment.amount_kobo, payment.currency, canBook ? 'booked' : 'refund_due'],
  );
  if (!canBook) {
    await queueRefund(client, { transactionId: event.transaction_id, amountKobo: payment.amount_kobo,
      currency: payment.currency, reason: showtime.cancelled_at ? 'SHOWTIME_CANCELLED'
        : booking.status === 'confirmed' || payment.status === 'successful' ? 'EXTRA_CAPTURE' : 'HOLD_UNAVAILABLE' });
    return { code: 'CAPTURE_REFUND_QUEUED' };
  }

  const sold = await client.query<{ seat_id: string }>(
    `UPDATE showtime_seats ss SET status = 'SOLD', held_by_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
       FROM booking_seats bs WHERE bs.booking_id = $1 AND ss.showtime_id = bs.showtime_id AND ss.seat_id = bs.seat_id
       RETURNING ss.seat_id`, [booking.id],
  );
  await client.query(
    `INSERT INTO tickets (id, booking_id, showtime_id, seat_id, price_kobo, qr_code_data)
     SELECT 'tkt-' || gen_random_uuid(), bs.booking_id, bs.showtime_id, bs.seat_id, bs.price_kobo,
       'REELPASS-TKT-' || bs.seat_label || '-' || b.booking_reference
     FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id WHERE bs.booking_id = $1
     ON CONFLICT (showtime_id, seat_id) DO NOTHING`, [booking.id],
  );
  await client.query(
    "UPDATE payments SET status = 'successful', transaction_id = $2, verified_at = NOW(), failure_reason = NULL WHERE id = $1",
    [payment.id, event.transaction_id],
  );
  await client.query(
    "UPDATE bookings SET status = 'confirmed', payment_status = 'successful', payment_id = $2 WHERE id = $1",
    [booking.id, payment.id],
  );
  return { code: 'BOOKING_CONFIRMED', release: {
    showtimeId: booking.showtime_id, token: booking.hold_token ?? booking.user_id,
    seatIds: sold.rows.map(row => row.seat_id),
  } };
}

export async function releaseRedisHold(release: ReleasedHold | undefined) {
  if (!release?.seatIds.length) return;
  // PostgreSQL is authoritative; if Redis is unavailable its keys still expire.
  void seatHolds.release(release.showtimeId, release.seatIds, release.token).catch(() => undefined);
}

export async function processNextPaymentEvent(pool: Pool) {
  const outcome = await withTransaction(pool, async client => {
    const { rows: [event] } = await client.query<EventRow>(
      `SELECT * FROM payment_events WHERE status = 'queued' AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at, received_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!event) return null;
    const attempts = event.attempts + 1;
    await client.query('SAVEPOINT event_processing');
    let status: string;
    let code: string;
    let release: ReleasedHold | undefined;
    try {
      const verified = await verifyTransactionById(event.transaction_id);
      if (verified.status === 'pending') throw new GatewayError('PROVIDER_PENDING');
      const result = await settleEvent(client, event, verified);
      status = result.rejected ? 'rejected' : 'processed';
      code = result.code;
      release = result.release;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT event_processing');
      status = attempts >= 5 ? 'failed' : 'queued';
      code = error instanceof GatewayError ? error.code : 'SETTLEMENT_ERROR';
    }
    await client.query(
      `UPDATE payment_events SET status = $2, attempts = $3, result_code = $4,
         next_attempt_at = NOW() + $5 * INTERVAL '1 second',
         finished_at = CASE WHEN $2 = 'queued' THEN NULL ELSE NOW() END WHERE event_key = $1`,
      [event.event_key, status, attempts, code, 2 ** attempts],
    );
    return { eventKey: event.event_key, status, attempts, code, release };
  });
  if (!outcome) return false;
  const { release, ...log } = outcome;
  console.log(JSON.stringify({ event: 'payment_event_attempt', ...log }));
  await releaseRedisHold(release);
  return true;
}
