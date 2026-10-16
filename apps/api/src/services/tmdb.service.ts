import { Movie, ApiResponse } from '@matinee/shared';
import { env } from '../config/env';
import { cache } from '../redis/client';
import { memoryStore } from '../db/memoryStore';

export const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export class TmdbService {
  private apiKey = env.TMDB_API_KEY;
  private baseUrl = env.TMDB_BASE_URL;
  private imageBase = env.TMDB_IMAGE_BASE_URL;

  // Exponential backoff fetcher
  private async fetchWithRetry(url: string, retries: number = 3, backoffMs: number = 300): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const separator = url.includes('?') ? '&' : '?';
        const fullUrl = `${url}${separator}api_key=${this.apiKey}`;
        const res = await fetch(fullUrl, {
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          throw new Error(`TMDB HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
      } catch (err: any) {
        if (attempt === retries) throw err;
        await new Promise((resolve) => setTimeout(resolve, backoffMs * Math.pow(2, attempt - 1)));
      }
    }
  }

  // Format TMDB raw movie object to Matinee Movie type
  private transformTmdbMovie(raw: any, status: 'now_playing' | 'upcoming' | 'popular' = 'now_playing'): Movie {
    return {
      id: `tmdb-${raw.id}`,
      tmdbId: raw.id,
      title: raw.title || raw.name || 'Untitled',
      tagline: raw.tagline || undefined,
      overview: raw.overview || 'No overview available for this title.',
      posterUrl: raw.poster_path ? `${this.imageBase}/w780${raw.poster_path}` : 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80',
      backdropUrl: raw.backdrop_path ? `${this.imageBase}/w1280${raw.backdrop_path}` : 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=80',
      releaseDate: raw.release_date || '2024-01-01',
      runtimeMinutes: raw.runtime || 125,
      genres: raw.genres || (raw.genre_ids ? raw.genre_ids.map((gid: number) => ({ id: gid, name: 'Cinema' })) : [{ id: 28, name: 'Action' }]),
      rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : 8.0,
      voteCount: raw.vote_count || 120,
      certification: raw.adult ? '18+' : 'PG-13',
      status,
    };
  }

  async getNowPlaying(page: number = 1): Promise<{ movies: Movie[]; isDemo: boolean }> {
    const cacheKey = `tmdb:now_playing:page:${page}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { movies: JSON.parse(cached), isDemo: false };
    }

    if (!this.apiKey || this.apiKey.includes('your_tmdb_api_key')) {
      const demoMovies = Array.from(memoryStore.movies.values()).filter((m) => m.status === 'now_playing');
      return { movies: demoMovies, isDemo: true };
    }

    try {
      const data = await this.fetchWithRetry(`${this.baseUrl}/movie/now_playing?page=${page}`);
      const movies = data.results.map((raw: any) => this.transformTmdbMovie(raw, 'now_playing'));
      await cache.set(cacheKey, JSON.stringify(movies), 900); // 15 mins TTL
      return { movies, isDemo: false };
    } catch (err) {
      console.warn('⚠️ [TMDB] Failed to fetch now playing movies, using fallback demo catalog:', err);
      const demoMovies = Array.from(memoryStore.movies.values()).filter((m) => m.status === 'now_playing');
      return { movies: demoMovies, isDemo: true };
    }
  }

  async getUpcoming(page: number = 1): Promise<{ movies: Movie[]; isDemo: boolean }> {
    const cacheKey = `tmdb:upcoming:page:${page}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { movies: JSON.parse(cached), isDemo: false };
    }

    if (!this.apiKey || this.apiKey.includes('your_tmdb_api_key')) {
      const demoMovies = Array.from(memoryStore.movies.values()).filter((m) => m.status === 'upcoming');
      return { movies: demoMovies, isDemo: true };
    }

    try {
      const data = await this.fetchWithRetry(`${this.baseUrl}/movie/upcoming?page=${page}`);
      const movies = data.results.map((raw: any) => this.transformTmdbMovie(raw, 'upcoming'));
      await cache.set(cacheKey, JSON.stringify(movies), 1800);
      return { movies, isDemo: false };
    } catch (err) {
      const demoMovies = Array.from(memoryStore.movies.values()).filter((m) => m.status === 'upcoming');
      return { movies: demoMovies, isDemo: true };
    }
  }

  async getPopular(page: number = 1): Promise<{ movies: Movie[]; isDemo: boolean }> {
    const cacheKey = `tmdb:popular:page:${page}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { movies: JSON.parse(cached), isDemo: false };
    }

    if (!this.apiKey || this.apiKey.includes('your_tmdb_api_key')) {
      const demoMovies = Array.from(memoryStore.movies.values()).filter((m) => m.status === 'popular');
      return { movies: demoMovies, isDemo: true };
    }

    try {
      const data = await this.fetchWithRetry(`${this.baseUrl}/movie/popular?page=${page}`);
      const movies = data.results.map((raw: any) => this.transformTmdbMovie(raw, 'popular'));
      await cache.set(cacheKey, JSON.stringify(movies), 1800);
      return { movies, isDemo: false };
    } catch (err) {
      const demoMovies = Array.from(memoryStore.movies.values()).filter((m) => m.status === 'popular');
      return { movies: demoMovies, isDemo: true };
    }
  }

  async searchMovies(query: string, page: number = 1): Promise<{ movies: Movie[]; isDemo: boolean }> {
    if (!query || !query.trim()) {
      return this.getNowPlaying(page);
    }

    const cleanQuery = query.trim().toLowerCase();
    const cacheKey = `tmdb:search:${cleanQuery}:page:${page}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { movies: JSON.parse(cached), isDemo: false };
    }

    if (!this.apiKey || this.apiKey.includes('your_tmdb_api_key')) {
      const matched = Array.from(memoryStore.movies.values()).filter((m) =>
        m.title.toLowerCase().includes(cleanQuery) ||
        m.overview.toLowerCase().includes(cleanQuery) ||
        m.genres.some((g) => g.name.toLowerCase().includes(cleanQuery))
      );
      return { movies: matched, isDemo: true };
    }

    try {
      const data = await this.fetchWithRetry(`${this.baseUrl}/search/movie?query=${encodeURIComponent(cleanQuery)}&page=${page}`);
      const movies = data.results.map((raw: any) => this.transformTmdbMovie(raw, 'now_playing'));
      await cache.set(cacheKey, JSON.stringify(movies), 600);
      return { movies, isDemo: false };
    } catch (err) {
      const matched = Array.from(memoryStore.movies.values()).filter((m) =>
        m.title.toLowerCase().includes(cleanQuery) ||
        m.overview.toLowerCase().includes(cleanQuery)
      );
      return { movies: matched, isDemo: true };
    }
  }

  async getMovieDetails(id: string): Promise<{ movie: Movie | null; isDemo: boolean }> {
    // Check in-memory store first
    const localMovie = memoryStore.movies.get(id);
    if (localMovie) {
      return { movie: localMovie, isDemo: true };
    }

    const cacheKey = `tmdb:movie:${id}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return { movie: JSON.parse(cached), isDemo: false };
    }

    const numericId = id.replace('tmdb-', '');
    if (!this.apiKey || this.apiKey.includes('your_tmdb_api_key')) {
      const found = Array.from(memoryStore.movies.values()).find(
        (m) => m.id === id || String(m.tmdbId) === numericId
      );
      return { movie: found || null, isDemo: true };
    }

    try {
      const raw = await this.fetchWithRetry(`${this.baseUrl}/movie/${numericId}`);
      const movie = this.transformTmdbMovie(raw, 'now_playing');
      await cache.set(cacheKey, JSON.stringify(movie), 3600); // 1 hr TTL
      return { movie, isDemo: false };
    } catch (err) {
      const found = Array.from(memoryStore.movies.values()).find(
        (m) => m.id === id || String(m.tmdbId) === numericId
      );
      return { movie: found || null, isDemo: true };
    }
  }
}

export const tmdbService = new TmdbService();
