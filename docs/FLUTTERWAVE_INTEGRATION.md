# ReelPass — Flutterwave Payment Integration & Status Recovery Architecture

## 1. Executive Summary

ReelPass provides a contactless cinema ticket reservation and payment system for the Nigerian market. Payments are processed in Nigerian Naira (**NGN**) via **Flutterwave Standard Checkout v3** with strict server-side transaction verification, database-level double-booking prevention, atomic confirmation, and automatic status recovery.

---

## 2. Payment Flow & Lifecycle

The end-to-end payment experience follows an 8-stage sequence:

```
[1. Select Movie]
       ↓
[2. Select Showtime]
       ↓
[3. Select Seats]
       ↓
[4. Reserve Seats (5-Min DB & Redis Hold)]
       ↓
[5. Pay with Flutterwave (Standard Checkout Modal)]
       ↓
[6. Server-Side Verification (GET /transactions/verify)]
       ↓
[7. Atomic Confirmation (Payment SUCCESSFUL + Booking CONFIRMED + Seats SOLD)]
       ↓
[8. Generate Scannable QR Ticket Pass]
```

### A. Payment Initiation (`POST /api/v1/payments/initialize`)
- **Caller:** Authenticated mobile app customer.
- **Trusted Computation:** The payable amount is calculated **exclusively on the backend** by summing ticket prices from the verified `showtime` and `seat` records. Client-provided prices are never trusted.
- **Unique Reference Generation:** Generates a distinct merchant transaction reference for every payment attempt:
  `RP-PAY-${booking.bookingReference}-${Date.now()}`. This allows safe retries if an earlier checkout attempt was cancelled or failed without triggering Flutterwave's "Duplicate tx_ref" error.
- **PostgreSQL Tracking:** Creates a `payments` record in status `pending` linked to the booking and authenticated user.
- **Gateway Session:** Calls Flutterwave `POST https://api.flutterwave.com/v3/payments` and returns the hosted checkout link to the mobile client.

### B. Mobile Checkout Execution
- Uses `expo-web-browser` with `WebBrowser.openAuthSessionAsync` to display Flutterwave's secure checkout page within an Android Custom Tab inside the app.
- Upon completion, the gateway redirects to ReelPass's backend callback (`GET /api/v1/payments/callback`), which intercepts the redirect with `mobile://payment-complete?status=...&tx_ref=...&transaction_id=...`.
- If the user dismisses or cancels the browser, the session returns `{ type: 'cancel' }`, preserving the seat hold for the remainder of its 5-minute expiry window.

### C. Server-Side Verification (`POST /api/v1/payments/verify`)
- The mobile app triggers server verification upon return.
- **Critical Security Checks:**
  1. **Gateway Status:** Verifies `status === 'success'` and `data.status === 'successful'`.
  2. **Reference Matching:** Verifies `data.tx_ref === payment.reference`.
  3. **Amount Matching:** Verifies `Math.round(data.amount * 100) === booking.totalAmount` in integer kobo.
  4. **Currency Matching:** Verifies `data.currency === 'NGN'`.
  5. **Transaction Uniqueness:** Queries `payments` to ensure the gateway `transaction_id` has not already been credited to another booking.
  6. **Hold Expiry Verification:** Checks whether the 5-minute reservation expired before payment completed. If expired, marks the payment as needing support refund (`EXPIRED_RESERVATION_PAYMENT_NEEDS_REFUND`) and safely blocks confirmation of contested seats.

### D. Atomic Confirmation
When all verification criteria pass:
- The payment record is updated to `status = 'successful'`, `verified_at = NOW()`, with the gateway's `transaction_id` and raw response payload.
- The booking status transitions to `confirmed`.
- The reserved seats in `showtime_seats` are updated from `HELD` to `SOLD`.
- Redis seat hold locks are cleared.
- Scannable QR code payload (`REELPASS-BOOKING-${reference}`) and individual ticket passes (`REELPASS-TKT-${seatLabel}-${reference}`) are enabled for entry.

---

## 3. Database Schema & Migration (`002_flutterwave_payments.sql`)

The `payments` table supports complete auditability and referential integrity:

| Field | Type | Description |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | Unique payment attempt identifier |
| `booking_id` | `TEXT REFERENCES bookings(id)` | Associated cinema reservation |
| `user_id` | `TEXT REFERENCES users(id)` | Customer who initiated payment |
| `amount_kobo` | `INTEGER` | Expected amount in minor units (kobo) |
| `currency` | `VARCHAR(10)` | Currency code (`NGN`) |
| `provider` | `VARCHAR(50)` | Payment gateway (`flutterwave`) |
| `reference` | `VARCHAR(120) UNIQUE` | Unique merchant transaction reference (`tx_ref`) |
| `transaction_id` | `VARCHAR(120)` | Gateway transaction ID from Flutterwave |
| `status` | `VARCHAR(20)` | `pending`, `successful`, `failed`, or `cancelled` |
| `failure_reason` | `TEXT` | Gateway error or expiration reason |
| `raw_response` | `JSONB` | Full webhook / API response envelope |
| `created_at` | `TIMESTAMPTZ` | Timestamp when payment session was initialized |
| `verified_at` | `TIMESTAMPTZ` | Timestamp when payment verification settled |

