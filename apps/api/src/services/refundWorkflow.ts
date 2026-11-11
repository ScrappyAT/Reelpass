import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/migrate';
import { releasePendingSeats, ReleasedHold } from '../db/bookingHolds';
import { AppError } from '../middleware/errorHandler';
import { queueRefund, releaseRedisHold, validateTransaction } from './paymentWorkflow';
import { GatewayError, fetchRefund, listRefunds, requestRefund, verifyTransactionById } from './payment.service';

type RefundRow = {
  id: string; transaction_id: string; amount_kobo: number; currency: string; reference: string;
  status: 'queued' | 'submitting' | 'pending'; provider_refund_id: string | null; check_attempts: number;
};
type RefundStatus = RefundRow['status'] | 'failed' | 'needs_review' | 'succeeded';

async function recordRefundState(client: PoolClient, id: string, status: RefundStatus, code: string,
  delay = 0, providerId?: string, onlyIf?: RefundRow['status']) {
  await client.query(
    `WITH changed AS (
      UPDATE refunds SET status = $2, provider_refund_id = COALESCE($5, provider_refund_id),
        next_attempt_at = NOW() + $4 * INTERVAL '1 second', updated_at = NOW()
      WHERE id = $1 AND ($6::text IS NULL OR status = $6) RETURNING *
    ) INSERT INTO refund_ledger (refund_id, status, amount_kobo, currency, detail_code)
      SELECT id, status, amount_kobo, currency, $3 FROM changed`,
    [id, status, code, delay, providerId ?? null, onlyIf ?? null],
  );
}

export async function cancelShowtime(pool: Pool, showtimeId: string) {
  const result = await withTransaction(pool, async client => {
    const { rows: [showtime] } = await client.query<{ start_time: Date; cancelled_at: Date | null }>(
      'SELECT start_time, cancelled_at FROM showtimes WHERE id = $1 FOR UPDATE', [showtimeId],
    );
    if (!showtime) throw new AppError(404, 'SHOWTIME_NOT_FOUND', 'Showtime not found.');
    if (showtime.cancelled_at) return { alreadyCancelled: true, refunds: 0, review: 0, releases: [] as ReleasedHold[] };
    if (showtime.start_time.getTime() <= Date.now()) {
      throw new AppError(409, 'SHOWTIME_STARTED', 'Only upcoming showtimes can be cancelled.');
    }
    await client.query('UPDATE showtimes SET cancelled_at = NOW() WHERE id = $1', [showtimeId]);
    const { rows } = await client.query<{
      id: string; user_id: string; showtime_id: string; hold_token: string | null; status: string;
      payment_id: string | null; total_amount_kobo: number; currency: string;
    }>(
      `SELECT * FROM bookings WHERE showtime_id = $1 AND status IN ('pending','confirmed')
         ORDER BY id FOR UPDATE`, [showtimeId],
    );
    let refunds = 0;
    let review = 0;
    const releases: ReleasedHold[] = [];
    for (const booking of rows) {
      if (booking.status === 'pending') {
        releases.push(await releasePendingSeats(client, booking));
      } else {
        // Import only a linked, consistent historical charge. Never invent a transaction for demo tickets.
        await client.query(
          `INSERT INTO payment_captures (transaction_id, payment_id, booking_id, amount_kobo, currency, disposition)
           SELECT p.transaction_id, p.id, p.booking_id, p.amount_kobo, p.currency, 'booked'
             FROM payments p WHERE p.booking_id = $1 AND p.user_id = $2 AND p.status = 'successful'
              AND p.provider = 'flutterwave' AND p.amount_kobo = $3 AND p.currency = $4
              AND p.transaction_id ~ '^[1-9][0-9]{0,19}$' AND ($5 = p.id OR $5 = p.transaction_id)
              AND NOT EXISTS (SELECT 1 FROM payment_captures c WHERE c.booking_id = $1 AND c.disposition = 'booked')
           ON CONFLICT DO NOTHING`,
          [booking.id, booking.user_id, booking.total_amount_kobo, booking.currency, booking.payment_id],
        );
        const { rows: [capture] } = await client.query<{ transaction_id: string; amount_kobo: number; currency: string }>(
          "SELECT transaction_id, amount_kobo, currency FROM payment_captures WHERE booking_id = $1 AND disposition = 'booked'",
          [booking.id],
        );
        if (capture) {
          await queueRefund(client, { transactionId: capture.transaction_id, amountKobo: capture.amount_kobo,
            currency: capture.currency, reason: 'SHOWTIME_CANCELLED' });
          refunds++;
        } else {
          await client.query(
            `INSERT INTO refund_reconciliation (booking_id, reason) VALUES ($1, 'NO_LINKED_CAPTURE')
             ON CONFLICT (booking_id) DO NOTHING`, [booking.id],
          );
          review++;
        }
      }
      // Keep sold seats, ticket rows and financial history; status invalidates admission.
      await client.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [booking.id]);
    }
    return { alreadyCancelled: false, refunds, review, releases };
  });
  await Promise.all(result.releases.map(releaseRedisHold));
  const { releases: _, ...summary } = result;
  return summary;
}

