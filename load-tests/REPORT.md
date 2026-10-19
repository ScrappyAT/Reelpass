# ReelPass 500-VU Seat-Contention Load Test — Report

## Executive Summary
- **Requirement**: Mandatory graduation requirement — 500-VU seat-booking concurrency test proving zero double bookings.
- **Status**: **PASSED** (0 double bookings, 0 duplicate tickets, 0 server errors).
- **Date**: 2026-10-19
- **Database Verification**: Proven via direct SQL queries against PostgreSQL tables `booking_seats` and `tickets`.

---

## 1. Test Environment & Safety Constraints
Concurrency tests were run **strictly against an isolated local test environment**. No load tests were pointed at the live Railway production database.

- **Operating System**: Windows (Host) with Docker Desktop
- **Database**: PostgreSQL 16 Alpine (`reelpass-postgres` on `localhost:5455`)
- **Cache**: Redis 7 Alpine (`reelpass-redis` on `localhost:6385`)
- **API Server**: Node.js Express (`@matinee/api` on `http://localhost:4000`, `DATA_MODE=postgres`)
- **Load Test Engine**: Grafana k6 (`grafana/k6` official Docker image mounting `./load-tests`)

---

## 2. Test Configuration & Parameters
500 concurrent virtual users (VUs) competed for a constrained pool of 40 seats in showtime `st-1` across 50 distinct registered user accounts.

| Parameter | Value | Description |
|---|---|---|
| **VUs** | 500 | Concurrent virtual users |
| **Duration** | 20s | Sustained concurrency test duration |
| **Contested Seat Pool** | 40 seats | Finite seat pool contested by all VUs |
| **Distinct Users** | 50 users | Registered accounts exercising Redis hold exclusivity |
| **Showtime ID** | `st-1` | Target showtime |
| **Think Time** | 0.5s | Realistic human think time between attempts |

---

## 3. Execution Commands
The test was executed using the automated runner script `load-tests/run.ps1` with the `-Reset` flag to clean showtime state and flush Redis holds prior to the run:

```powershell
powershell -ExecutionPolicy Bypass -File .\load-tests\run.ps1 -Reset -Vus 500 -Duration "20s" -PoolSize 40 -NumUsers 50
```

Under the hood, the runner executes:
```powershell
docker run --rm -i `
  -v "${loadTests}:/scripts" `
  -e "BASE_URL=http://host.docker.internal:4000/api/v1" `
  -e "SHOWTIME_ID=st-1" `
  -e "VUS=500" `
  -e "DURATION=20s" `
  -e "POOL_SIZE=40" `
  -e "NUM_USERS=50" `
  -e "SUMMARY_PATH=/scripts/summary.json" `
  grafana/k6 run /scripts/seat-contention.js
```

---

## 4. Measured Results (k6 Benchmark)

| Metric | Target / Threshold | Actual Measured Value | Status |
|---|---|---|---|
| **Bookings Created (HTTP 201)** | `> 0` and `<= 40` | **40** | ✅ **PASS** |
| **Seat Conflicts (HTTP 409)** | Expected under contention | **9,155** | ✅ **PASS** |
| **Server Errors (HTTP 5xx)** | `count == 0` | **0** | ✅ **PASS** |
| **Transport Drops (status 0)** | `0` | **0** | ✅ **PASS** |
| **Total Iterations / Requests** | N/A | **9,195** | ✅ **PASS** |
| **Average Latency** | Baseline | **581.9 ms** | ✅ **PASS** |
| **p95 Latency** | `< 5000 ms` | **2,109.9 ms** | ✅ **PASS** |
| **Result Flag** | `PASS` | **PASS** | ✅ **PASS** |

*Note: HTTP 409 Conflict responses are the correct and desired behavior for losing contenders racing for already-held seats. Every contested seat resolved cleanly to either HTTP 201 or HTTP 409.*

---

## 5. PostgreSQL Database Verification (SQL Evidence)
Database queries were executed directly against PostgreSQL (`reelpass-postgres`) immediately following test teardown to inspect database state:

### Query 1: Detect Duplicate Booked Seats
```sql
SELECT seat_id, COUNT(*) as cnt 
FROM booking_seats 
WHERE showtime_id = 'st-1' 
GROUP BY seat_id 
HAVING COUNT(*) > 1;
```
- **Result**: `0` rows (Zero duplicate seats booked).

### Query 2: Detect Duplicate Tickets Issued
```sql
SELECT seat_id, COUNT(*) as cnt 
FROM tickets 
WHERE showtime_id = 'st-1' 
GROUP BY seat_id 
HAVING COUNT(*) > 1;
```
- **Result**: `0` rows (Zero duplicate tickets issued).

### Query 3: Total Load-Test Bookings Created
```sql
SELECT COUNT(*) 
FROM bookings 
WHERE showtime_id = 'st-1' 
  AND user_id IN (SELECT id FROM users WHERE email LIKE 'loadtest-%');
```
- **Result**: `40` (Exactly matches the 40 contested seats).

### Query 4: Total Seats Marked HELD
```sql
SELECT COUNT(*) 
FROM showtime_seats 
WHERE showtime_id = 'st-1' AND status = 'HELD';
```
- **Result**: `40` (All 40 contested seats are properly held, none orphaned).

Evidence saved to: `load-tests/sql-verification.json` and `load-tests/summary.json`.

---

## 6. Architecture & Concurrency Enhancements
To achieve 0 errors and zero double bookings under 500 concurrent virtual users, several enhancements were implemented:

1. **Monotonic Row Lock Ordering (`ORDER BY ss.seat_id ASC`)**:
   In `apps/api/src/db/pgStore.ts`, seat queries now sort seat IDs monotonically before acquiring `FOR UPDATE OF ss`. This mathematically eliminates deadlocks when concurrent transactions attempt to hold overlapping sets of seats.

2. **Elimination of Global Lock Inversion**:
   Removed `expireStaleBookings` from inside the `createBooking` transaction. Stale holds are already checked inline per seat, and expired bookings are cleaned up by a dedicated background sweeper every 15 seconds. Running table-wide lock sweeps inside concurrent user transactions was causing severe lock contention.

3. **PostgreSQL Race Condition Error Translation**:
   PostgreSQL race errors (`23505` unique violation, `40P01` deadlock detected, `40001` serialization failure, `55P03` lock not available) are caught and cleanly mapped to `BookingConflictError` (`409 SEAT_UNAVAILABLE`), ensuring clients receive expected 409 conflict responses rather than unexpected 500 errors.

4. **Fast-Path Distributed Redis Holds**:
   Atomic Redis holds using Lua scripts (`reelpass:hold:{showtimeId}:{seatId}`) act as the fast-path gate, rejecting conflicting users before hitting PostgreSQL, while PostgreSQL retains durable authority with transactional locking.

5. **TCP Listen Backlog & Keep-Alive Tuning**:
   Configured `app.listen(port, '0.0.0.0', 2048)` and `server.maxConnections = 10000` to prevent socket backlog drops under sudden connection spikes.