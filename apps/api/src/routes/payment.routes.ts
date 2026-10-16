import { Router } from 'express';
import { ApiResponse } from '@matinee/shared';
import { getStore, BookingConflictError } from '../db/store';
import { seatHolds } from '../redis/seatHolds';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  initializePayment,
  isPaymentConfigured,
  isWebhookConfigured,
  verifyWebhookSignature,
} from '../services/payment.service';

const router = Router();

// GET /api/v1/payments/status — is a live payment provider configured?
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      provider: 'flutterwave',
      configured: isPaymentConfigured(),
      webhookConfigured: isWebhookConfigured(),
      mode: 'sandbox',
      note: 'No credentials are bundled with this project. Confirmation fails closed until real sandbox keys are supplied.',
    },
    meta: { timestamp: new Date().toISOString() },
  });
});

// POST /api/v1/payments/initialize — create a checkout link for a pending booking.
router.post('/initialize', requireAuth, async (req, res, next) => {
  try {
    const store = getStore();
    const bookingId = req.body?.bookingId;
    if (!bookingId) throw new AppError(400, 'BOOKING_ID_REQUIRED', 'bookingId is required');

    const booking = await store.getBooking(bookingId);
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.userId !== req.user!.id) throw new AppError(403, 'FORBIDDEN', 'Access to this booking is restricted');
    if (booking.status === 'confirmed') {
      throw new AppError(409, 'BOOKING_ALREADY_CONFIRMED', 'This booking is already confirmed');
    }

    const user = await store.findUserById(req.user!.id);
    const result = await initializePayment({
      bookingReference: booking.bookingReference,
      amountKobo: booking.totalAmount,
      customerEmail: user?.email ?? 'demo@reelpass.app',
      customerName: user?.fullName ?? 'ReelPass Customer',
    });

    if (!result.configured) {
      throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', result.message || 'Payment provider is not configured.');
    }

    const existing = await store.getPaymentByReference(result.reference);
    if (!existing) {
      await store.createPayment({
        id: `pay-${Date.now()}`,
        bookingId: booking.id,
        amountKobo: booking.totalAmount,
        reference: result.reference,
        status: 'pending',
      });
    }

    const response: ApiResponse<{ link?: string; reference: string }> = {
      success: true,
      data: { link: result.link, reference: result.reference },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };
    return res.json(response);
  } catch (error) {
    if (error instanceof BookingConflictError) return next(new AppError(409, error.code, error.message));
    next(error);
  }
});

// POST /api/v1/payments/webhook — Flutterwave webhook (idempotent, replay-safe).
router.post('/webhook', async (req, res, next) => {
  try {
    if (!isWebhookConfigured()) {
      // Fail closed: without a configured secret hash we cannot trust the caller.
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

    // Nothing actionable — acknowledge so the gateway stops retrying.
    if (!reference || status !== 'successful') {
      return res.json({ success: true, data: { ignored: true } });
    }

    const store = getStore();
    const payment = await store.getPaymentByReference(reference);
    if (!payment) {
      return res.json({ success: true, data: { ignored: true, reason: 'unknown_reference' } });
    }

    // Replay protection: a already-successful payment is never reprocessed.
    if (payment.status === 'successful') {
      return res.json({ success: true, data: { ignored: true, reason: 'already_processed' } });
    }

    const booking = await store.getBooking(payment.bookingId);
    if (!booking) {
      return res.json({ success: true, data: { ignored: true, reason: 'booking_missing' } });
    }

    const amountKobo = typeof data.amount === 'number' ? Math.round(data.amount * 100) : undefined;
    if (data.currency !== 'NGN' || (amountKobo !== undefined && amountKobo !== booking.totalAmount)) {
      await store.updatePaymentStatus(reference, 'failed', data.id ? String(data.id) : undefined, event);
      return res.json({ success: true, data: { ignored: true, reason: 'amount_or_currency_mismatch' } });
    }

    await store.updatePaymentStatus(reference, 'successful', data.id ? String(data.id) : undefined, event);
    await store.confirmBooking(booking.id, booking.userId, { paymentId: data.id ? String(data.id) : undefined });
    await seatHolds.clear(booking.showtimeId, booking.seats.map((s) => s.id));

    return res.json({ success: true, data: { processed: true, bookingId: booking.id } });
  } catch (error) {
    next(error);
  }
});

export default router;
