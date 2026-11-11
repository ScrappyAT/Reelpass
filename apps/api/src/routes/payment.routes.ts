import { Router } from 'express';
import { z } from 'zod';
import { getStore, BookingConflictError } from '../db/store';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getPaymentCurrency, isPaymentConfigured, isWebhookConfigured, verifyWebhookSignature } from '../services/payment.service';
import { acceptPaymentEvent, createCheckout, identifier, idempotencyKey, paymentPool, transactionIdentifier } from '../services/paymentWorkflow';

import { rateLimit } from '../services/traffic';

const router = Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

router.get('/status', (_req, res) => {
  res.json({ success: true, data: {
    provider: 'flutterwave', configured: isPaymentConfigured(), webhookConfigured: isWebhookConfigured(),
    currency: getPaymentCurrency(), mode: 'sandbox_v3',
  } });
});

const checkoutBody = z.object({ bookingId: identifier, redirectUrl: z.string().max(500).optional() });

router.post('/initialize', requireAuth, rateLimit('checkout', 16, 60), async (req, res, next) => {
  try {
    const { bookingId } = checkoutBody.parse(req.body);
    // Older APKs omit the header. Use the same booking-scoped key on retries.
    const key = idempotencyKey.parse(req.get('Idempotency-Key') ?? bookingId);
    const result = await createCheckout(bookingId, req.user!.id, key);
    return res.status(result.link ? 200 : 202).json({ success: true, data: result,
      meta: { message: result.link ? 'Checkout ready.' : 'Checkout is still being prepared or awaiting payment.' } });
  } catch (error) { next(error); }
});

const statusInput = z.object({
  bookingId: identifier.optional(), reference: identifier.optional(), transactionId: transactionIdentifier.optional(),
}).refine(input => Boolean(input.bookingId || input.reference || input.transactionId), { message: 'Booking or payment reference is required.' });

/** All client recovery paths read the same persisted state. No provider call or write. */
export async function readCheckoutStatus(userId: string, input: z.input<typeof statusInput>) {
  const { bookingId, reference, transactionId } = statusInput.parse(input);
  const store = getStore();
  const byRef = reference ? await store.getPaymentByReference(reference) : null;
  const byTx = transactionId ? await store.getPaymentByTransactionId(transactionId) : null;
  const id = bookingId ?? byRef?.bookingId ?? byTx?.bookingId;
  if (!id) throw new AppError(404, 'BOOKING_NOT_FOUND', 'No booking matches this checkout.');
  let booking;
  try { booking = await store.getBooking(id); }
  catch (error) {
    if (error instanceof BookingConflictError && error.code === 'BOOKING_NOT_FOUND') {
      throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
    }
    throw error;
  }
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found.');
  if (booking.userId !== userId) throw new AppError(403, 'FORBIDDEN', 'This booking belongs to another account.');
  if ((reference && !byRef) || (byRef && byRef.bookingId !== id) || (byTx && byTx.bookingId !== id)
      || (byRef && byTx && byRef.id !== byTx.id)
      || (transactionId && byRef?.transactionId && byRef.transactionId !== transactionId)) {
    throw new AppError(409, 'PAYMENT_REFERENCE_MISMATCH', 'This payment does not match the booking.');
  }
  const payment = byRef ?? byTx ?? await store.getPaymentByBookingId(id);
  if (payment && payment.userId !== userId) throw new AppError(403, 'FORBIDDEN', 'This payment belongs to another account.');
  if (transactionId && ((payment?.transactionId && payment.transactionId !== transactionId)
      || (!payment?.transactionId && booking.status === 'confirmed'))) {
    throw new AppError(409, 'PAYMENT_REFERENCE_MISMATCH', 'This transaction does not match the settled booking.');
  }
  const isConfirmed = booking.status === 'confirmed' && booking.paymentStatus === 'successful';
  return {
    booking,
    payment: payment ? {
      id: payment.id, bookingId: payment.bookingId, userId: payment.userId, amountKobo: payment.amountKobo,
      currency: payment.currency, provider: payment.provider, reference: payment.reference,
      transactionId: payment.transactionId, status: payment.status, failureReason: payment.failureReason,
      createdAt: payment.createdAt, verifiedAt: payment.verifiedAt,
    } : null,
    isConfirmed,
  };
}

router.post('/verify', requireAuth, async (req, res, next) => {
  try {
    const data = await readCheckoutStatus(req.user!.id, req.body);
    return res.json({ success: true, data });
  } catch (error) { next(error); }
});

router.get('/:bookingId/status', requireAuth, async (req, res, next) => {
  try {
    const data = await readCheckoutStatus(req.user!.id, { bookingId: req.params.bookingId });
    return res.json({ success: true, data });
  } catch (error) { next(error); }
});

router.get('/callback', (req, res) => {
  const parsed = z.object({
    status: z.enum(['successful', 'failed', 'cancelled']).optional(), tx_ref: identifier.optional(),
    transaction_id: transactionIdentifier.optional(),
  }).safeParse(req.query);
  const query = new URLSearchParams();
  if (parsed.success) {
    if (parsed.data.status) query.set('status', parsed.data.status);
    if (parsed.data.tx_ref) query.set('tx_ref', parsed.data.tx_ref);
    if (parsed.data.transaction_id) query.set('transaction_id', parsed.data.transaction_id);
  }
  const deepLink = 'mobile://payment-complete?' + query.toString();
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  res.type('html').send('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Return to ReelPass</title>' +
    '<p>ReelPass will show your ticket after payment is confirmed.</p><a href="' + deepLink.replace(/&/g, '&amp;') +
    '">Return to ReelPass</a><script>setTimeout(() => {location.href=' + JSON.stringify(deepLink) + '},300)</script></html>');
});

router.post('/webhook', async (req, res, next) => {
  try {
    if (!isWebhookConfigured()) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook intake is unavailable.');
    if (!verifyWebhookSignature(req.get('verif-hash'))) throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    if (req.body?.event !== 'charge.completed') return res.json({ success: true, ignored: true });
    const eventId = await acceptPaymentEvent(req.body);
    // Flutterwave v3 expects HTTP 200. The committed inbox row is the acknowledgement boundary.
    return res.json({ success: true, accepted: true, eventId });
  } catch (error) { next(error); }
});

router.get('/admin/workflow', requireAuth, async (req, res, next) => {
  try {
    const user = await getStore().findUserById(req.user!.id);
    if (user?.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Administrator access is required.');
    const pool = paymentPool();
    const [events, refunds, review] = await Promise.all([
      pool.query("SELECT event_key, status, attempts, result_code FROM payment_events WHERE status IN ('failed','rejected') ORDER BY finished_at DESC LIMIT 30"),
      pool.query("SELECT id, status, reason, check_attempts FROM refunds WHERE status IN ('failed','needs_review') ORDER BY updated_at DESC LIMIT 30"),
      pool.query("SELECT booking_id, reason, recorded_at FROM refund_reconciliation ORDER BY recorded_at DESC LIMIT 30"),
    ]);
    return res.json({ success: true, data: { events: events.rows, refunds: refunds.rows, reconciliation: review.rows } });
  } catch (error) { next(error); }
});

export default router;
