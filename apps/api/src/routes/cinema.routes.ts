import { Router } from 'express';
import { ApiResponse, Cinema, Showtime } from '@matinee/shared';
import { getStore } from '../db/store';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/v1/cinemas?city=Lagos
router.get('/', async (req, res, next) => {
  try {
    const { city } = req.query;
    const cinemas = await getStore().listCinemas(city ? String(city).trim() : undefined);

    const response: ApiResponse<Cinema[]> = {
      success: true,
      data: cinemas,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        totalResults: cinemas.length,
        note: 'Demo cinema records for Nigerian cities. These are fictional demo cinemas, not real businesses or verified partners.',
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/cinemas/:id
router.get('/:id', async (req, res, next) => {
  try {
    const cinema = await getStore().getCinema(req.params.id);
    if (!cinema) {
      throw new AppError(404, 'CINEMA_NOT_FOUND', `Cinema with id ${req.params.id} not found`);
    }

    const response: ApiResponse<Cinema> = {
      success: true,
      data: cinema,
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/cinemas/:id/showtimes
router.get('/:id/showtimes', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { movieId, date } = req.query;

    const store = getStore();
    const cinema = await store.getCinema(id);
    if (!cinema) {
      throw new AppError(404, 'CINEMA_NOT_FOUND', `Cinema with id ${id} not found`);
    }

    const showtimes = await store.listShowtimes({
      cinemaId: id,
      movieId: movieId ? String(movieId) : undefined,
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

export default router;
