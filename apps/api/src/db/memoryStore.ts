import { Movie, Cinema, Auditorium, Showtime, Seat, Booking, User, Ticket } from '@matinee/shared';
import bcrypt from 'bcryptjs';

// Pre-hashed password for demo user ('password123')
const DEMO_PASSWORD_HASH = bcrypt.hashSync('password123', 10);

// ---------------------------------------------------------------------------
// Demo pricing — NIGERIAN NAIRA, stored as INTEGER KOBO (1 NGN = 100 kobo).
// These are clearly-labelled demo prices in NGN. They are NOT conversions of
// any previous USD values.
// ---------------------------------------------------------------------------
export const PRICE_KOBO = {
  standard: 450_000, // ₦4,500
  vip: 750_000,      // ₦7,500
  imaxStandard: 750_000, // ₦7,500
  imaxVip: 1_200_000,    // ₦12,000
} as const;

export const SUPPORTED_CITIES = ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan'] as const;

export class MemoryStore {
  users: Map<string, User & { passwordHash: string }> = new Map();
  movies: Map<string, Movie> = new Map();
  cinemas: Map<string, Cinema> = new Map();
  auditoriums: Map<string, Auditorium> = new Map();
  showtimes: Map<string, Showtime> = new Map();
  seatsByAuditorium: Map<string, Seat[]> = new Map();
  bookings: Map<string, Booking> = new Map();

  constructor() {
    this.seedInitialData();
  }

