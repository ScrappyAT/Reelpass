import bcrypt from 'bcryptjs';
import { getDbPool } from './pool';
import { memoryStore, PRICE_KOBO } from './memoryStore';

/**
 * Idempotent PostgreSQL seed.
 *
 * The canonical demo catalog lives in `memoryStore` (the single source of truth
 * for demo data). This module materialises it into PostgreSQL so the API serves
 * identical cinemas, auditoriums, seats, movies and showtimes in both modes.
 *
 * Safe to run repeatedly: it only inserts when the database is empty.
 */
export async function seedPgDatabase(): Promise<void> {
  const pool = getDbPool();
  if (!pool) throw new Error('[seed] PostgreSQL pool unavailable');

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT COUNT(*)::int AS c FROM cinemas');
    if (existing.rows[0].c > 0) {
      console.log('ℹ️ [seed] Database already seeded. Skipping.');
      return;
    }

    console.log('🌱 [seed] Seeding ReelPass demo catalog into PostgreSQL...');
    await client.query('BEGIN');

    // --- users ----------------------------------------------------------
    const demoUser = memoryStore.users.get('u-1001-demo-user-id')!;
    const passwordHash = demoUser.passwordHash || bcrypt.hashSync('password123', 10);
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, phone_number, role)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [demoUser.id, demoUser.email, passwordHash, demoUser.fullName, demoUser.phoneNumber ?? null, demoUser.role]
    );

    // --- movies ---------------------------------------------------------
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

    // --- cinemas --------------------------------------------------------
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

    // --- auditoriums + seats -------------------------------------------
    for (const aud of memoryStore.auditoriums.values()) {
      await client.query(
        `INSERT INTO auditoriums (id, cinema_id, name, screen_type, total_seats, rows_count, columns_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [aud.id, aud.cinemaId, aud.name, aud.screenType, aud.totalSeats, aud.rowsCount, aud.columnsCount]
      );

      const seats = memoryStore.getSeats(aud.id);
      for (const s of seats) {
        await client.query(
          `INSERT INTO seats (id, auditorium_id, row_label, seat_number, seat_type, default_price_kobo)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [s.id, aud.id, s.row, s.number, s.type, s.price]
        );
      }
    }

    // --- showtimes + per-showtime seats ---------------------------------
    for (const st of memoryStore.showtimes.values()) {
      const aud = memoryStore.auditoriums.get(st.auditoriumId)!;
      const isImax = aud.screenType === 'imax';
      const priceStandard = isImax ? PRICE_KOBO.imaxStandard : PRICE_KOBO.standard;
      const priceVip = isImax ? PRICE_KOBO.imaxVip : PRICE_KOBO.vip;

      await client.query(
        `INSERT INTO showtimes (id, movie_id, cinema_id, auditorium_id, start_time, end_time, format,
                                price_standard_kobo, price_vip_kobo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           price_standard_kobo = EXCLUDED.price_standard_kobo,
           price_vip_kobo = EXCLUDED.price_vip_kobo`,
        [st.id, st.movieId, st.cinemaId, st.auditoriumId, st.startTime, st.endTime, st.format, priceStandard, priceVip]
      );

      const seats = memoryStore.getSeats(st.auditoriumId);
      const showtimeIds = seats.map(() => st.id);
      const seatIds = seats.map((s) => s.id);
      const statuses = seats.map((s) => (s.status === 'sold' ? 'SOLD' : 'AVAILABLE'));
      const prices = seats.map((s) => (s.type === 'vip' ? priceVip : priceStandard));

      await client.query(
        `INSERT INTO showtime_seats (showtime_id, seat_id, status, price_kobo)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
         ON CONFLICT (showtime_id, seat_id) DO NOTHING`,
        [showtimeIds, seatIds, statuses, prices]
      );
    }

    // --- mirror the demo confirmed booking (H10/H11) --------------------
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
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
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
    console.log('✅ [seed] Demo catalog seeded into PostgreSQL.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