### Constraints & Idempotency Guarantees
- `uq_payment_booking_successful`: Partial unique index on `(booking_id) WHERE status = 'successful'`. Guarantees at most **one** successful payment per booking while allowing multiple failed/cancelled retry attempts.
- `uq_payment_transaction_id`: Partial unique index on `(transaction_id) WHERE transaction_id IS NOT NULL AND status = 'successful'`. Physically prevents a single Flutterwave charge from being claimed by multiple reservations.

---

## 4. Operating Without Webhooks: Architecture, Limitations & Mitigations

### Why Webhooks Are Not Used in this Deployment
The user's existing Flutterwave account in Test Mode has a configured webhook URL dedicated to another project. Overwriting that webhook URL would break the other application. ReelPass therefore operates using **active status recovery and synchronous redirect verification**.

### Limitations of No-Webhook Operations

1. **No Asynchronous Server-to-Server Push:**
   - When a payment gateway has webhooks enabled, it delivers an HTTP POST notification to the backend even if the user closes their browser immediately after paying.
   - Without webhooks, the backend does not receive an automatic push notification at the exact millisecond the transaction completes.

2. **User Drop-off / Device Shutdown During Checkout:**
   - If a customer completes their card/transfer payment on Flutterwave's page, but immediately closes the browser tab, turns off their phone, or loses internet before being redirected back to ReelPass, the booking status in the database remains `pending` until the customer re-opens the app or triggers status recovery.

### Mitigations & Recovery Mechanisms

ReelPass eliminates the operational risks of operating without webhooks through three recovery layers:

1. **Active Return Verification:**
   - `WebBrowser.openAuthSessionAsync` automatically captures the browser redirect to `GET /api/v1/payments/callback` and immediately invokes `POST /api/v1/payments/verify`.
2. **On-Focus Status Recovery (`GET /api/v1/payments/:bookingId/status`):**
   - Whenever the customer re-opens ReelPass or views the **My Tickets** screen, active pending reservations trigger a background status check.
   - The endpoint actively queries Flutterwave's API (`/transactions/verify_by_reference?tx_ref=...`).
   - If Flutterwave reports that the transaction was settled while the app was closed, ReelPass **automatically reconciles and confirms the booking on the fly** without requiring user re-payment.
3. **Deep Link Fallback (`mobile://payment-complete`):**
   - The backend callback page displays a clean, responsive ReelPass confirmation screen with an automatic redirect script and a fallback button ("Return to ReelPass") using the mobile app deep link scheme.

---

## 5. Automated Verification Test Suite

The test suite in `apps/api/src/tests/flutterwave.test.ts` validates all 14 mandatory payment scenarios:

1. **Successful Payment:** Confirms booking, transitions seats to `SOLD`, records payment ID.
2. **Failed Payment:** Returns HTTP 400 `PAYMENT_FAILED`, preserves seat hold until expiry.
3. **Cancelled Payment:** Returns HTTP 400 `PAYMENT_CANCELLED`, preserves seat hold.
4. **Pending Payment:** Returns HTTP 202 `PAYMENT_PENDING`, maintains reservation.
5. **Incorrect Transaction Reference:** Rejects verification with HTTP 400 `REFERENCE_MISMATCH`.
6. **Incorrect Amount:** Rejects verification with HTTP 400 `AMOUNT_MISMATCH`.
7. **Incorrect Currency:** Rejects verification with HTTP 400 `CURRENCY_MISMATCH`.
8. **Duplicate Payment Verification:** Idempotent HTTP 200 response without duplicate records.
9. **Expired Reservation:** Blocks checkout initialization with HTTP 409 `BOOKING_EXPIRED`.
10. **Payment Success After Reservation Expiry:** Safely blocks confirmation of released seats; flags transaction for support refund (`EXPIRED_RESERVATION_PAYMENT_NEEDS_REFUND`).
11. **App Restart During Payment:** Automatically reconciles unsettled payments via `GET /payments/:bookingId/status`.
12. **Booking Confirmation Persistence:** Verifies confirmed booking persists across app restarts and ticket queries.
13. **QR Ticket Availability:** Validates scannable QR string and per-seat ticket codes are present.
14. **Repeated Concurrent Requests:** Proves 5 concurrent verification requests resolve safely with zero race condition conflicts.
