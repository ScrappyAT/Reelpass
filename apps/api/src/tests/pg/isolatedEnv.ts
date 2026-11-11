const database = new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid');
const redis = new URL(process.env.REDIS_URL || 'redis://invalid:6379');
if (process.env.REELPASS_ISOLATED_TESTS !== '1'
    || database.hostname !== '127.0.0.1' || !/^reelpass_it_[a-f0-9]{12}$/.test(database.pathname.slice(1))
    || !database.port || ['5432', '5455'].includes(database.port)
    || redis.hostname !== '127.0.0.1' || !redis.port || ['6379', '6385'].includes(redis.port)) {
  throw new Error('Refusing to run write tests outside the disposable ReelPass test stack. Use scripts/test-isolated.ps1.');
}
process.env.NODE_ENV = 'test';
process.env.DATA_MODE = 'postgres';
process.env.DATABASE_READ_URL = '';
process.env.WAITING_ROOM_CAPACITY = process.env.REELPASS_LOAD_TEST === '1' ? '500' : '120';
process.env.WAITING_ROOM_ADMISSIONS_PER_SECOND = process.env.REELPASS_LOAD_TEST === '1' ? '500' : '20';
process.env.TRAFFIC_IP_LIMIT_MULTIPLIER = process.env.REELPASS_LOAD_TEST === '1' ? '10' : '1';
process.env.TRUST_PROXY_HOPS = '0';
process.env.FLW_SECRET_KEY = '';
process.env.FLUTTERWAVE_SECRET_KEY = '';
process.env.FLW_SECRET_HASH = 'isolated-test-webhook-secret';
process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH = '';
process.env.TMDB_API_KEY = '';
process.env.JWT_SECRET = 'isolated-test-jwt-secret-never-used-outside-tests';
process.env.SERVICE_FEE_KOBO = '15000';
