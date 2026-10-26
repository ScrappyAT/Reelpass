# ReelPass (Matinee) — System State & Operational Verification

**Repository:** `ScrappyAT/Reelpass`  
**Current Milestone:** Final Documentation & Submission Closeout  
**Verification Date:** 26 October 2026  
**Final Tested Android Build:** [EAS Build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c`](https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c)

---

## 1. Operational State Overview

The ReelPass cinema ticket reservation platform has completed its implementation, cloud deployment, and physical device validation. The end-to-end customer journey—from cinema browsing and seat reservation to Flutterwave payment checkout, deep-link redirect, payment verification, and digital QR ticket issuance—is verified and fully operational.

---

## 2. Infrastructure & Deployment Inventory

### Production Cloud Infrastructure (Live & Reachable)

| Service | Provider | Configuration / Endpoint | Status |
|---|---|---|---|
| **REST API Server** | **Railway** | `https://matineeapi-production.up.railway.app/api/v1` | **Live & Operational** |
| **Relational Database** | **Neon PostgreSQL** | PostgreSQL 16 with connection pooling (`pg`), migrations `001_init.sql` & `002_flutterwave_payments.sql` | **Live & Operational** |
| **Atomic Cache / Seat Holds** | **Redis Cloud** | Managed Redis 7 instance with AOF persistence, executing atomic Lua scripts for seat holds (5-minute TTL) | **Live & Operational** |
| **Payment Gateway** | **Flutterwave v3** | Standard Checkout in **Sandbox Mode**, server verification, and HMAC webhook signature checks | **Live & Operational** |
| **Mobile Client** | **Expo / EAS** | Standalone Android Preview APK (`d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c`) | **Verified on Hardware** |

### Local Development Infrastructure (Docker Compose)
- **PostgreSQL 16**: Port `localhost:5455` (database: `reelpass`, user: `reelpass`).
- **Redis 7**: Port `localhost:6385` (AOF enabled, maxmemory 256MB).
- Configured with dedicated non-default ports to avoid local port conflicts.

---

## 3. Physical Device Verification: Booking `RP-128807`

A complete end-to-end booking was executed on a physical Android device using standalone APK build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c` against the deployed Railway API:

```text
================================================================================
PHYSICAL ANDROID DEVICE VERIFICATION AUDIT TRAIL
================================================================================
Booking Reference:      RP-128807
Internal Database ID:   bk-1793015322940-505
Customer ID:            u-1001-demo-user-id (Alex Vance / demo@reelpass.app)
Showtime ID:            st-58
Movie:                  Oppenheimer
Cinema:                 ReelPass Cinemas Lekki (Lagos)
Auditorium:             Auditorium 2 — Dolby Atmos Soundstage
Seat Reserved:          aud-202-A4 (Row A, Seat 4 — Standard Tier)
Amount Paid:            ₦4,500.00 (450,000 integer kobo)
Payment Reference:      FLW-RP-128807-1793015337858
Gateway Transaction ID: 1793015337858-614
Payment Gateway:        Flutterwave Standard Checkout (Sandbox)
Redirect Route:         mobile://payment-complete?status=successful&tx_ref=...
Server Verification:    HTTP 200 { isConfirmed: true, status: 'confirmed' }
Ticket ID:              tkt-bk-1793015322940-505-1
QR Pass String:         REELPASS-BOOKING-RP-128807 / REELPASS-TKT-A4-RP-128807
My Tickets Retrieval:   Confirmed, rendered in "Upcoming" tab with scannable QR code
================================================================================
```

---

## 4. Engineering Fixes & Hardened Capabilities

### 1. Standalone Android Payment Redirect (`mobile://payment-complete`)
- **Issue**: In the standalone Android APK, completing checkout in the browser redirected to `mobile://payment-complete` but resulted in an Expo Router `"Unmatched Route"` error.
- **Resolution**:
  - Implemented the explicit route [`apps/mobile/src/app/payment-complete.tsx`](../apps/mobile/src/app/payment-complete.tsx) to handle deep links.
  - Added `scheme: "mobile"` in [`apps/mobile/app.json`](../apps/mobile/app.json).
  - Added `WebBrowser.maybeCompleteAuthSession()` in the root layout to cleanly dismiss in-app browser windows upon receiving the callback.
  - Reused server verification to confirm the booking and present the digital pass.

### 2. Cold-Start Authentication Recovery & Self-Healing
- **Issue**: On a physical Android device cold boot, cellular/Wi-Fi socket initialization delays caused `initAuth()` to fail, leaving the app in a "phantom" session (displaying Alex Vance but with `token = null`), which returned `UNAUTHORIZED` when attempting to reserve seats.
- **Resolution**:
  - Added a 2-attempt cold-boot retry with backoff in [`apps/mobile/src/context/AuthContext.tsx`](../apps/mobile/src/context/AuthContext.tsx).
  - Implemented `refreshDemoToken()` in [`apps/mobile/src/services/api.ts`](../apps/mobile/src/services/api.ts) to proactively fetch a fresh demo token before executing protected booking or payment endpoints.
  - Added a token listener synchronizing React state with `ApiClient` credentials.
  - Configured automatic 401 interception to re-authenticate and retry the operation seamlessly.
  - Updated the Profile screen to differentiate `DEMO ACCOUNT (ACTIVE)` from `DEMO (OFFLINE PREVIEW)` and added a manual "Activate Demo Session" button.

### 3. My Tickets Latency Resilience & In-Flight Locking
- **Issue**: Tapping "View in My Tickets" displayed `"Tickets Unavailable — Cannot reach ReelPass servers"`.
- **Root Cause**: Resolving 10 historical bookings from cloud PostgreSQL on Railway required ~3.8–4.0s, which exceeded the client's default 3.5s timeout. Furthermore, concurrent lifecycle hooks fired duplicate parallel requests that increased database contention to 4.5s.
- **Resolution**:
  - Increased timeout for database-backed endpoints (`/bookings`, `/payments`, `/auth`, `/showtimes`) from 3.5s to **12.0s** in [`apps/mobile/src/services/api.ts`](../apps/mobile/src/services/api.ts).
  - Implemented an `isFetchingRef` lock in [`apps/mobile/src/app/(tabs)/tickets.tsx`](../apps/mobile/src/app/(tabs)/tickets.tsx) to eliminate duplicate simultaneous queries.
  - Added an automatic 2-attempt retry with an 800ms backoff for transient latency.
  - Added an actionable **"Retry"** button in `EmptyState` when ticket retrieval encounters an error.

### 4. Database Type Casting & SQL Parameter Handling
- **Issue**: Flutterwave payment verification encountered a PostgreSQL parameterized query syntax error when updating payment records.
- **Resolution**:
  - Updated SQL parameter handling in [`apps/api/src/db/pgStore.ts`](../apps/api/src/db/pgStore.ts) to cast raw payment response JSON payloads (`$5::jsonb`) and format integer kobo columns correctly.

---

## 5. Performance & Concurrency Testing

### Local High-Concurrency Stress Test (k6)
- **Tool**: k6 running in containerized environment
- **Load Profile**: **500 virtual users (VUs)** contending for **40 contested seats** over 20 seconds
- **Results**:
  - **Successful Reservations**: Exactly 40 (100% of available inventory)
  - **Expected Conflicts**: 9,155 (HTTP 409 responses; seats held by other users)
  - **Double Bookings**: **0 (Zero)** — verified by checking database unique constraints
  - **Server Errors (5xx)**: **0 (Zero)**
  - **Transport Drops**: **0 (Zero)**
  - **Average Latency**: 582 ms
  - **p95 Latency**: 2,110 ms

### Hosted Cloud Performance Characteristics (Railway + Neon)
- **Hosted Latency Profile**:
  - `POST /auth/demo-login`: ~1,080 ms
  - `POST /bookings` (hold): ~1,200 ms
  - `POST /payments/initialize`: ~1,400 ms
  - `POST /payments/verify`: ~1,600 ms
  - `GET /bookings/my-tickets` (10 multi-relation records): ~3,800–4,000 ms
- **Timeout Alignment**: Client timeout of 12.0s provides a 3x safety margin over normal cloud latency.

---

## 6. Verification Test Suites

| Test Suite | Scope | Status | Notes |
|---|---|---|---|
| **API Unit Tests** | `apps/api/src/tests/booking.test.ts` | **15/15 Passed** | In-memory validation, pricing, cancellation, auth rules |
| **PostgreSQL Concurrency Tests** | `apps/api/src/tests/concurrency.pg.test.ts` | **6/6 Passed** | Concurrent booking race, NGN totals, idempotency, row locks |
| **Flutterwave Payment Tests** | `apps/api/src/tests/flutterwave.test.ts` | **Passed** | Initialization, webhook signature, status verification |
| **TypeScript Workspace Typecheck** | `@matinee/shared`, `@matinee/api`, `@matinee/mobile` | **0 Errors** | `tsc --noEmit` clean across monorepo |
| **Android JS Bundle Verification** | `apps/mobile` (`npx expo export --platform android`) | **0 Errors** | Hermes bytecode bundle generated cleanly |

---

## 7. Mandatory Disclaimers & Scope Limits

1. **Flutterwave Sandbox**: Payments are processed using Flutterwave's test environment. No actual banking transfers or debit card charges occur.
2. **Demo Catalog Data**: Cinema chains, auditoriums, showtimes, and prices are **sample demonstration data** for Nigerian cities (Lagos, Abuja, Port Harcourt, Ibadan). They do not represent real-world cinema schedules or merchant relationships.
3. **iOS Platform Scope**: iOS functionality was demonstrated and validated via **Expo Go** and the Metro bundler; it is not distributed as an Apple App Store / IPA release.

---

## 8. Related Documentation Links

- [System Architecture](ARCHITECTURE.md)
- [Root README](../README.md)
- [Mobile Client README](../apps/mobile/README.md)
- [Learning & Engineering Log](LEARNING-LOG.md)
- [Security Model & Webhook Verification](SECURITY.md)
- [Traffic & Concurrency Analysis](TRAFFIC.md)
- [500-VU Load Test Report](../load-tests/REPORT.md)