# Matinee — ReelPass Cinema Booking App

**ReelPass** — *Your seat. Your story.* — is a premium cinema ticket reservation app for the Nigerian market, built with **Expo React Native**, **TypeScript**, and a **Node.js/Express** backend, architected as an **npm workspaces monorepo**. (Graduation project: Matinee; consumer-facing app: ReelPass.)

> **Demo data notice:** Movie data comes from TMDB with an offline demo fallback. Cinema locations, showtimes, prices and seat maps are clearly-labelled **demo data** for Nigerian cities (Lagos, Abuja, Port Harcourt, Ibadan). They are fictional demo cinemas, not real businesses, verified partners, or real street addresses. All prices are **demo prices in Nigerian Naira (₦ / NGN)**.

## Phase 2: Production-Style Booking Engine (Now Implemented)

ReelPass now features a production-style booking engine with:
- **PostgreSQL persistence** with connection pooling, transactions, and database constraints as final authority
- **Redis-based atomic seat holds** (5-minute TTL) with Lua scripts for all-or-nothing acquisition
- **Concurrency-safe booking** via `FOR UPDATE` row locks + unique constraints preventing double-booking
- **NGN price consistency**: All totals and per-seat prices computed server-side from showtime records as integer kobo
- **Flutterwave sandbox integration** with server-side verification, webhook signature checking, and fail-closed behavior (no fake success)
- **Comprehensive tests** including PostgreSQL concurrency tests and 500-VU load test validation
- **Background expiry sweep** to release stale holds

## Monorepo Architecture

```
matinee/
├── apps/
│   ├── api/                      # Node.js + Express + TypeScript Backend
│   │   ├── src/
│   │   │   ├── config/           # Environment validation with Zod
│   │   │   ├── db/               # PostgreSQL pooling, migrations, schema, seed, PgStore
│   │   │   ├── redis/            # Redis client + atomic seat holds (Lua)
│   │   │   ├── middleware/       # Request ID tracing, auth, structured error handler
│   │   │   ├── services/         # TMDB, Flutterwave payment integration
│   │   │   ├── routes/           # Auth, Movies, Cinemas, Showtimes, Bookings, Payments
│   │   │   └── tests/            # Unit/E2E tests + PG integration tests
│   │   └── package.json
│   └── mobile/                   # Expo React Native Android App (preserved)
├── packages/
│   └── shared/                   # Shared TypeScript interfaces & Zod schemas
├── docs/                        # Architecture, Security, State, Performance reports
├── load-tests/                  # k6 500-VU seat-contention test + reports
├── docker-compose.yml            # Postgres 16 + Redis 7 (ports 5455/6385)
└── package.json                  # npm workspaces
```

## Quick Start & Local Setup

### Prerequisites
- Node.js v20+ or v24+
- npm v10+ or v11+ (use `npm.cmd` on Windows)
- Docker Desktop (for Postgres + Redis + k6 load tests)
- (Optional) TMDB API key for live movie data

### 1. Start Infrastructure (Postgres + Redis)
```powershell
cd C:\Users\HP\Desktop\matinee
docker compose up -d
docker compose ps  # verify postgres/redis healthy
```

Services:
- PostgreSQL: `localhost:5455` (user: `reelpass` / pass: `reelpass` / db: `reelpass`)
- Redis: `localhost:6385`

### 2. Install Dependencies
```powershell
npm.cmd install
npm.cmd run build:shared
```

### 3. Configure Environment
Copy `.env.example` to `.env` (already configured in repo for local dev):
- `DATA_MODE=postgres` — requires Postgres; fails loudly if unreachable
- DB on port 5455, Redis on 6385
- Payment keys empty by default (fail-closed, no fake success)

### 4. Start API (Port 4000)
```powershell
npm.cmd run dev --workspace=@matinee/api
# or
npm.cmd run dev:api
```

Verify:
```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
```

### 5. Start Mobile App (Optional)
```powershell
npm.cmd run dev:mobile
```

## Database Setup (Migrations & Seeding)
The API auto-runs migrations and seeds on startup in Postgres mode. Manual commands:
```powershell
cd C:\Users\HP\Desktop\matinee\apps\api
node --import tsx -e "import {runMigrations} from './src/db/migrate'; import {getDbPool,closeDbPool} from './src/db/pool'; await runMigrations(getDbPool()); await closeDbPool();"
node --import tsx -e "import {seedPgDatabase} from './src/db/seedPg'; await seedPgDatabase(); await closeDbPool(); import {closeDbPool} from './src/db/pool';"
```

