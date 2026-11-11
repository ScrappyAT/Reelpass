# ReelPass graduation implementation

**Verification:** November 11, 2026 (WAT). Branch `codex/matinee-graduation-payments`. October APK and transaction evidence describe the previous release. See the [release checklist](RELEASE-CHECKLIST.md) for the migration rehearsal, startup verification and outstanding hosted checks.

| Assessment requirement | What this branch implements |
| --- | --- |
| Trusted payment verification | Only a worker can settle a booking. It verifies the Flutterwave transaction ID, reference, exact kobo amount, currency and status against the stored payment and its booking owner. Checkout callbacks, status recovery and the legacy confirm endpoint report stored state only. |
| Checkout idempotency and single settlement | A user-scoped checkout key, one managed checkout per reservation, a unique transaction capture and a unique booked capture per reservation. Checkout is reserved before the provider call. Concurrent requests reuse the same link; an ambiguous response does not trigger another checkout POST. |
| Verified webhook in a background job | Flutterwave v3 secret comparison, durable deduplication in PostgreSQL, and BullMQ dispatch from an independent worker. The database acknowledgement and event processing are separate. Retries back off and stop after five attempts. Events that fail or are rejected are visible at the administrator-only `GET /api/v1/payments/admin/workflow`. |
| Holds, tickets and refunds | Failed payments, explicit abandonment and expired holds release inventory. Tickets are created in the settlement transaction. Admin showtime cancellation preserves historical ticket/payment rows and writes refund intents plus an append-only status ledger. Late or extra captures queue refunds without issuing another ticket. |
| Refund safety | A send fence is committed before the sandbox refund POST. On timeout or crash the worker only looks up the refund; it never resends an ambiguous POST. Missing or mismatched records go to review. The worker treats v3 `completed` as pending disbursement. |
| Fees and showtimes | ₦150 service fee per booking by default, calculated and stored in integer kobo; mobile shows it before checkout. The showtime planner can preview and add up to seven days of demo screenings, with new IDs and seat inventory. It leaves existing screenings, bookings and payments intact. |
| Traffic and availability | Redis `SET NX` inside an atomic multi-seat hold, account/IP rate limits, and a FIFO waiting room. Defaults: 120 active places per showtime, 20 admissions per second. Mobile polls position every 2 seconds while queued and availability every 5 seconds after admission. Static geometry caches for 30 minutes; live inventory and payment state use the primary database. |
| Read routing and observability | An optional replica pool serves stable cinema metadata. Checkout, booking, seat availability and all reads after a write use the primary. Request and job logs include outcome and correlation identifiers. Mobile/server error tracking with an external service remains open. |
| Mobile usability | Payment confirmation has a pending state, a status check and a release action. Seat targets are at least 44×44; selection and confirmation use Reanimated. The previous render-time ticket lint errors are fixed. Device and screen-reader checks remain open. |

The v3 behavior follows [Flutterwave webhook delivery and verification](https://developer.flutterwave.com/docs/webhooks), [transaction verification](https://developer.flutterwave.com/reference/verify-transaction), and [refund status and reconciliation](https://developer.flutterwave.com/docs/refunds). When an existing booking lacks a trustworthy provider transaction, cancellation records a review entry and does not invent a refund.

## Verification

- `npm run build`, `npm run typecheck`: passed. Mobile ESLint: **0 errors, 0 warnings**.
- Memory API suite: **42 passed, 1 skipped, 0 failed**. The skipped live Redis check was exercised against the disposable Redis instance instead.
- Disposable PostgreSQL 16 and Redis 7: **23 passed, 0 failed**. Tests use mocked gateway responses. They verify mismatches, ownership, replay across bookings, concurrent success, extra captures, expired holds, refund timeouts, waiting-room ordering, both rate limits, additive showtime refresh, and compiled API/worker startup both independently and through the staging launcher.
- Schema-only rehearsal: **1 passed, 0 failed**. Migration 003 preserved representative historical rows in the disposable copy of the existing schema.
- [500-user / 50-seat report](../load-tests/GRADUATION-500X50.md) and [machine-readable results](../load-tests/graduation-500x50-result.json).

To reproduce the isolated suites:

```powershell
pwsh -NoProfile -File scripts/test-isolated.ps1
pwsh -NoProfile -File scripts/test-isolated.ps1 -Upgrade
pwsh -NoProfile -File scripts/test-isolated.ps1 -Load -K6Executable <path-to-k6.exe>
```

The script creates random loopback ports, a uniquely named database and temporary container storage. It cleans up only the containers it created. The load runner binds the API to loopback and disables payment credentials.

## Release handoff

- After approval, verify the exact hosted staging schema and apply the reviewed migration explicitly. API and worker startup requires the payment schema. See the [deployment and calendar checklist](RELEASE-CHECKLIST.md#deployment-and-calendar).
- Start the API with `npm run start --workspace=@matinee/api` and the worker with `npm run start:worker --workspace=@matinee/api`. Configure the same PostgreSQL and Redis services for both. Verify trusted proxy hops before enabling IP-based limits behind the deployment proxy.
- Configure Flutterwave **sandbox** keys, the v3 webhook secret, delivery retries and the stage-specific HTTPS callback. Exercise checkout, worker settlement, cancellation/refund and the QR pass on a device. The mocked tests do not establish provider delivery or refund behavior in the hosted sandbox.
- Preview the calendar using `npm run showtimes:plan --workspace=@matinee/api`. Use `showtimes:apply` only against the approved target. The current hosted catalog was left unchanged.
- Renew the expired Android artifact after approval. Recheck the demo video, Figma coverage, full accessibility and TMDB attribution/outage evidence before marking the submission complete. The historical physical-device test does not verify this branch.
