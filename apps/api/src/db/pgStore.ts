import { Pool, PoolClient, QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { seatHolds } from '../redis/seatHolds';
import { bookingFingerprint, releasePendingSeats } from './bookingHolds';
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
import { getCatalogReadPool, getDbPool } from './pool';
import { cache } from '../redis/client';
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
  userId: string;
  amountKobo: number;
  currency: string;
  provider: string;
  reference: string;
  transactionId?: string;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  rawResponse?: unknown;
  failureReason?: string;
  createdAt: string;
  verifiedAt?: string;
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
  service_fee_kobo: number;
  hold_token: string | null;
  request_fingerprint: string | null;
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
  user_id: string;
  amount_kobo: number | string;
  currency: string;
  provider: string;
  reference: string;
  transaction_id: string | null;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  raw_response: unknown;
  failure_reason: string | null;
  created_at: Date | string;
  verified_at: Date | string | null;
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

  // Only stable public metadata can use a replica. Reservation, inventory
  // and payment reads always use the primary, including after writes.
  private async readCatalog<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
    const replica = getCatalogReadPool();
    if (replica) {
      try { return await replica.query<T>(sql, params); }
      catch { console.warn(JSON.stringify({ event: 'catalog_replica_fallback' })); }
    }
    return this.pool.query<T>(sql, params);
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
      ? await this.readCatalog<CinemaDbRow>('SELECT * FROM cinemas WHERE LOWER(city) = LOWER($1) ORDER BY created_at, id', [city])
      : await this.readCatalog<CinemaDbRow>('SELECT * FROM cinemas ORDER BY created_at, id');
    return res.rows.map((r) => this.mapCinema(r));
  }

  async getCinema(id: string): Promise<Cinema | null> {
    const res = await this.readCatalog<CinemaDbRow>('SELECT * FROM cinemas WHERE id = $1', [id]);
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
    const clauses: string[] = ['st.cancelled_at IS NULL', 'st.start_time > NOW()'];
    const params: any[] = [];
    if (filter.movieId) {
      params.push(filter.movieId);
      const index = params.length;
      clauses.push(`(st.movie_id = $${index} OR 'tmdb-' || m.tmdb_id::text = $${index})`);
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
      `${SHOWTIME_SELECT} WHERE st.id = $1 AND st.cancelled_at IS NULL`,
      [showtimeId]
    );
    if (!showtimeRes.rows[0]) return null;
    const st = showtimeRes.rows[0];

    const layoutKey = 'reelpass:layout:v1:' + st.auditorium_id;
    type Geometry = { id: string; row_label: string; seat_number: number; seat_type: string };
    const cached = await cache.get(layoutKey);
    let geometry: Geometry[] | undefined;
    if (cached) {
      try { geometry = JSON.parse(cached) as Geometry[]; } catch { /* reload malformed cache */ }
    }
    if (!geometry) {
      geometry = (await this.pool.query<Geometry>(
        'SELECT id,row_label,seat_number,seat_type FROM seats WHERE auditorium_id=$1 ORDER BY row_label,seat_number',
        [st.auditorium_id],
      )).rows;
      await cache.set(layoutKey, JSON.stringify(geometry), 1800);
    }
    const inventory = await this.pool.query<{ seat_id: string; status: string }>(
      'SELECT seat_id,status FROM showtime_seats WHERE showtime_id=$1', [showtimeId],
    );
    const availability = new Map(inventory.rows.map(row => [row.seat_id, row.status]));
    const seats: Seat[] = geometry.flatMap(row => {
      const state = availability.get(row.id);
      if (!state) return [];
      const type = mapSeatType(row.seat_type);
      return [{
        id: row.id, auditoriumId: st.auditorium_id, row: row.row_label, number: row.seat_number,
        label: row.row_label + row.seat_number, type,
        status: state === 'SOLD' ? 'sold' : state === 'HELD' ? 'held' : 'available',
        price: Number(type === 'vip' ? st.price_vip_kobo : st.price_standard_kobo),
      }];
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

  async findBookingReplay(userId: string, key: string, showtimeId: string, seats: string[]) {
    const client = await this.pool.connect();
    try { return await this.readBookingReplay(client, userId, key, showtimeId, seats); }
    finally { client.release(); }
  }

  private async readBookingReplay(client: PoolClient, userId: string, key: string, showtimeId: string, seats: string[]) {
    const { rows: [row] } = await client.query<Pick<BookingDbRow, 'id' | 'request_fingerprint'>>(
      'SELECT id, request_fingerprint FROM bookings WHERE user_id = $1 AND idempotency_key = $2', [userId, key],
    );
    if (!row) return null;
    const booking = await this.loadBooking(client, row.id);
    const recorded = row.request_fingerprint ?? bookingFingerprint(booking.showtimeId, booking.seats.map(seat => seat.id));
    if (recorded !== bookingFingerprint(showtimeId, seats)) {
      throw new BookingConflictError('IDEMPOTENCY_KEY_REUSED', 'This booking key was used for a different seat selection.');
    }
    return booking;
  }

  // -------------------------------------------------------------- bookings
  /** Reserve seats for a user as a temporary HELD booking (all-or-nothing). */
  async createBooking(input: {
    showtimeId: string;
    seatIds: string[];
    userId: string;
    idempotencyKey?: string;
    holdTtlSeconds: number;
    holdToken?: string;
  }): Promise<CreateBookingResult> {
    const seatIds = Array.from(new Set(input.seatIds));

    return withTransaction(this.pool, async (client) => {
      if (input.idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking:' || $1 || ':' || $2, 0))",
          [input.userId, input.idempotencyKey]);
        const booking = await this.readBookingReplay(client, input.userId, input.idempotencyKey, input.showtimeId, seatIds);
        if (booking) return { booking, replayed: true };
      }

      const { rows: [showtime] } = await client.query<ShowtimeDbRow & { cancelled_at: Date | null }>(
        'SELECT * FROM showtimes WHERE id = $1 FOR SHARE', [input.showtimeId],
      );
      if (!showtime) throw new BookingConflictError('SHOWTIME_NOT_FOUND', 'Showtime does not exist');
      if (showtime.cancelled_at || new Date(showtime.start_time).getTime() <= Date.now()) {
        throw new BookingConflictError('SHOWTIME_UNAVAILABLE', 'This screening is no longer bookable.');
      }

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
          conflicts.push({ seatId, label, reason: 'held' });
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
      const totalAmount = seatIds.reduce((sum, id) => sum + priceFor(found.get(id)!), env.SERVICE_FEE_KOBO);

      const bookingId = 'bk-' + randomUUID();
      const reference = 'RP-' + randomUUID().replace(/-/g, '').toUpperCase();
      const expiresAt = new Date(now + input.holdTtlSeconds * 1000);

      try {
        await client.query(
          `INSERT INTO bookings
             (id, booking_reference, user_id, showtime_id, total_amount_kobo, currency,
              status, payment_status, idempotency_key, qr_code, expires_at, hold_token, service_fee_kobo, request_fingerprint)
           VALUES ($1,$2,$3,$4,$5,'NGN','pending','pending',$6,$7,$8,$9,$10,$11)`,
          [
            bookingId,
            reference,
            input.userId,
            input.showtimeId,
            totalAmount,
            input.idempotencyKey ?? null,
            `REELPASS-BOOKING-${reference}`,
            expiresAt.toISOString(),
            input.holdToken ?? null,
            env.SERVICE_FEE_KOBO,
            bookingFingerprint(input.showtimeId, seatIds),
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

  /** Cancel an unpaid reservation without touching settled tickets or payments. */
  async cancelBooking(bookingId: string, userId: string): Promise<Booking> {
    const result = await withTransaction(this.pool, async client => {
      const { rows: [booking] } = await client.query<BookingDbRow>('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
      if (!booking) throw new BookingConflictError('BOOKING_NOT_FOUND', 'Booking not found');
      if (booking.user_id !== userId) throw new BookingConflictError('FORBIDDEN', 'Access to this booking is restricted');
      if (booking.status === 'confirmed') throw new BookingConflictError('BOOKING_CONFIRMED', 'Confirmed bookings cannot be cancelled here');
      const release = booking.status === 'pending' ? await releasePendingSeats(client, booking) : undefined;
      if (release) {
        await client.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [bookingId]);
        await client.query("UPDATE payments SET status = 'cancelled', failure_reason = 'CUSTOMER_CANCELLED' WHERE booking_id = $1 AND status = 'pending'", [bookingId]);
      }
      return { booking: await this.loadBooking(client, bookingId), release };
    });
    if (result.release?.seatIds.length) {
      void seatHolds.release(result.release.showtimeId, result.release.seatIds, result.release.token).catch(() => undefined);
    }
    return result.booking;
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

    const tickets: Ticket[] = (effectiveStatus === 'confirmed' ? ticketsRes.rows : []).map((t) => ({
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
      serviceFee: Number(row.service_fee_kobo),
      currency: row.currency,
      status: effectiveStatus,
      paymentStatus: row.payment_status as 'pending' | 'successful' | 'failed',
      paymentId: row.payment_id ?? undefined,
      qrCode: effectiveStatus === 'confirmed' ? row.qr_code : '',
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
  async getPaymentByReference(reference: string): Promise<PaymentRecord | null> {
    const res = await this.pool.query<PaymentDbRow>('SELECT * FROM payments WHERE reference = $1', [reference]);
    return res.rows[0] ? this.mapPayment(res.rows[0]) : null;
  }

  async getPaymentByBookingId(bookingId: string): Promise<PaymentRecord | null> {
    const res = await this.pool.query<PaymentDbRow>(
      "SELECT * FROM payments WHERE booking_id = $1 ORDER BY (status = 'successful') DESC, created_at DESC LIMIT 1",
      [bookingId]
    );
    return res.rows[0] ? this.mapPayment(res.rows[0]) : null;
  }

  async getPaymentByTransactionId(transactionId: string): Promise<PaymentRecord | null> {
    const res = await this.pool.query<PaymentDbRow>(
      "SELECT * FROM payments WHERE transaction_id = $1 ORDER BY (status = 'successful') DESC, created_at DESC LIMIT 1",
      [transactionId]
    );
    return res.rows[0] ? this.mapPayment(res.rows[0]) : null;
  }

  private mapPayment(row: PaymentDbRow): PaymentRecord {
    return {
      id: row.id,
      bookingId: row.booking_id,
      userId: row.user_id,
      amountKobo: Number(row.amount_kobo),
      currency: row.currency,
      provider: row.provider,
      reference: row.reference,
      transactionId: row.transaction_id ?? undefined,
      status: row.status,
      rawResponse: row.raw_response,
      failureReason: row.failure_reason ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : undefined,
    };
  }
}
