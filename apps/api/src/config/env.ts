import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from apps/api or project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().default('*'),
  
  // Data mode: "auto" uses PostgreSQL when DATABASE_URL is set (and fails loudly
  // if that database is unreachable), "postgres" always requires PostgreSQL,
  // "memory" is the explicitly-identified demo mode.
  DATA_MODE: z.enum(['auto', 'postgres', 'memory']).default('auto'),

  // Database
  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .optional()
    .or(z.literal(''))
    .transform((val) => (val ? val : undefined)),
  PGHOST: z.string().default('localhost'),
  PGPORT: z.coerce.number().default(5432),
  PGUSER: z.string().default('postgres'),
  PGPASSWORD: z.string().default('postgres'),
  PGDATABASE: z.string().default('matinee'),

  // Redis
  REDIS_URL: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .transform((val) => {
      if (!val) return undefined;
      const unquoted = val.trim().replace(/^["']|["']$/g, '').trim();
      return unquoted || undefined;
    }),
  REDIS_TLS: z.enum(['true', 'false', 'auto']).default('auto'),
  REDIS_FAMILY: z.coerce.number().optional(),
  SEAT_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // JWT
  JWT_SECRET: z.string().min(16).default('matinee-super-secret-jwt-key-min-32-chars-for-dev'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // TMDB (Server-side ONLY)
  TMDB_API_KEY: z.string().optional(),
  TMDB_BASE_URL: z.string().default('https://api.themoviedb.org/3'),
  TMDB_IMAGE_BASE_URL: z.string().default('https://image.tmdb.org/t/p'),

  // Flutterwave (Phase 2 payment integration)
  FLW_SECRET_KEY: z.string().optional(),
  FLW_SECRET_HASH: z.string().optional(),
  FLW_CURRENCY: z.string().default('NGN'),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET_HASH: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Environment validation failed:', JSON.stringify(parsedEnv.error.format(), null, 2));
  throw new Error('Invalid environment variables');
}

export const env = parsedEnv.data;
