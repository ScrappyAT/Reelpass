# ReelPass graduation release checklist

Candidate branch `codex/matinee-graduation-payments`. Requirements are from the Final Graduation Task PDF, shared rules on pages 14–16, Matinee on pages 21–24, and submission evidence on pages 25 and 34. The [implementation report](GRADUATION-IMPLEMENTATION.md) maps the completed work.

## Verification recorded November 11, 2026

| Check | Result |
| --- | --- |
| Migration 003 on existing schema | **Passed.** Restored a schema-only dump from the local 001/002 database into disposable PostgreSQL 16. Preserved all original fields in two synthetic bookings, four payments across four statuses, one historical screening, its inventory, a booking seat and a ticket. Checked constraints and default values. Rerunning applied zero migrations. The source had 153 bookings and zero payment rows. |
| Additive showtimes | **Passed.** In the same disposable copy, preview left the data identical. Apply added six future screenings, November 12–17 WAT, and 12 seat rows. A second apply added zero. Historical rows matched the pre-upgrade snapshot. The public October Railway API returned HTTP 200 and 336 showtime records, with zero future showtimes. |
| Runtime and regression | **Passed.** Build and TypeScript passed. API memory suite had 42 passes, one live-Redis skip and zero failures. Disposable PostgreSQL and Redis suite had 23 passes and zero failures, including both compiled processes starting independently and through the staging launcher. Payment tests use mocked provider responses. |
| Android build inputs | **Passed locally.** Aligned six packages to Expo SDK 57 patch versions. Online `expo install --check` passed, mobile lint reported zero findings, and the Android Hermes bundle contained the supplied test staging URL. The staging hook rejected an unset URL and the existing Railway host. EAS resolved the internal APK profile with the correct project and package. The preview environment had no public staging URL configured. |
| Dependency advisories | `npm audit --package-lock-only --omit=dev` reported 9 affected entries, including 5 high and 0 critical, down from 17 entries and 7 high in the previous lockfile. All five high entries also appeared in the baseline. Review the remaining Express/body-parser, Zod and Expo Router dependency findings before a public rollout. |
| Exact seat-contention evidence | **Passed in the recorded local run.** 500 users, 50 seats, 50 holds, 450 expected HTTP 409s, zero duplicates and zero unexpected, transport or server errors. Mean 1,066.6 ms and p95 1,453.8 ms. [Report](../load-tests/GRADUATION-500X50.md) · [raw results](../load-tests/graduation-500x50-result.json) |

Reproduce the database checks from the repository root:

```powershell
pwsh -NoProfile -File scripts/test-isolated.ps1 -Upgrade
pwsh -NoProfile -File scripts/test-isolated.ps1
```

## No-upgrade staging arrangement

