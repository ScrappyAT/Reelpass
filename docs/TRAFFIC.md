# ReelPass — Traffic, Concurrency and Load Testing

**Project:** ReelPass (Matinee graduation project)  
**Evidence reviewed:** GitHub repository `ScrappyAT/Reelpass`, including `load-tests/REPORT.md`, `load-tests/seat-contention.js`, `load-tests/summary.json`, and API implementation.  
**Scope:** Describes implemented request handling and previously recorded **local** test results. It does **not** assert that the currently unavailable Railway deployment is healthy.

## 1. Traffic architecture

```text
Expo Android application
       |
       | HTTPS / JSON API calls
       v
Node.js / Express API (/api/v1)
       |-- Auth and read endpoints: movies, cinemas, showtimes
       |-- Booking endpoints: pending reservations and ticket history
       |-- Payment endpoints: Flutterwave checkout and verification
       |
       +--> PostgreSQL (Neon for cloud deployment; local PostgreSQL for tests)
       |       Durable bookings, seat inventory, payments and constraints
       |
       +--> Redis (when available)
       |       Atomic short-lived seat holds; BullMQ infrastructure
       |
       +--> TMDB (when configured)
               Movie catalogue information
```

The mobile client has read-only fallback catalogue data for movie/cinema browsing if the API cannot be reached. **Authentication, showtimes, seat availability, reservations and payments are not simulated offline.**

## 2. Handling concurrent seat requests

A showtime has finite seats. Many clients may attempt to reserve the same seat at once; only one booking should succeed.

1. The authenticated client requests `POST /api/v1/bookings` with a showtime ID and selected seat IDs.
2. In PostgreSQL mode, an available Redis connection allows the API to acquire short-lived, atomic Lua-script seat holds as an early contention gate. The configured hold TTL defaults to **300 seconds (5 minutes)**.
3. PostgreSQL remains the **durable source of truth**. Booking transactions lock relevant seat rows using `FOR UPDATE`, with ordered locking to reduce deadlock risk.
4. Database uniqueness constraints and transaction validation prevent duplicate allocation even if Redis is unavailable.
5. The winning request returns **HTTP 201** with a **pending** reservation; a conflicting attempt returns **HTTP 409** rather than creating a second booking.
6. A background sweeper runs approximately every **15 seconds** to expire stale pending reservations and release inventory.
7. Payment confirmation is a separate step. Flutterwave transactions must be verified server-side before a booking is marked confirmed and a QR admission pass is presented.

**Failure handling:** Redis is an optimization rather than the final booking authority. PostgreSQL mode must not silently fall back to an in-memory database when the configured PostgreSQL connection is unavailable.

## 3. API and connection management

- Express serves routes under `/api/v1`; the health endpoint is also available at `/health`.
- PostgreSQL connections are pooled. The code defaults to a pool maximum of **20 for remote/cloud databases** and **100 locally**, configurable through `PG_POOL_MAX`.
- The code sets a PostgreSQL connection acquisition timeout of **30 seconds** and configurable statement/query timeouts (60 seconds by default).
- The Node server is configured with a TCP listen backlog of **2,048**, a maximum of **10,000 connections**, and a **65-second keep-alive timeout**. These are configuration values, **not demonstrated throughput guarantees**.
- A BullMQ worker can start when Redis is available; the reviewed ticket-processing job handler is presently a placeholder. Do not describe that handler as a complete production ticket-delivery pipeline.

## 4. Recorded 500-virtual-user contention test

**Date recorded:** 19 October 2026  
**Environment:** isolated Windows/Docker local stack; PostgreSQL 16, Redis 7, Node/Express API, Grafana k6.  
**Scenario:** 500 concurrent virtual users, 50 distinct user accounts, 40 contested seats, 20-second duration, and 0.5-second think time.

