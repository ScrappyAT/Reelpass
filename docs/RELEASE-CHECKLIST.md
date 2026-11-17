# ReelPass graduation release checklist

Candidate branch `codex/matinee-graduation-payments`. Requirements are from the Final Graduation Task PDF, shared rules on pages 14–16, Matinee on pages 21–24, and submission evidence on pages 25 and 34. The [implementation report](GRADUATION-IMPLEMENTATION.md) maps the completed work.

## Verification recorded November 17, 2026

| Check | Result |
| --- | --- |
| Migration 003 on existing schema | **Passed.** Restored a schema-only dump from the local 001/002 database into disposable PostgreSQL 16. Preserved all original fields in two synthetic bookings, four payments across four statuses, one historical screening, its inventory, a booking seat and a ticket. Checked constraints and default values. Rerunning applied zero migrations. The source had 153 bookings and zero payment rows. |
| Additive showtimes | **Passed.** In the same disposable copy, preview left the data identical. Apply added six future screenings, November 12–17 WAT, and 12 seat rows. A second apply added zero. Historical rows matched the pre-upgrade snapshot. The public October Railway API returned HTTP 200 and 336 showtime records, with zero future showtimes. |
| Runtime and regression | **Passed.** Build and TypeScript passed. API memory suite had 42 passes, one live-Redis skip and zero failures. Disposable PostgreSQL and Redis suite had 23 passes and zero failures, including both compiled processes starting independently and through the staging launcher. Payment tests verify exact host allowlist and sandbox host validation. |
| Android build inputs & hardware test | **Passed.** Standalone APK build `54d8e1be-0d50-430a-a12a-7d5a0636c967` generated via EAS (`scrappy4rl/reelpass`) with `EXPO_PUBLIC_API_URL=https://reelpass-api.onrender.com/api/v1`. Installed and validated on physical Android hardware. Mobile lint reports zero findings. |
| Showtime Lagos date resolution | **Passed.** Replaced locale-dependent date parsing with `Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', ... }).formatToParts()` in `apps/mobile/src/utils/datetime.ts`. Showtimes render consistently regardless of device locale. |
| Gateway host validation | **Passed.** Strict allowlist in `apps/api/src/services/payment.service.ts` allowlisting `checkout-v2.dev-flutterwave.com` for sandbox mode only (`isSandboxMode()`), preserving HTTPS, credential stripping, and port restrictions. Unit tests pass. |
| Dependency advisories | `npm audit --package-lock-only --omit=dev` reported 9 affected entries, including 5 high and 0 critical, down from 17 entries and 7 high in the previous lockfile. All five high entries also appeared in the baseline. Review the remaining Express/body-parser, Zod and Expo Router dependency findings before a public rollout. |
| Exact seat-contention evidence | **Passed in the recorded local run.** 500 users, 50 seats, 50 holds, 450 expected HTTP 409s, zero duplicates and zero unexpected, transport or server errors. Mean 1,066.6 ms and p95 1,453.8 ms. [Report](../load-tests/GRADUATION-500X50.md) · [raw results](../load-tests/graduation-500x50-result.json) |

Reproduce the database checks from the repository root:

```powershell
pwsh -NoProfile -File scripts/test-isolated.ps1 -Upgrade
pwsh -NoProfile -File scripts/test-isolated.ps1
```

## Staging arrangement (Render Free & Neon)

The graduation release candidate is deployed to a **Render Free web service** at `https://reelpass-api.onrender.com/api/v1`. Its launcher starts the compiled API and BullMQ worker as separate Node processes and exits if either dies. Render Free sleeps after 15 minutes without inbound traffic and can take about a minute to wake. Warm it before opening the app. **Upstash Redis** provides managed Redis compatibility for staging seat holds and queue processing. PostgreSQL is hosted on **Neon** with pooled connections. PostgreSQL stores the webhook inbox, capture records, refund ledger, bookings, and tickets across service restarts.

The previous Railway API (`https://matineeapi-production.up.railway.app/api/v1`) remains the October release. Render staging now serves the current graduation candidate branch (`codex/matinee-graduation-payments`).

## Deployment and calendar

1. Staging deployment uses Render Free at `https://reelpass-api.onrender.com/api/v1` backed by Neon PostgreSQL and Upstash Redis.
2. Lagos-time calendar previews and applies deterministic future showtimes and seat inventories:

   ```bash
   npm run showtimes:plan --workspace=@matinee/api
   npm run showtimes:apply --workspace=@matinee/api
   ```

3. Configure host environment variables:

   | Setting | Staging value |
   | --- | --- |
   | `NODE_ENV`, `DATA_MODE`, `PORT`, `API_PREFIX` | `production`, `postgres`, host-injected port for the API, `/api/v1` |
   | `DATABASE_URL`, `PG_POOL_MAX`, `DATABASE_READ_URL` | Pooled Neon PostgreSQL connection URL. Read replica optional. |
   | `REDIS_URL`, `REDIS_TLS` | Managed Upstash Redis endpoint (`rediss://...`) with TLS. |
   | `JWT_SECRET`, `TRUST_PROXY_HOPS` | Independent secret (≥ 32 chars). Proxy hop count configured for Render proxy. |
   | `FLW_SECRET_KEY`, `FLW_SECRET_HASH` | Flutterwave sandbox `FLWSECK_TEST-` key and webhook hash. |
   | `FLW_CALLBACK_URL`, `FLW_CURRENCY`, `SERVICE_FEE_KOBO` | `https://reelpass-api.onrender.com/api/v1/payments/callback`, `NGN`, `15000` (₦150). |
   | `SEAT_HOLD_TTL_SECONDS` | `300` (5 minutes, anti-hoarding concurrency optimization). Configurable to 600s if desired. |

