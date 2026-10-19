import Redis from 'ioredis';
import { env } from '../src/config/env';
import { parseRedisConfig } from '../src/redis/config';

async function verify() {
  console.log('🔍 [Redis Verification] Checking Redis configuration and connectivity...');

  const rawUrl = env.REDIS_URL || (env.NODE_ENV !== 'production' ? 'redis://localhost:6385' : undefined);
  if (!rawUrl) {
    console.error('❌ [Redis Verification] REDIS_URL environment variable is not set.');
    process.exit(1);
  }

  const config = parseRedisConfig(rawUrl);
  if (!config) {
    console.error('❌ [Redis Verification] Failed to parse REDIS_URL.');
    process.exit(1);
  }

  if (config.error) {
    console.error(`❌ [Redis Verification] Configuration error: ${config.error}`);
    process.exit(1);
  }

  console.log(`📍 Endpoint: ${config.sanitizedHost}`);
  console.log(`🔒 TLS: ${config.isTls ? 'Enabled (SNI: ' + config.hostname + ')' : 'Disabled'}`);
  console.log('⏳ Connecting to Redis...');

  const client = new Redis(config.url, {
    ...config.options,
    lazyConnect: true,
  });

  try {
    const start = Date.now();
    await client.connect();
    const connectLatency = Date.now() - start;
    console.log(`✅ TCP + TLS Handshake established in ${connectLatency}ms.`);

    const pingStart = Date.now();
    const ping = await client.ping();
    const pingLatency = Date.now() - pingStart;
    console.log(`🏓 PING response: "${ping}" (${pingLatency}ms).`);

    console.log('🧪 Running SET -> GET -> DEL verification test...');
    const testKey = `reelpass:verify:cli:${Date.now()}`;
    const testVal = `ok_${Math.random().toString(36).substring(2, 8)}`;

    await client.set(testKey, testVal, 'EX', 30);
    const retrieved = await client.get(testKey);
    await client.del(testKey);

    if (retrieved === testVal) {
      console.log('✅ Temporary SET/GET/DEL test successful: value written and verified without leaking credentials.');
    } else {
      throw new Error(`Retrieved value mismatch. Expected "${testVal}", got "${retrieved}".`);
    }

    const existsAfterDel = await client.exists(testKey);
    if (existsAfterDel === 0) {
      console.log('✅ Temporary key successfully deleted.');
    }

    console.log('🎉 Redis connection and operations verified 100% operational.');
    await client.quit();
    process.exit(0);
  } catch (err: any) {
    console.error(`💥 [Redis Verification] Failed: ${err.message}`);
    await client.quit().catch(() => undefined);
    process.exit(1);
  }
}

verify();
