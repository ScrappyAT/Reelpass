import { Router } from 'express';
import { ApiResponse, Showtime, SeatMapLayout } from '@matinee/shared';
import { getStore } from '../db/store';
import { AppError } from '../middleware/errorHandler';

const router = Router();

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
