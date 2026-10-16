import { Router } from 'express';
import { ApiResponse, Booking, createBookingSchema, formatNaira } from '@matinee/shared';
import { getStore, BookingConflictError, isPostgresMode } from '../db/store';
import { seatHolds } from '../redis/seatHolds';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { isPaymentConfigured, verifyTransactionById, verifyTransactionByReference } from '../services/payment.service';

const router = Router();

function conflictToAppError(err: BookingConflictError): AppError {
  let status = err.statusCode;
  if (err.code === 'SHOWTIME_NOT_FOUND' || err.code === 'BOOKING_NOT_FOUND') status = 404;
  else if (err.code === 'INVALID_SEATS') status = 400;
  return new AppError(status, err.code, err.message, err.conflicts.length ? { conflicts: err.conflicts } : undefined);
}

// POST /api/v1/bookings — hold seats and create a pending reservation.
router.post('/', requireAuth, async (req, res, next) => {
  const store = getStore();
  const userId = req.user!.id;
  const ttl = env.SEAT_HOLD_TTL_SECONDS;
  const idempotencyKey =
    (req.header('Idempotency-Key') as string | undefined) ||
    (typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : undefined);

  let redisHeld = false;
  let showtimeId = '';
  let seatIds: string[] = [];

  try {
    const input = createBookingSchema.parse(req.body);
    showtimeId = input.showtimeId;
    seatIds = Array.from(new Set(input.seatIds));

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `🧾 [Booking:dev] POST /bookings mode=${store.mode} body_keys=[${Object.keys(req.body || {})}] ` +
          `showtimeId=${showtimeId} seatIds_count=${seatIds.length} userId=${userId}`
      );
    }

    // Fast-path atomic Redis hold (PostgreSQL mode only; DB remains the authority).
    if (isPostgresMode() && seatHolds.isLive()) {
      const hold = await seatHolds.hold(showtimeId, seatIds, userId, ttl);
      if (!hold.ok) {
        throw new AppError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats are currently held by another user.', {
          conflicts: hold.conflicts,
        });
      }
      redisHeld = true;
    }

    const { booking } = await store.createBooking({
      showtimeId,
      seatIds,
      userId,
      idempotencyKey,
      holdTtlSeconds: ttl,
    });

    const response: ApiResponse<Booking> = {
      success: true,
      data: booking,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        message: `Seats held for ${Math.round(ttl / 60)} minute(s). Payment confirmation required to complete the booking.`,
      },
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `✅ [Booking:dev] Created ${booking.id} (${booking.bookingReference}) seats=${booking.seats
          .map((s) => s.label)
          .join(',')} total=${formatNaira(booking.totalAmount)}`
      );
    }

    return res.status(201).json(response);
  } catch (error) {
    // Release the Redis hold if the DB write failed (all-or-nothing).
    if (redisHeld) {
      await seatHolds.release(showtimeId, seatIds, userId).catch(() => undefined);
    }
    if (error instanceof BookingConflictError) return next(conflictToAppError(error));
    if (process.env.NODE_ENV !== 'production') {
      const err = error as any;
      console.warn(
        `⚠️ [Booking:dev] Rejected POST /bookings status=${err?.statusCode || 400} ` +
          `code=${err?.code || 'VALIDATION_ERROR'} message=${err?.message}`
      );
    }
    next(error);
  }
});

