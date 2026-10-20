import { Router } from 'express';
import { ApiResponse, Booking, PaymentDetails, PaymentVerifyResult } from '@matinee/shared';
import { getStore, BookingConflictError } from '../db/store';
import { seatHolds } from '../redis/seatHolds';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  initializePayment,
  isPaymentConfigured,
  isWebhookConfigured,
  getPaymentCurrency,
  verifyWebhookSignature,
  verifyTransactionById,
  verifyTransactionByReference,
  VerificationResult,
} from '../services/payment.service';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/v1/payments/status — Check provider status (no secret keys exposed)
// ---------------------------------------------------------------------------
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      provider: 'flutterwave',
      configured: isPaymentConfigured(),
      webhookConfigured: isWebhookConfigured(),
      currency: getPaymentCurrency(),
      mode: 'standard_v3',
    },
    meta: { timestamp: new Date().toISOString() },
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/payments/initialize — Create checkout link for reserved seats
// ---------------------------------------------------------------------------
router.post('/initialize', requireAuth, async (req, res, next) => {
  try {
    const store = getStore();
    const bookingId = req.body?.bookingId;
    if (!bookingId) {
      throw new AppError(400, 'BOOKING_ID_REQUIRED', 'bookingId is required');
    }

    const booking = await store.getBooking(bookingId);
    if (!booking) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    if (booking.userId !== req.user!.id) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this booking is restricted');
    }
    if (booking.status === 'confirmed') {
      throw new AppError(409, 'BOOKING_ALREADY_CONFIRMED', 'This booking is already confirmed');
    }
    if (booking.status === 'expired' || (booking.expiresAt && new Date(booking.expiresAt).getTime() < Date.now())) {
      throw new AppError(409, 'BOOKING_EXPIRED', 'This reservation has expired. Please select seats again.');
    }

    const user = await store.findUserById(req.user!.id);
    const redirectUrl = req.body?.redirectUrl;

    const result = await initializePayment({
      bookingReference: booking.bookingReference,
      amountKobo: booking.totalAmount, // Server-calculated trusted amount
      customerEmail: user?.email ?? 'customer@reelpass.app',
      customerName: user?.fullName ?? 'ReelPass Customer',
      redirectUrl,
    });

    if (!result.configured) {
      throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', result.message || 'Payment provider is not configured.');
    }

    // Save payment attempt to PostgreSQL
    const payment = await store.createPayment({
      id: `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      bookingId: booking.id,
      userId: req.user!.id,
      amountKobo: booking.totalAmount,
      currency: result.currency,
      provider: 'flutterwave',
      reference: result.reference,
      status: 'pending',
    });

    const response: ApiResponse<{
      link?: string;
      reference: string;
      amountKobo: number;
      currency: string;
      paymentId: string;
    }> = {
      success: true,
      data: {
        link: result.link,
        reference: result.reference,
        amountKobo: result.amountKobo,
        currency: result.currency,
        paymentId: payment.id,
      },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };
    return res.json(response);
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return next(new AppError(409, error.code, error.message));
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/payments/verify — Server-side Flutterwave verification & confirmation
// ---------------------------------------------------------------------------
router.post('/verify', requireAuth, async (req, res, next) => {
  try {
    const store = getStore();
    const { bookingId, reference, transactionId } = req.body || {};

    if (!bookingId && !reference && !transactionId) {
      throw new AppError(400, 'VERIFICATION_PARAM_REQUIRED', 'bookingId, reference, or transactionId is required');
    }

    // Locate the payment record
    let payment = reference
      ? await store.getPaymentByReference(reference)
      : transactionId
        ? await store.getPaymentByTransactionId(String(transactionId))
        : await store.getPaymentByBookingId(bookingId!);

    // Locate the associated booking
    const targetBookingId = payment?.bookingId || bookingId;
    if (!targetBookingId) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Could not identify booking for verification');
    }

    const booking = await store.getBooking(targetBookingId);
    if (!booking) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    if (booking.userId !== req.user!.id) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this booking is restricted');
    }

    // If payment record wasn't found yet, create or retrieve it
    if (!payment) {
      payment = await store.getPaymentByBookingId(booking.id);
    }

    // Idempotency check: if booking is already confirmed, return success immediately
    if (booking.status === 'confirmed') {
      const confirmedPayment = payment || (await store.getPaymentByBookingId(booking.id));
      const response: ApiResponse<PaymentVerifyResult> = {
        success: true,
        data: {
          booking,
          payment: confirmedPayment ? toPaymentDetails(confirmedPayment) : createFallbackPaymentDetails(booking),
          isConfirmed: true,
        },
        meta: { message: 'Booking already confirmed', timestamp: new Date().toISOString() },
      };
      return res.json(response);
    }

    // Verify transaction with Flutterwave API
    const lookupRef = reference || payment?.reference;
    let flwResult: VerificationResult;
    if (transactionId) {
      flwResult = await verifyTransactionById(transactionId);
    } else if (lookupRef) {
      flwResult = await verifyTransactionByReference(lookupRef);
    } else {
      throw new AppError(400, 'NO_TRANSACTION_REFERENCE', 'No transaction reference available to verify');
    }

    // 1. Transaction failed or was cancelled
    if (flwResult.status === 'cancelled') {
      if (lookupRef) {
        await store.updatePaymentStatus(lookupRef, 'cancelled', flwResult.transactionId, flwResult.raw, 'Payment cancelled by user');
      }
      throw new AppError(400, 'PAYMENT_CANCELLED', 'Payment was cancelled. Your reservation remains held until expiry.');
    }

    if (flwResult.status === 'failed' || (!flwResult.ok && flwResult.status !== 'pending')) {
      const reason = flwResult.reason || 'Payment was declined by payment gateway';
      if (lookupRef) {
        await store.updatePaymentStatus(lookupRef, 'failed', flwResult.transactionId, flwResult.raw, reason);
      }
      throw new AppError(400, 'PAYMENT_FAILED', `Payment failed: ${reason}`);
    }

    if (flwResult.status === 'pending') {
      throw new AppError(202, 'PAYMENT_PENDING', 'Payment is still being processed by the provider. Please try again in a few moments.');
    }

    // 2. Gateway reports success: strictly verify transaction parameters
    // a. Reference check
    if (lookupRef && flwResult.txRef && flwResult.txRef !== lookupRef) {
      throw new AppError(400, 'REFERENCE_MISMATCH', 'Transaction reference does not match expected booking payment reference');
    }

    // b. Amount check (compare in integer kobo)
    if (flwResult.amountKobo !== undefined && flwResult.amountKobo !== booking.totalAmount) {
      if (lookupRef) {
        await store.updatePaymentStatus(lookupRef, 'failed', flwResult.transactionId, flwResult.raw, 'Amount mismatch');
      }
      throw new AppError(400, 'AMOUNT_MISMATCH', `Payment amount (₦${((flwResult.amountKobo || 0) / 100).toFixed(2)}) does not match expected booking total (₦${(booking.totalAmount / 100).toFixed(2)})`);
    }

    // c. Currency check
    const expectedCurrency = getPaymentCurrency();
    if (flwResult.currency && flwResult.currency.toUpperCase() !== expectedCurrency.toUpperCase()) {
      if (lookupRef) {
        await store.updatePaymentStatus(lookupRef, 'failed', flwResult.transactionId, flwResult.raw, 'Currency mismatch');
      }
      throw new AppError(400, 'CURRENCY_MISMATCH', `Payment currency ${flwResult.currency} does not match required currency ${expectedCurrency}`);
    }

    // d. Reused transaction ID check (prevent applying same transaction to another booking)
    if (flwResult.transactionId) {
      const existingTx = await store.getPaymentByTransactionId(flwResult.transactionId);
      if (existingTx && existingTx.bookingId !== booking.id && existingTx.status === 'successful') {
        throw new AppError(409, 'TRANSACTION_ALREADY_USED', 'This payment transaction ID has already been applied to another reservation');
      }
    }

    // e. Check if reservation expired before payment completed
    const isExpired = booking.status === 'expired' || (booking.expiresAt && new Date(booking.expiresAt).getTime() < Date.now());
    if (isExpired) {
      // Record payment for reconciliation / refund, but do not confirm expired booking
      if (lookupRef) {
        await store.updatePaymentStatus(
          lookupRef,
          'successful',
          flwResult.transactionId,
          flwResult.raw,
          'EXPIRED_RESERVATION_PAYMENT_NEEDS_REFUND'
        );
      }
      throw new AppError(409, 'BOOKING_EXPIRED_PAYMENT_HELD', 'Payment was processed successfully, but your seat reservation had expired. Our customer support team will reconcile or refund your transaction.');
    }

    // 3. Atomically confirm booking and update payment status to SUCCESSFUL
    const updatedPayment = lookupRef
      ? await store.updatePaymentStatus(lookupRef, 'successful', flwResult.transactionId, flwResult.raw)
      : payment;

    const confirmedBooking = await store.confirmBooking(booking.id, req.user!.id, {
      paymentId: updatedPayment?.id || flwResult.transactionId,
    });

    // Clear Redis temporary seat holds
    await seatHolds.clear(booking.showtimeId, booking.seats.map((s) => s.id)).catch(() => {});

    const response: ApiResponse<PaymentVerifyResult> = {
      success: true,
      data: {
        booking: confirmedBooking,
        payment: updatedPayment ? toPaymentDetails(updatedPayment) : toPaymentDetailsFromBooking(confirmedBooking, flwResult),
        isConfirmed: true,
      },
      meta: {
        message: 'Payment verified and booking confirmed successfully',
        timestamp: new Date().toISOString(),
      },
    };
    return res.json(response);
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return next(new AppError(409, error.code, error.message));
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/payments/:bookingId/status — Check & reconcile payment status
// ---------------------------------------------------------------------------
router.get('/:bookingId/status', requireAuth, async (req, res, next) => {
  try {
    const store = getStore();
    const { bookingId } = req.params;

    const booking = await store.getBooking(bookingId);
    if (!booking) {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    if (booking.userId !== req.user!.id) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this booking is restricted');
    }

    let payment = await store.getPaymentByBookingId(booking.id);

    // Active status recovery: if booking is pending and payment is pending, attempt verification
    if (booking.status === 'pending' && payment && payment.status === 'pending') {
      try {
        const flwResult = await verifyTransactionByReference(payment.reference);
        if (flwResult.ok && flwResult.status === 'successful') {
          // Reconcile and confirm
          const updatedPayment = await store.updatePaymentStatus(
            payment.reference,
            'successful',
            flwResult.transactionId,
            flwResult.raw
          );
          const confirmedBooking = await store.confirmBooking(booking.id, req.user!.id, {
            paymentId: updatedPayment?.id || flwResult.transactionId,
          });
          await seatHolds.clear(booking.showtimeId, booking.seats.map((s) => s.id)).catch(() => {});

          return res.json({
            success: true,
            data: {
              booking: confirmedBooking,
              payment: updatedPayment ? toPaymentDetails(updatedPayment) : createFallbackPaymentDetails(confirmedBooking),
              isConfirmed: true,
              reconciled: true,
            },
            meta: { timestamp: new Date().toISOString() },
          });
        }
      } catch {
        // If lookup fails or transaction isn't completed, proceed with current database state
      }
    }

    return res.json({
      success: true,
      data: {
        booking,
        payment: payment ? toPaymentDetails(payment) : null,
        isConfirmed: booking.status === 'confirmed',
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/payments/callback — Browser redirect return handler for Flutterwave Standard
// ---------------------------------------------------------------------------
router.get('/callback', (req, res) => {
  const { status, tx_ref, transaction_id } = req.query as {
    status?: string;
    tx_ref?: string;
    transaction_id?: string;
  };

  const isSuccess = status === 'successful';
  const deepLink = `mobile://payment-complete?status=${encodeURIComponent(status || 'unknown')}&tx_ref=${encodeURIComponent(tx_ref || '')}&transaction_id=${encodeURIComponent(transaction_id || '')}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ReelPass - Payment ${isSuccess ? 'Completed' : 'Status'}</title>
  <style>
    body {
      background-color: #0B0B0F;
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 24px;
      text-align: center;
      box-sizing: border-box;
    }
    .icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: ${isSuccess ? 'rgba(74, 222, 128, 0.15)' : 'rgba(229, 169, 60, 0.15)'};
      color: ${isSuccess ? '#4ADE80' : '#E5A93C'};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
      margin-bottom: 20px;
      border: 1px solid ${isSuccess ? '#4ADE80' : '#E5A93C'};
    }
    h1 {
      font-size: 24px;
      margin: 0 0 10px 0;
      color: #FFFFFF;
    }
    p {
      color: #9CA3AF;
      font-size: 15px;
      margin: 0 0 24px 0;
      max-width: 340px;
      line-height: 1.5;
    }
    .btn {
      background: #E5A93C;
      color: #0B0B0F;
      font-weight: 700;
      text-decoration: none;
      padding: 14px 28px;
      border-radius: 12px;
      display: inline-block;
      font-size: 16px;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #F5C058;
    }
    .sub {
      margin-top: 16px;
      font-size: 13px;
      color: #6B7280;
    }
  </style>
  <script>
    // Automatically redirect back into the ReelPass mobile app
    window.onload = function() {
      setTimeout(function() {
        window.location.href = "${deepLink}";
      }, 300);
    };
  </script>
</head>
<body>
  <div class="icon">${isSuccess ? '✓' : 'ℹ'}</div>
  <h1>${isSuccess ? 'Payment Received' : 'Returning to ReelPass'}</h1>
  <p>${isSuccess ? 'Your payment has been received. Returning to ReelPass to finalize your digital cinema pass...' : 'Please return to the ReelPass app to view your reservation status.'}</p>
  <a class="btn" href="${deepLink}">Return to ReelPass</a>
  <div class="sub">Reference: ${tx_ref || 'N/A'}</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------------------------------------------------------------------------
// POST /api/v1/payments/webhook — Flutterwave webhook (fallback, replay-safe)
// ---------------------------------------------------------------------------
router.post('/webhook', async (req, res, next) => {
  try {
    if (!isWebhookConfigured()) {
      return res.status(503).json({
        success: false,
        error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook secret hash is not configured.' },
        meta: { timestamp: new Date().toISOString() },
      });
    }
    if (!verifyWebhookSignature(req.header('verif-hash') || undefined)) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed.' },
        meta: { timestamp: new Date().toISOString() },
      });
    }

    const event = req.body || {};
    const data = event.data || {};
    const reference: string | undefined = data.tx_ref;
    const status: string | undefined = data.status;

    if (!reference || status !== 'successful') {
      return res.json({ success: true, data: { ignored: true } });
    }

    const store = getStore();
    const payment = await store.getPaymentByReference(reference);
    if (!payment) {
      return res.json({ success: true, data: { ignored: true, reason: 'unknown_reference' } });
    }

    if (payment.status === 'successful') {
      return res.json({ success: true, data: { ignored: true, reason: 'already_processed' } });
    }

    const booking = await store.getBooking(payment.bookingId);
    if (!booking) {
      return res.json({ success: true, data: { ignored: true, reason: 'booking_missing' } });
    }

    const amountKobo = typeof data.amount === 'number' ? Math.round(data.amount * 100) : undefined;
    const expectedCurrency = getPaymentCurrency();

    if (data.currency !== expectedCurrency || (amountKobo !== undefined && amountKobo !== booking.totalAmount)) {
      await store.updatePaymentStatus(reference, 'failed', data.id ? String(data.id) : undefined, event, 'Amount or currency mismatch');
      return res.json({ success: true, data: { ignored: true, reason: 'amount_or_currency_mismatch' } });
    }

    // Check expiration before confirming
    const isExpired = booking.status === 'expired' || (booking.expiresAt && new Date(booking.expiresAt).getTime() < Date.now());
    if (isExpired) {
      await store.updatePaymentStatus(reference, 'successful', data.id ? String(data.id) : undefined, event, 'EXPIRED_RESERVATION_PAYMENT_NEEDS_REFUND');
      return res.json({ success: true, data: { ignored: true, reason: 'booking_expired' } });
    }

    await store.updatePaymentStatus(reference, 'successful', data.id ? String(data.id) : undefined, event);
    await store.confirmBooking(booking.id, booking.userId, { paymentId: data.id ? String(data.id) : undefined });
    await seatHolds.clear(booking.showtimeId, booking.seats.map((s) => s.id)).catch(() => {});

    return res.json({ success: true, data: { processed: true, bookingId: booking.id } });
  } catch (error) {
    next(error);
  }
});