const succeeded = new Set(['completed-bank-transfer', 'completed-momo', 'completed-mpgs', 'completed-offline', 'completed-preauth']);
const failed = new Set(['failed', 'cancelled']);
const pending = new Set(['completed', 'pending', 'processing', 'pending-momo', 'pending-bank-transfer', 'pending-mpgs']);

export async function processNextRefund(pool: Pool) {
  const row = await withTransaction(pool, async client => {
    const { rows: [refund] } = await client.query<RefundRow>(
      `SELECT r.*, p.reference FROM refunds r JOIN payment_captures c USING (transaction_id)
          JOIN payments p ON p.id = c.payment_id
        WHERE r.status IN ('queued','submitting','pending') AND r.next_attempt_at <= NOW()
        ORDER BY r.next_attempt_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
    );
    if (!refund) return null;
    // Persist a send fence before the network call. A crash after this point can
    // trigger lookup/reconciliation, never another POST.
    if (refund.status === 'queued') await recordRefundState(client, refund.id, 'submitting', 'SEND_FENCE', 90);
    else await client.query("UPDATE refunds SET next_attempt_at = NOW() + INTERVAL '90 seconds' WHERE id = $1", [refund.id]);
    await client.query('UPDATE refunds SET check_attempts = check_attempts + 1 WHERE id = $1', [refund.id]);
    return { ...refund, check_attempts: refund.check_attempts + 1 };
  });
  if (!row) return false;

  let attemptedPost = false;
  let state: RefundStatus = 'needs_review';
  let code = 'REFUND_UNRECOGNIZED';
  let providerRefundId: string | undefined;
  let delay = 0;
  try {
    if (row.status === 'queued') {
      const original = await verifyTransactionById(row.transaction_id);
      const mismatch = validateTransaction(original, { id: row.transaction_id, reference: row.reference,
        amount: row.amount_kobo, currency: row.currency, status: 'successful' });
      if (mismatch) throw new GatewayError('REFUND_SOURCE_' + mismatch);
    }
    const known = row.provider_refund_id
      ? [await fetchRefund(row.provider_refund_id)] : await listRefunds(row.transaction_id);
    let refund = known[0];
    if (known.length > 1) throw new GatewayError('REFUND_MULTIPLE_PROVIDER_RECORDS');
    if (!refund && row.status === 'queued' && !known.length) {
      attemptedPost = true;
      refund = await requestRefund(row.transaction_id, row.amount_kobo, row.id);
    }
    if (!refund) throw new GatewayError('REFUND_NOT_YET_VISIBLE');
    if (refund.amountKobo !== row.amount_kobo || refund.transactionId !== row.transaction_id) {
      throw new GatewayError('REFUND_PROVIDER_MISMATCH');
    }
    providerRefundId = refund.id;
    if (succeeded.has(refund.status)) { state = 'succeeded'; code = 'PROVIDER_REFUNDED'; }
    else if (failed.has(refund.status)) { state = 'failed'; code = 'PROVIDER_REFUND_FAILED'; }
    else if (pending.has(refund.status) && row.check_attempts < 24) {
      state = 'pending'; code = 'PROVIDER_REFUND_PENDING';
      delay = Math.min(86_400, 300 * 2 ** (row.check_attempts - 1));
    } else {
      code = 'REFUND_STATUS_REQUIRES_REVIEW';
    }
  } catch (error) {
    code = error instanceof GatewayError ? error.code : 'REFUND_PROCESSING_ERROR';
    if (attemptedPost) {
      // A timeout can mean the gateway accepted the refund. Only recheck it.
      state = 'submitting'; delay = 30;
    } else if (/^REFUND_(SOURCE|PROVIDER|MULTIPLE)/.test(code)) {
      state = 'needs_review';
    } else if (row.check_attempts < 5) {
      state = row.status;
      delay = 5 * 2 ** row.check_attempts;
    }
  }
  await withTransaction(pool, client => recordRefundState(client, row.id, state, code, delay, providerRefundId,
    row.status === 'queued' ? 'submitting' : row.status));
  console.log(JSON.stringify({ event: 'refund_attempt', refundId: row.id, status: state, code, attempt: row.check_attempts }));
  return true;
}

export async function expirePendingBookings(pool: Pool) {
  const releases = await withTransaction(pool, async client => {
    const { rows } = await client.query<{
      id: string; showtime_id: string; user_id: string; hold_token: string | null;
    }>(
      `SELECT id, showtime_id, user_id, hold_token FROM bookings
        WHERE status = 'pending' AND expires_at <= NOW()
        ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
    );
    const released: ReleasedHold[] = [];
    for (const booking of rows) {
      released.push(await releasePendingSeats(client, booking));
      await client.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [booking.id]);
      await client.query("UPDATE payments SET status = 'cancelled', failure_reason = 'HOLD_EXPIRED' WHERE booking_id = $1 AND status = 'pending'", [booking.id]);
    }
    return released;
  });
  await Promise.all(releases.map(releaseRedisHold));
  return releases.length;
}