// GET /api/v1/bookings/my-tickets
router.get('/my-tickets', requireAuth, async (req, res, next) => {
  try {
    const bookings = await getStore().listBookingsForUser(req.user!.id);
    const response: ApiResponse<Booking[]> = {
      success: true,
      data: bookings,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        totalResults: bookings.length,
      },
    };
    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/bookings/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const booking = await getStore().getBooking(req.params.id);
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', `Booking ${req.params.id} not found`);
    if (booking.userId !== req.user!.id && req.user!.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Access to this booking is restricted');
    }
    const response: ApiResponse<Booking> = {
      success: true,
      data: booking,
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };
    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/bookings/:id/confirm — confirm after verified payment (idempotent).
router.post('/:id/confirm', requireAuth, async (req, res, next) => {
  try {
    const store = getStore();
    const userId = req.user!.id;
    const booking = await store.getBooking(req.params.id);
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.userId !== userId) throw new AppError(403, 'FORBIDDEN', 'Access to this booking is restricted');

    // Idempotent: already confirmed returns the booking unchanged.
    if (booking.status === 'confirmed') {
      const response: ApiResponse<Booking> = {
        success: true,
        data: booking,
        meta: { requestId: req.id, timestamp: new Date().toISOString(), message: 'Booking already confirmed.' },
      };
      return res.json(response);
    }

    if (!isPaymentConfigured()) {
      throw new AppError(
        503,
        'PAYMENT_NOT_CONFIGURED',
        'Payment provider is not configured, so this booking cannot be confirmed. No payment was processed and no success has been recorded.'
      );
    }

    const transactionId = req.body?.transactionId;
    const txRef = req.body?.txRef || `RP-PAY-${booking.bookingReference}`;
    if (!transactionId && !txRef) {
      throw new AppError(400, 'PAYMENT_REFERENCE_REQUIRED', 'A transactionId or txRef is required to verify payment.');
    }

    const verification = transactionId
      ? await verifyTransactionById(transactionId)
      : await verifyTransactionByReference(txRef);

    if (!verification.ok) {
      throw new AppError(402, 'PAYMENT_NOT_VERIFIED', `Payment could not be verified (${verification.reason || verification.status || 'unknown'}).`);
    }
    if (verification.currency !== 'NGN') {
      throw new AppError(402, 'PAYMENT_CURRENCY_MISMATCH', `Expected NGN but gateway reported ${verification.currency}.`);
    }
    if (verification.amountKobo !== booking.totalAmount) {
      throw new AppError(402, 'PAYMENT_AMOUNT_MISMATCH', `Paid amount does not match the booking total.`);
    }

    const reference = verification.txRef || `RP-PAY-${booking.bookingReference}`;
    const existingPayment = await store.getPaymentByReference(reference);
    if (!existingPayment) {
      await store.createPayment({
        id: `pay-${Date.now()}`,
        bookingId: booking.id,
        amountKobo: booking.totalAmount,
        reference,
        status: 'pending',
      });
    }
    await store.updatePaymentStatus(reference, 'successful', verification.transactionId, verification.raw);
    const confirmed = await store.confirmBooking(booking.id, userId, { paymentId: verification.transactionId });
    if (isPostgresMode() && seatHolds.isLive()) {
      await seatHolds.clear(booking.showtimeId, booking.seats.map((s) => s.id));
    }

    const response: ApiResponse<Booking> = {
      success: true,
      data: confirmed,
      meta: { requestId: req.id, timestamp: new Date().toISOString(), message: 'Payment verified and booking confirmed.' },
    };
    return res.json(response);
  } catch (error) {
    if (error instanceof BookingConflictError) return next(conflictToAppError(error));
    next(error);
  }
});

// POST /api/v1/bookings/:id/cancel — release a pending reservation.
router.post('/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const store = getStore();
    const userId = req.user!.id;
    const booking = await store.getBooking(req.params.id);
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.userId !== userId) throw new AppError(403, 'FORBIDDEN', 'Access to this booking is restricted');

    const cancelled = await store.cancelBooking(booking.id, userId);
    if (isPostgresMode() && seatHolds.isLive()) {
      await seatHolds.release(booking.showtimeId, booking.seats.map((s) => s.id), userId);
    }

    const response: ApiResponse<Booking> = {
      success: true,
      data: cancelled,
      meta: { requestId: req.id, timestamp: new Date().toISOString(), message: 'Reservation cancelled and seats released.' },
    };
    return res.json(response);
  } catch (error) {
    if (error instanceof BookingConflictError) return next(conflictToAppError(error));
    next(error);
  }
});

export default router;
