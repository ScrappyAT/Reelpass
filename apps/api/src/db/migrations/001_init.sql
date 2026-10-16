-- ============================================================================
-- ReelPass (Matinee) — 001_init.sql
-- PostgreSQL-backed booking engine.
--
-- Conventions:
--   * Primary keys are the platform's internal, human-readable TEXT ids
--     (e.g. "c-101", "st-1", "aud-201-J12"). They match the demo catalog ids.
--   * Money is stored as INTEGER KOBO (1 NGN = 100 kobo). Never floats.
--   * Seat state is tracked PER SHOWTIME in `showtime_seats`, which is the
--     authoritative source of truth for availability, holds and sales.
--   * The UNIQUE constraints below are the final authority against double
--     booking even if Redis is unavailable.
-- ============================================================================

-- ---------------------------------------------------------------- users -----
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(150) NOT NULL,
    phone_number  VARCHAR(50),
    role          VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------- cinemas -----
CREATE TABLE IF NOT EXISTS cinemas (
    id           TEXT PRIMARY KEY,
    name         VARCHAR(150) NOT NULL,
    city         VARCHAR(100) NOT NULL,
    neighborhood VARCHAR(100),
    address      TEXT NOT NULL,
    postal_code  VARCHAR(30),
    phone        VARCHAR(50),
    latitude     DOUBLE PRECISION NOT NULL DEFAULT 0,
    longitude    DOUBLE PRECISION NOT NULL DEFAULT 0,
    amenities    TEXT[] NOT NULL DEFAULT '{}',
    image_url    TEXT NOT NULL DEFAULT '',
    is_demo      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------- movies -----
CREATE TABLE IF NOT EXISTS movies (
    id              TEXT PRIMARY KEY,
    tmdb_id         INTEGER UNIQUE,
    title           VARCHAR(255) NOT NULL,
    tagline         TEXT,
    overview        TEXT NOT NULL DEFAULT '',
    poster_url      TEXT NOT NULL DEFAULT '',
    backdrop_url    TEXT NOT NULL DEFAULT '',
    release_date    VARCHAR(20) NOT NULL DEFAULT '',
    runtime_minutes INTEGER NOT NULL DEFAULT 120,
    genres          JSONB NOT NULL DEFAULT '[]',
    rating          NUMERIC(3, 1) NOT NULL DEFAULT 0.0,
    vote_count      INTEGER NOT NULL DEFAULT 0,
    certification   VARCHAR(20) NOT NULL DEFAULT 'PG-13',
    trailer_url     TEXT,
    status          VARCHAR(50) NOT NULL DEFAULT 'now_playing',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------- auditoriums -----
CREATE TABLE IF NOT EXISTS auditoriums (
    id            TEXT PRIMARY KEY,
    cinema_id     TEXT NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
    name          VARCHAR(150) NOT NULL,
    screen_type   VARCHAR(20) NOT NULL DEFAULT 'standard'
                    CHECK (screen_type IN ('standard', 'imax', 'dolby', 'vip')),
    total_seats   INTEGER NOT NULL DEFAULT 320,
    rows_count    INTEGER NOT NULL DEFAULT 16,
    columns_count INTEGER NOT NULL DEFAULT 20,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------- seats -----
-- Static seat layout per auditorium (physical chair).
CREATE TABLE IF NOT EXISTS seats (
    id           TEXT PRIMARY KEY,
    auditorium_id TEXT NOT NULL REFERENCES auditoriums(id) ON DELETE CASCADE,
    row_label    VARCHAR(5) NOT NULL,
    seat_number  INTEGER NOT NULL,
    seat_type    VARCHAR(20) NOT NULL DEFAULT 'standard'
                    CHECK (seat_type IN ('standard', 'vip', 'wheelchair')),
    default_price_kobo INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_auditorium_seat UNIQUE (auditorium_id, row_label, seat_number)
);

-- ------------------------------------------------------------ showtimes -----
CREATE TABLE IF NOT EXISTS showtimes (
    id                  TEXT PRIMARY KEY,
    movie_id            TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    cinema_id           TEXT NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
    auditorium_id       TEXT NOT NULL REFERENCES auditoriums(id) ON DELETE CASCADE,
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL,
    format              VARCHAR(50) NOT NULL DEFAULT '2D',
    price_standard_kobo INTEGER NOT NULL DEFAULT 0,
    price_vip_kobo      INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------- showtime_seats -----
-- Authoritative per-showtime seat state. Lifecycle:
--   AVAILABLE -> HELD (temporary Redis + DB hold) -> SOLD (confirmed ticket)
--   HELD -> AVAILABLE on hold expiry or explicit release.
CREATE TABLE IF NOT EXISTS showtime_seats (
    showtime_id      TEXT NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
    seat_id          TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
    status           VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
                       CHECK (status IN ('AVAILABLE', 'HELD', 'SOLD')),
    price_kobo       INTEGER NOT NULL DEFAULT 0,
    held_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    hold_expires_at  TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (showtime_id, seat_id)
);

-- ------------------------------------------------------------- bookings -----
CREATE TABLE IF NOT EXISTS bookings (
    id               TEXT PRIMARY KEY,
    booking_reference VARCHAR(40) UNIQUE NOT NULL,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    showtime_id      TEXT NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
    total_amount_kobo INTEGER NOT NULL,
    currency         VARCHAR(10) NOT NULL DEFAULT 'NGN',
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending', 'successful', 'failed')),
    payment_id       TEXT,
    idempotency_key  VARCHAR(120),
    qr_code          TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ,
    CONSTRAINT uq_booking_idempotency UNIQUE (user_id, idempotency_key)
);

-- -------------------------------------------------------- booking_seats -----
-- Join table booking <-> seat for a showtime. The UNIQUE(showtime_id, seat_id)
-- constraint is the hard guarantee that a seat is never double-booked.
CREATE TABLE IF NOT EXISTS booking_seats (
    booking_id   TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    showtime_id  TEXT NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
    seat_id      TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
    seat_label   VARCHAR(10) NOT NULL,
    seat_type    VARCHAR(20) NOT NULL DEFAULT 'standard',
    price_kobo   INTEGER NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (showtime_id, seat_id),
    CONSTRAINT uq_booking_seat_booking UNIQUE (booking_id, seat_id)
);

-- -------------------------------------------------------------- tickets -----
CREATE TABLE IF NOT EXISTS tickets (
    id           TEXT PRIMARY KEY,
    booking_id   TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    showtime_id  TEXT NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
    seat_id      TEXT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
    price_kobo   INTEGER NOT NULL,
    qr_code_data TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ticket_showtime_seat UNIQUE (showtime_id, seat_id)
);

-- ------------------------------------------------------------- payments -----
CREATE TABLE IF NOT EXISTS payments (
    id            TEXT PRIMARY KEY,
    booking_id    TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount_kobo   INTEGER NOT NULL,
    currency      VARCHAR(10) NOT NULL DEFAULT 'NGN',
    provider      VARCHAR(50) NOT NULL DEFAULT 'flutterwave',
    reference     VARCHAR(120) UNIQUE NOT NULL,
    transaction_id VARCHAR(120),
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'successful', 'failed')),
    raw_response  JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_booking UNIQUE (booking_id)
);

-- ------------------------------------------------------------- indexes ------
CREATE INDEX IF NOT EXISTS idx_showtimes_cinema    ON showtimes(cinema_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_movie     ON showtimes(movie_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_start     ON showtimes(start_time);
CREATE INDEX IF NOT EXISTS idx_seats_auditorium    ON seats(auditorium_id);
CREATE INDEX IF NOT EXISTS idx_showtime_seats_state ON showtime_seats(showtime_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_user       ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status_exp  ON bookings(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_tickets_booking     ON tickets(booking_id);
