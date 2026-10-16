import Redis from 'ioredis';
import { env } from '../config/env';

/**
 * Redis-backed temporary seat holds.
 *
 * Each hold is a single key `reelpass:hold:{showtimeId}:{seatId}` whose value is
 * the owning user id and whose TTL is the hold window. Holds are:
 *   - atomic across multiple seats (Lua all-or-nothing script),
 *   - scoped by showtime + seat,
 *   - exclusive (a second user cannot hold a held seat),
 *   - self-expiring (Redis TTL).
 *
 * This service is the FAST PATH. PostgreSQL `showtime_seats` remains the durable
 * authority: if Redis is unavailable the booking engine falls back to DB-only
 * locking (logged loudly) and never uses process-local memory for ownership.
 */

const HOLD_PREFIX = 'reelpass:hold';

export interface HoldResult {
  ok: boolean;
  conflicts: { seatId: string; heldBy: string }[];
}

function holdKey(showtimeId: string, seatId: string): string {
  return `${HOLD_PREFIX}:${showtimeId}:${seatId}`;
}

// KEYS = hold keys, ARGV[1] = ttl ms, ARGV[2] = userId.
// All-or-nothing: if any seat is held by a different user, hold nothing.
const ACQUIRE_LUA = `
local ttl = tonumber(ARGV[1])
local userId = ARGV[2]
for i = 1, #KEYS do
  local v = redis.call('GET', KEYS[i])
  if v and v ~= userId then
    return {0, KEYS[i], v}
  end
end
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], userId, 'PX', ttl)
end
return {1, '', ''}
`;

// KEYS = hold keys, ARGV[1] = userId. Only the owner may release.
const RELEASE_LUA = `
local userId = ARGV[1]
local released = 0
for i = 1, #KEYS do
  local v = redis.call('GET', KEYS[i])
  if v == userId then
    redis.call('DEL', KEYS[i])
    released = released + 1
  end
end
return released
`;

class SeatHoldService {
  private redis: Redis | null = null;
  private connected = false;
  private initialized = false;

  private init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const url = env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
        retryStrategy: (times) => (times > 3 ? null : 500),
      });

      this.redis
        .connect()
        .then(() => {
          this.connected = true;
          console.log('✅ [SeatHolds] Redis seat-hold store connected.');
        })
        .catch((err) => {
          this.connected = false;
          console.log(
            `ℹ️ [SeatHolds] Redis unavailable (${err.message}). Seat holds will use PostgreSQL row locks only.`
          );
        });

      this.redis.on('error', () => {
        this.connected = false;
      });
      this.redis.on('ready', () => {
        this.connected = true;
      });
    } catch {
      this.connected = false;
      console.log('ℹ️ [SeatHolds] Redis init failed. Seat holds will use PostgreSQL row locks only.');
    }
  }

  isLive(): boolean {
    this.init();
    return this.connected && this.redis !== null;
  }

  /** Atomically hold all seats or none. */
  async hold(showtimeId: string, seatIds: string[], userId: string, ttlSeconds: number): Promise<HoldResult> {
    this.init();
    if (!this.redis) return { ok: false, conflicts: [] };

    const keys = seatIds.map((s) => holdKey(showtimeId, s));
    const raw = (await this.redis.eval(
      ACQUIRE_LUA,
      keys.length,
      ...keys,
      String(ttlSeconds * 1000),
      userId
    )) as [number, string, string];

    if (raw[0] === 1) return { ok: true, conflicts: [] };

    const conflictKey = raw[1];
    const heldBy = raw[2];
    const seatId = conflictKey.slice(`${HOLD_PREFIX}:${showtimeId}:`.length);
    return { ok: false, conflicts: [{ seatId, heldBy }] };
  }

  /** Release seats owned by this user (no-op for seats held by others). */
  async release(showtimeId: string, seatIds: string[], userId: string): Promise<number> {
    this.init();
    if (!this.redis) return 0;
    const keys = seatIds.map((s) => holdKey(showtimeId, s));
    return (await this.redis.eval(RELEASE_LUA, keys.length, ...keys, userId)) as number;
  }

  /** The user id currently holding a seat, or null. */
  async holder(showtimeId: string, seatId: string): Promise<string | null> {
    this.init();
    if (!this.redis) return null;
    return this.redis.get(holdKey(showtimeId, seatId));
  }

  /** Clear all hold keys for a set of seats (used when a booking is confirmed). */
  async clear(showtimeId: string, seatIds: string[]): Promise<void> {
    this.init();
    if (!this.redis || seatIds.length === 0) return;
    await this.redis.del(...seatIds.map((s) => holdKey(showtimeId, s)));
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
      this.connected = false;
    }
  }
}

export const seatHolds = new SeatHoldService();
export { holdKey };