Use one **Render Free web service** for a scheduled demo. Its launcher starts the compiled API and worker as separate Node processes and exits if either dies. Render Free sleeps after 15 minutes without inbound traffic and can take about a minute to wake. Warm it before opening the app. Treat Redis restarts as a demo interruption and recheck the hold and queue state. Free Render Key Value is ephemeral. [Render Free](https://render.com/docs/free) · [Render Key Value](https://render.com/docs/key-value)

Use a **separate Neon Free project** with a synthetic catalog and a separate **Render Key Value** instance on the private network, in the same region as the web service. Select `noeviction` and verify it before checkout. Keep staging and Railway Redis endpoints distinct because the queue name is shared and logical database suffixes are ignored. PostgreSQL stores the webhook inbox, capture records and refund ledger across restarts. The worker polls every two seconds while awake, which consumes Neon compute. [Neon Free limits](https://neon.com/docs/introduction/plans) · [BullMQ connections](https://docs.bullmq.io/guide/connections)

The existing Railway API remains the October release backed by the documented Neon and Redis Cloud services. The Railway CLI is signed out, and the browser review stopped when the tool could not verify the current URL. Existing Render and Neon resources, regions, free quota and spending settings remain unverified. Confirm free capacity in all three dashboards before provisioning. Railway's public Free allowance is $1 per month. Use separate Railway services only if the dashboard shows enough credit for both, in a staging environment. An always-on deployment has not been established within the free quotas. [Railway Free allowance](https://docs.railway.com/pricing/free-trial)

## Deployment and calendar

1. Approve and identify the exact staging project, PostgreSQL database, Redis instance and public hostname. Confirm billing and spend limits. Use an isolated database role and run the migration once from a trusted operator shell with the direct Neon URL and certificate verification. Check the target and applied migration names first. On an existing staging copy, review the schema and backup/restore option, record counts for screenings, bookings, payments and tickets, and repeat the counts after migration. Stop if additional unapplied migrations besides `003_payment_workflow.sql` appear on a legacy copy. On a fresh staging database, use the setup command to create the schema and demo catalog.

   ```bash
   npm ci --include=dev
   npm run build
   npm run db:migrate:prod --workspace=@matinee/api
   ```

   On an empty, dedicated staging database, use `npm run db:setup:prod --workspace=@matinee/api` in place of the migration-only command.

2. Preview the Lagos-time calendar. Apply it to the approved staging database and confirm future screenings and seat inventory through the API. The planner derives slots from the demo catalog, skips overlaps and inserts deterministic new IDs. Rerun the preview before each review session. Apply again when the calendar needs extending.

   ```bash
   npm run showtimes:plan --workspace=@matinee/api
   npm run showtimes:apply --workspace=@matinee/api
   ```

3. Configure the host's build command as `npm ci --include=dev && npm run build` and select the tested Node 24 release line. Render start command is `npm run start:staging`. For separate services, use `npm start` for the API and `npm run start:worker --workspace=@matinee/api` for the worker. Configure `/api/v1/health` for the API and use worker startup and job logs for the worker.

   | Setting | Staging value |
   | --- | --- |
   | `NODE_ENV`, `DATA_MODE`, `PORT`, `API_PREFIX` | `production`, `postgres`, host-injected port for the API, `/api/v1` |
   | `DATABASE_URL`, `PG_POOL_MAX`, `DATABASE_READ_URL` | Same isolated, TLS-verified pooled Neon endpoint for both runtime processes. Start with five connections per process for the demo. Leave read replica blank unless a separate endpoint is verified. |
   | `REDIS_URL`, `REDIS_TLS` | Same isolated Redis-compatible TCP endpoint for both. Use the host's internal URL for private Render Key Value, or `rediss://` and strict TLS for an external endpoint. |
   | `JWT_SECRET`, `TRUST_PROXY_HOPS` | Independent random secret of at least 32 characters. Verify the actual forwarding chain with a trusted test client before setting the proxy hop count and exercising per-IP limits. |
   | `FLW_SECRET_KEY`, `FLW_SECRET_HASH` | Keep both empty for the first deployment. After sandbox approval, share a `FLWSECK_TEST-` key and v3 webhook secret with the API and worker through host secrets. |
   | `FLW_CALLBACK_URL`, `FLW_CURRENCY`, `SERVICE_FEE_KOBO` | Explicit `https://<staging-host>/api/v1/payments/callback`, `NGN`, `15000`. |
   | `TMDB_API_KEY`, `CORS_ORIGIN` | Optional server-only TMDB key for the integration test. Set the allowed origin when testing a web client. |

4. Verify `/api/v1/health` returns 200, `dataMode=postgres`, and `services.redis.verified=true`. Check for `payment_worker_ready` in logs and a staging-only waiting-room and hold smoke test. HTTP readiness alone establishes PostgreSQL connectivity. Confirm `/api/v1/payments/status` reports payment disabled before provider configuration. To recover from a bad staging deployment, stop its worker and revert the staging application build. Keep the additive schema and retain all ledger and queue evidence.

## Controlled Flutterwave sandbox

Run this after the staging and provider approvals. First confirm test mode, dedicated test users, exact callback and webhook addresses, and that changing the sandbox webhook will not redirect a shared test integration. Register `https://<staging-host>/api/v1/payments/webhook`, use the v3 `verif-hash` convention, and enable provider retries. Redact tokens, keys, headers and personal data from captured evidence. [Webhook delivery](https://developer.flutterwave.com/docs/webhooks) · [Transaction verification](https://developer.flutterwave.com/reference/verify-transaction)

| Scenario | Evidence to capture |
| --- | --- |
| Checkout and retry | Hold one test seat and verify the displayed total and server fee in kobo. Repeat initialization with the same key and confirm a single reference and checkout link. Complete one sandbox payment for the lifecycle. |
| Signed delivery and ticket | Confirm the browser callback returns to the app. Use the provider delivery log, worker event and booking status to establish the order: persisted webhook, worker verification, then one confirmed booking and QR ticket. With the worker stopped briefly, the callback/status stays pending until the worker resumes. |
| Duplicate and unrelated booking | Redeliver the same sandbox event through the provider tooling if available. Confirm one capture and one ticket. Use a second unpaid booking to confirm that presenting the first transaction does not confirm it. Local mocked tests cover altered amount, currency, reference, status, ownership and invalid signature. |
| Failed or abandoned payment | Leave checkout without paying, release the hold, and confirm the seat is available to a second user. Record expiry behavior on a separate unpaid hold. |
| Cancellation and refund | With explicit sandbox refund approval, cancel the test screening as a dedicated stage admin. Observe a single refund intent, append-only ledger and provider reconciliation. Repeat the cancellation action and confirm no second intent. Record the provider's final status, or mark pending/manual review with timestamps. The ambiguous POST timeout and late-capture paths are covered by local mocked tests. [Flutterwave refund states](https://developer.flutterwave.com/docs/refunds) |

## Android and submission gates

- The EAS project is `scrappy4rl/reelpass`, Android package `com.scrappy4rl.reelpass`, Expo SDK 57 and deep link scheme `mobile`. From `apps/mobile`, use the `staging` profile after setting the plain-text EAS `preview` variable `EXPO_PUBLIC_API_URL=https://<staging-host>/api/v1`. The app bundles this public setting. Check EAS build quota and Android signing credentials before requesting a build. [Expo environment variables](https://docs.expo.dev/eas/environment-variables/usage/) · [APK builds](https://docs.expo.dev/build-reference/apk/)
- After approval, `eas build --platform android --profile staging` requests an internal, installable APK for the review. EAS is the prepared build path. The local shell has no Android SDK configured and no `adb` or Java on PATH. The PDF explicitly requests an Android development build. The `staging` profile is a standalone preview. The development-client profile still needs an SDK-compatible `expo-dev-client` and a build/install check if the assessor requires that artifact type. Verify a fresh download as a reviewer and test install, sign-in, callback return, ticket and TalkBack on a physical phone. The latest existing EAS artifact expired on November 9.
- Review the existing Drive video for reviewer access, the three-minute limit, and coverage of the candidate's UI, seat map, booking and exact 500/50 result. Verify the Figma token and screen coverage, especially waiting, payment pending and error states, and evidence of design before implementation. The existing LinkedIn post needs review for a specific explanation of the Redis hold and database safety net. Link the final evidence from [SUBMISSION.md](../SUBMISSION.md).
- Remaining assessment evidence includes an app GIF for the README, the portfolio case study, the five-app design study, screen-reader labels and contrast/font scaling across the app, smooth 300-seat rendering, TMDB attribution and hosted outage behavior, and external error tracking for both app and server. Hosted read routing with a real replica is unverified. Local log and load evidence are available.

## Actions requiring approval

1. Publish the candidate branch and provision or reuse the exact no-upgrade staging resources. Deploy only to the approved staging host.
2. Apply migrations and demo catalog/showtime writes to that named hosted staging database.
3. Change sandbox webhook settings and run sandbox checkout. Approve the cancellation that triggers a sandbox refund separately.
4. Set the EAS preview environment, start the Android build, and share the resulting download with reviewers.
5. Publish the refreshed submission, video or LinkedIn evidence, merge the branch, or roll out to the existing production environment. Each publication or production action needs explicit approval.
