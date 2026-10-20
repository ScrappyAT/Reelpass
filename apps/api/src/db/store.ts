import {
  Booking,
  Cinema,
  Seat,
  SeatMapLayout,
  Showtime,
  Ticket,
} from '@matinee/shared';
import { memoryStore } from './memoryStore';
import { PgStore, UserRecord, CreateBookingResult, BookingConflictError, PaymentRecord } from './pgStore';
import { resolveDataMode, DataMode } from '../config/dataMode';

export { BookingConflictError };
export type { UserRecord, CreateBookingResult, PaymentRecord };

export interface CreateUserInput {
  id: string;
  email: string;
  fullName: string;
  phoneNumber?: string;
  passwordHash: string;
  role?: 'customer' | 'admin';
}

export interface CreateBookingInput {
  showtimeId: string;
  seatIds: string[];
  userId: string;
  idempotencyKey?: string;
  holdTtlSeconds: number;
}

export interface ReelStore {
  readonly mode: DataMode;
  // auth
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  // catalog
  listCinemas(city?: string): Promise<Cinema[]>;
  getCinema(id: string): Promise<Cinema | null>;
  listShowtimes(filter: { movieId?: string; cinemaId?: string; date?: string }): Promise<Showtime[]>;
  getShowtime(id: string): Promise<Showtime | null>;
  getSeatMap(showtimeId: string): Promise<SeatMapLayout | null>;
  // booking
  createBooking(input: CreateBookingInput): Promise<CreateBookingResult>;
  getBooking(id: string): Promise<Booking | null>;
  listBookingsForUser(userId: string): Promise<Booking[]>;
  confirmBooking(id: string, userId: string, payment?: { paymentId?: string }): Promise<Booking>;
  cancelBooking(id: string, userId: string): Promise<Booking>;
  // payments
  createPayment(input: {
    id: string;
    bookingId: string;
    userId: string;
    amountKobo: number;
    currency?: string;
    provider?: string;
    reference: string;
    status?: 'pending' | 'successful' | 'failed' | 'cancelled';
    transactionId?: string;
    failureReason?: string;
  }): Promise<PaymentRecord>;
  getPaymentByReference(reference: string): Promise<PaymentRecord | null>;
  getPaymentByBookingId(bookingId: string): Promise<PaymentRecord | null>;
  getPaymentByTransactionId(transactionId: string): Promise<PaymentRecord | null>;
  updatePaymentStatus(
    reference: string,
    status: 'pending' | 'successful' | 'failed' | 'cancelled',
    transactionId?: string,
    rawResponse?: unknown,
    failureReason?: string,
    verifiedAt?: Date
  ): Promise<PaymentRecord | null>;
}

