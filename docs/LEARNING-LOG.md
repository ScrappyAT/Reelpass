# ReelPass — Learning and Engineering Log

**Graduation project:** Matinee / ReelPass — *Your seat. Your story.*  
**Scope:** Product design, Expo Android application, backend API, booking engine, load testing and submission documentation  
**Updated:** 21 October 2026

> This log summarizes work supported by the repository and the project discussions. It is not a reconstructed daily timesheet; dates are provided only where evidenced. It distinguishes completed implementation from unverified deployment behavior.

## Project objective

Build a Nigerian cinema-ticket reservation experience that demonstrates product design, reusable mobile UI, backend engineering, concurrency-safe seat selection, payment integration and technical communication.

## Milestones and lessons

### 1. Product definition and UI direction

**Work:** Established ReelPass as a dark, premium cinema experience with a gold accent, movie discovery, cinema/showtime browsing, auditorium seat selection and digital passes.

**Learning:** A design handoff must match the implemented product. Imported Stitch mockups initially used colors and sample content different from the application. We compared them with `apps/mobile/src/theme/tokens.ts`, aligned key colors, added missing reference screens and documented sample-only content in Figma.

**Evidence:** Figma design file; `apps/mobile/src/theme/tokens.ts`; `apps/mobile/src/app`.

### 2. Mobile application architecture

**Work:** Built an Expo React Native / TypeScript application with Expo Router, shared components, tabs and screens for discovery, search, tickets, profile, authentication, movie details, showtimes and seats.

**Learning:** Shared components and design tokens improve consistency. Loading, empty and error states are part of the core user journey rather than optional finishing touches.

**Evidence:** `apps/mobile/src/components/ui`, `apps/mobile/src/app`, `apps/mobile/src/app/gallery.tsx`.

### 3. Backend and data integrity

**Work:** Organized a Node.js/Express TypeScript API with shared TypeScript/Zod contracts, PostgreSQL persistence and Redis seat holds. Database migrations define users, cinemas, movies, auditoriums, showtimes, seats, bookings, tickets and payments.

**Learning:** A seat reservation is a concurrency problem. A UI selection cannot guarantee ownership; the backend must enforce availability through transactions, row locks, uniqueness constraints and idempotency.

**Evidence:** `apps/api/src/db/pgStore.ts`; `apps/api/src/redis/seatHolds.ts`; `apps/api/src/db/migrations`.

### 4. Payment lifecycle

**Work:** Implemented Flutterwave checkout initialization, payment verification, payment-state persistence and confirmation-dependent QR passes.

**Learning:** Creating a booking is not the same as completing a payment. Reservations remain pending until server-side verification succeeds; unavailable payment credentials must not produce a fake confirmation.

**Evidence:** `apps/api/src/routes/payment.routes.ts`; `apps/api/src/services/payment.service.ts`; `apps/mobile/src/app/booking/seats/[showtimeId].tsx`.

**Verification limit:** A successful live end-to-end payment has not been established during the current deployment outage.

### 5. High-concurrency testing — 19 October 2026

**Work:** Executed a local k6 contention benchmark with **500 virtual users**, 50 distinct user accounts and 40 contested seats over 20 seconds. The saved report records 40 successful reservations, 9,155 expected HTTP 409 conflicts, zero server errors, and zero transport drops. Average latency was approximately 582 ms; p95 approximately 2,110 ms.

**Learning:** Under contention, HTTP 409 is correct business behavior, not a system outage. Correctness requires inspecting database state for duplicate reservations, not just reading HTTP success rates.

**Evidence:** `load-tests/REPORT.md`, `load-tests/summary.json`, `load-tests/sql-verification.json`.

**Scope limit:** These results were obtained in an isolated local environment, not on Railway or Neon production traffic.

### 6. Android build and design submission

**Work:** Produced an Android APK build and prepared a Figma handoff with screen coverage, design tokens, seat-state legend and payment-state notes.

**Learning:** A graduation submission needs both demonstrable implementation and truthful evidence. Mock QR codes, prices and fictional cinemas must be labeled as sample data.

**Evidence:** Expo build link and Figma link supplied in the project conversation; GitHub repository `ScrappyAT/Reelpass`.

### 7. Deployment interruption — October 2026

**Work:** Configured Neon PostgreSQL and attempted Railway deployment; Railway remained unavailable. Alternative hosting was explored but not adopted at a cost the project could justify.

**Learning:** A deployment plan needs an operational fallback, but changing hosting under time pressure can introduce new costs and configuration risks. Documentation and local verification can continue while a service is unavailable.

**Outstanding:** Restore a reachable backend; verify API health, migrations, Redis mode, Android API connectivity, booking creation, Flutterwave sandbox payment and QR pass after successful verification.

## What went well

- Reusable UI components and centralized theme tokens.
- Transactional PostgreSQL seat ownership and optional Redis fast-path holds.
- Evidence-backed 500-VU local contention test with zero double-bookings.
- Clear distinction between demo catalog data and verified production behavior.

## What should improve

- Maintain closer synchronization between Figma and app screens throughout implementation.
- Track deployment status and evidence separately from local test results.
- Capture real Android screenshots and a concise demo video when the backend is reachable.
- Verify Flutterwave sandbox success, failure, cancellation and retry on the actual APK.
- Review hardcoded screen-specific style values and accessibility details.

## Submission evidence checklist

- [x] Public source repository: https://github.com/ScrappyAT/Reelpass
- [x] Android build link: https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/91060cdf-d902-4780-b4bf-f1cdfdf1ca8d
- [x] Figma design: https://www.figma.com/design/Gh0kzUtGs4547W19iH4WVa/Dev-and-Design-Bootcamp-Learning-Phase
- [x] Local load test evidence: `load-tests/REPORT.md` and `load-tests/summary.json`
- [x] Technical documentation drafted: `ARCHITECTURE.md`, `TRAFFIC.md`, `SHARDING.md`, `COMPONENTS.md`, `LEARNING-LOG.md`
- [ ] Confirm a publicly reachable deployed backend (Railway unavailable at last check)
- [ ] Verify Flutterwave sandbox end-to-end on Android
- [ ] Capture final demo recording (approximately 3 minutes)
- [ ] Publish final LinkedIn reflection/post
- [ ] Commit or upload all required documentation to the repository

## Final reflection

The most important engineering lesson was to treat booking correctness, payment verification and design accuracy as testable requirements. ReelPass demonstrates the implementation and local concurrency evidence; the remaining work is to validate deployment-dependent user journeys and package truthful submission proof.
