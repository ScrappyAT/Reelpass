import Redis from 'ioredis';
import { env } from '../config/env';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

class CacheService {
  private redis: Redis | null = null;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private isConnected = false;

  constructor() {
    this.initRedis();
  }

  private initRedis() {
    try {
      const redisUrl = env.REDIS_URL || 'redis://localhost:6379';
      const isTls = redisUrl.startsWith('rediss://') || process.env.REDIS_TLS === 'true';
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 5000),
        ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
        retryStrategy: (times) => {
          if (times > 3) return null; // stop reconnecting if not available
          return Math.min(times * 500, 2000);
        },
        lazyConnect: true,
      });

      this.redis.connect()
        .then(() => {
          this.isConnected = true;
          console.log('✅ [Redis] Connected successfully.');
        })
        .catch((err) => {
          this.isConnected = false;
          console.log(`ℹ️ [Redis] Connection unavailable (${err.message}). Using in-memory TTL cache fallback.`);
        });

      this.redis.on('error', (err) => {
        if (this.isConnected) {
          console.warn('⚠️ [Redis] Error:', err.message);
        }
        this.isConnected = false;
      });
    } catch (error) {
      this.isConnected = false;
      console.log('ℹ️ [Redis] Initialization failed. Using in-memory TTL cache fallback.');
    }
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

  /** Close the Redis connection (used by test teardown so the process can exit). */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
    }
    this.isConnected = false;
  }
}

export const cache = new CacheService();
