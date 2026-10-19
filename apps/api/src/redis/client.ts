import Redis from 'ioredis';
import { env } from '../config/env';
import { parseRedisConfig, verifyRedisReadWrite } from './config';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export type RedisConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'ready'
  | 'reconnecting'
  | 'error'
  | 'closed';

class CacheService {
  private redis: Redis | null = null;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private isConnected = false;
  private verified = false;
  private status: RedisConnectionStatus = 'unconfigured';
  private sanitizedHost = 'unconfigured';
  private lastError: string | null = null;
  private isTlsEnabled = false;
  private connectPromise: Promise<boolean> | null = null;

  constructor() {
    this.initRedis();
  }

  private initRedis() {
    // If running in development and REDIS_URL is unset, default to local demo Redis
    const rawUrl = env.REDIS_URL || (env.NODE_ENV !== 'production' ? 'redis://localhost:6385' : undefined);

    if (!rawUrl) {
      this.status = 'unconfigured';
      this.sanitizedHost = 'unconfigured';
      console.log('ℹ️ [Redis] REDIS_URL not configured. Running in in-memory TTL cache fallback mode.');
      return;
    }

    const config = parseRedisConfig(rawUrl);
    if (!config) {
      this.status = 'unconfigured';
      return;
    }

    this.sanitizedHost = config.sanitizedHost;
    this.isTlsEnabled = config.isTls;

    if (config.error) {
      this.status = 'error';
      this.lastError = config.error;
      console.error(`❌ [Redis] Configuration error: ${config.error}`);
      return;
    }

    try {
      this.status = 'connecting';
      console.log(
        `🔌 [Redis] Initializing connection to ${config.sanitizedHost} (TLS: ${config.isTls ? 'enabled' : 'disabled'})...`
      );

      this.redis = new Redis(config.options);

      this.redis.on('connect', () => {
        this.status = 'connecting';
        console.log(`🔌 [Redis] Connected TCP socket to ${this.sanitizedHost}. Awaiting ready...`);
      });

      this.redis.on('ready', async () => {
        this.isConnected = true;
        this.status = 'ready';
        this.lastError = null;
        console.log(`✅ [Redis] Connection ready at ${this.sanitizedHost}. Running read/write verification...`);

        if (this.redis) {
          const checkPassed = await verifyRedisReadWrite(this.redis);
          this.verified = checkPassed;
          if (checkPassed) {
            console.log('✅ [Redis] Read/write verification successful (SET/GET/DEL confirmed).');
          } else {
            console.warn('⚠️ [Redis] Read/write verification did not confirm test key.');
          }
        }
      });

      this.redis.on('reconnecting', (delay: number) => {
        this.isConnected = false;
        this.status = 'reconnecting';
        console.log(`🔄 [Redis] Reconnecting to ${this.sanitizedHost} in ${delay}ms...`);
      });

      this.redis.on('error', (err: any) => {
        this.isConnected = false;
        this.status = 'error';
        this.lastError = err.message;
        console.warn(`⚠️ [Redis] Error on ${this.sanitizedHost}:`, err.message);
      });

      this.redis.on('close', () => {
        this.isConnected = false;
        if (this.status !== 'reconnecting') {
          this.status = 'closed';
        }
      });

      this.connectPromise = this.redis
        .connect()
        .then(() => true)
        .catch((err) => {
          this.isConnected = false;
          this.status = 'error';
          this.lastError = err.message;
          console.log(
            `ℹ️ [Redis] Initial connect attempt failed (${err.message}). Background retries will continue; in-memory TTL cache active.`
          );
          return false;
        });
    } catch (error: any) {
      this.isConnected = false;
      this.status = 'error';
      this.lastError = error?.message || 'Initialization failed';
      console.log(`ℹ️ [Redis] Initialization failed: ${this.lastError}. Using in-memory TTL cache fallback.`);
    }
  }

  async waitForReady(timeoutMs: number = 3000): Promise<boolean> {
    if (this.isConnected) return true;
    if (!this.redis) return false;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.isConnected) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.isConnected;
  }

  getRedisClient(): Redis | null {
    return this.redis;
  }

  async get(key: string): Promise<string | null> {
    if (this.isConnected && this.redis) {
      try {
        return await this.redis.get(key);
      } catch (err) {
        // Fallback to memory
      }
    }

    const item = this.memoryCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds: number = 3600): Promise<void> {
    if (this.isConnected && this.redis) {
      try {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      } catch (err) {
        // Fallback to memory
      }
    }

    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    if (this.isConnected && this.redis) {
      try {
        await this.redis.del(key);
        return;
      } catch (err) {
        // Fallback to memory
      }
    }

    this.memoryCache.delete(key);
  }

  isLive(): boolean {
    return this.isConnected;
  }

  isConfigured(): boolean {
    return Boolean(env.REDIS_URL);
  }

  isVerified(): boolean {
    return this.verified;
  }

  getStatus(): RedisConnectionStatus {
    return this.status;
  }

  getSanitizedHost(): string {
    return this.sanitizedHost;
  }

  isTls(): boolean {
    return this.isTlsEnabled;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getDiagnosticInfo() {
    return {
      configured: this.isConfigured(),
      status: this.status,
      verified: this.verified,
      host: this.sanitizedHost,
      tls: this.isTlsEnabled,
      error: this.lastError,
    };
  }

  /** Close the Redis connection (used by test teardown so the process can exit). */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
    }
    this.isConnected = false;
    this.verified = false;
    this.status = 'closed';
  }
}

export const cache = new CacheService();
