import { Router } from 'express';
import { ApiResponse, Booking, createBookingSchema, formatNaira } from '@matinee/shared';
import { getStore, BookingConflictError, isPostgresMode } from '../db/store';
import { seatHolds } from '../redis/seatHolds';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { isPaymentConfigured } from '../services/payment.service';
import { readCheckoutStatus } from './payment.routes';
import { createHash, randomUUID } from 'node:crypto';
import { idempotencyKey as keySchema } from '../services/paymentWorkflow';
import { bookingFingerprint } from '../db/bookingHolds';

import { getAdmission, rateLimit } from '../services/traffic';

const router = Router();

function conflictToAppError(err: BookingConflictError): AppError {
  let status = err.statusCode;
  if (err.code === 'SHOWTIME_NOT_FOUND' || err.code === 'BOOKING_NOT_FOUND') status = 404;
  else if (err.code === 'INVALID_SEATS') status = 400;
  return new AppError(status, err.code, err.message, err.conflicts.length ? { conflicts: err.conflicts } : undefined);
}

// POST /api/v1/bookings — hold seats and create a pending reservation.
router.post('/', requireAuth, rateLimit('hold', 20, 120), async (req, res, next) => {
  const store = getStore();
  const userId = req.user!.id;
  const ttl = env.SEAT_HOLD_TTL_SECONDS;
  let holdToken: string = randomUUID();

  let redisHeld = false;
  let showtimeId = '';
  let seatIds: string[] = [];

  try {
    const input = createBookingSchema.parse(req.body);
    const idempotencyKey = keySchema.optional().parse(req.get('Idempotency-Key') ?? req.body?.idempotencyKey);
    if (idempotencyKey) {
      holdToken = createHash('sha256').update(JSON.stringify([userId, idempotencyKey,
        bookingFingerprint(input.showtimeId, input.seatIds)])).digest('hex');
      const prior = await store.findBookingReplay(userId, idempotencyKey, input.showtimeId, input.seatIds);
      if (prior) return res.status(201).json({ success: true, data: prior });
    }
    showtimeId = input.showtimeId;
    const admission = await getAdmission(showtimeId, userId);
    if (!admission.admitted) {
      res.setHeader('Retry-After', admission.retryAfter);
      throw new AppError(429, 'WAITING_ROOM', 'This showtime is busy. Please wait for your turn.', admission);
    }
    seatIds = Array.from(new Set(input.seatIds));

    if (env.NODE_ENV === 'development') {
      console.log(
        `🧾 [Booking:dev] POST /bookings mode=${store.mode} body_keys=[${Object.keys(req.body || {})}] ` +
          `showtimeId=${showtimeId} seatIds_count=${seatIds.length} userId=${userId}`
      );
    }

    // Fast-path atomic Redis hold (PostgreSQL mode only; DB remains the authority).
    if (isPostgresMode() && seatHolds.isLive()) {
      const hold = await seatHolds.hold(showtimeId, seatIds, holdToken, ttl);
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
      holdToken,
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

    if (env.NODE_ENV === 'development') {
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
      await seatHolds.release(showtimeId, seatIds, holdToken).catch(() => undefined);
    }
    if (error instanceof BookingConflictError) return next(conflictToAppError(error));
    if (env.NODE_ENV === 'development') {
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

// Kept for old clients. It can report a verified booking, never confirm one.
router.post('/:id/confirm', requireAuth, async (req, res, next) => {
  try {
    const data = await readCheckoutStatus(req.user!.id, { bookingId: req.params.id,
      reference: req.body?.txRef, transactionId: req.body?.transactionId });
    if (data.isConfirmed) return res.json({ success: true, data: data.booking });
    if (!isPaymentConfigured()) throw new AppError(503, 'PAYMENT_NOT_CONFIGURED', 'Sandbox checkout is unavailable.');
    throw new AppError(202, 'PAYMENT_PENDING', 'Waiting for a verified payment notification.');
  } catch (error) { next(error); }
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