// Helper formatting functions
function toPaymentDetails(record: any): PaymentDetails {
  return {
    id: record.id,
    bookingId: record.bookingId,
    userId: record.userId,
    amountKobo: record.amountKobo,
    currency: record.currency,
    provider: record.provider,
    reference: record.reference,
    transactionId: record.transactionId,
    status: record.status,
    failureReason: record.failureReason,
    createdAt: record.createdAt,
    verifiedAt: record.verifiedAt,
  };
}

function toPaymentDetailsFromBooking(booking: Booking, flwResult: VerificationResult): PaymentDetails {
  return {
    id: `pay-${booking.id}`,
    bookingId: booking.id,
    userId: booking.userId,
    amountKobo: booking.totalAmount,
    currency: booking.currency,
    provider: 'flutterwave',
    reference: flwResult.txRef || `RP-PAY-${booking.bookingReference}`,
    transactionId: flwResult.transactionId,
    status: 'successful',
    createdAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  };
}

function createFallbackPaymentDetails(booking: Booking): PaymentDetails {
  return {
    id: booking.paymentId || `pay-${booking.id}`,
    bookingId: booking.id,
    userId: booking.userId,
    amountKobo: booking.totalAmount,
    currency: booking.currency,
    provider: 'flutterwave',
    reference: `RP-PAY-${booking.bookingReference}`,
    status: 'successful',
    createdAt: booking.createdAt,
    verifiedAt: new Date().toISOString(),
  };
}

export default router;
