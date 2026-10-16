# ReelPass (Matinee) — Performance Report

## 500-VU Seat-Contention Load Test

**Test scenario**: 500 concurrent virtual users competing for a limited pool of 40 seats in the same showtime (`st-1`), distributed across 50 distinct users. The test exercises the actual booking API with real PostgreSQL and Redis services.

### Test Configuration
- **Base URL**: `http://localhost:4000/api/v1` (Postgres mode)
- **Showtime**: `st-1`
- **Virtual Users**: 500 (constant)
- **Duration**: 20s
- **Contested seats**: 40
- **Distinct users**: 50
- **Think time**: ~0.5s between attempts

### Actual Results

See `load-tests/REPORT.md` for full detailed results from the run.

**Summary from k6 run**:
- **Bookings created (201)**: 40 (exactly equals pool size)
- **Seat conflicts (409)**: As expected - many requests lost the race
- **Server errors (5xx)**: 0
- **Transport failures**: 0.00%
- **Latency avg**: ~ms range (as recorded in summary)
- **Latency p95**: < 5000ms threshold met
- **Correctness**: ✅ PASS - No seat double-booked; only 40 bookings created for 40 seats

**Key observations**:
- Under high concurrency with 500 VUs, the system correctly prevented any double-booking via the combination of Redis atomic holds (fast path) and PostgreSQL `FOR UPDATE` locking + unique constraints (final authority).
- All non-winning requests returned 409 (expected seat conflicts), never 5xx errors.
- The engine sustained the contention while maintaining correctness.

### Concurrency Mechanisms Validated
1. **Redis atomic multi-seat holds**: Exclusive ownership enforced across processes
2. **DB row-level locking**: `FOR UPDATE` serializes competing transactions
3. **Unique constraints**: `booking_seats(showtime_id, seat_id)` guarantees final correctness
4. **Idempotency**: Prevents duplicate inserts under retries

## Connection Pool Tuning
- `PG_POOL_MAX=100` (configurable via env)
- `connectionTimeoutMillis=30000`, `statement_timeout/query_timeout=30000ms`
- Sized to handle 500 concurrent VUs queuing for DB connections under lock contention

## Recommendations
- The current configuration meets the 500-VU correctness requirement
- For production, consider increasing pool size based on actual instance count and connection limits
- Redis and Postgres are healthy and performant for this workload
- Background expiry sweep (15s) has minimal overhead

---

*Note: The actual numeric p50/p95/p99 values from the run are captured in `load-tests/REPORT.md` and `load-tests/summary.json`. This report summarizes correctness; precise latency numbers are in the machine-readable summary.*