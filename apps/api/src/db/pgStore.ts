import { Pool, PoolClient } from 'pg';
import {
  Booking,
  BookingStatus,
  Cinema,
  CinemaAmenity,
  ScreenType,
  Seat,
  SeatMapLayout,
  SeatType,
  Showtime,
  ShowtimeFormat,
  Ticket,
  User,
  UserRole,
} from '@matinee/shared';
import { getDbPool } from './pool';
import { withTransaction } from './migrate';

export interface UserRecord extends User {
  passwordHash: string;
}

export interface CreateBookingResult {
  booking: Booking;
  /** True when returned via idempotency replay rather than a fresh insert. */
  replayed: boolean;
}

export interface PaymentRecord {
  id: string;
  bookingId: string;
  amountKobo: number;
  currency: string;
  provider: string;
  reference: string;
  transactionId?: string;
  status: 'pending' | 'successful' | 'failed';
  rawResponse?: unknown;
  createdAt: string;
}

export class BookingConflictError extends Error {
  code: string;
  conflicts: { seatId: string; label?: string; reason: string }[];
  statusCode = 409;
  constructor(code: string, message: string, conflicts: { seatId: string; label?: string; reason: string }[] = []) {
    super(message);
    this.code = code;
    this.conflicts = conflicts;
    Object.setPrototypeOf(this, BookingConflictError.prototype);
  }
}

export interface UserDbRow {
  id: string;
  email: string;
  full_name: string;
  phone_number: string | null;
  role: string;
  password_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CinemaDbRow {
  id: string;
  name: string;
  city: string;
  neighborhood: string | null;
  address: string;
  postal_code: string | null;
  phone: string | null;
  latitude: number | string;
  longitude: number | string;
  amenities: string[];
  image_url: string;
  is_demo: boolean;
}

export interface ShowtimeDbRow {
  id: string;
  movie_id: string;
  cinema_id: string;
  auditorium_id: string;
  movie_title?: string | null;
  movie_title_cached?: string | null;
  movie_poster_url?: string | null;
  cinema_name?: string | null;
  cinema_city?: string | null;
  cinema_neighborhood?: string | null;
  auditorium_name?: string | null;
  auditorium_screen_type?: string | null;
  start_time: Date | string;
  end_time: Date | string;
  format: string;
  price_standard_kobo: number | string;
  price_vip_kobo: number | string;
  available_count?: number | string;
  total_seats?: number | string;
  rows_count?: number | string;
  columns_count?: number | string;
}

export interface SeatRow {
  seat_id: string;
  row_label: string;
  seat_number: number;
  seat_type: string;
  status: string;
  hold_expires_at: Date | string | null;
  price_standard_kobo: number | string;
  price_vip_kobo: number | string;
}

export interface LockedSeatRow {
  id: string;
  row_label: string;
  seat_number: number;
  seat_type: string;
  status: string;
  held_by_user_id: string | null;
  hold_expires_at: Date | string | null;
}

export interface BookingDbRow {
  id: string;
  booking_reference: string;
  user_id: string;
  showtime_id: string;
  total_amount_kobo: number | string;
  currency: string;
  status: string;
  payment_status: string;
  payment_id: string | null;
  idempotency_key: string | null;
  qr_code: string;
  created_at: Date | string;
  expires_at: Date | string | null;
}

export interface BookingSeatDbRow {
  seat_id: string;
  seat_label: string;
  seat_type: string;
  price_kobo: number | string;
  row_label: string;
  seat_number: number;
}

export interface TicketDbRow {
  id: string;
  booking_id: string;
  showtime_id: string;
  seat_id: string;
  price_kobo: number | string;
  qr_code_data: string;
}

export interface PaymentDbRow {
  id: string;
  booking_id: string;
  amount_kobo: number | string;
  currency: string;
  provider: string;
  reference: string;
  transaction_id: string | null;
  status: 'pending' | 'successful' | 'failed';
  raw_response: unknown;
  created_at: Date | string;
}

function mapSeatType(t: string): SeatType {
  return t === 'vip' ? 'vip' : t === 'wheelchair' ? 'wheelchair' : 'standard';
}

function mapScreenType(t?: string | null): ScreenType {
  return t === 'imax' ? 'imax' : t === 'dolby' ? 'dolby' : t === 'vip' ? 'vip' : 'standard';
}

function mapShowtime(row: ShowtimeDbRow): Showtime {
  return {
    id: row.id,
    movieId: row.movie_id,
    cinemaId: row.cinema_id,
    auditoriumId: row.auditorium_id,
    movieTitle: row.movie_title ?? row.movie_title_cached ?? '',
    moviePosterUrl: row.movie_poster_url ?? undefined,
    cinemaName: row.cinema_name ?? '',
    cinemaCity: row.cinema_city ?? '',
    cinemaNeighborhood: row.cinema_neighborhood ?? undefined,
    auditoriumName: row.auditorium_name ?? '',
    startTime: new Date(row.start_time).toISOString(),
    endTime: new Date(row.end_time).toISOString(),
    format: row.format as ShowtimeFormat,
    priceStandard: Number(row.price_standard_kobo),
    priceVip: Number(row.price_vip_kobo),
    availableSeatsCount: row.available_count !== undefined ? Number(row.available_count) : 0,
    totalSeatsCount: row.total_seats !== undefined ? Number(row.total_seats) : 320,
  };
}

const SHOWTIME_SELECT = `
  SELECT st.*,
         m.title AS movie_title,
         m.poster_url AS movie_poster_url,
         c.name AS cinema_name,
         c.city AS cinema_city,
         c.neighborhood AS cinema_neighborhood,
         a.name AS auditorium_name,
         a.screen_type AS auditorium_screen_type,
         a.total_seats AS total_seats,
         a.rows_count AS rows_count,
         a.columns_count AS columns_count,
         (SELECT COUNT(*) FROM showtime_seats ss
            WHERE ss.showtime_id = st.id AND ss.status = 'AVAILABLE') AS available_count
    FROM showtimes st
    JOIN movies m      ON m.id = st.movie_id
    JOIN cinemas c     ON c.id = st.cinema_id
    JOIN auditoriums a ON a.id = st.auditorium_id
`;

export class PgStore {
  readonly mode = 'postgres' as const;
  private pool: Pool;

