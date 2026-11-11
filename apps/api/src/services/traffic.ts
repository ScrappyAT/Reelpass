import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { resolveDataMode } from '../config/dataMode';
import { cache } from '../redis/client';
import { AppError } from '../middleware/errorHandler';

function redisForTraffic() {
  const redis = cache.getRedisClient();
  if (!redis || !cache.isLive()) {
    throw new AppError(503, 'TRAFFIC_UNAVAILABLE', 'Booking traffic is temporarily unavailable. Please try again shortly.');
  }
  return redis;
}

// Atomically check both budgets before consuming either. Counter keys contain no
// email addresses or IP addresses. Retrying rejected requests does not extend the window.
const LIMIT_SCRIPT = `
local retry = 0
for i = 1, #KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i + 1]) then
    retry = math.max(retry, redis.call('PTTL', KEYS[i]))
  end
end
if retry > 0 then return retry end
for i = 1, #KEYS do
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[1]) end
end
return 0
`;

export async function consumeBudget(redis: Redis, scope: string, dimensions: { id: string; limit: number }[], windowMs = 60_000) {
  const keys = dimensions.map(({ id }) => 'reelpass:limit:{' + scope + '}:' + createHash('sha256').update(id).digest('hex'));
  return Number(await redis.eval(LIMIT_SCRIPT, keys.length, ...keys, windowMs, ...dimensions.map(item => item.limit)));
}

function trafficError(error: unknown) {
  return error instanceof AppError ? error
    : new AppError(503, 'TRAFFIC_UNAVAILABLE', 'The service is temporarily busy. Please try again shortly.');
}

export function rateLimit(scope: string, userLimit: number, ipLimit: number, accountField = false): RequestHandler {
  return async (req, res, next) => {
    if (resolveDataMode() !== 'postgres') return next();
    try {
      const dimensions = [{ id: 'ip:' + (req.ip || req.socket.remoteAddress), limit: ipLimit * env.TRAFFIC_IP_LIMIT_MULTIPLIER }];
      const account = req.user?.id ?? (accountField && typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase().slice(0, 255) : undefined);
      if (account) dimensions.push({ id: 'account:' + account, limit: userLimit });
      const retry = await consumeBudget(redisForTraffic(), scope, dimensions);
      if (retry > 0) {
        const retryAfter = Math.ceil(retry / 1000);
        res.setHeader('Retry-After', retryAfter);
        return next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait before trying again.', { retryAfter }));
      }
      return next();
    } catch (error) {
      res.setHeader('Retry-After', 2);
      return next(trafficError(error));
    }
  };
}

// Leases track active seats screens. Queue ordering is separate from heartbeat
// expiry so polling never moves a user backwards. Redis TIME keeps instances aligned.
const ADMISSION_SCRIPT = `
local clock = redis.call('TIME')
local second = tonumber(clock[1])
local now = second * 1000 + math.floor(tonumber(clock[2]) / 1000)
local user = ARGV[1]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 1000)
for _, member in ipairs(expired) do
  redis.call('ZREM', KEYS[2], member)
  redis.call('ZREM', KEYS[3], member)
end
if redis.call('ZSCORE', KEYS[1], user) then
  redis.call('ZADD', KEYS[1], now + ARGV[4], user)
  redis.call('PEXPIRE', KEYS[1], ARGV[4] * 2)
  return 0
end
if not redis.call('ZSCORE', KEYS[2], user) then
  redis.call('ZADD', KEYS[2], redis.call('INCR', KEYS[4]), user)
end
redis.call('ZADD', KEYS[3], now + ARGV[5], user)
for i = 2, 4 do redis.call('PEXPIRE', KEYS[i], ARGV[5] * 2) end
local used = 0
if tonumber(redis.call('HGET', KEYS[5], 'second')) == second then
  used = tonumber(redis.call('HGET', KEYS[5], 'used'))
end
local slots = math.min(tonumber(ARGV[2]) - redis.call('ZCARD', KEYS[1]), tonumber(ARGV[3]) - used)
if slots > 0 then
  local admit = redis.call('ZRANGE', KEYS[2], 0, slots - 1)
  for _, member in ipairs(admit) do
    redis.call('ZREM', KEYS[2], member)
    redis.call('ZREM', KEYS[3], member)
    redis.call('ZADD', KEYS[1], now + ARGV[4], member)
  end
  redis.call('HSET', KEYS[5], 'second', second, 'used', used + #admit)
  redis.call('PEXPIRE', KEYS[5], 2000)
  redis.call('PEXPIRE', KEYS[1], ARGV[4] * 2)
end
if redis.call('ZSCORE', KEYS[1], user) then return 0 end
return (redis.call('ZRANK', KEYS[2], user) or 0) + 1
`;

export async function admissionPosition(redis: Redis, showtimeId: string, userId: string, policy = {
  capacity: env.WAITING_ROOM_CAPACITY, rate: env.WAITING_ROOM_ADMISSIONS_PER_SECOND, leaseMs: 30_000,
}) {
  const prefix = 'reelpass:admission:{' + showtimeId + '}:';
  const keys = ['active', 'queue', 'heartbeat', 'sequence', 'window'].map(part => prefix + part);
  return Number(await redis.eval(ADMISSION_SCRIPT, keys.length, ...keys,
    userId, policy.capacity, policy.rate, policy.leaseMs, 45_000));
}

export async function getAdmission(showtimeId: string, userId: string) {
  try {
    const position = resolveDataMode() === 'postgres' ? await admissionPosition(redisForTraffic(), showtimeId, userId) : 0;
    return { admitted: position === 0, position, retryAfter: 2 };
  } catch (error) { throw trafficError(error); }
}