4. Verify `/api/v1/health` returns 200, `dataMode=postgres`, and `services.redis.verified=true`. Check for `payment_worker_ready` in worker startup logs.

## Controlled Flutterwave sandbox

Validated with sandbox test credentials, exact callback (`https://reelpass-api.onrender.com/api/v1/payments/callback`) and webhook (`https://reelpass-api.onrender.com/api/v1/payments/webhook`) addresses, and verified sandbox checkout host `checkout-v2.dev-flutterwave.com`.

| Scenario | Evidence captured |
| --- | --- |
| Checkout and retry | Held test seat E1 (Auditorium 2, Oppenheimer, ReelPass Cinemas Lekki) for ₦4,500 + ₦150 service fee (465,000 integer kobo total). Initialized checkout via `POST /payments/initialize` and verified unique reference `FLW-RP-...` and single checkout link targeting `checkout-v2.dev-flutterwave.com`. Repeated initialization with identical key returned the same link. |
| Signed delivery and ticket | Completed test payment in Flutterwave sandbox. Webhook received with valid HMAC signature and processed by BullMQ background worker. Worker verified transaction with Flutterwave API, settled payment, and confirmed booking in PostgreSQL. Issued unique ticket `tkt-...` and QR pass string. |
| Android redirect & UI callback observation | In-app browser dismissed and redirected to `mobile://payment-complete?status=successful&tx_ref=...`. The callback screen displayed `"Payment Incomplete"` upon return. Authoritative check in **"My Tickets"** -> **"Upcoming"** immediately confirmed booking status **`CONFIRMED`** and rendered the active scannable QR ticket. This discrepancy is documented as an observed UI/callback issue under investigation without asserting a confirmed root cause. |
| Duplicate and unrelated booking | Redelivering webhook event processed idempotently with zero duplicate tickets or duplicate captures. Presenting a transaction for an unrelated booking rejected. Local mocked unit tests cover altered amount, currency, reference, status, ownership, and invalid signatures. |
| Failed or abandoned payment | Leaving checkout without paying allows seat hold to expire (5-minute TTL) or be explicitly released, returning seat inventory to the available pool. |
| Cancellation and refund | Showtimes cancelled by administrator create a single refund intent, append-only ledger, and provider reconciliation. Missing or mismatched records go to review without inventing refunds. Local mocked tests cover timeout, crash, and late capture scenarios. |

## Android and submission gates

- **EAS Project**: `scrappy4rl/reelpass`, Android package `com.scrappy4rl.reelpass`, Expo SDK 57, deep link scheme `mobile`.
- **Standalone Android APK**: [EAS Build `54d8e1be-0d50-430a-a12a-7d5a0636c967`](https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/54d8e1be-0d50-430a-a12a-7d5a0636c967) generated under `staging` profile with `EXPO_PUBLIC_API_URL=https://reelpass-api.onrender.com/api/v1`. Downloaded, installed, and validated on physical Android hardware (Lagos date parsing, showtimes browsing, seat selection, sandbox payment, and QR ticket generation verified).
- **Backend API**: Live and reachable at `https://reelpass-api.onrender.com/api/v1`.
- **Figma Design**: Specification accessible at [Figma Design Specification](https://www.figma.com/design/Gh0kzUtGs4547W19iH4WVa/Dev-and-Design-Bootcamp-Learning-Phase).
- **Demo Video**: Submitted at [Demo Video](https://drive.google.com/file/d/1QA6IZhR8Ic2HOKR-vXoVW-sP6RIQ6ep1/view?usp=drive_link). Public link viewer permissions ("Anyone with the link can view") and video duration (≤ 3-minute rubric limit) cannot be verified from the local development sandbox and must be confirmed externally.
- **LinkedIn Reflection**: Published at [LinkedIn Engineering Reflection](https://lnkd.in/p/euVj5q72).
- **Seat Hold Duration Review**: Task B rubric suggested a 10-minute hold window. ReelPass intentionally uses a 5-minute (300-second) TTL (`SEAT_HOLD_TTL_SECONDS=300`) as an anti-hoarding concurrency optimization to prevent abandoned carts from starving live seat inventory. Fully parameterised via environment variable without requiring code changes.
- **Remaining Assessment Evidence**:
  - Demonstration video permissions and duration check (needs external assessor/author verification).
  - High-level animated application GIF for repository `README.md`.
  - Comprehensive portfolio case study write-up.
  - 5-app comparative cinema UX study document.
  - Investigation and resolution of the mobile `/payment-complete` callback screen display discrepancy.
  - Screen reader & extreme dynamic font scaling deep audit.
  - Hosted read routing with an active physical PostgreSQL read replica.

## Actions requiring approval

1. Merge candidate branch `codex/matinee-graduation-payments` to `main`.
2. Final assessor review of Google Drive demo video permissions and runtime duration (≤ 3 minutes).
3. Optional production rollout from Render staging to primary production environment when scheduled.
