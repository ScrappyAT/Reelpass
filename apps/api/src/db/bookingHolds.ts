import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';

export function bookingFingerprint(showtimeId: string, seatIds: string[]) {
  return createHash('sha256').update(JSON.stringify([showtimeId, [...new Set(seatIds)].sort()])).digest('hex');
}

export interface ReleasedHold {
  showtimeId: string;
  token: string;
  seatIds: string[];
}

/** Call while holding the booking row lock. Confirmed ticket and payment history stays intact. */
export async function releasePendingSeats(client: PoolClient, booking: {
  id: string; showtime_id: string; user_id: string; hold_token: string | null;
}): Promise<ReleasedHold> {
  const released = await client.query<{ seat_id: string }>(
    'DELETE FROM booking_seats WHERE booking_id = $1 RETURNING seat_id', [booking.id],
  );
  // Old versions pre-created tickets for unpaid bookings. Only remove those placeholders.
  await client.query('DELETE FROM tickets WHERE booking_id = $1', [booking.id]);
  const seatIds = released.rows.map(row => row.seat_id);
  if (seatIds.length) {
    await client.query(
      `UPDATE showtime_seats SET status = 'AVAILABLE', held_by_user_id = NULL,
         hold_expires_at = NULL, updated_at = NOW()
       WHERE showtime_id = $1 AND seat_id = ANY($2::text[])
         AND status = 'HELD' AND held_by_user_id = $3`,
      [booking.showtime_id, seatIds, booking.user_id],
    );
  }
  return { showtimeId: booking.showtime_id, token: booking.hold_token ?? booking.user_id, seatIds };
}
