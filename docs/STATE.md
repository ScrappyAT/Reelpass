# ReelPass (Matinee) — State Documentation

## Current State (as verified)

### Infrastructure
- **PostgreSQL 16**: Running in Docker on `localhost:5455`, healthy. Database `reelpass` with user `reelpass`. 
- **Redis 7**: Running in Docker on `localhost:6385`, healthy. AOF enabled, maxmemory 256MB (noeviction).
- **Docker Compose**: Configured with non-default ports to avoid collisions.

### API (apps/api)
- **Mode**: Configured for `DATA_MODE=postgres` in `.env`. API fails loudly if PostgreSQL unavailable.
- **Migrations**: `001_init.sql` applied (schema up to date). Schema includes all required tables with proper constraints (unique on showtime+seat in booking_seats/tickets).
- **Seeding**: Demo catalog seeded into PostgreSQL from canonical memory store.
- **Seat holds**: Redis-backed with Lua scripts for atomic acquisition/release. Functional; verified via manual test.
- **Booking engine**: PgStore implements transactions + `FOR UPDATE` + unique constraints. All existing tests pass.
- **Price consistency**: Totals and per-seat prices computed server-side from showtime record (integer kobo, NGN). Consistent across booking objects.
- **Payments**: Flutterwave integration implemented with fail-closed behavior (no credentials configured → 503 on confirm/init). Webhook signature verification via timingSafeEqual; replay protection; amount/currency checks.

### Tests
- **Unit/integration (memory mode)**: `npm run test` in apps/api → 15/15 passed (booking validation, price consistency, idempotency, cancel/release, payment-not-configured, etc.)
- **PostgreSQL integration tests**: `npm run test:pg` → 6/6 passed (concurrent booking race, NGN totals, idempotency, cancel/release, confirm/idempotent, held-not-available)

### Mobile App
- Preserved as-is. UI unchanged. Uses existing API client.

### Known State
- Redis seat-holds service initializes asynchronously; becomes live shortly after startup (verified functional)
- Background expiry sweep runs every 15s in Postgres mode
- Payment verification is fully implemented but requires valid Flutterwave sandbox credentials to return `ok: true` (current state: not configured → confirm fails with 503 as designed)

## Lifecycle Rules
**Seat states**: AVAILABLE → HELD → SOLD. HELD → AVAILABLE on expiry or explicit cancellation (via DB sweep or cancel endpoint). PostgreSQL is source of truth for SOLD; Redis is advisory fast-path for holds. 

**Booking states**: pending → confirmed (after verified payment). pending → cancelled/expired. Confirmed bookings cannot be cancelled via cancel endpoint. Idempotent confirmation returns existing confirmed booking.