// ---------------------------------------------------------------------------
// In-memory adapter (explicit demo mode). Wraps the existing memoryStore so the
// mobile offline demo and the non-PostgreSQL regression tests keep working.
// ---------------------------------------------------------------------------
class MemoryAdapter implements ReelStore {
  readonly mode = 'memory' as const;
  private idempotency = new Map<string, string>();
  private payments = new Map<string, PaymentRecord>();

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return (
      Array.from(memoryStore.users.values()).find(
        (u) => u.email.toLowerCase() === email.toLowerCase()
      ) ?? null
    );
  }
  async findUserById(id: string): Promise<UserRecord | null> {
    return memoryStore.users.get(id) ?? null;
  }
  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const user: UserRecord = {
      id: input.id,
      email: input.email.toLowerCase(),
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      role: input.role ?? 'customer',
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.users.set(user.id, user);
    return user;
  }

  async listCinemas(city?: string): Promise<Cinema[]> {
    const all = Array.from(memoryStore.cinemas.values());
    if (!city) return all;
    return all.filter((c) => c.city.toLowerCase() === city.toLowerCase());
  }
  async getCinema(id: string): Promise<Cinema | null> {
    return memoryStore.cinemas.get(id) ?? null;
  }
  async listShowtimes(filter: { movieId?: string; cinemaId?: string; date?: string }): Promise<Showtime[]> {
    let showtimes = Array.from(memoryStore.showtimes.values());
    if (filter.movieId) showtimes = showtimes.filter((s) => s.movieId === filter.movieId);
    if (filter.cinemaId) showtimes = showtimes.filter((s) => s.cinemaId === filter.cinemaId);
    if (filter.date) showtimes = showtimes.filter((s) => s.startTime.startsWith(filter.date!));
    return showtimes;
  }
  async getShowtime(id: string): Promise<Showtime | null> {
    return memoryStore.showtimes.get(id) ?? null;
  }
  async getSeatMap(showtimeId: string): Promise<SeatMapLayout | null> {
    const showtime = memoryStore.showtimes.get(showtimeId);
    if (!showtime) return null;
    const auditorium = memoryStore.auditoriums.get(showtime.auditoriumId);
    if (!auditorium) return null;
    const seats: Seat[] = memoryStore.getSeats(auditorium.id).map((seat) => ({
      ...seat,
      price: seat.type === 'vip' ? showtime.priceVip : showtime.priceStandard,
    }));
    return {
      auditoriumId: auditorium.id,
      auditoriumName: auditorium.name,
      screenType: auditorium.screenType,
      showtimeId,
      totalSeats: seats.length,
      rows: Array.from(new Set(seats.map((s) => s.row))),
      columns: 20,
      seats,
    };
  }

  async createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
    const key = input.idempotencyKey ? `${input.userId}:${input.idempotencyKey}` : undefined;
    if (key && this.idempotency.has(key)) {
      const existing = memoryStore.bookings.get(this.idempotency.get(key)!);
      if (existing) return { booking: existing, replayed: true };
    }

    const showtime = memoryStore.showtimes.get(input.showtimeId);
    if (!showtime) throw new BookingConflictError('SHOWTIME_NOT_FOUND', 'Showtime does not exist');

    // Clean up expired pending holds first
    const now = Date.now();
    for (const b of memoryStore.bookings.values()) {
      if (b.status === 'pending' && b.expiresAt && new Date(b.expiresAt).getTime() < now) {
        b.status = 'expired';
        const audSeats = memoryStore.getSeats(b.showtime.auditoriumId);
        b.seats.forEach((bs) => {
          const s = audSeats.find((seat) => seat.id === bs.id);
          if (s) {
            s.status = 'available';
          }
        });
        memoryStore.refreshShowtimeAvailability(b.showtime);
      }
    }

    const seatIds = Array.from(new Set(input.seatIds));
    const allSeats = memoryStore.getSeats(showtime.auditoriumId);
    const selected = seatIds
      .map((id) => allSeats.find((s) => s.id === id))
      .filter((s): s is Seat => Boolean(s));
    if (selected.length !== seatIds.length) {
      const found = new Set(selected.map((s) => s.id));
      const missing = seatIds.filter((id) => !found.has(id));
      throw new BookingConflictError(
        'INVALID_SEATS',
        `Selected seats do not exist in this auditorium: ${missing.join(', ')}`,
        missing.map((id) => ({ seatId: id, reason: 'not_found' }))
      );
    }
    const unavailable = selected.filter((s) => s.status !== 'available');
    if (unavailable.length > 0) {
      throw new BookingConflictError(
        'SEAT_UNAVAILABLE',
        `Seat ${unavailable.map((s) => s.label).join(', ')} is no longer available. Please pick different seats.`,
        unavailable.map((s) => ({ seatId: s.id, label: s.label, reason: s.status }))
      );
    }

    const priceFor = (s: Seat) => (s.type === 'vip' ? showtime.priceVip : showtime.priceStandard);
    const totalAmount = selected.reduce((sum, s) => sum + priceFor(s), 0);
    const bookingId = `bk-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const reference = `RP-${Math.floor(100000 + Math.random() * 900000)}`;

    const tickets: Ticket[] = selected.map((seat, idx) => ({
      id: `tkt-${bookingId}-${idx + 1}`,
      bookingId,
      showtimeId: showtime.id,
      seatId: seat.id,
      seatLabel: seat.label,
      seatType: seat.type,
      price: priceFor(seat),
      qrCodeData: `REELPASS-TKT-${seat.label}-${reference}`,
    }));

    selected.forEach((s) => {
      s.status = 'sold';
    });
    memoryStore.refreshShowtimeAvailability(showtime);

    const booking: Booking = {
      id: bookingId,
      bookingReference: reference,
      userId: input.userId,
      showtimeId: showtime.id,
      showtime,
      // Price every seat with the showtime-specific price (kobo, NGN).
      seats: selected.map((s) => ({ ...s, price: priceFor(s) })),
      tickets,
      totalAmount,
      currency: 'NGN',
      status: 'pending',
      paymentStatus: 'pending',
      qrCode: `REELPASS-BOOKING-${reference}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + input.holdTtlSeconds * 1000).toISOString(),
    };
    memoryStore.bookings.set(booking.id, booking);
    if (key) this.idempotency.set(key, booking.id);
    return { booking, replayed: false };
  }

  async getBooking(id: string): Promise<Booking | null> {
    const booking = memoryStore.bookings.get(id);
    if (!booking) return null;
    if (booking.status === 'pending' && booking.expiresAt && new Date(booking.expiresAt).getTime() < Date.now()) {
      booking.status = 'expired';
      const audSeats = memoryStore.getSeats(booking.showtime.auditoriumId);
      booking.seats.forEach((bs) => {
        const s = audSeats.find((seat) => seat.id === bs.id);
        if (s) s.status = 'available';
      });
      memoryStore.refreshShowtimeAvailability(booking.showtime);
    }
    return booking;
  }
  async listBookingsForUser(userId: string): Promise<Booking[]> {
    const now = Date.now();
    for (const b of memoryStore.bookings.values()) {
      if (b.status === 'pending' && b.expiresAt && new Date(b.expiresAt).getTime() < now) {
        b.status = 'expired';
        const audSeats = memoryStore.getSeats(b.showtime.auditoriumId);
        b.seats.forEach((bs) => {
          const s = audSeats.find((seat) => seat.id === bs.id);
          if (s) s.status = 'available';
        });
        memoryStore.refreshShowtimeAvailability(b.showtime);
      }
    }
    return Array.from(memoryStore.bookings.values())
      .filter((b) => b.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async confirmBooking(id: string, userId: string, payment?: { paymentId?: string }): Promise<Booking> {
    const booking = memoryStore.bookings.get(id);
    if (!booking) throw new BookingConflictError('BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.userId !== userId) throw new BookingConflictError('FORBIDDEN', 'Access to this booking is restricted');
    booking.status = 'confirmed';
    booking.paymentStatus = 'successful';
    booking.paymentId = payment?.paymentId ?? booking.paymentId;
    booking.seats = booking.seats.map((s) => ({ ...s, status: 'sold' }));
    return booking;
  }
  async cancelBooking(id: string, userId: string): Promise<Booking> {
    const booking = memoryStore.bookings.get(id);
    if (!booking) throw new BookingConflictError('BOOKING_NOT_FOUND', 'Booking not found');
    if (booking.userId !== userId) throw new BookingConflictError('FORBIDDEN', 'Access to this booking is restricted');
    if (booking.status === 'confirmed') {
      throw new BookingConflictError('BOOKING_CONFIRMED', 'Confirmed bookings cannot be cancelled here');
    }
    const seats = memoryStore.getSeats(booking.showtime.auditoriumId);
    booking.seats.forEach((bs) => {
      const seat = seats.find((s) => s.id === bs.id);
      if (seat) seat.status = 'available';
    });
    booking.status = 'cancelled';
    memoryStore.refreshShowtimeAvailability(booking.showtime);
    return booking;
  }

  async createPayment(input: {
    id: string;
    bookingId: string;
    userId: string;
    amountKobo: number;
    currency?: string;
    provider?: string;
    reference: string;
    status?: 'pending' | 'successful' | 'failed' | 'cancelled';
    transactionId?: string;
    failureReason?: string;
  }): Promise<PaymentRecord> {
    const record: PaymentRecord = {
      id: input.id,
      bookingId: input.bookingId,
      userId: input.userId,
      amountKobo: input.amountKobo,
      currency: input.currency ?? 'NGN',
      provider: input.provider ?? 'flutterwave',
      reference: input.reference,
      transactionId: input.transactionId,
      status: input.status ?? 'pending',
      failureReason: input.failureReason,
      createdAt: new Date().toISOString(),
    };
    this.payments.set(record.reference, record);
    return record;
  }
  async getPaymentByReference(reference: string): Promise<PaymentRecord | null> {
    return this.payments.get(reference) ?? null;
  }
  async getPaymentByBookingId(bookingId: string): Promise<PaymentRecord | null> {
    const matches = Array.from(this.payments.values()).filter((p) => p.bookingId === bookingId);
    if (matches.length === 0) return null;
    return matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }
  async getPaymentByTransactionId(transactionId: string): Promise<PaymentRecord | null> {
    return Array.from(this.payments.values()).find((p) => p.transactionId === transactionId) ?? null;
  }
  async updatePaymentStatus(
    reference: string,
    status: 'pending' | 'successful' | 'failed' | 'cancelled',
    transactionId?: string,
    rawResponse?: unknown,
    failureReason?: string,
    verifiedAt?: Date
  ): Promise<PaymentRecord | null> {
    const record = this.payments.get(reference);
    if (!record) return null;
    record.status = status;
    if (transactionId) record.transactionId = transactionId;
    if (rawResponse !== undefined) record.rawResponse = rawResponse;
    if (failureReason !== undefined) record.failureReason = failureReason;
    if (verifiedAt) record.verifiedAt = verifiedAt.toISOString();
    else if (status === 'successful' || status === 'failed' || status === 'cancelled') {
      record.verifiedAt = new Date().toISOString();
    }
    return record;
  }
}

// ---------------------------------------------------------------------------
// Store selection
// ---------------------------------------------------------------------------
let cachedPgStore: PgStore | null = null;
let cachedMemoryStore: ReelStore | null = null;
let cachedMode: DataMode | null = null;

export function getMode(): DataMode {
  const mode = resolveDataMode();
  cachedMode = mode;
  return mode;
}

export function getStore(): ReelStore {
  const mode = getMode();
  if (mode === 'postgres') {
    if (!cachedPgStore) cachedPgStore = new PgStore();
    return cachedPgStore as unknown as ReelStore;
  }
  // Singleton so idempotency keys and payments persist across requests.
  if (!cachedMemoryStore) cachedMemoryStore = new MemoryAdapter();
  return cachedMemoryStore;
}

export function isPostgresMode(): boolean {
  return resolveDataMode() === 'postgres';
}

export function getPgStore(): PgStore {
  if (!cachedPgStore) cachedPgStore = new PgStore();
  return cachedPgStore;
}

export function getActiveMode(): DataMode | null {
  return cachedMode;
}
