import { RedisOptions } from 'ioredis';
import type Redis from 'ioredis';

export interface ParsedRedisConfig {
  url: string;
  isTls: boolean;
  hostname: string;
  port: number;
  sanitizedHost: string;
  options: RedisOptions;
  error?: string;
}

/**
 * Strips credentials (username and password) from a Redis connection URL so
 * it can be logged or returned in health checks without leaking secrets.
 */
export function getSanitizedRedisHost(rawUrl?: string): string {
  if (!rawUrl) return 'unconfigured';
  try {
    const cleaned = rawUrl.trim().replace(/^["']|["']$/g, '');
    const u = new URL(cleaned);
    const port = u.port || (u.protocol === 'rediss:' ? '6379' : '6379');
    return `${u.hostname}:${port}`;
  } catch {
    return 'invalid-url-format';
  }
}

/**
 * Validates, normalizes, and builds robust connection options for Redis / Upstash.
 */
export function parseRedisConfig(rawUrl?: string): ParsedRedisConfig | null {
  if (!rawUrl) return null;

  const cleaned = rawUrl.trim().replace(/^["']|["']$/g, '').trim();
  if (!cleaned) return null;

  // Detect Upstash REST API URL misconfiguration
  if (cleaned.startsWith('https://') || cleaned.startsWith('http://')) {
    const errorMsg =
      'REDIS_URL is configured as an HTTP(S) URL. Upstash provides both a REST API URL (https://) ' +
      'and a standard Redis TCP URL (rediss://). Please update REDIS_URL in Railway to use the standard ' +
      'TCP connection string: rediss://default:<password>@<host>:6379';
    return {
      url: cleaned,
      isTls: false,
      hostname: 'invalid-http-url',
      port: 0,
      sanitizedHost: getSanitizedRedisHost(cleaned),
      options: {},
      error: errorMsg,
    };
  }

  // Ensure scheme is present (default to rediss:// if host includes upstash.io, otherwise redis://)
  let normalizedUrl = cleaned;
  if (!normalizedUrl.includes('://')) {
    if (normalizedUrl.includes('upstash.io')) {
      normalizedUrl = `rediss://${normalizedUrl}`;
    } else {
      normalizedUrl = `redis://${normalizedUrl}`;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch (err: any) {
    return {
      url: cleaned,
      isTls: false,
      hostname: 'invalid-url',
      port: 0,
      sanitizedHost: 'invalid-url',
      options: {},
      error: `Failed to parse REDIS_URL: ${err.message}`,
    };
  }

  const hostname = parsed.hostname;
  const port = parsed.port ? parseInt(parsed.port, 10) : 6379;
  const sanitizedHost = `${hostname}:${port}`;

  // TLS detection: rediss:// scheme, REDIS_TLS=true, or any upstash.io endpoint
  const forceTls = process.env.REDIS_TLS === 'true';
  const forceNoTls = process.env.REDIS_TLS === 'false';
  const isUpstash = hostname.toLowerCase().includes('upstash.io');
  const isTlsScheme = parsed.protocol === 'rediss:';
  const isTls = !forceNoTls && (isTlsScheme || forceTls || isUpstash);

  const connectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 10000);
  const family = process.env.REDIS_FAMILY ? Number(process.env.REDIS_FAMILY) : 0;

  const options: RedisOptions = {
    // maxRetriesPerRequest: null is required by BullMQ and prevents premature rejection on slow WAN links
    maxRetriesPerRequest: null,
    connectTimeout: connectTimeoutMs,
    family,
    lazyConnect: true,
    // Reconnect with exponential backoff up to 5s. Never return null to avoid permanent client shutdown.
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
  };

  if (isTls) {
    const rejectUnauthorized = process.env.REDIS_REJECT_UNAUTHORIZED === 'true';
    options.tls = {
      rejectUnauthorized,
      // CRITICAL: SNI (Server Name Indication) servername is required for Upstash & multi-tenant cloud Redis
      servername: hostname,
    };
  }

  return {
    url: normalizedUrl,
    isTls,
    hostname,
    port,
    sanitizedHost,
    options,
  };
}

/**
 * Performs a temporary SET / GET / DELETE operation to verify read/write capability on Redis.
 * Avoids printing or exposing secret values.
 */
export async function verifyRedisReadWrite(redis: Redis): Promise<boolean> {
  const testKey = `reelpass:health:verify:${Date.now()}`;
  const testVal = 'ok';
  try {
    await redis.set(testKey, testVal, 'EX', 10);
    const retrieved = await redis.get(testKey);
    await redis.del(testKey);
    return retrieved === testVal;
  } catch (err: any) {
    console.warn(`⚠️ [Redis] Read/write verification failed: ${err.message}`);
    return false;
  }
}
