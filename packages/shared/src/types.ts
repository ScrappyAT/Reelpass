// User & Auth Types
export type UserRole = 'customer' | 'admin';

export interface User {
  id: string;
  email: string;
  fullName: string;
  phoneNumber?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// Movie Types
export interface MovieGenre {
  id: number;
  name: string;
}

export interface Movie {
  id: string;
  tmdbId: number;
  title: string;
  tagline?: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  releaseDate: string;
  runtimeMinutes: number;
  genres: MovieGenre[];
  rating: number; // 0.0 - 10.0
  voteCount: number;
  certification: string; // e.g. "PG-13", "R", "18+"
  trailerUrl?: string;
  status: 'now_playing' | 'upcoming' | 'popular';
}

export interface MovieCastMember {
  id: number;
  name: string;
  character: string;
  profileUrl?: string;
}

// Cinema & Auditorium Types
export type CinemaAmenity =
  | 'imax'
  | 'dolby_atmos'
  | 'vip_lounge'
  | 'recliners'
  | 'concessions'
  | 'wheelchair_accessible'
  | 'parking'
  | 'bar';

export interface Cinema {
  id: string;
  name: string;
  /** Nigerian state/city, e.g. "Lagos", "Abuja", "Port Harcourt", "Ibadan". */
  city: string;
  /** Neighborhood within the city, e.g. "Lekki", "Victoria Island", "Wuse". */
  neighborhood?: string;
  address: string;
  postalCode?: string;
  phone?: string;
  latitude: number;
  longitude: number;
  distanceKm?: number;
  amenities: CinemaAmenity[];
  imageUrl: string;
  /** True for clearly-labelled demo cinema records (not real businesses or partners). */
  isDemo?: boolean;
}

export type ScreenType = 'standard' | 'imax' | 'dolby' | 'vip';

export interface Auditorium {
  id: string;
  cinemaId: string;
  name: string;
  screenType: ScreenType;
  totalSeats: number;
  rowsCount: number;
  columnsCount: number;
}

// Showtime Types
export type ShowtimeFormat = '2D' | '3D' | 'IMAX 2D' | 'IMAX 3D' | 'Dolby Cinema' | 'VIP Experience';

export interface Showtime {
  id: string;
  movieId: string;
  cinemaId: string;
  auditoriumId: string;
  movieTitle: string;
  moviePosterUrl?: string;
  cinemaName: string;
  /** City of the showtime's cinema, e.g. "Lagos". */
  cinemaCity: string;
  /** Neighborhood of the showtime's cinema, e.g. "Lekki". */
  cinemaNeighborhood?: string;
  auditoriumName: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  format: ShowtimeFormat;
  /** Integer kobo (NGN). 1 naira = 100 kobo. Format with `formatNaira()`. */
  priceStandard: number;
  /** Integer kobo (NGN). 1 naira = 100 kobo. Format with `formatNaira()`. */
  priceVip: number;
  availableSeatsCount: number;
  totalSeatsCount: number;
}

// Seat Types
export type SeatType = 'standard' | 'vip' | 'wheelchair';
export type SeatStatus = 'available' | 'selected' | 'held' | 'sold';

export interface Seat {
  id: string;
  auditoriumId: string;
  row: string;     // e.g. "A", "B", ... "P"
  number: number;  // e.g. 1, 2, ... 20
  label: string;   // e.g. "A1", "H12"
  type: SeatType;
  status: SeatStatus;
  /** Integer kobo (NGN). 1 naira = 100 kobo. Format with `formatNaira()`. */
  price: number;
}

export interface SeatMapLayout {
  auditoriumId: string;
  auditoriumName: string;
  screenType: ScreenType;
  showtimeId: string;
  totalSeats: number;
  rows: string[];
  columns: number;
  seats: Seat[];
}

// Booking & Ticket Types
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface Ticket {
  id: string;
  bookingId: string;
  showtimeId: string;
  seatId: string;
  seatLabel: string;
  seatType: SeatType;
  /** Integer kobo (NGN). 1 naira = 100 kobo. Format with `formatNaira()`. */
  price: number;
  qrCodeData: string;
}

export interface Booking {
  id: string;
  bookingReference: string;
  userId: string;
  showtimeId: string;
  showtime: Showtime;
  seats: Seat[];
  tickets: Ticket[];
  /** Server-calculated total in integer kobo (NGN). Never trust a client-supplied total. */
  totalAmount: number;
  currency: string;
  status: BookingStatus;
  paymentStatus: 'pending' | 'successful' | 'failed';
  paymentId?: string;
  qrCode: string;
  createdAt: string;
  expiresAt?: string;
}

// Generic API Envelope
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId?: string;
    timestamp?: string;
    isDemoData?: boolean;
    attribution?: string;
    page?: number;
    totalPages?: number;
    totalResults?: number;
    message?: string;
    note?: string;
    [key: string]: any;
  };
}