| Metric | Recorded result |
|---|---:|
| Concurrent virtual users | 500 |
| Contested seats | 40 |
| Successful pending bookings (HTTP 201) | 40 |
| Expected seat conflicts (HTTP 409) | 9,155 |
| Unexpected server errors | 0 |
| Transport drops (status 0) | 0 |
| Average request latency | 581.9 ms |
| p95 request latency | 2,109.9 ms |
| Test outcome | PASS |

**Interpretation:** 409 responses are expected when multiple users compete for the same seat. They are not application failures. The local report records no duplicate seat allocations and no duplicate tickets, supported by SQL verification saved in `load-tests/sql-verification.json`.

**Metric caveat:** `summary.json` reports `transportFailureRate` near 0.99, while also reporting **zero** `transportDrops`. The script obtains that percentage from k6's `http_req_failed`, which includes expected HTTP 409 conflicts. Consequently, **do not interpret the 0.99 value as a 99% network failure rate**. The script's label is misleading; the transport-drop counter is the appropriate network-drop indicator here.

The load test proves a specific **local seat-contention correctness scenario**. It does not establish production uptime, full payment throughput, broad geographic latency, or Railway/Neon capacity at 500 users.

## 5. How to reproduce the local test

From the repository root, with Docker Desktop running and the API connected to the isolated local PostgreSQL/Redis stack:

```powershell
docker compose up -d
npm.cmd run build:shared
npm.cmd run dev:api
```

In a second terminal:

```powershell
pwsh -File .\load-tests\run.ps1 -Vus 500 -Duration "20s" -PoolSize 40 -NumUsers 50 -Reset
```

The `-Reset` flag changes test data. **Run only against the disposable local test environment, never the live Neon database or production deployment.** The k6 runner uses the official `grafana/k6` Docker image and writes results to `load-tests/summary.json`.

## 6. Operational checks before submission

- [x] Local 500-VU contention test recorded as passing.
- [x] PostgreSQL SQL verification recorded for duplicate seat/ticket detection.
- [x] Pending bookings, expected 409 conflicts and payment confirmation are distinguished in the architecture.
- [ ] Restore or replace the unavailable Railway API deployment.
- [ ] Verify `/api/v1/health` reports PostgreSQL connectivity and expected database state.
- [ ] Confirm Redis connectivity or explicitly document PostgreSQL-only fallback behavior in the deployed environment.
- [ ] Test real Android-to-API reservation creation and expired holds.
- [ ] Execute Flutterwave **sandbox** checkout, cancellation, verification and confirmed QR-pass flows end to end.
- [ ] Run a modest deployment-specific smoke/load test **only with authorization and within hosting limits**; do not assume the local 500-VU result applies to a free cloud instance.

## 7. Evidence and implementation references

- [`load-tests/REPORT.md`](https://github.com/ScrappyAT/Reelpass/blob/main/load-tests/REPORT.md) — recorded load-test report and SQL validation.
- [`load-tests/summary.json`](https://github.com/ScrappyAT/Reelpass/blob/main/load-tests/summary.json) — machine-readable test metrics.
- [`load-tests/seat-contention.js`](https://github.com/ScrappyAT/Reelpass/blob/main/load-tests/seat-contention.js) — k6 test logic.
- [`apps/api/src/routes/booking.routes.ts`](https://github.com/ScrappyAT/Reelpass/blob/main/apps/api/src/routes/booking.routes.ts) — reservation endpoint and Redis fast path.
- [`apps/api/src/db/pgStore.ts`](https://github.com/ScrappyAT/Reelpass/blob/main/apps/api/src/db/pgStore.ts) — PostgreSQL transaction and concurrency implementation.
- [`apps/api/src/redis/seatHolds.ts`](https://github.com/ScrappyAT/Reelpass/blob/main/apps/api/src/redis/seatHolds.ts) — Redis Lua seat holds.
- [`apps/api/src/index.ts`](https://github.com/ScrappyAT/Reelpass/blob/main/apps/api/src/index.ts) — startup, expiry sweep and server tuning.

---

**Deployment status at preparation:** Railway unavailable. The results above are historical, local test evidence and are not a claim of current production availability.
