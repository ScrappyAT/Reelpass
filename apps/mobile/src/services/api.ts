import {
  Movie,
  Cinema,
  Showtime,
  SeatMapLayout,
  Booking,
  User,
  ApiResponse,
  AuthResponse,
} from '@matinee/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const PRODUCTION_API_URL = 'https://matineeapi-production.up.railway.app/api/v1';

// Dynamically resolve API URL for physical devices on same Wi-Fi, emulators, or web
function resolveApiBaseUrl(): string {
  // 1. Explicit environment variable takes precedence
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 2. Production standalone builds (e.g. Android APK / iOS release) default to live Railway API
  if (!__DEV__) {
    return PRODUCTION_API_URL;
  }

  // 3. Physical phone via Expo Go on Wi-Fi (Constants.expoConfig?.hostUri is e.g. "192.168.1.163:8081")
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;

  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:4000/api/v1`;
    }
  }

  // 4. Android Emulator fallback in local dev
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:4000/api/v1';
  }

  // 5. iOS Simulator / Web fallback in local dev
  return 'http://localhost:4000/api/v1';
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Thrown when the Express backend cannot be reached at all (timeout / refused). */
export class ApiConnectionError extends Error {
  endpoint: string;
  constructor(endpoint: string, reason: string) {
    super(
      `Cannot reach the ReelPass server for ${endpoint} (${reason}). ` +
        `Booking requires the backend running on port 4000 — check your Wi-Fi and that the API is started.`
    );
    this.name = 'ApiConnectionError';
    this.endpoint = endpoint;
  }
}

export function isApiConnectionError(error: unknown): error is ApiConnectionError {
  return error instanceof ApiConnectionError;
}

// Curated high-reliability fallback movie catalog (offline browsing only — bookings are NEVER faked)
export const FALLBACK_MOVIES: Movie[] = [
  {
    id: 'm-301',
    tmdbId: 693134,
    title: 'Dune: Part Two',
    tagline: 'Long live the fighters.',
    overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
    posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=800&q=80',
    backdropUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
    releaseDate: '2024-03-01',
    runtimeMinutes: 166,
    genres: [{ id: 878, name: 'Sci-Fi' }, { id: 12, name: 'Adventure' }],
    rating: 8.5,
    voteCount: 5420,
    certification: 'PG-13',
    status: 'now_playing',
  },
  {
    id: 'm-302',
    tmdbId: 872585,
    title: 'Oppenheimer',
    tagline: 'The world forever changes.',
    overview: 'The story of J. Robert Oppenheimer’s role in the development of the atomic bomb during World War II.',
    posterUrl: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?auto=format&fit=crop&w=800&q=80',
    backdropUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1200&q=80',
    releaseDate: '2023-07-21',
    runtimeMinutes: 180,
    genres: [{ id: 18, name: 'Drama' }, { id: 36, name: 'History' }],
    rating: 8.6,
    voteCount: 8900,
    certification: 'R',
    status: 'now_playing',
  },
  {
    id: 'm-303',
    tmdbId: 569094,
    title: 'Spider-Man: Across the Spider-Verse',
    tagline: 'It’s how you wear the mask that matters.',
    overview: 'Brooklyn’s full-time Spider-Man is catapulted across the Multiverse to encounter the Spider Society.',
    posterUrl: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?auto=format&fit=crop&w=800&q=80',
    backdropUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=1200&q=80',
    releaseDate: '2023-06-02',
    runtimeMinutes: 140,
    genres: [{ id: 16, name: 'Animation' }, { id: 28, name: 'Action' }],
    rating: 8.7,
    voteCount: 6400,
    certification: 'PG',
    status: 'now_playing',
  },
  {
    id: 'm-304',
    tmdbId: 157336,
    title: 'Interstellar (10th Anniversary IMAX)',
    tagline: 'Mankind was born on Earth. It was never meant to die here.',
    overview: 'A team of explorers travel through a wormhole in space to ensure humanity’s survival.',
    posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80',
    backdropUrl: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1200&q=80',
    releaseDate: '2014-11-07',
    runtimeMinutes: 169,
    genres: [{ id: 12, name: 'Adventure' }, { id: 878, name: 'Sci-Fi' }],
    rating: 8.9,
    voteCount: 35000,
    certification: 'PG-13',
    status: 'now_playing',
  },
  {
    id: 'm-305',
    tmdbId: 533535,
    title: 'Deadpool & Wolverine',
    tagline: 'Come together.',
    overview: 'Wade Wilson and Wolverine must team up to defeat an existential threat to the multiverse.',
    posterUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=800&q=80',
    backdropUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1200&q=80',
    releaseDate: '2024-07-26',
    runtimeMinutes: 128,
    genres: [{ id: 28, name: 'Action' }, { id: 35, name: 'Comedy' }],
    rating: 7.8,
    voteCount: 4200,
    certification: 'R',
    status: 'popular',
  },
  {
    id: 'm-306',
    tmdbId: 558449,
    title: 'Gladiator II',
    tagline: 'Prepare to be entertained.',
    overview: 'Lucius must enter the Colosseum to restore glory and honor to Rome.',
    posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80',
    backdropUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80',
    releaseDate: '2024-11-22',
    runtimeMinutes: 148,
    genres: [{ id: 28, name: 'Action' }, { id: 18, name: 'Drama' }],
    rating: 8.0,
    voteCount: 2100,
    certification: 'R',
    status: 'upcoming',
  },
];

// DEMO Nigerian cinemas — mirrors the backend demo seed so offline browsing
// stays consistent with the Lagos-first experience. Booking still requires the backend.
export const FALLBACK_CINEMAS: Cinema[] = [
  {
    id: 'c-101',
    name: 'ReelPass Cinemas Lekki',
    city: 'Lagos',
    neighborhood: 'Lekki',
    address: 'Demo cinema — Lekki Phase 1, Lagos',
    latitude: 6.4478,
    longitude: 3.4723,
    distanceKm: 2.1,
    amenities: ['imax', 'dolby_atmos', 'vip_lounge', 'recliners', 'concessions', 'wheelchair_accessible', 'parking', 'bar'],
    imageUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=800&q=80',
    isDemo: true,
  },
  {
    id: 'c-102',
    name: 'ReelPass IMAX Victoria Island',
    city: 'Lagos',
    neighborhood: 'Victoria Island',
    address: 'Demo cinema — Victoria Island, Lagos',
    latitude: 6.4281,
    longitude: 3.4219,
    distanceKm: 5.4,
    amenities: ['imax', 'dolby_atmos', 'vip_lounge', 'recliners', 'concessions', 'wheelchair_accessible', 'bar'],
    imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80',
    isDemo: true,
  },
  {
    id: 'c-103',
    name: 'ReelPass Cinemas Ikeja',
    city: 'Lagos',
    neighborhood: 'Ikeja',
    address: 'Demo cinema — Ikeja GRA, Lagos',
    latitude: 6.6018,
    longitude: 3.3515,
    distanceKm: 18.7,
    amenities: ['dolby_atmos', 'concessions', 'wheelchair_accessible', 'parking'],
    imageUrl: 'https://images.unsplash.com/photo-1595769816263-9b910be24d5f?auto=format&fit=crop&w=800&q=80',
    isDemo: true,
  },
  {
    id: 'c-104',
    name: 'ReelPass Cinemas Jabi',
    city: 'Abuja',
    neighborhood: 'Jabi',
    address: 'Demo cinema — Jabi, Abuja',
    latitude: 9.0108,
    longitude: 7.4165,
    distanceKm: 512.0,
    amenities: ['imax', 'concessions', 'wheelchair_accessible', 'parking', 'bar'],
    imageUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=800&q=80',
    isDemo: true,
  },
  {
    id: 'c-106',
    name: 'ReelPass Cinemas Port Harcourt',
    city: 'Port Harcourt',
    neighborhood: 'GRA',
    address: 'Demo cinema — GRA, Port Harcourt',
    latitude: 4.8156,
    longitude: 7.0498,
    distanceKm: 472.8,
    amenities: ['dolby_atmos', 'concessions', 'wheelchair_accessible', 'parking'],
    imageUrl: 'https://images.unsplash.com/photo-1595769816263-9b910be24d5f?auto=format&fit=crop&w=800&q=80',
    isDemo: true,
  },
  {
    id: 'c-107',
    name: 'ReelPass Cinemas Ibadan',
    city: 'Ibadan',
    neighborhood: 'Bodija',
    address: 'Demo cinema — Bodija, Ibadan',
    latitude: 7.4027,
    longitude: 3.9046,
    distanceKm: 118.5,
    amenities: ['concessions', 'wheelchair_accessible', 'parking'],
    imageUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=800&q=80',
    isDemo: true,
  },
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const method = (options.method || 'GET').toUpperCase();
    const isWrite = WRITE_METHODS.has(method);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Writes (bookings, auth) get a longer timeout; reads fail fast to demo data.
    const timeoutMs = isWrite ? 10000 : 3500;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (__DEV__ && isWrite) {
      // Safe shape only: never log tokens, passwords, or payment secrets.
      let seatCount: unknown;
      try {
        seatCount = options.body ? JSON.parse(options.body as string)?.seatIds?.length : undefined;
      } catch {
        seatCount = undefined;
      }
      console.log(
        `📡 [API dev] ${method} ${API_BASE_URL}${endpoint} body_keys=[${options.body ? Object.keys(JSON.parse(options.body as string)).join(',') : ''}]` +
          (seatCount !== undefined ? ` seatIds_count=${seatCount}` : '')
      );
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (error: any) {
      clearTimeout(timeoutId);
      const reason = error?.name === 'AbortError' ? 'timed out' : error?.message || 'network request failed';

      // Booking writes and booking reads MUST hit a reachable backend.
      // We never silently simulate a reservation.
      if (isWrite || endpoint.startsWith('/bookings') || endpoint.startsWith('/showtimes') || endpoint.startsWith('/auth')) {
        if (__DEV__) console.warn(`❌ [API dev] ${endpoint} unreachable: ${reason}`);
        throw new ApiConnectionError(endpoint, reason);
      }

      if (__DEV__) {
        console.log(`ℹ️ [API Client] ${endpoint} unreachable (${reason}). Serving local high-speed demo cache.`);
      }
      return this.getFallbackResponse<T>(endpoint);
    }

    // Parse the JSON envelope; HTTP errors carry { success:false, error } from the API.
    let data: ApiResponse<T>;
    try {
      data = await response.json();
    } catch {
      if (__DEV__) console.warn(`❌ [API dev] ${method} ${endpoint} -> ${response.status} (non-JSON response)`);
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: `Unexpected server response (${response.status}). Please try again.`,
        },
      };
    }

    if (__DEV__ && !response.ok) {
      console.warn(
        `❌ [API dev] ${method} ${endpoint} -> ${response.status} code=${data.error?.code} message=${data.error?.message}` +
          (data.error?.details ? ` details=${JSON.stringify(data.error.details)}` : '')
      );
    }

    return data;
  }

  // Graceful client fallback data for OFFLINE READ-ONLY browsing (movies/cinemas only).
  // Bookings, showtimes, seats and auth are never faked — they throw ApiConnectionError.
  private getFallbackResponse<T>(endpoint: string): ApiResponse<T> {
    if (endpoint.includes('/movies/now-playing') || endpoint.includes('/movies/popular')) {
      return { success: true, data: FALLBACK_MOVIES as unknown as T, meta: { isDemoData: true } };
    }
    if (endpoint.includes('/movies/upcoming')) {
      return {
        success: true,
        data: FALLBACK_MOVIES.filter((m) => m.status === 'upcoming') as unknown as T,
        meta: { isDemoData: true },
      };
    }
    if (endpoint.includes('/movies/search')) {
      return { success: true, data: FALLBACK_MOVIES as unknown as T, meta: { isDemoData: true } };
    }
    if (endpoint.includes('/cinemas')) {
      return { success: true, data: FALLBACK_CINEMAS as unknown as T, meta: { isDemoData: true } };
    }

    const matchedMovie = FALLBACK_MOVIES.find((m) => endpoint.includes(m.id)) || FALLBACK_MOVIES[0];
    return {
      success: true,
      data: matchedMovie as unknown as T,
      meta: { isDemoData: true },
    };
  }

  // --- Auth APIs ---
  async login(body: { email: string; password: string }) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async demoLogin() {
    return this.request<AuthResponse>('/auth/demo-login', {
      method: 'POST',
    });
  }

  async register(body: { email: string; password: string; fullName: string; phoneNumber?: string }) {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getMe() {
    return this.request<{ user: User }>('/auth/me');
  }

  // --- Movie APIs ---
  async getNowPlaying(page: number = 1) {
    return this.request<Movie[]>(`/movies/now-playing?page=${page}`);
  }

  async getUpcoming(page: number = 1) {
    return this.request<Movie[]>(`/movies/upcoming?page=${page}`);
  }

  async getPopular(page: number = 1) {
    return this.request<Movie[]>(`/movies/popular?page=${page}`);
  }

  async searchMovies(query: string, page: number = 1) {
    return this.request<Movie[]>(`/movies/search?q=${encodeURIComponent(query)}&page=${page}`);
  }

  async getMovieById(id: string) {
    return this.request<Movie>(`/movies/${id}`);
  }

  // --- Cinema & Showtime APIs ---
  async getCinemas(city?: string) {
    const query = city ? `?city=${encodeURIComponent(city)}` : '';
    return this.request<Cinema[]>(`/cinemas${query}`);
  }

  async getCinemaById(id: string) {
    return this.request<Cinema>(`/cinemas/${id}`);
  }

  async getCinemaShowtimes(cinemaId: string, movieId?: string, date?: string) {
    const params = new URLSearchParams();
    if (movieId) params.append('movieId', movieId);
    if (date) params.append('date', date);
    return this.request<Showtime[]>(`/cinemas/${cinemaId}/showtimes?${params.toString()}`);
  }

  async getShowtimes(movieId?: string, date?: string) {
    const params = new URLSearchParams();
    if (movieId) params.append('movieId', movieId);
    if (date) params.append('date', date);
    return this.request<Showtime[]>(`/showtimes?${params.toString()}`);
  }

  async getShowtimeById(id: string) {
    return this.request<Showtime>(`/showtimes/${id}`);
  }

  async getShowtimeSeats(showtimeId: string) {
    return this.request<SeatMapLayout>(`/showtimes/${showtimeId}/seats`);
  }

  // --- Booking APIs ---
  async createBooking(showtimeId: string, seatIds: string[]) {
    return this.request<Booking>('/bookings', {
      method: 'POST',
      body: JSON.stringify({ showtimeId, seatIds }),
    });
  }

  async getMyTickets() {
    return this.request<Booking[]>('/bookings/my-tickets');
  }

  async getBookingById(id: string) {
    return this.request<Booking>(`/bookings/${id}`);
  }
}

export const api = new ApiClient();
