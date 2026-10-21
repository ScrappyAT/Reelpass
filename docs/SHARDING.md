# ReelPass — Database Sharding and Scale-Out Strategy

**Project:** ReelPass (Matinee) cinema reservation application  
**Status:** Architecture proposal, **not an implemented sharded deployment**  
**Reviewed:** 21 October 2026

## 1. Current implementation

ReelPass currently uses a single logical PostgreSQL database, with Neon configured for the cloud database and PostgreSQL 16 used for local Docker testing. The Express/TypeScript API uses `pg` connection pooling, transactions, row-level `FOR UPDATE` locking, and unique constraints. Redis provides optional atomic seat holds; PostgreSQL is the final authority for seat availability. No database sharding, distributed SQL cluster, or partitioned multi-region booking deployment is implemented.

The local booking benchmark demonstrated **500 concurrent virtual users competing for 40 seats**, not a 500-node or 500-shard system. See `load-tests/REPORT.md` and `load-tests/summary.json`.

## 2. Why and when to shard

Sharding distributes records across separate databases when a single database cannot meet measured write throughput, storage, connection or latency requirements. It adds substantial complexity: distributed queries, cross-shard transactions, migrations, reporting, operational monitoring and failure recovery. ReelPass should first optimize its single PostgreSQL database before introducing sharding.

## 3. Recommended scaling sequence

1. **Measure:** monitor p50/p95/p99 request latency, PostgreSQL pool saturation, transaction lock wait, deadlocks, CPU, IOPS, database size and reservation conflict rate.
2. **Optimize queries:** use existing indexes on showtimes, bookings and per-showtime seats; review slow queries with `EXPLAIN (ANALYZE, BUFFERS)` in a safe environment.
3. **Control connections:** configure `PG_POOL_MAX` per API instance within Neon connection limits; consider supported pooling and bounded retries with idempotency keys.
4. **Cache safe reads:** cache movie/catalog information where appropriate; never treat Redis cache as the source of truth for sold seats.
5. **Consider native PostgreSQL partitioning:** if table sizes warrant it, partition append-heavy history or `showtime_seats`/`bookings` by a carefully selected key after validating uniqueness and query plans.
6. **Shard only after evidence:** adopt multiple logical databases when capacity testing demonstrates that the single-database design is insufficient.

## 4. Proposed shard key and routing

**Candidate: `cinema_id` or a stable cinema group/region.** Most booking transactions involve one showtime in one cinema, making this a potential locality boundary. An alternative is `showtime_id` for a very large event-oriented workload. The choice requires production query statistics; it is not yet finalized.

A future routing service would resolve a cinema/showtime to its owning shard, and all related `showtime_seats`, `bookings`, `booking_seats`, `tickets` and payment records would be co-located where feasible. A central directory would map cinema/showtime IDs to shards. Global user identities and movie metadata would require a separate ownership strategy or replicated read model.

**Critical invariant:** Every `(showtime_id, seat_id)` pair must have exactly one authoritative owner. Never independently accept bookings for the same showtime on multiple shards.

## 5. Concurrency and payment safety

Within each shard, retain the existing PostgreSQL transactional locking and uniqueness constraints. Redis Lua holds remain an optimization, not proof of sale. Payment verification must match the exact booking, amount, currency and transaction reference, and confirmations must be idempotent. Cross-shard reporting can be asynchronous, but seat allocation and payment confirmation must remain strongly consistent within the owning shard.

## 6. Data movement and recovery

If sharding is introduced, migrate cinemas/showtimes in controlled batches, freeze or drain new reservations during ownership cutover, reconcile booking and payment records, and switch routing atomically. Keep backups, audit trails, monitoring, rollback plans and restore drills. Avoid live dual writes for authoritative seat state unless an explicitly verified migration protocol exists.

## 7. Trade-offs

| Strategy | Benefit | Cost / risk | Status |
| --- | --- | --- | --- |
| Single PostgreSQL + indexes | Simple transactions and global constraints | Finite instance capacity | Implemented |
| Redis seat holds | Fast cross-instance contention rejection | Redis availability/TTL coordination | Implemented with DB-only fallback |
| Read caching | Reduces catalog traffic | Invalidation/staleness | Selective, not a guarantee for seat state |
| PostgreSQL partitioning | Smaller partitions, easier retention | Partition-key/constraint complexity | Proposed |
| Multi-database sharding | Independent scale domains | Routing, distributed analytics and operations | **Not implemented** |

## 8. Evidence and limitations

- `apps/api/src/db/pgStore.ts` — booking transaction and row-lock implementation.
- `apps/api/src/db/migrations/001_init.sql` and `002_flutterwave_payments.sql` — schema and indexes.
- `apps/api/src/redis/seatHolds.ts` — atomic Redis holds.
- `apps/api/src/db/pool.ts` — connection pooling and timeouts.
- `load-tests/REPORT.md` — local 500-VU test and SQL duplicate-seat verification.

**Deployment caveat:** Railway was unavailable during preparation. This document describes the implemented single-database design and a future scaling strategy, not a verified live sharded system.