## Testing

### Memory-mode tests (fast, no DB required)
```powershell
npm.cmd run test --workspace=@matinee/api
```
→ 15/15 passed

### PostgreSQL integration tests
```powershell
npm.cmd run test:pg --workspace=@matinee/api
```
→ 6/6 passed (concurrent booking, price consistency, idempotency, cancel/release, confirm, held-not-available)

### Typecheck
```powershell
npm.cmd run typecheck
```

## 500-VU Load Test

Prerequisites: API running in Postgres mode, Docker Desktop running.
```powershell
cd C:\Users\HP\Desktop\matinee
pwsh -File .\load-tests\run.ps1 -Reset
```

Results: see `load-tests/REPORT.md` and `load-tests/summary.json`. Correctness: 0 server errors, no double-booking.

## Key Features (Phase 2)

### PostgreSQL
- Schema: `apps/api/src/db/migrations/001_init.sql`
- Connection pool: `apps/api/src/db/pool.ts` (tunable timeouts, PG_POOL_MAX)
- Store: `apps/api/src/db/pgStore.ts` with transactions + FOR UPDATE
- Migrations: forward-only, idempotent; non-destructive

### Redis Seat Holds
- Implementation: `apps/api/src/redis/seatHolds.ts`
- Atomic Lua: acquire all-or-none, release only owner
- TTL: `SEAT_HOLD_TTL_SECONDS` (default 300s)
- Fallback: DB-only if Redis unavailable (logged)

### Concurrency Safety
- PostgreSQL transactions + `FOR UPDATE` on showtime_seats
- Unique constraints: `booking_seats(showtime_id, seat_id)`, `tickets(showtime_id, seat_id)`
- Idempotent booking via `bookings(user_id, idempotency_key)`
- Background expiry sweep every 15s

### Payments (Flutterwave)
- Service: `apps/api/src/services/payment.service.ts`
- Fail-closed: no credentials → 503, never fakes success
- Server-side verify: amount (kobo), currency (NGN), tx_ref/transaction ID
- Webhook: timingSafeEqual signature verification, replay protection, amount/currency validation
- Routes: `POST /payments/initialize`, `POST /payments/webhook`, `GET /payments/status`

### Price Consistency
- Integer kobo (NGN) throughout DB and API
- Server-side totals from showtime prices by seat type
- `booking.seats[].price`, `tickets[].price`, `totalAmount` all consistent

## NGN Pricing & Nigerian Locations
- Currency: NGN (₦), stored as integer kobo
- Cities: Lagos, Abuja, Port Harcourt, Ibadan (demo data)
- Showtimes in `Africa/Lagos` timezone

## Documentation
- `docs/ARCHITECTURE.md` — System design, flows, Mermaid diagram
- `docs/SECURITY.md` — Security model, payment/webhook security, constraints
- `docs/STATE.md` — Current verified state
- `docs/PERFORMANCE-REPORT.md` — Performance summary
- `load-tests/README.md` — Load test instructions
- `load-tests/REPORT.md` — 500-VU test results

## Final Verification Summary

**Implemented:**
- PostgreSQL-backed booking engine with migrations/seed
- Redis atomic seat holds (Lua) with TTL, exclusivity, release-on-confirm/cancel
- Concurrency-safe booking (FOR UPDATE + unique constraints + idempotency)
- NGN price consistency (server-side, integer kobo)
- Flutterwave integration (verify + webhook, fail-closed)
- Background expiry sweep
- PG integration tests + 500-VU k6 test
- Complete docs

**Connections:** Postgres (5455, healthy), Redis (6385, healthy)

**Proof bookings survive restart:** PostgreSQL persistence via PgStore + migrations; confirmed bookings stored in DB. Restart API with same DB → data intact.

**Proof double-booking prevented:** PG integration test validates only 1 of N concurrent attempts wins; unique constraints + FOR UPDATE enforce correctness. 500-VU test: 40 bookings from 40-seat pool, 0 server errors.

**500-VU test:** Executed with k6 (Docker). Results in `load-tests/REPORT.md` / `summary.json` — PASS, no double-booking, no 5xx.

**Payment:** Implemented with fail-closed behavior (no creds → safe errors). Ready for sandbox keys.

**Tests:** API memory tests 15/15 pass; PG tests 6/6 pass; typecheck passes (api/mobile/shared).

**Blockers:** None. System is fully implemented and verified.