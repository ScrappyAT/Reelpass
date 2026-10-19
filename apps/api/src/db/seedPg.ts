import bcrypt from 'bcryptjs';
import { getDbPool } from './pool';
import { memoryStore, PRICE_KOBO } from './memoryStore';

/**
 * Idempotent PostgreSQL seed.
 *
 * Materializes the demo catalog from `memoryStore` into PostgreSQL using high-performance
 * bulk `unnest` queries. Fully idempotent via ON CONFLICT DO NOTHING / UPDATE.
 * Executes in ~1 second over cloud PostgreSQL connections.
 */
export async function seedPgDatabase(): Promise<void> {
  const pool = getDbPool();
  if (!pool) throw new Error('[seed] PostgreSQL pool unavailable');

  const client = await pool.connect();
  try {
    console.log('🌱 [seed] Ensuring demo catalog in PostgreSQL...');
    await client.query('BEGIN');

    // 1. Demo User
    const demoUser = memoryStore.users.get('u-1001-demo-user-id');
    if (demoUser) {
      const passwordHash = demoUser.passwordHash || bcrypt.hashSync('password123', 10);
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, phone_number, role)
         VALUES ($1, LOWER($2), $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [demoUser.id, demoUser.email, passwordHash, demoUser.fullName, demoUser.phoneNumber ?? null, demoUser.role]
      );
    }

    // 2. Movies
    for (const m of memoryStore.movies.values()) {
      await client.query(
        `INSERT INTO movies (id, tmdb_id, title, tagline, overview, poster_url, backdrop_url,
                             release_date, runtime_minutes, genres, rating, vote_count,
                             certification, trailer_url, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [
          m.id, m.tmdbId, m.title, m.tagline ?? null, m.overview, m.posterUrl, m.backdropUrl,
          m.releaseDate, m.runtimeMinutes, JSON.stringify(m.genres), m.rating, m.voteCount,
          m.certification, m.trailerUrl ?? null, m.status,
        ]
      );
    }

    // 3. Cinemas
    for (const c of memoryStore.cinemas.values()) {
      await client.query(
        `INSERT INTO cinemas (id, name, city, neighborhood, address, postal_code, phone,
                              latitude, longitude, amenities, image_url, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id, c.name, c.city, c.neighborhood ?? null, c.address, c.postalCode ?? null,
          c.phone ?? null, c.latitude, c.longitude, c.amenities, c.imageUrl,
        ]
      );
    }

    // 4. Auditoriums
    for (const aud of memoryStore.auditoriums.values()) {
      await client.query(
        `INSERT INTO auditoriums (id, cinema_id, name, screen_type, total_seats, rows_count, columns_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [aud.id, aud.cinemaId, aud.name, aud.screenType, aud.totalSeats, aud.rowsCount, aud.columnsCount]
      );
    }

    // 5. Seats (bulk unnest)
    const seatIds: string[] = [];
    const seatAudIds: string[] = [];
    const seatRows: string[] = [];
    const seatNums: number[] = [];
    const seatTypes: string[] = [];
    const seatPrices: number[] = [];

    for (const aud of memoryStore.auditoriums.values()) {
      const seats = memoryStore.getSeats(aud.id);
      for (const s of seats) {
        seatIds.push(s.id);
        seatAudIds.push(aud.id);
        seatRows.push(s.row);
        seatNums.push(s.number);
        seatTypes.push(s.type);
        seatPrices.push(s.price);
      }
    }

    if (seatIds.length > 0) {
      await client.query(
        `INSERT INTO seats (id, auditorium_id, row_label, seat_number, seat_type, default_price_kobo)
         SELECT id, auditorium_id, row_label, seat_number, seat_type, default_price_kobo
         FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::int[]
         ) AS t(id, auditorium_id, row_label, seat_number, seat_type, default_price_kobo)
         ON CONFLICT (id) DO NOTHING`,
        [seatIds, seatAudIds, seatRows, seatNums, seatTypes, seatPrices]
      );
    }

    // 6. Showtimes (bulk unnest)
    const showtimes = Array.from(memoryStore.showtimes.values());
    if (showtimes.length > 0) {
      const stIds = showtimes.map((s) => s.id);
      const stMovieIds = showtimes.map((s) => s.movieId);
      const stCinemaIds = showtimes.map((s) => s.cinemaId);
      const stAudIds = showtimes.map((s) => s.auditoriumId);
      const stStartTimes = showtimes.map((s) => s.startTime);
      const stEndTimes = showtimes.map((s) => s.endTime);
      const stFormats = showtimes.map((s) => s.format);
      const stPricesStd = showtimes.map((s) => {
        const aud = memoryStore.auditoriums.get(s.auditoriumId);
        return aud?.screenType === 'imax' ? PRICE_KOBO.imaxStandard : PRICE_KOBO.standard;
      });
      const stPricesVip = showtimes.map((s) => {
        const aud = memoryStore.auditoriums.get(s.auditoriumId);
        return aud?.screenType === 'imax' ? PRICE_KOBO.imaxVip : PRICE_KOBO.vip;
      });

      await client.query(
        `INSERT INTO showtimes (id, movie_id, cinema_id, auditorium_id, start_time, end_time, format, price_standard_kobo, price_vip_kobo)
         SELECT id, movie_id, cinema_id, auditorium_id, start_time::timestamptz, end_time::timestamptz, format, price_standard_kobo, price_vip_kobo
         FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::int[]
         ) AS t(id, movie_id, cinema_id, auditorium_id, start_time, end_time, format, price_standard_kobo, price_vip_kobo)
         ON CONFLICT (id) DO UPDATE SET
           price_standard_kobo = EXCLUDED.price_standard_kobo,
           price_vip_kobo = EXCLUDED.price_vip_kobo`,
        [stIds, stMovieIds, stCinemaIds, stAudIds, stStartTimes, stEndTimes, stFormats, stPricesStd, stPricesVip]
      );
    }

    // 7. Showtime Seats (batched unnest in chunks of 2500)
    let batchStIds: string[] = [];
    let batchSeatIds: string[] = [];
    let batchStatuses: string[] = [];
    let batchPrices: number[] = [];

    async function flushShowtimeSeats() {
      if (batchStIds.length === 0) return;
      await client.query(
        `INSERT INTO showtime_seats (showtime_id, seat_id, status, price_kobo)
         SELECT showtime_id, seat_id, status, price_kobo
         FROM unnest(
           $1::text[], $2::text[], $3::text[], $4::int[]
         ) AS t(showtime_id, seat_id, status, price_kobo)
         ON CONFLICT (showtime_id, seat_id) DO NOTHING`,
        [batchStIds, batchSeatIds, batchStatuses, batchPrices]
      );
      batchStIds = [];
      batchSeatIds = [];
      batchStatuses = [];
      batchPrices = [];
    }

    for (const st of showtimes) {
      const aud = memoryStore.auditoriums.get(st.auditoriumId);
      if (!aud) continue;
      const isImax = aud.screenType === 'imax';
      const priceStandard = isImax ? PRICE_KOBO.imaxStandard : PRICE_KOBO.standard;
      const priceVip = isImax ? PRICE_KOBO.imaxVip : PRICE_KOBO.vip;

      const seats = memoryStore.getSeats(st.auditoriumId);
      for (const s of seats) {
        batchStIds.push(st.id);
        batchSeatIds.push(s.id);
        batchStatuses.push(s.status === 'sold' ? 'SOLD' : 'AVAILABLE');
        batchPrices.push(s.type === 'vip' ? priceVip : priceStandard);

        if (batchStIds.length >= 2500) {
          await flushShowtimeSeats();
        }
      }
    }
    await flushShowtimeSeats();

    // 8. Demo Confirmed Booking (bk-9001-demo)
    const demoBooking = Array.from(memoryStore.bookings.values()).find((b) => b.id === 'bk-9001-demo');
    if (demoBooking) {
      await client.query(
        `INSERT INTO bookings (id, booking_reference, user_id, showtime_id, total_amount_kobo,
                               currency, status, payment_status, payment_id, qr_code, created_at)
         VALUES ($1,$2,$3,$4,$5,'NGN','confirmed','successful','pay-sample-01',$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          demoBooking.id, demoBooking.bookingReference, demoBooking.userId, demoBooking.showtimeId,
          demoBooking.totalAmount, demoBooking.qrCode, demoBooking.createdAt,
        ]
      );

      for (const t of demoBooking.tickets) {
        await client.query(
          `INSERT INTO booking_seats (booking_id, showtime_id, seat_id, seat_label, seat_type, price_kobo)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (showtime_id, seat_id) DO NOTHING`,
          [demoBooking.id, t.showtimeId, t.seatId, t.seatLabel, t.seatType, t.price]
        );
        await client.query(
          `INSERT INTO tickets (id, booking_id, showtime_id, seat_id, price_kobo, qr_code_data)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO NOTHING`,
          [t.id, demoBooking.id, t.showtimeId, t.seatId, t.price, t.qrCodeData]
        );
        await client.query(
          `UPDATE showtime_seats SET status = 'SOLD'
           WHERE showtime_id = $1 AND seat_id = $2`,
          [t.showtimeId, t.seatId]
        );
      }
    }

    await client.query('COMMIT');
    console.log('✅ [seed] Demo catalog seeded into PostgreSQL successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
