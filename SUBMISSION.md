# ReelPass (Matinee) — Project Submission Document

**Graduation Project:** ReelPass (Matinee) — *Your seat. Your story.*  
**Author / Developer:** ScrappyAT

Original submission on 26 October 2026. Release candidate evidence updated on 11 November 2026. Local verification passed. Hosted staging, sandbox and replacement Android download are pending.

---

## 1. Submission Deliverables & Resource Links

| Item | Status | Link / Reference |
|---|---|---|
| **Project Name** | Completed | **ReelPass (Matinee)** |
| **GitHub Repository** | Public repository. Candidate branch is local. | [ReelPass on GitHub](https://github.com/ScrappyAT/Reelpass) |
| **Android Standalone APK** | Historical physical-device test; download expired | [EAS Build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c`](https://expo.dev/accounts/scrappy4rl/projects/reelpass/builds/d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c) |
| **Deployed Backend API** | Previous release responded. Candidate staging URL pending. | [Existing Railway API](https://matineeapi-production.up.railway.app/api/v1) |
| **Figma Design File** | Existing design accessible. Full candidate screen coverage pending. | [Figma Design Specification](https://www.figma.com/design/Gh0kzUtGs4547W19iH4WVa/Dev-and-Design-Bootcamp-Learning-Phase) |
| **System Architecture** | Completed | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **500-user / 50-seat load test** | 50 holds, 450 expected conflicts, zero duplicate claims or unexpected errors, 1,453.8 ms p95 | [Script](load-tests/graduation-500x50.js) · [Report](load-tests/GRADUATION-500X50.md) · [Results](load-tests/graduation-500x50-result.json) |
| **Graduation implementation** | Locally verified | [Implementation](docs/GRADUATION-IMPLEMENTATION.md) · [Release checks and pending evidence](docs/RELEASE-CHECKLIST.md) |
| **Required engineering docs** | In repository | [README](README.md) · [Traffic](docs/TRAFFIC.md) · [Sharding](docs/SHARDING.md) · [Components](docs/COMPONENTS.md) · [Learning log](docs/LEARNING-LOG.md) |
| **Security Architecture** | Completed | [docs/SECURITY.md](docs/SECURITY.md) |
| **Security Audit Report** | Completed | [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) |
| **Learning & Engineering Log** | Completed | [docs/LEARNING-LOG.md](docs/LEARNING-LOG.md) |
| **Current Operational State** | Completed | [docs/STATE.md](docs/STATE.md) |
| **Demonstration Video** | Existing Drive link. Playback, length and candidate coverage unverified. | [Demo Video](https://drive.google.com/file/d/1QA6IZhR8Ic2HOKR-vXoVW-sP6RIQ6ep1/view?usp=sharing) |
| **LinkedIn Reflection Post** | Published. Detailed double-booking explanation still due for review. | [LinkedIn Engineering Reflection](https://lnkd.in/p/euVj5q72) |
| **Portfolio case study** | Working link pending | [Remaining evidence](docs/RELEASE-CHECKLIST.md#android-and-submission-gates) |

---

## 2. Mandatory Project Disclaimers & Scope Boundaries

1. **Flutterwave Payment Gateway**: All payment operations use **Flutterwave Standard Checkout v3** in **sandbox test mode**. No real banking accounts, debit cards, or monetary funds are debited.
2. **Cinema & Catalog Data**: Cinema chains, auditoriums, showtimes, seat maps, and pricing are **fictional demonstration fixtures** for Nigerian cities (Lagos, Abuja, Port Harcourt, Ibadan). Movie details are integrated with TMDB with offline demo fallback.
3. **Concurrency Load Testing**: The 500-VU high-concurrency benchmark was conducted in an **isolated containerized local environment** to stress-test transactional database row locks and Redis atomic holds under maximum saturation. It is distinct from hosted multi-region cloud performance on Railway/Neon.
4. **iOS Platform Scope**: iOS functionality was demonstrated and validated using **Expo Go** and the Metro bundler; it is not distributed as an Apple App Store / IPA release.

---

## 3. Physical Device Verification Audit (Booking `RP-128807`)

The entire reservation and payment lifecycle was executed and verified on a physical Android device using standalone APK build `d5df0b9c-4f0e-4c5f-a8b5-a9612ff3ae1c`:

```text
================================================================================
PHYSICAL ANDROID DEVICE VERIFICATION AUDIT TRAIL
================================================================================
Customer Account:       Alex Vance (demo@reelpass.app / u-1001-demo-user-id)
Booking Reference:      RP-128807
Internal Booking ID:    bk-1793015322940-505
Movie Title:            Oppenheimer (Auditorium 2 — Dolby Atmos Soundstage)
Cinema Location:        ReelPass Cinemas Lekki, Lagos
Seat Number:            A4 (Standard Tier)
Total Amount:           ₦4,500.00 (450,000 integer kobo)
Payment Gateway:        Flutterwave Standard Checkout (Sandbox)
Payment Reference:      FLW-RP-128807-1793015337858
Transaction ID:         1793015337858-614
Android Redirect:       mobile://payment-complete?status=successful&tx_ref=...
Server Verification:    HTTP 200 { success: true, isConfirmed: true, status: 'confirmed' }
Ticket ID:              tkt-bk-1793015322940-505-1
QR Pass Data:           REELPASS-BOOKING-RP-128807 / REELPASS-TKT-A4-RP-128807
My Tickets Retrieval:   Confirmed; displays pass in "Upcoming" tab with scannable QR
================================================================================
```

---

## 4. Key Engineering Milestones & Fixes

1. **Concurrency-Safe Seat Holds & Booking Engine**:
   - Redis Lua scripts guarantee atomic, all-or-nothing seat hold acquisition with 5-minute TTL.
   - PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) and database unique constraints (`showtime_id, seat_id`) on `booking_seats` and `tickets` mathematically prevent double-booking.
   - The graduation test recorded 50 unique holds and 450 expected HTTP 409 conflicts when 500 virtual users contended for 50 seats. The database check found zero duplicate seat claims. [Graduation load report](load-tests/GRADUATION-500X50.md)

2. **Android Standalone Deep-Link Redirection**:
   - Resolved an Expo Router `"Unmatched Route"` error when returning from Flutterwave checkout in the standalone APK.
   - Implemented `apps/mobile/src/app/payment-complete.tsx`, configured `scheme: "mobile"`, and cleanly handled browser dismissals via `WebBrowser.maybeCompleteAuthSession()`.

3. **Authentication Cold-Start Resilience**:
   - Resolved mobile startup socket delays on physical devices by implementing a 2-attempt cold-boot retry with backoff in `AuthContext`.
   - Built proactive demo session acquisition and 401 auto-recovery into `ApiClient`.

4. **My Tickets Cloud Latency Accommodation**:
   - Accommodated hosted PostgreSQL query resolution (~3.9s for 10 records) by raising client timeout for database endpoints from 3.5s to 12.0s.
   - Implemented an `isFetchingRef` in-flight lock to eliminate duplicate concurrent queries on screen focus.
   - Added automatic 2-attempt retries and an actionable "Retry" button.

---

## 5. Technology Stack Summary

- **Mobile Client**: React Native 0.86, Expo SDK 57, Expo Router, TypeScript, `react-native-qrcode-svg`, `expo-web-browser`
- **Backend API**: Node.js 20+, Express, TypeScript, Zod, JWT (`jsonwebtoken`), bcryptjs
- **Database & Cache**: PostgreSQL 16 (Neon), Redis 7 (Redis Cloud), BullMQ
- **Payment Gateway**: Flutterwave Standard Checkout v3 (Sandbox Mode)
- **Deployment**: Railway (API), EAS Build (Android Standalone APK)