  constructor(pool: Pool = getDbPool() as Pool) {
    if (!pool) throw new Error('[PgStore] PostgreSQL pool is not available');
    this.pool = pool;
  }

  getPool(): Pool {
    return this.pool;
  }

  // ------------------------------------------------------------------ users
  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const res = await this.pool.query<UserDbRow>('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return res.rows[0] ? this.mapUser(res.rows[0]) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const res = await this.pool.query<UserDbRow>('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ? this.mapUser(res.rows[0]) : null;
  }

  async createUser(input: {
    id: string;
    email: string;
    fullName: string;
    phoneNumber?: string;
    passwordHash: string;
    role?: UserRole;
  }): Promise<UserRecord> {
    const res = await this.pool.query<UserDbRow>(
      `INSERT INTO users (id, email, password_hash, full_name, phone_number, role)
       VALUES ($1, LOWER($2), $3, $4, $5, $6) RETURNING *`,
      [input.id, input.email, input.passwordHash, input.fullName, input.phoneNumber ?? null, input.role ?? 'customer']
    );
    return this.mapUser(res.rows[0]);
  }

  private mapUser(row: UserDbRow): UserRecord {
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phoneNumber: row.phone_number ?? undefined,
      role: row.role as UserRole,
      passwordHash: row.password_hash,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  // --------------------------------------------------------------- catalog
  async listCinemas(city?: string): Promise<Cinema[]> {
    const res = city
      ? await this.pool.query<CinemaDbRow>('SELECT * FROM cinemas WHERE LOWER(city) = LOWER($1) ORDER BY created_at, id', [city])
      : await this.pool.query<CinemaDbRow>('SELECT * FROM cinemas ORDER BY created_at, id');
    return res.rows.map((r) => this.mapCinema(r));
  }

  async getCinema(id: string): Promise<Cinema | null> {
    const res = await this.pool.query<CinemaDbRow>('SELECT * FROM cinemas WHERE id = $1', [id]);
    return res.rows[0] ? this.mapCinema(res.rows[0]) : null;
  }

  private mapCinema(row: CinemaDbRow): Cinema {
    return {
      id: row.id,
      name: row.name,
      city: row.city,
      neighborhood: row.neighborhood ?? undefined,
      address: row.address,
      postalCode: row.postal_code ?? undefined,
      phone: row.phone ?? undefined,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      amenities: (row.amenities as CinemaAmenity[]) ?? [],
      imageUrl: row.image_url,
      isDemo: row.is_demo,
    };
  }

  async listShowtimes(filter: { movieId?: string; cinemaId?: string; date?: string }): Promise<Showtime[]> {
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter.movieId) {
      params.push(filter.movieId);
      clauses.push(`st.movie_id = $${params.length}`);
    }
    if (filter.cinemaId) {
      params.push(filter.cinemaId);
      clauses.push(`st.cinema_id = $${params.length}`);
    }
    if (filter.date) {
      params.push(filter.date);
      // Compare in the Africa/Lagos business timezone (UTC+1).
      clauses.push(`(st.start_time AT TIME ZONE 'Africa/Lagos')::date = $${params.length}::date`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const res = await this.pool.query<ShowtimeDbRow>(`${SHOWTIME_SELECT}${where} ORDER BY st.start_time`, params);
    return res.rows.map(mapShowtime);
  }

  async getShowtime(id: string): Promise<Showtime | null> {
    const res = await this.pool.query<ShowtimeDbRow>(`${SHOWTIME_SELECT} WHERE st.id = $1`, [id]);
    return res.rows[0] ? mapShowtime(res.rows[0]) : null;
  }

  async getSeatMap(showtimeId: string): Promise<SeatMapLayout | null> {
    const showtimeRes = await this.pool.query<ShowtimeDbRow>(
      `${SHOWTIME_SELECT} WHERE st.id = $1`,
      [showtimeId]
    );
    if (!showtimeRes.rows[0]) return null;
    const st = showtimeRes.rows[0];

    const seatsRes = await this.pool.query<SeatRow>(
      `SELECT ss.seat_id, s.row_label, s.seat_number, s.seat_type,
              ss.status, ss.hold_expires_at,
              st.price_standard_kobo, st.price_vip_kobo
         FROM showtime_seats ss
         JOIN seats s      ON s.id = ss.seat_id
         JOIN showtimes st ON st.id = ss.showtime_id
        WHERE ss.showtime_id = $1
        ORDER BY s.row_label, s.seat_number`,
      [showtimeId]
    );

    const now = Date.now();
    const seats: Seat[] = seatsRes.rows.map((r) => {
      const type = mapSeatType(r.seat_type);
      let status: Seat['status'] = 'available';
      if (r.status === 'SOLD') status = 'sold';
      else if (r.status === 'HELD') {
        const expired = r.hold_expires_at && new Date(r.hold_expires_at).getTime() < now;
        status = expired ? 'available' : 'held';
      }
      const price = type === 'vip' ? Number(r.price_vip_kobo) : Number(r.price_standard_kobo);
      return {
        id: r.seat_id,
        auditoriumId: st.auditorium_id,
        row: r.row_label,
        number: r.seat_number,
        label: `${r.row_label}${r.seat_number}`,
        type,
        status,
        price,
      };
    });

    const rows = Array.from(new Set(seats.map((s) => s.row)));

    return {
      auditoriumId: st.auditorium_id,
      auditoriumName: st.auditorium_name ?? '',
      screenType: mapScreenType(st.auditorium_screen_type),
      showtimeId,
      totalSeats: seats.length,
      rows,
      columns: Number(st.columns_count ?? 16),
      seats,
    };
  }

  // -------------------------------------------------------------- bookings
  /** Reserve seats for a user as a temporary HELD booking (all-or-nothing). */
  async createBooking(input: {
    showtimeId: string;
    seatIds: string[];
    userId: string;
    idempotencyKey?: string;
    holdTtlSeconds: number;
  }): Promise<CreateBookingResult> {
    const seatIds = Array.from(new Set(input.seatIds));

    return withTransaction(this.pool, async (client) => {
      // Idempotent replay: return the previously created booking for this key.
      if (input.idempotencyKey) {
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM bookings WHERE user_id = $1 AND idempotency_key = $2',
          [input.userId, input.idempotencyKey]
        );
        if (existing.rows[0]) {
          const booking = await this.loadBooking(client, existing.rows[0].id);
          return { booking, replayed: true };
        }
      }

      // Note: Stale holds for the requested seats are evaluated per-seat below,
      // and the background sweeper runs every 15s. We avoid running global
      // expireStaleBookings inside this transaction to prevent lock-order deadlocks.

      const showtimeRes = await client.query<ShowtimeDbRow>(
        'SELECT * FROM showtimes WHERE id = $1',
        [input.showtimeId]
      );
      if (!showtimeRes.rows[0]) {
        throw new BookingConflictError('SHOWTIME_NOT_FOUND', 'Showtime does not exist');
      }
      const showtime = showtimeRes.rows[0];

      // Lock the per-showtime seat rows in monotonic order. FOR UPDATE serialises competing claims.
      const locked = await client.query<LockedSeatRow>(
        `SELECT s.id, s.row_label, s.seat_number, s.seat_type,
                ss.status, ss.held_by_user_id, ss.hold_expires_at
           FROM showtime_seats ss
           JOIN seats s ON s.id = ss.seat_id
          WHERE ss.showtime_id = $1 AND ss.seat_id = ANY($2::text[])
          ORDER BY ss.seat_id ASC
          FOR UPDATE OF ss`,
        [input.showtimeId, seatIds]
      );

      const found = new Map<string, LockedSeatRow>(locked.rows.map((r) => [r.id, r]));
      const missing = seatIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new BookingConflictError(
          'INVALID_SEATS',
          `Selected seats do not exist in this auditorium: ${missing.join(', ')}`,
          missing.map((id) => ({ seatId: id, reason: 'not_found' }))
        );
      }

      const now = Date.now();
      const conflicts: { seatId: string; label?: string; reason: string }[] = [];
      for (const seatId of seatIds) {
        const seat = found.get(seatId)!;
        const label = `${seat.row_label}${seat.seat_number}`;
        if (seat.status === 'SOLD') {
          conflicts.push({ seatId, label, reason: 'sold' });
        } else if (seat.status === 'HELD') {
          const expired = seat.hold_expires_at && new Date(seat.hold_expires_at).getTime() < now;
          if (!expired && seat.held_by_user_id && seat.held_by_user_id !== input.userId) {
            conflicts.push({ seatId, label, reason: 'held' });
          }
        }
      }
      if (conflicts.length > 0) {
        throw new BookingConflictError(
          'SEAT_UNAVAILABLE',
          `Seat ${conflicts.map((c) => c.label).join(', ')} is no longer available. Please pick different seats.`,
          conflicts
        );
      }

      // Server-side totals only. NEVER trust a client price.
      const priceFor = (row: LockedSeatRow) =>
        row.seat_type === 'vip'
          ? Number(showtime.price_vip_kobo)
          : Number(showtime.price_standard_kobo);
      const totalAmount = seatIds.reduce((sum, id) => sum + priceFor(found.get(id)!), 0);

      const bookingId = `bk-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const reference = `RP-${Math.floor(100000 + Math.random() * 900000)}`;
      const expiresAt = new Date(now + input.holdTtlSeconds * 1000);

      try {
        // Clean up any expired pending holds for the requested seats so they can be re-held immediately
        await client.query(
          `DELETE FROM booking_seats
            WHERE showtime_id = $1 AND seat_id = ANY($2::text[])
              AND booking_id IN (
                SELECT id FROM bookings WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
              )`,
          [input.showtimeId, seatIds]
        );
        await client.query(
          `DELETE FROM tickets
            WHERE showtime_id = $1 AND seat_id = ANY($2::text[])
              AND booking_id IN (
                SELECT id FROM bookings WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
              )`,
          [input.showtimeId, seatIds]
        );
        await client.query(
          `UPDATE bookings
              SET status = 'expired'
            WHERE showtime_id = $1 AND status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`,
          [input.showtimeId]
        );

        await client.query(
          `INSERT INTO bookings
             (id, booking_reference, user_id, showtime_id, total_amount_kobo, currency,
              status, payment_status, idempotency_key, qr_code, expires_at)
           VALUES ($1,$2,$3,$4,$5,'NGN','pending','pending',$6,$7,$8)`,
          [
            bookingId,
            reference,
            input.userId,
            input.showtimeId,
            totalAmount,
            input.idempotencyKey ?? null,
            `REELPASS-BOOKING-${reference}`,
            expiresAt.toISOString(),
          ]
        );

        for (let i = 0; i < seatIds.length; i++) {
          const seatId = seatIds[i];
          const seat = found.get(seatId)!;
          const price = priceFor(seat);
          const label = `${seat.row_label}${seat.seat_number}`;
          await client.query(
            `INSERT INTO booking_seats (booking_id, showtime_id, seat_id, seat_label, seat_type, price_kobo)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [bookingId, input.showtimeId, seatId, label, seat.seat_type, price]
          );
          await client.query(
            `INSERT INTO tickets (id, booking_id, showtime_id, seat_id, price_kobo, qr_code_data)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [`tkt-${bookingId}-${i + 1}`, bookingId, input.showtimeId, seatId, price, `REELPASS-TKT-${label}-${reference}`]
          );
        }

        await client.query(
          `UPDATE showtime_seats
              SET status = 'HELD', held_by_user_id = $3, hold_expires_at = $4, updated_at = NOW()
            WHERE showtime_id = $1 AND seat_id = ANY($2::text[])`,
          [input.showtimeId, seatIds, input.userId, expiresAt.toISOString()]
        );
      } catch (err: any) {
        // 23505 = unique_violation on booking_seats/tickets => a concurrent booking claimed the seat.
        // 40P01 = deadlock_detected, 40001 = serialization_failure, 55P03 = lock_not_available
        if (
          err?.code === '23505' ||
          err?.code === '40P01' ||
          err?.code === '40001' ||
          err?.code === '55P03'
        ) {
          throw new BookingConflictError(
            'SEAT_UNAVAILABLE',
            'One or more selected seats were just taken. Please pick different seats.',
            seatIds.map((seatId) => ({ seatId, reason: 'race' }))
          );
        }
        throw err;
      }

      const booking = await this.loadBooking(client, bookingId);
      return { booking, replayed: false };
    });
  }

  /** Confirm a pending booking (after verified payment). Idempotent. */
  async confirmBooking(
    bookingId: string,
    userId: string,
    payment?: { paymentId?: string }
  ): Promise<Booking> {
    return withTransaction(this.pool, async (client) => {
      const res = await client.query<BookingDbRow>('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
      const booking = res.rows[0];
      if (!booking) throw new BookingConflictError('BOOKING_NOT_FOUND', 'Booking not found');
      if (booking.user_id !== userId) {
        throw new BookingConflictError('FORBIDDEN', 'Access to this booking is restricted');
      }
      // Idempotent: already confirmed returns as-is.
      if (booking.status === 'confirmed') {
        return this.loadBooking(client, bookingId);
      }
      if (booking.status !== 'pending') {
        throw new BookingConflictError('BOOKING_NOT_PENDING', `Booking is ${booking.status}`);
      }
      if (booking.expires_at && new Date(booking.expires_at).getTime() < Date.now()) {
        throw new BookingConflictError('BOOKING_EXPIRED', 'This reservation has expired');
      }

      await client.query(
        `UPDATE showtime_seats
            SET status = 'SOLD', held_by_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
          WHERE showtime_id = $1 AND seat_id IN (
            SELECT seat_id FROM booking_seats WHERE booking_id = $2
          )`,
        [booking.showtime_id, bookingId]
      );

      await client.query(
        `UPDATE bookings
            SET status = 'confirmed', payment_status = 'successful', payment_id = $2
          WHERE id = $1`,
        [bookingId, payment?.paymentId ?? null]
      );

      return this.loadBooking(client, bookingId);
    });
  }

  /** Cancel a pending booking and release its seats. Idempotent. */
  async cancelBooking(bookingId: string, userId: string): Promise<Booking> {
    return withTransaction(this.pool, async (client) => {
      const res = await client.query<BookingDbRow>('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
      const booking = res.rows[0];
      if (!booking) throw new BookingConflictError('BOOKING_NOT_FOUND', 'Booking not found');
      if (booking.user_id !== userId) {
        throw new BookingConflictError('FORBIDDEN', 'Access to this booking is restricted');
      }
      if (booking.status === 'cancelled' || booking.status === 'expired') {
        return this.loadBooking(client, bookingId);
      }
      if (booking.status === 'confirmed') {
        throw new BookingConflictError('BOOKING_CONFIRMED', 'Confirmed bookings cannot be cancelled here');
      }

      const released = await client.query<{ seat_id: string }>(
        'DELETE FROM booking_seats WHERE booking_id = $1 RETURNING seat_id',
        [bookingId]
      );
      await client.query('DELETE FROM tickets WHERE booking_id = $1', [bookingId]);

      const seatIds = released.rows.map((r) => r.seat_id);
      if (seatIds.length > 0) {
        await client.query(
          `UPDATE showtime_seats
              SET status = 'AVAILABLE', held_by_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
            WHERE showtime_id = $1 AND seat_id = ANY($2::text[])`,
          [booking.showtime_id, seatIds]
        );
      }

      await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);
      return this.loadBooking(client, bookingId);
    });
  }

  /** Expire stale pending bookings and free their seats. Idempotent. */
  async expireStaleBookings(client?: PoolClient): Promise<number> {
    const run = async (c: PoolClient) => {
      const stale = await c.query<{ id: string; showtime_id: string }>(
        `SELECT id, showtime_id FROM bookings
          WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
          FOR UPDATE`
      );
      if (stale.rowCount === 0) return 0;

      const ids = stale.rows.map((r) => r.id);
      const released = await c.query<{ showtime_id: string; seat_id: string }>(
        'DELETE FROM booking_seats WHERE booking_id = ANY($1::text[]) RETURNING showtime_id, seat_id',
        [ids]
      );
      await c.query('DELETE FROM tickets WHERE booking_id = ANY($1::text[])', [ids]);

      // Group released seats by showtime and free them.
      const byShowtime = new Map<string, string[]>();
      for (const r of released.rows) {
        const list = byShowtime.get(r.showtime_id) ?? [];
        list.push(r.seat_id);
        byShowtime.set(r.showtime_id, list);
      }
      for (const [showtimeId, seatIds] of byShowtime) {
        await c.query(
          `UPDATE showtime_seats
              SET status = 'AVAILABLE', held_by_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
            WHERE showtime_id = $1 AND seat_id = ANY($2::text[]) AND status <> 'SOLD'`,
          [showtimeId, seatIds]
        );
      }
      await c.query(`UPDATE bookings SET status = 'expired' WHERE id = ANY($1::text[])`, [ids]);
      return ids.length;
    };

    if (client) return run(client);
    return withTransaction(this.pool, run);
  }

  async getBooking(id: string): Promise<Booking | null> {
    const client = await this.pool.connect();
    try {
      return this.loadBooking(client, id);
    } finally {
      client.release();
    }
  }

  async listBookingsForUser(userId: string): Promise<Booking[]> {
    // Mark any stale pending holds for this user as expired in the database
    await this.pool
      .query(
        `UPDATE bookings SET status = 'expired'
          WHERE user_id = $1 AND status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`,
        [userId]
      )
      .catch(() => undefined);

    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM bookings WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    const client = await this.pool.connect();
    try {
      const bookings: Booking[] = [];
      for (const row of res.rows) {
        const b = await this.loadBooking(client, row.id);
        if (b) bookings.push(b);
      }
      return bookings;
    } finally {
      client.release();
    }
  }

  private async loadBooking(client: PoolClient, id: string): Promise<Booking> {
    const bRes = await client.query<BookingDbRow>('SELECT * FROM bookings WHERE id = $1', [id]);
    const row = bRes.rows[0];
    if (!row) throw new BookingConflictError('BOOKING_NOT_FOUND', 'Booking not found');

    const stRes = await client.query<ShowtimeDbRow>(`${SHOWTIME_SELECT} WHERE st.id = $1`, [row.showtime_id]);
    const showtime = mapShowtime(stRes.rows[0]);

    const seatsRes = await client.query<BookingSeatDbRow>(
      `SELECT bs.seat_id, bs.seat_label, bs.seat_type, bs.price_kobo, s.row_label, s.seat_number
         FROM booking_seats bs JOIN seats s ON s.id = bs.seat_id
        WHERE bs.booking_id = $1 ORDER BY s.row_label, s.seat_number`,
      [id]
    );

    const ticketsRes = await client.query<TicketDbRow>(
      `SELECT * FROM tickets WHERE booking_id = $1 ORDER BY id`,
      [id]
    );

    const isExpiredHold = row.status === 'pending' && row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    const effectiveStatus: BookingStatus = isExpiredHold ? 'expired' : (row.status as BookingStatus);

    const seats: Seat[] = seatsRes.rows.map((r) => ({
      id: r.seat_id,
      auditoriumId: showtime.auditoriumId,
      row: r.row_label,
      number: r.seat_number,
      label: r.seat_label,
      type: mapSeatType(r.seat_type),
      // Price consistent with the showtime-specific price (integer kobo, NGN).
      status: effectiveStatus === 'confirmed' ? 'sold' : 'held',
      price: Number(r.price_kobo),
    }));

    const tickets: Ticket[] = ticketsRes.rows.map((t) => ({
      id: t.id,
      bookingId: t.booking_id,
      showtimeId: t.showtime_id,
      seatId: t.seat_id,
      seatLabel: seats.find((s) => s.id === t.seat_id)?.label ?? '',
      seatType: mapSeatType(seats.find((s) => s.id === t.seat_id)?.type ?? 'standard'),
      price: Number(t.price_kobo),
      qrCodeData: t.qr_code_data,
    }));

    return {
      id: row.id,
      bookingReference: row.booking_reference,
      userId: row.user_id,
      showtimeId: row.showtime_id,
      showtime,
      seats,
      tickets,
      totalAmount: Number(row.total_amount_kobo),
      currency: row.currency,
      status: effectiveStatus,
      paymentStatus: row.payment_status as 'pending' | 'successful' | 'failed',
      paymentId: row.payment_id ?? undefined,
      qrCode: row.qr_code,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    };
  }

  // ---------------------------------------------------------- availability
  async countAvailableSeats(showtimeId: string): Promise<number> {
    const res = await this.pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM showtime_seats
        WHERE showtime_id = $1 AND status = 'AVAILABLE'`,
      [showtimeId]
    );
    return res.rows[0]?.c ?? 0;
  }

  // -------------------------------------------------------------- payments
  async createPayment(input: {
    id: string;
    bookingId: string;
    amountKobo: number;
    currency?: string;
    provider?: string;
    reference: string;
    status?: 'pending' | 'successful' | 'failed';
    transactionId?: string;
  }): Promise<PaymentRecord> {
    const res = await this.pool.query<PaymentDbRow>(
      `INSERT INTO payments (id, booking_id, amount_kobo, currency, provider, reference, transaction_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (reference) DO UPDATE SET booking_id = EXCLUDED.booking_id
       RETURNING *`,
      [
        input.id,
        input.bookingId,
        input.amountKobo,
        input.currency ?? 'NGN',
        input.provider ?? 'flutterwave',
        input.reference,
        input.transactionId ?? null,
        input.status ?? 'pending',
      ]
    );
    return this.mapPayment(res.rows[0]);
  }

  async getPaymentByReference(reference: string): Promise<PaymentRecord | null> {
    const res = await this.pool.query<PaymentDbRow>('SELECT * FROM payments WHERE reference = $1', [reference]);
    return res.rows[0] ? this.mapPayment(res.rows[0]) : null;
  }

  async getPaymentByBookingId(bookingId: string): Promise<PaymentRecord | null> {
    const res = await this.pool.query<PaymentDbRow>('SELECT * FROM payments WHERE booking_id = $1', [bookingId]);
    return res.rows[0] ? this.mapPayment(res.rows[0]) : null;
  }

  async updatePaymentStatus(
    reference: string,
    status: 'pending' | 'successful' | 'failed',
    transactionId?: string,
    rawResponse?: unknown
  ): Promise<PaymentRecord | null> {
    const res = await this.pool.query<PaymentDbRow>(
      `UPDATE payments
          SET status = $2, transaction_id = COALESCE($3, transaction_id), raw_response = $4
        WHERE reference = $1
        RETURNING *`,
      [reference, status, transactionId ?? null, rawResponse ? JSON.stringify(rawResponse) : null]
    );
    return res.rows[0] ? this.mapPayment(res.rows[0]) : null;
  }

  private mapPayment(row: PaymentDbRow): PaymentRecord {
    return {
      id: row.id,
      bookingId: row.booking_id,
      amountKobo: Number(row.amount_kobo),
      currency: row.currency,
      provider: row.provider,
      reference: row.reference,
      transactionId: row.transaction_id ?? undefined,
      status: row.status,
      rawResponse: row.raw_response,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}