  private seedInitialData() {
    // 1. Demo User
    const demoUser: User & { passwordHash: string } = {
      id: 'u-1001-demo-user-id',
      email: 'demo@reelpass.app',
      fullName: 'Alex Vance',
      phoneNumber: '+234 803 000 0000',
      role: 'customer',
      passwordHash: DEMO_PASSWORD_HASH,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.users.set(demoUser.id, demoUser);

    // 2. DEMO Nigerian cinema locations.
    //    These are fictional demo cinemas for a Nigerian-market product. They are
    //    NOT real businesses, verified partners, or real street addresses.
    //    Coordinates are approximate neighborhood-level points only.
    const cinemasList: Cinema[] = [
      {
        id: 'c-101',
        name: 'ReelPass Cinemas Lekki',
        city: 'Lagos',
        neighborhood: 'Lekki',
        address: 'Demo cinema — Lekki Phase 1, Lagos',
        phone: '+234 800 000 0101',
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
        phone: '+234 800 000 0102',
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
        phone: '+234 800 000 0103',
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
        phone: '+234 800 000 0104',
        latitude: 9.0108,
        longitude: 7.4165,
        distanceKm: 512.0,
        amenities: ['imax', 'concessions', 'wheelchair_accessible', 'parking', 'bar'],
        imageUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=800&q=80',
        isDemo: true,
      },
      {
        id: 'c-105',
        name: 'ReelPass Cinemas Jabi Lake — Wuse',
        city: 'Abuja',
        neighborhood: 'Wuse',
        address: 'Demo cinema — Wuse, Abuja',
        phone: '+234 800 000 0105',
        latitude: 9.0591,
        longitude: 7.4951,
        distanceKm: 515.3,
        amenities: ['dolby_atmos', 'vip_lounge', 'recliners', 'concessions', 'wheelchair_accessible'],
        imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80',
        isDemo: true,
      },
      {
        id: 'c-106',
        name: 'ReelPass Cinemas Port Harcourt',
        city: 'Port Harcourt',
        neighborhood: 'GRA',
        address: 'Demo cinema — GRA, Port Harcourt',
        phone: '+234 800 000 0106',
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
        phone: '+234 800 000 0107',
        latitude: 7.4027,
        longitude: 3.9046,
        distanceKm: 118.5,
        amenities: ['concessions', 'wheelchair_accessible', 'parking'],
        imageUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=800&q=80',
        isDemo: true,
      },
    ];

    cinemasList.forEach((c) => this.cinemas.set(c.id, c));

    // 3. Auditoriums with 320 Seats Each (16 rows x 20 columns)
    //    Every auditorium belongs to exactly one cinema, and every showtime
    //    below is built from its own cinema's auditorium — so the map never
    //    shows a cinema whose showtimes actually belong to a different one.
    const auditoriumsList: Auditorium[] = [
      { id: 'aud-201', cinemaId: 'c-101', name: 'Auditorium 1 — IMAX Laser Screen', screenType: 'imax', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
      { id: 'aud-202', cinemaId: 'c-101', name: 'Auditorium 2 — Dolby Atmos Soundstage', screenType: 'dolby', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
      { id: 'aud-203', cinemaId: 'c-102', name: 'Screen 1 — IMAX Grand Tier', screenType: 'imax', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
      { id: 'aud-204', cinemaId: 'c-103', name: 'Screen 1 — Ikeja Main Hall', screenType: 'standard', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
      { id: 'aud-205', cinemaId: 'c-104', name: 'Screen 1 — Jabi IMAX Hall', screenType: 'imax', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
      { id: 'aud-206', cinemaId: 'c-105', name: 'Screen 1 — Wuse Dolby Hall', screenType: 'dolby', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
      { id: 'aud-207', cinemaId: 'c-106', name: 'Screen 1 — Port Harcourt Main Hall', screenType: 'standard', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
      { id: 'aud-208', cinemaId: 'c-107', name: 'Screen 1 — Ibadan Main Hall', screenType: 'standard', totalSeats: 320, rowsCount: 16, columnsCount: 20 },
    ];

    auditoriumsList.forEach((aud) => {
      this.auditoriums.set(aud.id, aud);
      this.generate320SeatsForAuditorium(aud.id);
    });

    // 4. Movies Catalog
    const moviesList: Movie[] = [
      {
        id: 'm-301',
        tmdbId: 693134,
        title: 'Dune: Part Two',
        tagline: 'Long live the fighters.',
        overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the known universe, he endeavors to prevent a terrible future only he can foresee.',
        posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=800&q=80',
        backdropUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1200&q=80',
        releaseDate: '2024-03-01',
        runtimeMinutes: 166,
        genres: [
          { id: 878, name: 'Science Fiction' },
          { id: 12, name: 'Adventure' },
        ],
        rating: 8.5,
        voteCount: 5420,
        certification: 'PG-13',
        trailerUrl: 'https://www.youtube.com/watch?v=Way9Dexny3w',
        status: 'now_playing',
      },
      {
        id: 'm-302',
        tmdbId: 872585,
        title: 'Oppenheimer',
        tagline: 'The world forever changes.',
        overview: 'The story of J. Robert Oppenheimer’s role in the development of the atomic bomb during World War II, tracing his intellectual awakening and deep moral reckoning.',
        posterUrl: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?auto=format&fit=crop&w=800&q=80',
        backdropUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=1200&q=80',
        releaseDate: '2023-07-21',
        runtimeMinutes: 180,
        genres: [
          { id: 18, name: 'Drama' },
          { id: 36, name: 'History' },
        ],
        rating: 8.6,
        voteCount: 8900,
        certification: 'R',
        trailerUrl: 'https://www.youtube.com/watch?v=uYPbbksJxIg',
        status: 'now_playing',
      },
      {
        id: 'm-303',
        tmdbId: 569094,
        title: 'Spider-Man: Across the Spider-Verse',
        tagline: 'It’s how you wear the mask that matters.',
        overview: 'After reuniting with Gwen Stacy, Brooklyn’s full-time, friendly neighborhood Spider-Man is catapulted across the Multiverse, where he encounters the Spider Society.',
        posterUrl: 'https://images.unsplash.com/photo-1635805737707-575885ab0820?auto=format&fit=crop&w=800&q=80',
        backdropUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=1200&q=80',
        releaseDate: '2023-06-02',
        runtimeMinutes: 140,
        genres: [
          { id: 16, name: 'Animation' },
          { id: 28, name: 'Action' },
          { id: 12, name: 'Adventure' },
        ],
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
        overview: 'A team of explorers travel through a newly discovered wormhole in space to surpass the limitations on human space travel and conquer the vast distances involved in an interstellar voyage.',
        posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80',
        backdropUrl: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1200&q=80',
        releaseDate: '2014-11-07',
        runtimeMinutes: 169,
        genres: [
          { id: 12, name: 'Adventure' },
          { id: 18, name: 'Drama' },
          { id: 878, name: 'Science Fiction' },
        ],
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
        overview: 'A listless Wade Wilson toils away in civilian life with his days as the morally flexible mercenary, Deadpool, behind him. But when his homeworld faces an existential threat, Wade must reluctantly suit-up again.',
        posterUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=800&q=80',
        backdropUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1200&q=80',
        releaseDate: '2024-07-26',
        runtimeMinutes: 128,
        genres: [
          { id: 28, name: 'Action' },
          { id: 35, name: 'Comedy' },
          { id: 878, name: 'Science Fiction' },
        ],
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
        overview: 'Years after witnessing the death of the revered hero Maximus at the hands of his uncle, Lucius must enter the Colosseum after his home is conquered by the tyrannical Emperors who now lead Rome with an iron fist.',
        posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80',
        backdropUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80',
        releaseDate: '2024-11-22',
        runtimeMinutes: 148,
        genres: [
          { id: 28, name: 'Action' },
          { id: 12, name: 'Adventure' },
          { id: 18, name: 'Drama' },
        ],
        rating: 8.0,
        voteCount: 2100,
        certification: 'R',
        status: 'upcoming',
      },
    ];

    moviesList.forEach((m) => this.movies.set(m.id, m));

    // 5. Dynamic Showtimes for Today and Tomorrow
    //    Each cinema only ever gets showtimes for ITS OWN auditorium(s).
    const cinemaAuditoriums = new Map<string, string[]>();
    auditoriumsList.forEach((aud) => {
      const list = cinemaAuditoriums.get(aud.cinemaId) || [];
      list.push(aud.id);
      cinemaAuditoriums.set(aud.cinemaId, list);
    });

    const today = new Date();
    const times = ['13:30', '16:45', '19:30', '22:15'];
    let showtimeCounter = 1;

    moviesList.slice(0, 4).forEach((movie) => {
      cinemasList.forEach((cinema) => {
        const audIds = cinemaAuditoriums.get(cinema.id) || [];
        if (audIds.length === 0) return;

        times.forEach((timeStr, idx) => {
          const [hours, mins] = timeStr.split(':').map(Number);
          const start = new Date(today);
          start.setHours(hours, mins, 0, 0);

          const end = new Date(start);
          end.setMinutes(end.getMinutes() + movie.runtimeMinutes + 20);

          const audId = audIds[idx % audIds.length];
          const aud = this.auditoriums.get(audId)!;

          const showtimeId = `st-${showtimeCounter++}`;
          const isImax = aud.screenType === 'imax';
          const isVipScreen = aud.screenType === 'vip';

          const showtime: Showtime = {
            id: showtimeId,
            movieId: movie.id,
            cinemaId: cinema.id,
            auditoriumId: aud.id,
            movieTitle: movie.title,
            moviePosterUrl: movie.posterUrl,
            cinemaName: cinema.name,
            cinemaCity: cinema.city,
            cinemaNeighborhood: cinema.neighborhood,
            auditoriumName: aud.name,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            format: isImax ? 'IMAX 2D' : isVipScreen ? 'VIP Experience' : aud.screenType === 'dolby' ? 'Dolby Cinema' : '2D',
            priceStandard: isImax ? PRICE_KOBO.imaxStandard : PRICE_KOBO.standard,
            priceVip: isImax ? PRICE_KOBO.imaxVip : PRICE_KOBO.vip,
            availableSeatsCount: 290,
            totalSeatsCount: 320,
          };

          this.showtimes.set(showtime.id, showtime);
        });
      });
    });

    // 6. Pre-seed a Sample Confirmed Ticket for the Demo User
    //    H10/H11 in aud-201 are marked SOLD in the live seat map so the
    //    auditorium view and the demo booking stay consistent.
    const demoShowtime = Array.from(this.showtimes.values()).find(
      (st) => st.auditoriumId === 'aud-201'
    );
    if (demoShowtime) {
      const demoBookingId = 'bk-9001-demo';
      const audSeats = this.getSeats('aud-201');
      const seat1 = audSeats.find((s) => s.label === 'H10');
      const seat2 = audSeats.find((s) => s.label === 'H11');

      if (seat1 && seat2) {
        seat1.status = 'sold';
        seat2.status = 'sold';
        seat1.price = demoShowtime.priceStandard;
        seat2.price = demoShowtime.priceStandard;

        const sampleTicket1: Ticket = {
          id: 'tkt-1',
          bookingId: demoBookingId,
          showtimeId: demoShowtime.id,
          seatId: seat1.id,
          seatLabel: 'H10',
          seatType: seat1.type,
          price: demoShowtime.priceStandard,
          qrCodeData: `REELPASS-TKT-H10-${demoBookingId}`,
        };
        const sampleTicket2: Ticket = {
          id: 'tkt-2',
          bookingId: demoBookingId,
          showtimeId: demoShowtime.id,
          seatId: seat2.id,
          seatLabel: 'H11',
          seatType: seat2.type,
          price: demoShowtime.priceStandard,
          qrCodeData: `REELPASS-TKT-H11-${demoBookingId}`,
        };

        const demoBooking: Booking = {
          id: demoBookingId,
          bookingReference: 'RP-882941-DX',
          userId: demoUser.id,
          showtimeId: demoShowtime.id,
          showtime: demoShowtime,
          seats: [seat1, seat2],
          tickets: [sampleTicket1, sampleTicket2],
          totalAmount: sampleTicket1.price + sampleTicket2.price,
          currency: 'NGN',
          status: 'confirmed',
          paymentStatus: 'successful',
          paymentId: 'pay-sample-01',
          qrCode: `REELPASS-BOOKING-${demoBookingId}`,
          createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
        };

        this.bookings.set(demoBooking.id, demoBooking);
      }
    }
  }

  // Generates 320 seats (Rows A to P, 20 seats per row)
  private generate320SeatsForAuditorium(auditoriumId: string) {
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
    const columns = 20;
    const seats: Seat[] = [];

    // Deterministic pseudo-random sold/held seats for demo display
    rows.forEach((rowLetter, rowIndex) => {
      for (let col = 1; col <= columns; col++) {
        const isVipRow = rowIndex >= 14; // Rows O and P are VIP Recliners
        const isWheelchair = rowIndex === 0 && (col === 1 || col === 2 || col === 19 || col === 20); // Row A ends are Wheelchair accessible

        let seatType: 'standard' | 'vip' | 'wheelchair' = 'standard';
        if (isWheelchair) seatType = 'wheelchair';
        else if (isVipRow) seatType = 'vip';

        // Pre-determine a few sold and held seats for realistic map visualization
        let status: 'available' | 'held' | 'sold' = 'available';
        const hash = (rowIndex * 31 + col * 17) % 100;
        if (hash < 12) {
          status = 'sold';
        } else if (hash >= 12 && hash < 16) {
          status = 'held';
        }

        const seat: Seat = {
          id: `${auditoriumId}-${rowLetter}${col}`,
          auditoriumId,
          row: rowLetter,
          number: col,
          label: `${rowLetter}${col}`,
          type: seatType,
          status,
          price: isVipRow ? PRICE_KOBO.vip : PRICE_KOBO.standard,
        };

        seats.push(seat);
      }
    });

    this.seatsByAuditorium.set(auditoriumId, seats);
  }

  getSeats(auditoriumId: string): Seat[] {
    let seats = this.seatsByAuditorium.get(auditoriumId);
    if (!seats) {
      this.generate320SeatsForAuditorium(auditoriumId);
      seats = this.seatsByAuditorium.get(auditoriumId)!;
    }
    return seats;
  }

  /** Recompute the available-seat count for a showtime from its live seat map. */
  refreshShowtimeAvailability(showtime: Showtime): void {
    const seats = this.getSeats(showtime.auditoriumId);
    showtime.availableSeatsCount = seats.filter((s) => s.status === 'available').length;
  }
}

// Global singleton instance for memory persistence
export const memoryStore = new MemoryStore();
