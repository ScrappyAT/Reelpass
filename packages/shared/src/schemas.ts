import { z } from 'zod';

// Authentication Schemas
export const registerSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters'),
  phoneNumber: z.string().trim().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Movie Query Schemas
export const movieQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().optional(),
  genreId: z.coerce.number().optional(),
});

export type MovieQueryInput = z.infer<typeof movieQuerySchema>;

// Booking Schemas
// NOTE: Showtime and seat identifiers used by this platform are internal,
// human-readable IDs (e.g. "st-1", "aud-201-J12"), NOT RFC-4122 UUIDs.
// Requiring `.uuid()` here rejected every valid booking request. The schema
// below still validates strictly: the ID must be present, bounded in length,
// and use the platform's safe identifier character set.
export const internalIdSchema = z
  .string()
  .trim()
  .min(1, 'Identifier is required')
  .max(64, 'Identifier is too long')
  .regex(/^[A-Za-z0-9_-]+$/, 'Identifier contains invalid characters');

export const createBookingSchema = z.object({
  showtimeId: internalIdSchema,
  seatIds: z
    .array(internalIdSchema)
    .min(1, 'Please select at least one seat')
    .max(10, 'Maximum 10 seats per booking'),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// Showtime Query Schema
export const showtimeQuerySchema = z.object({
  movieId: z.string().optional(),
  cinemaId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted YYYY-MM-DD').optional(),
});

export type ShowtimeQueryInput = z.infer<typeof showtimeQuerySchema>;
