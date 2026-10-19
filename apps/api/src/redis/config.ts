import { RedisOptions } from 'ioredis';
import type Redis from 'ioredis';

export interface ParsedRedisConfig {
  scheme: string;
  isTls: boolean;
  hostname: string;
  port: number;
  sanitizedHost: string;
  options: RedisOptions;
  error?: string;
}

/**
 * Strips credentials (username and password) from a Redis connection string so
 * it can be logged or returned in health checks without leaking secrets.
 */
export function getSanitizedRedisHost(rawUrl?: string): string {
  if (!rawUrl) return 'unconfigured';
  try {
    const config = parseRedisConfig(rawUrl);
    return config?.sanitizedHost || 'invalid-url-format';
  } catch {
    return 'invalid-url-format';
  }
}

/**
 * Validates, normalizes, and builds robust connection options for Redis / Upstash.
 * Custom parser avoids node URL parser failures on passwords with special characters
 * and cleans up common copy-paste artifacts (such as quotes, redis-cli prefixes, etc.).
 */
export function parseRedisConfig(raw?: string): ParsedRedisConfig | null {
  if (!raw) return null;
  let str = raw.trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim();
  if (!str) return null;

  // Strip common CLI / environment variable prefixes from copy-paste
  if (str.startsWith('export ')) str = str.slice(7).trim();
  if (str.startsWith('REDIS_URL=')) {
    str = str.slice(10).trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim();
  }
  const cliMatch = str.match(/redis-cli(?:\s+--tls)?\s+-u\s+(\S+)/i);
  if (cliMatch) {
    str = cliMatch[1].trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim();
  }

  // Detect Upstash REST API URL misconfiguration
  if (str.startsWith('https://') || str.startsWith('http://')) {
    const errorMsg =
      'REDIS_URL is configured as an HTTP(S) URL. Upstash provides both a REST API URL (https://) ' +
      'and a standard Redis TCP URL (rediss://). Please update REDIS_URL in Railway to use the standard ' +
      'TCP connection string: rediss://default:<password>@<host>:6379';
    return {
      scheme: 'http:',
      isTls: false,
      hostname: 'invalid-http-url',
      port: 0,
      sanitizedHost: 'invalid-http-url',
      options: {},
      error: errorMsg,
    };
  }

  // Find scheme if present
  let scheme = 'redis:';
  let rest = str;
  if (str.includes('://')) {
    const parts = str.split('://');
    scheme = parts[0].toLowerCase() + ':';
    rest = parts.slice(1).join('://');
  } else if (str.toLowerCase().includes('upstash.io')) {
    scheme = 'rediss:';
  }

  // Extract auth (username:password) and host:port
  let username: string | undefined;
  let password: string | undefined;
  let hostPort = rest;

  const atIndex = rest.lastIndexOf('@');
  if (atIndex !== -1) {
    const authPart = rest.slice(0, atIndex);
    hostPort = rest.slice(atIndex + 1);

    const colonIndex = authPart.indexOf(':');
    if (colonIndex !== -1) {
      username = authPart.slice(0, colonIndex);
      password = authPart.slice(colonIndex + 1);
    } else {
      password = authPart;
      username = 'default';
    }
  }

  // Remove any trailing path/database suffix (e.g. /0)
  if (hostPort.includes('/')) {
    hostPort = hostPort.split('/')[0];
  }

  // Extract host and port
  let host = hostPort.trim();
  let port = scheme === 'rediss:' ? 6379 : 6379;
  const hostColon = hostPort.lastIndexOf(':');
  if (hostColon !== -1) {
    const possiblePort = parseInt(hostPort.slice(hostColon + 1), 10);
    if (!isNaN(possiblePort)) {
      host = hostPort.slice(0, hostColon).trim();
      port = possiblePort;
    }
  }

  // Validate hostname
  if (!host || host.includes(' ') || (!host.includes('.') && host !== 'localhost')) {
    return {
      scheme,
      isTls: false,
      hostname: 'invalid-host',
      port: 0,
      sanitizedHost: 'invalid-host',
      options: {},
      error: `Invalid Redis host "${host}". Please verify your REDIS_URL format in Railway.`,
    };
  }

  const forceTls = process.env.REDIS_TLS === 'true';
  const forceNoTls = process.env.REDIS_TLS === 'false';
  const isUpstash = host.toLowerCase().includes('upstash.io');
  const isTlsScheme = scheme === 'rediss:';
  const isTls = !forceNoTls && (isTlsScheme || forceTls || isUpstash);

  const connectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 10000);
  const family = process.env.REDIS_FAMILY ? Number(process.env.REDIS_FAMILY) : 0;

  const options: RedisOptions = {
    host,
    port,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    maxRetriesPerRequest: null,
    connectTimeout: connectTimeoutMs,
    family,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
  };

  if (isTls) {
    const rejectUnauthorized = process.env.REDIS_REJECT_UNAUTHORIZED === 'true';
    options.tls = {
      rejectUnauthorized,
      servername: host,
    };
  }

  return {
    scheme,
    isTls,
    hostname: host,
    port,
    sanitizedHost: `${host}:${port}`,
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
