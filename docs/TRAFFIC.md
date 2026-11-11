# ReelPass — Traffic, Concurrency and Load Testing

This document describes the graduation candidate and its disposable local load test. [Graduation implementation](GRADUATION-IMPLEMENTATION.md) · [Staging checklist](RELEASE-CHECKLIST.md)

## 1. Traffic architecture

```text
Expo Android application
       |
       | HTTPS / JSON API calls
       v
Node.js / Express API (/api/v1)
       |-- Auth and read endpoints: movies, cinemas, showtimes
       |-- Booking endpoints: pending reservations and ticket history
       |-- Payment endpoints: checkout, webhook intake and status reads
       |
       +--> PostgreSQL (Neon for cloud deployment; local PostgreSQL for tests)
       |       Durable bookings, seat inventory, payments and constraints
       |
       +--> Redis
       |       Atomic holds, waiting room, rate limits and cache
       |
       +--> TMDB (when configured)
               Movie catalogue information

Separate BullMQ worker --> Redis + PostgreSQL + Flutterwave
```

The mobile client has read-only fallback catalogue data for movie/cinema browsing if the API cannot be reached. **Authentication, showtimes, seat availability, reservations and payments are not simulated offline.**

## 2. Handling concurrent seat requests

A showtime has finite seats. Many clients may attempt to reserve the same seat at once. Only one booking should succeed.

1. A Redis waiting room limits active users per showtime and admits the queue at a fixed rate. Defaults are 120 active places and 20 admissions per second. The app polls position every two seconds while queued.
2. The admitted client requests `POST /api/v1/bookings` with the showtime ID and selected seat IDs. Redis uses `SET NX` in an all-or-nothing Lua script with a five-minute default TTL. Per-account and per-IP budgets protect hold, checkout and search.
3. PostgreSQL remains the **durable source of truth**. Booking transactions lock relevant seat rows using `FOR UPDATE`, with ordered locking to reduce deadlock risk.
4. Database uniqueness constraints and transaction validation prevent duplicate seat allocation.
5. The winning request returns **HTTP 201** with a **pending** reservation; a conflicting attempt returns **HTTP 409** rather than creating a second booking.
6. The worker sweeps stale reservations and handles webhook verification and ticket settlement. The durable event and booking state is read from the primary.

New holds and admission fail safely when the required Redis connection is unavailable. The app shows a retry path. Static seat geometry can be cached for 30 minutes. The app polls current availability every five seconds after admission to keep updates simple over mobile networks. Mutable seat inventory, payment status and user tickets come from the primary database.

## 3. API and connection management

- Express serves routes under `/api/v1`; the health endpoint is also available at `/health`.
- PostgreSQL connections are pooled. The code defaults to a pool maximum of **20 for remote/cloud databases** and **100 locally**, configurable through `PG_POOL_MAX`.
- The code sets a PostgreSQL connection acquisition timeout of **30 seconds** and configurable statement/query timeouts (60 seconds by default).
- The Node server is configured with a TCP listen backlog of **2,048**, a maximum of **10,000 connections**, and a **65-second keep-alive timeout**. These are configuration values, **not demonstrated throughput guarantees**.
- The separate worker uses BullMQ and persists verification and refund state in PostgreSQL. An optional read endpoint serves stable cinema metadata while reservation and payment reads use the primary.

## 4. Recorded 500-user / 50-seat contention test

Recorded on November 11, 2026 against disposable PostgreSQL 16 and Redis 7. Native k6 released 500 distinct synthetic accounts against the same 50 seats.

| Metric | Recorded result |
|---|---:|
| Concurrent virtual users | 500 |
| Contested seats | 50 |
| Successful holds (HTTP 201) | 50 |
| Expected seat conflicts (HTTP 409) | 450 |
| Duplicate seat claims | 0 |
| Unexpected responses | 0 |
| Unexpected server errors | 0 |
| Transport drops (status 0) | 0 |
| Average request latency | 1,066.6 ms |
| p95 request latency | 1,453.8 ms |
| Test outcome | PASS |

The HTTP 409s were the expected outcomes for unavailable seats. The SQL check found 50 held bookings and zero duplicate seat claims. The earlier 40-seat test is preserved in the [October report](../load-tests/REPORT.md). [Graduation report](../load-tests/GRADUATION-500X50.md) · [Raw results](../load-tests/graduation-500x50-result.json)

## 5. How to reproduce the local test

From the repository root, with Docker Desktop and native k6 available:

```powershell
pwsh -NoProfile -File scripts/test-isolated.ps1 -Load -K6Executable <path-to-k6.exe>
```

The runner creates disposable database and Redis containers, binds the API to loopback and uses synthetic accounts with payment disabled. The assessment run raises the admission budget so all 500 users can contend for inventory at the same time.

## 6. Operational checks before submission

- [x] Local 500-VU contention test recorded as passing.
- [x] PostgreSQL SQL verification recorded for duplicate seat/ticket detection.
- [x] Pending bookings, expected 409 conflicts and payment confirmation are distinguished in the architecture.
- [ ] Verify the candidate on an approved staging host.
- [ ] Verify `/api/v1/health` reports PostgreSQL connectivity and expected database state.
- [ ] Confirm Redis readiness and the worker's startup signal.
- [ ] Test real Android-to-API reservation creation and expired holds.
- [ ] Execute Flutterwave **sandbox** checkout, cancellation, verification and confirmed QR-pass flows end to end.
- [ ] Run a modest deployment-specific smoke/load test **only with authorization and within hosting limits**; do not assume the local 500-VU result applies to a free cloud instance.

## 7. Evidence and implementation references

- [k6 script](../load-tests/graduation-500x50.js)
- [Reservation endpoint](../apps/api/src/routes/booking.routes.ts) and [Redis seat holds](../apps/api/src/redis/seatHolds.ts)
- [Admission and rate limits](../apps/api/src/services/traffic.ts)
- [Background job schedule](../apps/api/src/queue/index.ts)
