import './testEnv';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import app from '../app';
import { parseRedisConfig, getSanitizedRedisHost, verifyRedisReadWrite } from '../redis/config';
import { cache } from '../redis/client';

let server: Server;
let baseUrl = '';

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}/api/v1`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cache.close();
});

test('parseRedisConfig correctly configures Upstash TLS and SNI servername', () => {
  const upstashUrl = 'rediss://default:supersecretpassword123@us1-fancy-bear-12345.upstash.io:6379';
  const config = parseRedisConfig(upstashUrl);

  assert.ok(config, 'config should be parsed');
  assert.equal(config.isTls, true, 'TLS should be enabled for rediss://');
  assert.equal(config.hostname, 'us1-fancy-bear-12345.upstash.io');
  assert.equal(config.port, 6379);
  assert.equal(config.sanitizedHost, 'us1-fancy-bear-12345.upstash.io:6379');
  assert.ok(!config.sanitizedHost.includes('supersecretpassword123'), 'sanitizedHost must never expose credentials');
  assert.equal(config.options.maxRetriesPerRequest, null, 'maxRetriesPerRequest must be null for BullMQ compatibility');
  assert.equal((config.options.tls as any)?.servername, 'us1-fancy-bear-12345.upstash.io', 'SNI servername must match hostname');
});

test('parseRedisConfig strips double and single quotes from REDIS_URL', () => {
  const quoted = '"rediss://default:secret@us1-fancy-bear-12345.upstash.io:6379"';
  const config = parseRedisConfig(quoted);

  assert.ok(config);
  assert.equal(config.isTls, true);
  assert.equal(config.hostname, 'us1-fancy-bear-12345.upstash.io');
  assert.equal((config.options.tls as any)?.servername, 'us1-fancy-bear-12345.upstash.io');
});

test('parseRedisConfig automatically enables TLS and SNI when host is upstash.io even with redis://', () => {
  const unsecureUpstash = 'redis://default:secret@us1-fancy-bear-12345.upstash.io:6379';
  const config = parseRedisConfig(unsecureUpstash);

  assert.ok(config);
  assert.equal(config.isTls, true, 'Upstash endpoints must automatically enable TLS');
  assert.equal((config.options.tls as any)?.servername, 'us1-fancy-bear-12345.upstash.io');
});

test('parseRedisConfig handles unencoded special characters in password and redis-cli prefix', () => {
  const cliInput = 'redis-cli -u rediss://default:p#ssword?foo=bar@us1-fancy-bear-12345.upstash.io:6379';
  const config = parseRedisConfig(cliInput);

  assert.ok(config);
  assert.equal(config.hostname, 'us1-fancy-bear-12345.upstash.io');
  assert.equal(config.port, 6379);
  assert.equal(config.options.password, 'p#ssword?foo=bar');
  assert.equal(config.options.username, 'default');
  assert.equal(config.isTls, true);
  assert.equal(config.sanitizedHost, 'us1-fancy-bear-12345.upstash.io:6379');
});

test('parseRedisConfig detects Upstash HTTPS REST URL and returns helpful guidance', () => {
  const restUrl = 'https://us1-fancy-bear-12345.upstash.io';
  const config = parseRedisConfig(restUrl);

  assert.ok(config);
  assert.ok(config.error, 'Should report an error for HTTP(S) URLs');
  assert.match(config.error!, /HTTP\(S\) URL/, 'Error should explain HTTP REST vs TCP Redis URL');
  assert.match(config.error!, /rediss:\/\//, 'Error should guide user to rediss:// format');
});

test('parseRedisConfig correctly configures Redis Cloud TLS endpoint with strict certificate validation enabled by default', () => {
  const redisCloudUrl = 'rediss://default:redisCloudSecretPass999@redis-13768.c289.us-central1-1-2.gce.redns.redis-cloud.com:13768';
  const config = parseRedisConfig(redisCloudUrl);

  assert.ok(config, 'Redis Cloud configuration should parse cleanly');
  assert.equal(config.isTls, true, 'rediss:// scheme must activate TLS');
  assert.equal(config.hostname, 'redis-13768.c289.us-central1-1-2.gce.redns.redis-cloud.com');
  assert.equal(config.port, 13768);
  assert.equal(config.sanitizedHost, 'redis-13768.c289.us-central1-1-2.gce.redns.redis-cloud.com:13768');
  assert.ok(!config.sanitizedHost.includes('redisCloudSecretPass999'), 'sanitizedHost must never expose Redis Cloud password');
  assert.equal((config.options.tls as any)?.rejectUnauthorized, true, 'rejectUnauthorized must default to true for secure TLS certificate validation');
  assert.equal((config.options.tls as any)?.servername, 'redis-13768.c289.us-central1-1-2.gce.redns.redis-cloud.com', 'SNI servername must match Redis Cloud hostname');
});

test('parseRedisConfig honors REDIS_REJECT_UNAUTHORIZED=false opt-out for custom environments', () => {
  const originalEnv = process.env.REDIS_REJECT_UNAUTHORIZED;
  try {
    process.env.REDIS_REJECT_UNAUTHORIZED = 'false';
    const redisCloudUrl = 'rediss://default:secret@redis-13768.c289.us-central1-1-2.gce.redns.redis-cloud.com:13768';
    const config = parseRedisConfig(redisCloudUrl);
    assert.ok(config);
    assert.equal(config.isTls, true);
    assert.equal((config.options.tls as any)?.rejectUnauthorized, false, 'Explicit opt-out must set rejectUnauthorized to false');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.REDIS_REJECT_UNAUTHORIZED;
    } else {
      process.env.REDIS_REJECT_UNAUTHORIZED = originalEnv;
    }
  }
});

test('getSanitizedRedisHost never leaks passwords or usernames', () => {
  const sanitized = getSanitizedRedisHost('rediss://default:ultra_secret_token@my-redis.upstash.io:6379');
  assert.equal(sanitized, 'my-redis.upstash.io:6379');
  assert.ok(!sanitized.includes('ultra_secret_token'));
  assert.ok(!sanitized.includes('default'));
});

test('verifyRedisReadWrite verifies SET/GET/DEL on a live Redis instance', async () => {
  const client = cache.getRedisClient();
  if (client && cache.isLive()) {
    const verified = await verifyRedisReadWrite(client);
    assert.equal(verified, true, 'Temporary SET/GET/DEL test should succeed on live Redis');
  }
});

test('health check endpoint exposes services with safe Redis diagnostics', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const json: any = await res.json();

  assert.equal(json.status, 'ok');
  assert.ok(json.services, 'services object must be present');
  assert.ok(json.services.cache, 'cache status must be present');
  assert.ok(json.services.redis, 'redis diagnostic info must be present');
  assert.ok('configured' in json.services.redis);
  assert.ok('status' in json.services.redis);
  assert.ok('verified' in json.services.redis);
  assert.ok('host' in json.services.redis);
  assert.ok('tls' in json.services.redis);

  // Assert no credentials appear anywhere in the health JSON
  const rawJson = JSON.stringify(json);
  assert.ok(!rawJson.includes('password'), 'Health response must not contain passwords');
});

after(async () => {
  await cache.close();
});
