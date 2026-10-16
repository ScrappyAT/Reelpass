-- MATINEE POSTGRESQL DATABASE SCHEMA
-- Phase 1 Core Database Definitions

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(50),
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. CINEMAS TABLE
CREATE TABLE IF NOT EXISTS cinemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    postal_code VARCHAR(30),
    phone VARCHAR(50),
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    amenities TEXT[] DEFAULT '{}',
    image_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. AUDITORIUMS TABLE
CREATE TABLE IF NOT EXISTS auditoriums (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cinema_id UUID NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    screen_type VARCHAR(50) NOT NULL DEFAULT 'standard' CHECK (screen_type IN ('standard', 'imax', 'dolby', 'vip')),
    total_seats INT NOT NULL DEFAULT 300,
    rows_count INT NOT NULL DEFAULT 15,
    columns_count INT NOT NULL DEFAULT 20,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. MOVIES TABLE (Cached metadata from TMDB or local catalog)
CREATE TABLE IF NOT EXISTS movies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tmdb_id INT UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    tagline TEXT,
    overview TEXT NOT NULL,
    poster_url TEXT NOT NULL,
    backdrop_url TEXT NOT NULL,
    release_date VARCHAR(20) NOT NULL,
    runtime_minutes INT NOT NULL DEFAULT 120,
    genres JSONB DEFAULT '[]',
    rating DECIMAL(3, 1) DEFAULT 0.0,
    vote_count INT DEFAULT 0,
    certification VARCHAR(20) DEFAULT 'PG-13',
    trailer_url TEXT,
    status VARCHAR(50) DEFAULT 'now_playing',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. SHOWTIMES TABLE
CREATE TABLE IF NOT EXISTS showtimes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
    cinema_id UUID NOT NULL REFERENCES cinemas(id) ON DELETE CASCADE,
    auditorium_id UUID NOT NULL REFERENCES auditoriums(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    format VARCHAR(50) NOT NULL DEFAULT '2D',
    price_standard DECIMAL(10, 2) NOT NULL DEFAULT 12.00,
    price_vip DECIMAL(10, 2) NOT NULL DEFAULT 22.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. SEATS TABLE (Pre-generated for each auditorium)
CREATE TABLE IF NOT EXISTS seats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auditorium_id UUID NOT NULL REFERENCES auditoriums(id) ON DELETE CASCADE,
    row_label VARCHAR(5) NOT NULL,
    seat_number INT NOT NULL,
    seat_type VARCHAR(20) NOT NULL DEFAULT 'standard' CHECK (seat_type IN ('standard', 'vip', 'wheelchair')),
    default_price DECIMAL(10, 2) NOT NULL DEFAULT 12.00,
    CONSTRAINT uq_auditorium_seat UNIQUE (auditorium_id, row_label, seat_number)
);

-- 7. BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_reference VARCHAR(30) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    showtime_id UUID NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
    total_amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'successful', 'failed')),
    payment_id UUID,
    qr_code TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
);

-- 8. TICKETS TABLE (Individual seats booked per booking)
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    showtime_id UUID NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
    seat_id UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
    price DECIMAL(10, 2) NOT NULL,
    qr_code_data TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_showtime_seat UNIQUE (showtime_id, seat_id)
);

-- 9. PAYMENTS TABLE (Phase 2 Prep)
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    provider VARCHAR(50) NOT NULL DEFAULT 'flutterwave',
    reference VARCHAR(100) UNIQUE NOT NULL,
    transaction_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed')),
    raw_response JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_showtimes_cinema ON showtimes(cinema_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_movie ON showtimes(movie_id);
CREATE INDEX IF NOT EXISTS idx_showtimes_start ON showtimes(start_time);
CREATE INDEX IF NOT EXISTS idx_seats_auditorium ON seats(auditorium_id);
CREATE INDEX IF NOT EXISTS idx_tickets_showtime ON tickets(showtime_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
