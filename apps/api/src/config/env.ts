import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from apps/api or project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

export const DEFAULT_DEV_JWT_SECRET = 'matinee-super-secret-jwt-key-min-32-chars-for-dev';

export const KNOWN_INSECURE_JWT_SECRETS = [
  DEFAULT_DEV_JWT_SECRET,
  'replace-with-a-unique-random-secret-at-least-32-characters',
  'your_jwt_secret_here',
  'secret',
  'password',
  'changeme',
  '12345678901234567890123456789012',
];

export function isDevOrKnownInsecureSecret(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  return KNOWN_INSECURE_JWT_SECRETS.some((insecure) => normalized === insecure.toLowerCase());
}

export function isTrivialSecret(secret: string): boolean {
  const trimmed = secret.trim();
  if (trimmed.length < 32) return true;
  // Entropy check: must contain at least 8 unique characters
  const uniqueChars = new Set(trimmed).size;
  if (uniqueChars < 8) return true;
  return false;
}

export function validateJwtSecret(
  secret: string | undefined,
  nodeEnv: string
): { valid: boolean; error?: string } {
  if (nodeEnv !== 'production') {
    return { valid: true };
  }

  if (!secret || secret.trim().length === 0) {
    return {
      valid: false,
      error: 'JWT_SECRET is required in production and cannot be missing or empty.',
    };
  }

  const trimmed = secret.trim();

  if (isDevOrKnownInsecureSecret(trimmed)) {
    return {
      valid: false,
      error: 'JWT_SECRET must not use development default or known insecure placeholder secrets in production.',
    };
  }

  if (trimmed.length < 32) {
    return {
      valid: false,
      error: `JWT_SECRET is too weak (${trimmed.length} chars). Production JWT secrets must be at least 32 characters long.`,
    };
  }

  if (isTrivialSecret(trimmed)) {
    return {
      valid: false,
      error: 'JWT_SECRET has insufficient entropy or uses a trivial pattern. Use a cryptographically secure random secret.',
    };
  }

  return { valid: true };
}

export const baseEnvSchema = z.object({
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
  JWT_SECRET: z.string().optional(),
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

export const envSchema = baseEnvSchema
  .transform((data) => {
    const rawSecret = data.JWT_SECRET?.trim();
    return {
      ...data,
      JWT_SECRET:
        rawSecret && rawSecret.length > 0
          ? rawSecret
          : data.NODE_ENV === 'production'
            ? ''
            : DEFAULT_DEV_JWT_SECRET,
    };
  })
  .superRefine((data, ctx) => {
    const validation = validateJwtSecret(data.JWT_SECRET, data.NODE_ENV);
    if (!validation.valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: validation.error!,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnvironment(raw: Record<string, string | undefined> = process.env) {
  return envSchema.safeParse(raw);
}

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Environment validation failed:', JSON.stringify(parsedEnv.error.format(), null, 2));
  throw new Error(`Invalid environment variables: ${parsedEnv.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
}

export const env = parsedEnv.data;
