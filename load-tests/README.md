# Load Tests — ReelPass

## 500-VU Seat-Contention Test

This load test validates that the PostgreSQL-backed booking engine maintains correctness under high concurrency. It simulates 500 virtual users competing for a limited pool of seats in the same showtime.

### Prerequisites

1. **Docker Desktop** running
2. **API running in Postgres mode**: `npm run dev:api` (with DATA_MODE=postgres, DB on 5455, Redis on 6385)
3. **Services healthy**: PostgreSQL and Redis containers up (check `docker ps`)

### Running the Test

From the project root:

```powershell
cd C:\Users\HP\Desktop\matinee
pwsh -File .\load-tests\run.ps1
```

With options:

```powershell
pwsh -File .\load-tests\run.ps1 -Vus 500 -Duration "20s" -PoolSize 40 -NumUsers 50 -Reset
```

Parameters:
- `-BaseUrl` (default: http://host.docker.internal:4000/api/v1)
- `-HealthBaseUrl` (default: http://localhost:4000/api/v1)
- `-ShowtimeId` (default: st-1)
- `-Vus` (default: 500)
- `-Duration` (default: 20s)
- `-PoolSize` (default: 40)
- `-NumUsers` (default: 50)
- `-Reset` — clears bookings and resets contested seats (local-only, never use on prod)

### What It Validates

- **No double-booking**: Exactly as many bookings created (201) as contested seats. Never more.
- **Correct conflict handling**: Losing requests receive 409 (seat already taken). These are expected.
- **No server errors**: 0 5xx responses under contention.
- **Concurrency correctness**: Redis atomic holds + PostgreSQL FOR UPDATE + unique constraints all enforced.
- **Latency**: p95 latency tracked against threshold (< 5000ms)

### Outputs

- Console summary with pass/fail and key metrics
- `load-tests/summary.json` — machine-readable results
- `load-tests/REPORT.md` — human-readable report with full details

### Correctness Gates

The test fails if:
- Any server error (5xx) occurs (`booking_errors > 0`)
- More bookings created than seats in the pool (`created > poolSize`) — indicates double-booking

Transport failures (network issues) are reported but the primary correctness signal is the booking error count and the created vs poolSize comparison.