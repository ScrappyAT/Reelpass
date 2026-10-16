# ReelPass (Matinee) — Security

## Core Principles
- **Fail closed**: Payment verification failures never auto-confirm bookings. Missing credentials cause safe 503s.
- **Never hardcode secrets**: No credentials committed. Use `.env` (gitignored). `.env.example` contains placeholders only.
- **Server-side authority**: All pricing, totals, and booking confirmation decisions happen on the API. Client prices are ignored.
- **Defense in depth**: Redis atomicity + DB transactions + DB unique constraints + parameterized SQL.

## Data Protection
- **Money as integers**: All monetary values stored as integer kobo in PostgreSQL (avoids float precision issues)
- **Parameterized queries**: All SQL uses parameterized queries via `pg` (no string concatenation of user input)
- **Least privilege**: Local demo DB user has scoped access; no production credentials present
- **NGN only**: Currency consistently NGN; payment verification rejects non-NG matches

## Authentication & Authorization
- JWT-based auth (demo secret in local env). Route protection via `requireAuth` middleware.
- Resource ownership: Users can only access their own bookings; admin role checked where applicable.
- Booking operations require ownership validation before confirm/cancel.

## Concurrency & Integrity
- **Seat holds**: Redis Lua ensures atomic multi-seat acquisition; only owner can release
- **Row-level locking**: PostgreSQL `FOR UPDATE` on `showtime_seats` during booking
- **Final constraints**: `booking_seats(showtime_id, seat_id)` and `tickets(showtime_id, seat_id)` UNIQUE prevent double-booking even if Redis fails
- **Idempotency**: Prevents duplicate operations on retries (`idempotency_key` + unique constraint)

## Payment Security (Flutterwave)
- **No simulated success**: If not configured, endpoints return 503/appropriate errors — never mark paid
- **Server-side verification**: Amount (kobo), currency (NGN), tx_ref/transaction ID verified against booking
- **Webhook integrity**: `verif-hash` header verified via `crypto.timingSafeEqual` (constant-time) against configured secret
- **Replay protection**: Already-successful payments ignored; idempotent processing
- **Amount/currency mismatch**: Treated as failure; booking not confirmed

## Redis Security
- Runs on dedicated local port (6385), isolated in Docker network for local dev
- Keys scoped by showtime/seat; ownership enforced
- TTL-based expiration prevents indefinite holds
- No process-local fallback (prevents cross-instance inconsistency)

## Database Security
- Migrations are forward-only, non-destructive; never run destructive ops against production (documented)
- Connection timeouts and statement timeouts configured
- Health checks and fail-loud behavior when explicitly required

## Secrets Management
- `.env` excluded from git
- No API keys bundled client-side
- TMDB key server-side only
- Payment secrets optional; absence handled safely

## Local-Only Services
Docker Compose services (Postgres/Redis) are for local/demo only — never point production traffic at them. Ports non-default to avoid collisions.