import { Router } from 'express';
import { ApiResponse, Showtime, SeatMapLayout } from '@matinee/shared';
import { getStore } from '../db/store';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { cancelShowtime } from '../services/refundWorkflow';
import { identifier, paymentPool } from '../services/paymentWorkflow';

import { getAdmission, rateLimit } from '../services/traffic';

const router = Router();

router.post('/:id/admission', requireAuth, rateLimit('admission', 70, 300), async (req, res, next) => {
  try {
    const data = await getAdmission(identifier.parse(req.params.id), req.user!.id);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data });
  } catch (error) { next(error); }
});

router.post('/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const user = await getStore().findUserById(req.user!.id);
    if (user?.role !== 'admin') throw new AppError(403, 'FORBIDDEN', 'Administrator access is required.');
    const data = await cancelShowtime(paymentPool(), identifier.parse(req.params.id));
    return res.json({ success: true, data });
  } catch (error) { next(error); }
});

// GET /api/v1/showtimes?movieId=...&cinemaId=...&date=...
router.get('/', async (req, res, next) => {
  try {
    const { movieId, cinemaId, date } = req.query;
    const showtimes = await getStore().listShowtimes({
      movieId: movieId ? String(movieId) : undefined,
      cinemaId: cinemaId ? String(cinemaId) : undefined,
      date: date ? String(date) : undefined,
    });

    const response: ApiResponse<Showtime[]> = {
      success: true,
      data: showtimes,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        totalResults: showtimes.length,
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/showtimes/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const showtime = await getStore().getShowtime(id);
    if (!showtime) {
      throw new AppError(404, 'SHOWTIME_NOT_FOUND', `Showtime with id ${id} not found`);
    }

    const response: ApiResponse<Showtime> = {
      success: true,
      data: showtime,
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/showtimes/:id/seats (Returns the 320-seat layout with live state)
router.get('/:id/seats', async (req, res, next) => {
  try {
    const { id } = req.params;
    const layout = await getStore().getSeatMap(id);
    if (!layout) {
      throw new AppError(404, 'SHOWTIME_NOT_FOUND', `Showtime with id ${id} not found`);
    }

    const response: ApiResponse<SeatMapLayout> = {
      success: true,
      data: layout,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        totalSeats: layout.totalSeats,
        note: 'Seat states reflect live PostgreSQL-held reservations and Redis holds.',
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
