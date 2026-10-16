import { Router } from 'express';
import { ApiResponse, Movie } from '@matinee/shared';
import { tmdbService, TMDB_ATTRIBUTION } from '../services/tmdb.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/v1/movies/now-playing
router.get('/now-playing', async (req, res, next) => {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
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
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
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
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
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
router.get('/search', async (req, res, next) => {
  try {
    const query = (req.query.q as string) || '';
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
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
