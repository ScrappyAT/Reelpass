-- Additive migration. Existing bookings, attempts, tickets and financial records are preserved.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_key TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_link TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_uncertain BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_booking ON payments(booking_id) WHERE checkout_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkout_user_key ON payments(user_id, checkout_key) WHERE checkout_key IS NOT NULL;

ALTER TABLE showtimes ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hold_token TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_fee_kobo INTEGER NOT NULL DEFAULT 0 CHECK (service_fee_kobo >= 0);

CREATE TABLE IF NOT EXISTS payment_events (
    event_key TEXT PRIMARY KEY,
    reference TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    reported_status TEXT NOT NULL CHECK (reported_status IN ('successful', 'failed', 'cancelled')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processed', 'rejected', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    result_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_events_due ON payment_events(next_attempt_at) WHERE status = 'queued';

-- Extra/late charges must be recorded even if the booking already has a successful payment.
CREATE TABLE IF NOT EXISTS payment_captures (
    transaction_id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES payments(id),
    booking_id TEXT NOT NULL REFERENCES bookings(id),
    amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
    currency TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('booked', 'refund_due')),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_capture_booked ON payment_captures(booking_id) WHERE disposition = 'booked';

CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE REFERENCES payment_captures(transaction_id),
    amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
    currency TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitting', 'pending', 'succeeded', 'failed', 'needs_review')),
    provider_refund_id TEXT UNIQUE,
    check_attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refunds_due ON refunds(next_attempt_at) WHERE status IN ('queued', 'pending', 'submitting');

CREATE TABLE IF NOT EXISTS refund_ledger (
    id BIGSERIAL PRIMARY KEY,
    refund_id TEXT NOT NULL REFERENCES refunds(id),
    status TEXT NOT NULL,
    amount_kobo INTEGER NOT NULL,
    currency TEXT NOT NULL,
    detail_code TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refund_reconciliation (
    booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
    reason TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
