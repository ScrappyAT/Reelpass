-- 002_flutterwave_payments.sql
-- Flutterwave Payment Integration schema updates:
-- Supports user_id, verification timestamp, failure reason, idempotent successful transactions,
-- and allows safe retries while preventing duplicate confirmations or reused transaction IDs.

-- 1. Add user_id column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE payments ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2. Backfill user_id from bookings where possible
UPDATE payments p
   SET user_id = b.user_id
  FROM bookings b
 WHERE p.booking_id = b.id AND p.user_id IS NULL;

-- 3. Add verified_at and failure_reason columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'verified_at'
    ) THEN
        ALTER TABLE payments ADD COLUMN verified_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'failure_reason'
    ) THEN
        ALTER TABLE payments ADD COLUMN failure_reason TEXT;
    END IF;
END $$;

-- 4. Update status check constraint to include 'cancelled'
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check 
    CHECK (status IN ('pending', 'successful', 'failed', 'cancelled'));

-- 5. Drop single-booking constraint if it prevents retries, and replace with unique index for successful bookings
ALTER TABLE payments DROP CONSTRAINT IF EXISTS uq_payment_booking;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_booking_successful 
    ON payments (booking_id) WHERE status = 'successful';

-- 6. Add unique index on successful transaction_id to prevent transaction reuse across bookings
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_transaction_id 
    ON payments (transaction_id) WHERE transaction_id IS NOT NULL AND status = 'successful';

-- 7. Performance & lookup indexes
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
