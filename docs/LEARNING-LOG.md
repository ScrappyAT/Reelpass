# ReelPass — Learning and Engineering Log

**Graduation Project:** Matinee / ReelPass — *Your seat. Your story.*  
**Scope:** Product design, Expo Android application, backend API, booking engine, cloud deployment, load testing, and submission closeout  
**Updated:** 26 October 2026  
**Final Android Build:** [EAS Build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c`](https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c)

> This log documents the engineering milestones, lessons learned, and empirical verification supporting the ReelPass platform. It provides truthful evidence distinguishing local performance benchmarks from cloud production behavior and records the physical device validation of the complete booking journey.

---

## Project Objective

Build a Nigerian cinema-ticket reservation experience demonstrating end-to-end product design, reusable mobile UI architecture, robust backend engineering, concurrency-safe seat allocation, sandbox payment gateway integration, and technical communication.

---

## Milestones and Engineering Lessons

### 1. Product Definition & Design System Alignment
- **Work:** Established ReelPass as a dark-mode, gold-accented cinema ticketing experience with movie discovery, cinema/showtime browsing, auditorium seat selection, and digital pass generation.
- **Learning:** Design tokens must be strictly synchronized between Figma handoffs and application code. Initial Figma mockups drifted in color and spacing from the code. We centralized tokens in `apps/mobile/src/theme/`, created a dedicated 12-state UI component gallery (`/gallery`), and documented sample-only content.
- **Evidence:** `apps/mobile/src/theme/`, `apps/mobile/src/components/ui/`, `apps/mobile/src/app/gallery.tsx`.

### 2. Mobile Application Architecture (Expo Router)
- **Work:** Built an Expo React Native application using TypeScript and Expo Router file-based routing. Created shared components, tabs (Movies, Search, Tickets, Profile), movie details, auditorium seat layout grids, and digital pass generation.
- **Learning:** Empty, loading, and error states are first-class architectural concerns. Offline handling requires clean separation between read-only cached browsing and transactional server operations.
- **Evidence:** `apps/mobile/src/app/`, `apps/mobile/src/components/ui/EmptyState.tsx`, `apps/mobile/src/components/ui/SeatMap.tsx`.

### 3. Backend Architecture & Concurrency Safety
- **Work:** Engineered a Node.js/Express TypeScript API backed by PostgreSQL (persistence) and Redis (atomic holds). Implemented database migrations, seed data, and a transactional store (`PgStore`).
- **Learning:** A seat reservation is fundamentally a concurrency problem. The client cannot be trusted for availability. Correctness requires two-phase isolation: atomic fast-path Redis holds (Lua scripts) combined with database row locks (`SELECT ... FOR UPDATE`) and unique constraints (`showtime_id, seat_id`) on `booking_seats` and `tickets`.
- **Evidence:** `apps/api/src/db/pgStore.ts`, `apps/api/src/redis/seatHolds.ts`, `apps/api/src/db/migrations/001_init.sql`.

### 4. Payment Gateway Integration (Flutterwave Sandbox)
- **Work:** Implemented Flutterwave Standard Checkout v3 in sandbox test mode, including session initialization, server-side transaction verification (`POST /payments/verify`), and webhook HMAC signature validation (`timingSafeEqual`) with replay protection.
- **Learning:** Booking creation and payment completion must remain decoupled. Seats are held temporarily in `pending` state; confirmation occurs strictly upon server-verified settlement. If payment credentials fail or timeout, the system fails closed rather than issuing unverified tickets.
- **Evidence:** `apps/api/src/routes/payment.routes.ts`, `apps/api/src/services/payment.service.ts`, `apps/api/src/tests/flutterwave.test.ts`.

### 5. High-Concurrency Stress Testing (k6 Load Test)
- **Work:** Executed a containerized k6 contention benchmark simulating **500 virtual users (VUs)** contending for **40 contested seats** over 20 seconds.
- **Results:** 40 successful reservations (100% inventory), 9,155 expected HTTP 409 conflict responses, zero double-bookings, zero server errors (5xx), and zero network drops. Mean latency was 582 ms; p95 latency was 2,110 ms.
- **Learning:** In high-concurrency seat reservation, HTTP 409 Conflict is correct business logic, not a server failure. True concurrency validation requires inspecting database tables for duplicate allocations.
- **Scope Limit:** These results reflect an isolated containerized environment designed to stress-test locks and constraints; they are distinct from hosted cloud latency over the public internet.
- **Evidence:** `load-tests/REPORT.md`, `load-tests/summary.json`, `load-tests/sql-verification.json`.

### 6. Cloud Deployment Resolution (Railway + Neon + Redis Cloud)
- **Work:** Successfully deployed the production backend API to **Railway** (`https://matineeapi-production.up.railway.app/api/v1`), connected to serverless **Neon PostgreSQL** and **Redis Cloud**.
- **Learning:** Cloud database hosting introduces latency dynamics absent in local Docker environments. Serverless connection pooling requires explicit SSL configuration and query timeout tuning.
- **Evidence:** Live Railway health check (`/api/v1/health`), Neon migration records (`001_init.sql`, `002_flutterwave_payments.sql`).

### 7. Physical Android Verification & Client Hardening
- **Work:** Tested the complete customer journey on a physical Android device using EAS build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c` against the deployed Railway API.
- **Challenges Resolved:**
  1. *Android Deep-Link Redirect*: Resolved an Expo Router `"Unmatched Route"` error in the standalone APK when returning from the Flutterwave browser window. Implemented `apps/mobile/src/app/payment-complete.tsx`, configured `scheme: "mobile"`, and added `WebBrowser.maybeCompleteAuthSession()`.
  2. *Authentication Cold-Start Recovery*: Solved an issue where initial cellular socket startup delays caused `initAuth()` to time out, leaving the app in an unauthenticated phantom demo session. Added cold-boot retries, proactive token acquisition in `ApiClient`, a token listener, and an interactive "Activate Demo Session" button on Profile.
  3. *My Tickets Query Timeout*: Diagnosed client timeouts (`3.5s`) when querying 10 multi-relation bookings from Railway (~3.9s). Increased database query timeout to 12.0s, added an `isFetchingRef` lock to eliminate duplicate concurrent queries on screen focus, implemented 2-attempt automatic retry, and added an interactive "Retry" button.
- **Empirical Proof (Booking `RP-128807`):**
  - Confirmed reservation for *Oppenheimer* at *ReelPass Cinemas Lekki*, seat `A4`, total `₦4,500.00`.
  - Processed sandbox payment, intercepted deep link to `mobile://payment-complete`, verified transaction with Flutterwave API, generated scannable QR ticket (`REELPASS-BOOKING-RP-128807`), and retrieved pass in My Tickets tab.
- **Evidence:** Internal booking `bk-1793015322940-505`, payment `pay-1793015337858-614`, ticket `tkt-bk-1793015322940-505-1`.

---

## What Went Well

1. **Transactional Data Integrity:** Zero double-bookings achieved through Redis Lua scripts, PostgreSQL `FOR UPDATE` row locks, and unique database constraints.
2. **Defensive Mobile Resilience:** Proactive self-healing authentication, in-flight query locking, and graceful timeout recovery prevented physical device test disruptions.
3. **Realistic Payment Lifecycle:** True two-phase checkout flow with in-app browser interception, server-side transaction verification, and QR ticket issuance.
4. **Transparent Documentation:** Honest distinction between local stress-test benchmarks, cloud hosting latencies, and sandbox demonstration data.

---

## What Should Improve in Future Iterations

1. **Database Query Batching:** Optimize `listBookingsForUser` in `pgStore.ts` using SQL `JOIN`s or batched `ANY($1)` queries instead of sequential per-booking queries, reducing multi-record retrieval time on hosted PostgreSQL.
2. **Persistent Storage Module:** Install `@react-native-async-storage/async-storage` or `expo-secure-store` to persist JWT tokens across native process terminations rather than relying on in-memory state.
3. **Push Notification Service:** Implement Expo push notifications for real-time showtime reminders and payment confirmation alerts.
4. **Production Payment Migration:** Transition Flutterwave credentials from sandbox test mode to live merchant keys with automated bank settlement.

---

## Submission Evidence Checklist

- [x] **Public Source Repository**: [https://github.com/ScrappyAT/Reelpass](https://github.com/ScrappyAT/Reelpass)
- [x] **Tested Android Standalone APK**: [EAS Build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c`](https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c)
- [x] **Live Deployed API**: `https://matineeapi-production.up.railway.app/api/v1` (Railway + Neon PostgreSQL + Redis Cloud)
- [x] **End-to-End Android Booking Verified**: Booking reference `RP-128807` (*Oppenheimer*, Lekki, seat A4, ₦4,500)
- [x] **Flutterwave Sandbox Payment Verified**: In-app browser checkout + `mobile://payment-complete` redirect + server-side verification
- [x] **Digital Pass & QR Code Generated**: Scannable QR code rendered and retrieved in My Tickets tab
- [x] **Figma Design System**: [Figma Design File](https://www.figma.com/design/Gh0kzUtGs4547W19iH4WVa/Dev-and-Design-Bootcamp-Learning-Phase)
- [x] **Local 500-VU Concurrency Evidence**: [`load-tests/REPORT.md`](../load-tests/REPORT.md) and [`load-tests/summary.json`](../load-tests/summary.json)
- [x] **Complete Documentation Suite**:
  - Root README: [`README.md`](../README.md)
  - Mobile Client README: [`apps/mobile/README.md`](../apps/mobile/README.md)
  - System Architecture: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
  - Current Verified State: [`docs/STATE.md`](STATE.md)
  - Traffic & Concurrency Analysis: [`docs/TRAFFIC.md`](TRAFFIC.md)
  - Database Sharding Strategy: [`docs/SHARDING.md`](SHARDING.md)
  - Mobile Design System: [`docs/COMPONENTS.md`](COMPONENTS.md)
  - Security Model: [`docs/SECURITY.md`](SECURITY.md)

---

## Final Reflection

Building ReelPass demonstrated that real-world engineering begins where tutorials end. High-concurrency seat reservation is not just about writing UI screens or standard CRUD endpoints—it requires designing for failure modes: race conditions when two users tap the same seat at the same millisecond, network drops on physical mobile radios, deep-link routing quirks in standalone native APKs, and cloud database round-trip latencies.

By grounding the architecture in strict database constraints, atomic Redis operations, fail-closed payment verification, and defensive client self-healing, ReelPass achieves both technical correctness and a polished, premium cinema-going experience.
