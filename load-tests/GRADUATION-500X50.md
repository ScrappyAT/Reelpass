# Matinee graduation benchmark: 500 users, 50 seats

**Local result: pass.** 500 distinct test accounts each sent one reservation request. Every user targeted one seat in the same 50-seat showtime (ten attempts per seat). The requests shared a time barrier and dispatched within 38 ms of it.

| Measured result | Value |
| --- | ---: |
| Requests | 500 |
| Pending reservations / HTTP 201 | 50 |
| Expected seat conflicts / HTTP 409 | 450 |
| Transport errors, 5xx or admission/rate rejections | 0 each |
| Mean hold response time | 1,066.6 ms |
| p95 hold response time | 1,453.8 ms |
| PostgreSQL held seats | 50 |
| Duplicate seat claims in PostgreSQL | 0 |
| Tickets or payment captures | 0 |

Request results showed 50 successes and 450 expected seat conflicts. The SQL checks in the runner independently verified 50 held seats with one claim per seat. No ticket or capture was expected in a holds-only test. The payment regression suite separately checks ticket and capture uniqueness.

Native k6 2.3.0 used loopback, with a fresh PostgreSQL 16 and Redis 7 in Docker. Each VU warmed one connection before the barrier, like customers already browsing a seating chart. Initial runs that opened hundreds of connections at once hit local connection refusals; they preserved unique claims but did not pass. The final run measures seat contention over established connections.

The test uses 500 active places, 500 admissions per second, and a tenfold IP budget because all accounts share loopback. This sends all 500 hold attempts through the booking engine. It does not benchmark hosted capacity or the production waiting-room policy. The integration suite independently checks the waiting-room ordering and rate limiting.

- [k6 script](graduation-500x50.js)
- [Saved result](graduation-500x50-result.json)
- [Disposable runner](../scripts/test-isolated.ps1)
- [SQL checks and fixture](../apps/api/src/tests/pg/run-load.ts)
- [Historical October 40-seat benchmark](REPORT.md)
