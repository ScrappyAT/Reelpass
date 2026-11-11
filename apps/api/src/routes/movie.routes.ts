import { Router } from 'express';
import { ApiResponse, Movie } from '@matinee/shared';
import { tmdbService, TMDB_ATTRIBUTION } from '../services/tmdb.service';
import { AppError } from '../middleware/errorHandler';

import { z } from 'zod';
import { optionalAuth } from '../middleware/auth';
import { rateLimit } from '../services/traffic';

const router = Router();
const pageParam = z.coerce.number().int().min(1).max(100).default(1);

// GET /api/v1/movies/now-playing
router.get('/now-playing', async (req, res, next) => {
  try {
    const page = pageParam.parse(req.query.page);
    const { movies, isDemo } = await tmdbService.getNowPlaying(page);

    const response: ApiResponse<Movie[]> = {
      success: true,
      data: movies,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        isDemoData: isDemo,
        attribution: TMDB_ATTRIBUTION,
        page,
        totalResults: movies.length,
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/movies/upcoming
router.get('/upcoming', async (req, res, next) => {
  try {
    const page = pageParam.parse(req.query.page);
    const { movies, isDemo } = await tmdbService.getUpcoming(page);

    const response: ApiResponse<Movie[]> = {
      success: true,
      data: movies,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        isDemoData: isDemo,
        attribution: TMDB_ATTRIBUTION,
        page,
        totalResults: movies.length,
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/movies/popular
router.get('/popular', async (req, res, next) => {
  try {
    const page = pageParam.parse(req.query.page);
    const { movies, isDemo } = await tmdbService.getPopular(page);

    const response: ApiResponse<Movie[]> = {
      success: true,
      data: movies,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        isDemoData: isDemo,
        attribution: TMDB_ATTRIBUTION,
        page,
        totalResults: movies.length,
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/movies/search?q=...
router.get('/search', optionalAuth, rateLimit('search', 45, 100), async (req, res, next) => {
  try {
    const query = z.string().trim().max(120).default('').parse(req.query.q);
    const page = pageParam.parse(req.query.page);
    const { movies, isDemo } = await tmdbService.searchMovies(query, page);

    const response: ApiResponse<Movie[]> = {
      success: true,
      data: movies,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        isDemoData: isDemo,
        attribution: TMDB_ATTRIBUTION,
        page,
        totalResults: movies.length,
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/movies/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { movie, isDemo } = await tmdbService.getMovieDetails(id);

    if (!movie) {
      throw new AppError(404, 'MOVIE_NOT_FOUND', `Movie with id ${id} not found`);
    }

    const response: ApiResponse<Movie> = {
      success: true,
      data: movie,
      meta: {
        requestId: req.id,
        timestamp: new Date().toISOString(),
        isDemoData: isDemo,
        attribution: TMDB_ATTRIBUTION,
      },
    };

    return res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
