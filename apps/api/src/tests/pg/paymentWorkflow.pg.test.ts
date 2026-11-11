import './isolatedEnv';
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { env } from '../../config/env';
import { checkDatabaseConnection, closeDbPool, getDbPool } from '../../db/pool';
import { runMigrations } from '../../db/migrate';
import { cache } from '../../redis/client';
import { verifyRedisReadWrite } from '../../redis/config';
import { seatHolds } from '../../redis/seatHolds';
import { setFlutterwaveMock } from '../../services/payment.service';
import { processNextPaymentEvent } from '../../services/paymentWorkflow';
import { expirePendingBookings, processNextRefund } from '../../services/refundWorkflow';
import { startPaymentWorker } from '../../queue';
import { refreshDemoShowtimes } from '../../db/refreshDemoShowtimes';
import { admissionPosition, consumeBudget } from '../../services/traffic';

const owner = 'workflow-owner';
const outsider = 'workflow-outsider';
const admin = 'workflow-admin';
let server: Server;
let base: string;
const pool = () => getDbPool()!;
const transactions = new Map<string, Record<string, unknown>>();
const refunds = new Map<string, Record<string, unknown>>();
let initializeCalls = 0;
let verificationCalls = 0;
let refundCalls = 0;
let simulateAmbiguousRefund = false;
let simulateAmbiguousCheckout = false;
let cursor = 0;
let nextTransaction = 10000;

async function row(sql: string, params: unknown[] = []) {
  return (await pool().query(sql, params)).rows[0];
}
const token = (user: string) => jwt.sign({ id: user, role: user === admin ? 'admin' : 'customer' }, env.JWT_SECRET);
async function http(path: string, method = 'GET', body?: object, user = owner, extra: Record<string, string> = {}) {
  const response = await fetch(base + path, { method, headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer ' + token(user), ...extra,
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, json: await response.json() as any };
}
async function reserve(showtime = 'wf-showtime', user = owner, seat?: string, key?: string) {
  const result = await http('/bookings', 'POST', { showtimeId: showtime, seatIds: [seat ?? 'wf-seat-' + ++cursor] },
    user, key ? { 'Idempotency-Key': key } : {});
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data;
}
async function checkout(booking: any, key = booking.id, user = owner) {
  return http('/payments/initialize', 'POST', { bookingId: booking.id }, user, { 'Idempotency-Key': key });
}
function providerTransaction(payment: any, extra: Record<string, unknown> = {}, id = String(++nextTransaction)) {
  transactions.set(id, { id: Number(id), tx_ref: payment.reference, amount: payment.amountKobo / 100,
    currency: 'NGN', status: 'successful', ...extra });
  return id;
}
async function notify(payment: any, id: string, status = 'successful', signature = 'isolated-test-webhook-secret') {
  return http('/payments/webhook', 'POST', { event: 'charge.completed', data: { id, tx_ref: payment.reference, status } },
    owner, { 'verif-hash': signature });
}
async function due(table: 'payment_events' | 'refunds', key: string) {
  const column = table === 'payment_events' ? 'event_key' : 'id';
  await pool().query('UPDATE ' + table + ' SET next_attempt_at = NOW() WHERE ' + column + ' = $1', [key]);
}
async function waitFor(check: () => Promise<boolean>, description: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await check()) return;
    await delay(100);
  }
  assert.fail('Timed out waiting for ' + description);
}

before(async () => {
  await checkDatabaseConnection(true);
  await runMigrations();
  assert.equal(await cache.waitForReady(3000), true);
  assert.equal(await verifyRedisReadWrite(cache.getRedisClient()!), true);
  for (const id of [owner, outsider, admin]) {
    await pool().query('INSERT INTO users (id,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)',
      [id, id + '@example.test', 'unused', id, id === admin ? 'admin' : 'customer']);
  }
  await pool().query("INSERT INTO cinemas (id,name,city,address) VALUES ('wf-cinema','Workflow Cinema','Lagos','Test address')");
  await pool().query("INSERT INTO movies (id,title) VALUES ('wf-movie','Workflow Film')");
  await pool().query("INSERT INTO auditoriums (id,cinema_id,name) VALUES ('wf-aud','wf-cinema','Workflow Hall')");
  await pool().query(`INSERT INTO seats (id,auditorium_id,row_label,seat_number)
    SELECT 'wf-seat-' || n,'wf-aud','A',n FROM generate_series(1,50) n`);
  for (const showtime of ['wf-showtime', 'wf-cancel']) {
    await pool().query(`INSERT INTO showtimes (id,movie_id,cinema_id,auditorium_id,start_time,end_time,price_standard_kobo)
      VALUES ($1,'wf-movie','wf-cinema','wf-aud',NOW()+INTERVAL '2 days',NOW()+INTERVAL '2 days 2 hours',750000)`, [showtime]);
    await pool().query("INSERT INTO showtime_seats (showtime_id,seat_id) SELECT $1,id FROM seats WHERE auditorium_id='wf-aud'", [showtime]);
  }
  setFlutterwaveMock(async (url, init) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    let data: unknown;
    if (path === '/v3/payments' && init?.method === 'POST') {
      initializeCalls++;
      const { tx_ref } = JSON.parse(String(init.body));
      await delay(30);
      if (simulateAmbiguousCheckout) throw new Error('Simulated lost checkout response');
      data = { link: 'https://checkout.flutterwave.com/v3/' + tx_ref };
    } else if (path.endsWith('/verify')) {
      verificationCalls++;
      data = transactions.get(path.split('/')[3]);
      if (!data) return { ok: false, status: 503, json: async () => ({}) };
    } else if (path === '/v3/refunds') {
      const existing = refunds.get(parsed.searchParams.get('id')!);
      data = existing ? [existing] : [];
    } else if (path.startsWith('/v3/refunds/')) {
      data = [...refunds.values()].find(refund => String(refund.id) === path.split('/')[3]);
    } else if (path.endsWith('/refund') && init?.method === 'POST') {
      refundCalls++;
      const id = path.split('/')[3];
      data = { id: refundCalls + 900, tx_id: Number(id), amount_refunded: JSON.parse(String(init.body)).amount, status: 'completed' };
      refunds.set(id, data as Record<string, unknown>);
      if (simulateAmbiguousRefund) throw new Error('Simulated lost refund response');
    } else {
      assert.fail('Unexpected mock gateway request ' + path);
    }
    return { ok: true, status: 200, json: async () => ({ status: 'success', data }) };
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test API port');
  base = 'http://127.0.0.1:' + address.port + '/api/v1';
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  setFlutterwaveMock(null);
  await Promise.all([cache.close(), closeDbPool()]);
});

afterEach(async () => {
  // These keys belong to the validated disposable Redis instance.
  const redis = cache.getRedisClient()!;
  const counters = await redis.keys('reelpass:limit:*');
  if (counters.length) await redis.del(...counters);
});

test('concurrent booking and checkout replays produce one reservation and one checkout link', async () => {
  const seat = 'wf-seat-' + ++cursor;
  const [b1, b2] = await Promise.all([reserve('wf-showtime', owner, seat, 'one-hold'), reserve('wf-showtime', owner, seat, 'one-hold')]);
  assert.equal(b1.id, b2.id);
  assert.equal(b1.serviceFee, 15000);
  assert.equal(b1.totalAmount, 765000);
  const mismatch = await http('/bookings', 'POST', { showtimeId: 'wf-showtime', seatIds: ['wf-seat-50'] },
    owner, { 'Idempotency-Key': 'one-hold' });
  assert.equal(mismatch.status, 409);
  const before = initializeCalls;
  const replies = await Promise.all(Array.from({ length: 12 }, () => checkout(b1, 'one-checkout')));
  assert.ok(replies.every(reply => reply.status === 200 || reply.status === 202), JSON.stringify(replies));
  const ready = await checkout(b1, 'one-checkout');
  assert.equal(ready.status, 200);
  assert.equal(initializeCalls - before, 1);
  assert.ok(replies.every(reply => reply.json.data.reference === ready.json.data.reference));
  assert.equal((await row('SELECT COUNT(*)::int AS count FROM payments WHERE booking_id=$1', [b1.id])).count, 1);
  assert.equal((await checkout(await reserve(), 'one-checkout')).status, 409);
  assert.equal((await checkout(b1, 'another-owner', outsider)).status, 403);
});

test('ambiguous checkout is not sent again even under a new key', async () => {
  const booking = await reserve();
  const before = initializeCalls;
  simulateAmbiguousCheckout = true;
  try { assert.equal((await checkout(booking)).status, 502); }
  finally { simulateAmbiguousCheckout = false; }
  assert.equal((await checkout(booking)).status, 409);
  assert.equal((await checkout(booking, 'try-another-key')).status, 409);
  assert.equal(initializeCalls - before, 1);
});

test('browser and recovery endpoints cannot settle, even with a successful provider response', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  const id = providerTransaction(payment, { amount: 0.01, currency: 'USD', tx_ref: 'unrelated' });
  const before = verificationCalls;
  const status = await http('/payments/' + booking.id + '/status');
  assert.equal(status.json.data.isConfirmed, false);
  assert.equal((await http('/payments/verify', 'POST', { bookingId: booking.id, reference: payment.reference, transactionId: id })).json.data.isConfirmed, false);
  assert.equal((await http('/bookings/' + booking.id + '/confirm', 'POST', { transactionId: id })).status, 202);
  assert.equal((await http('/payments/' + booking.id + '/status', 'GET', undefined, outsider)).status, 403);
  const callback = await fetch(base + '/payments/callback?status=successful&tx_ref=' + payment.reference);
  assert.match(await callback.text(), /after payment is confirmed/);
  assert.equal(verificationCalls, before);
  assert.equal((await row('SELECT status FROM bookings WHERE id=$1', [booking.id])).status, 'pending');
});

test('only authenticated webhook deliveries queue and every mismatch is rejected by the worker', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  assert.equal((await notify(payment, '9001', 'successful', 'wrong')).status, 401);
  assert.equal((await row("SELECT COUNT(*)::int AS count FROM payment_events WHERE transaction_id='9001'")).count, 0);
  for (const [override, code] of [
    [{ amount: 0.01 }, 'AMOUNT_MISMATCH'], [{ amount: undefined }, 'AMOUNT_MISMATCH'],
    [{ currency: 'USD' }, 'CURRENCY_MISMATCH'], [{ tx_ref: 'unrelated' }, 'REFERENCE_MISMATCH'],
    [{ status: 'failed' }, 'PAYMENT_STATUS_MISMATCH'], [{ id: 4000 }, 'TRANSACTION_ID_MISMATCH'],
  ] as const) {
    const id = providerTransaction(payment, override);
    const event = await notify(payment, id);
    assert.equal(event.status, 200);
    assert.equal(await processNextPaymentEvent(pool()), true);
    const outcome = await row('SELECT status,result_code FROM payment_events WHERE event_key=$1', [event.json.eventId]);
    assert.deepEqual(outcome, { status: 'rejected', result_code: code });
  }
  await pool().query('UPDATE payments SET user_id=$2 WHERE id=$1', [payment.paymentId, outsider]);
  const event = await notify(payment, providerTransaction(payment));
  await processNextPaymentEvent(pool());
  assert.equal((await row('SELECT result_code FROM payment_events WHERE event_key=$1', [event.json.eventId])).result_code, 'BOOKING_OWNER_MISMATCH');
  assert.equal((await row('SELECT status FROM bookings WHERE id=$1', [booking.id])).status, 'pending');
});

test('duplicate webhooks and concurrent workers confirm once; transaction cannot pay a different booking', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  const id = providerTransaction(payment);
  const deliveries = await Promise.all(Array.from({ length: 10 }, () => notify(payment, id)));
  assert.ok(deliveries.every(event => event.status === 200 && event.json.eventId === deliveries[0].json.eventId));
  assert.equal((await http('/payments/' + booking.id + '/status')).json.data.isConfirmed, false);
  const results = await Promise.all(Array.from({ length: 6 }, () => processNextPaymentEvent(pool())));
  assert.equal(results.filter(Boolean).length, 1);
  const status = (await http('/payments/' + booking.id + '/status')).json.data;
  assert.equal(status.isConfirmed, true);
  assert.equal(status.booking.tickets.length, 1);
  assert.ok(status.booking.qrCode);
  assert.equal((await row('SELECT COUNT(*)::int AS count FROM payment_captures WHERE transaction_id=$1', [id])).count, 1);
  const other = await reserve();
  const otherPayment = (await checkout(other)).json.data;
  assert.equal((await http('/bookings/' + other.id + '/confirm', 'POST', { transactionId: id })).status, 409);
  providerTransaction(otherPayment, {}, id);
  const replay = await notify(otherPayment, id);
  await processNextPaymentEvent(pool());
  assert.equal((await row('SELECT result_code FROM payment_events WHERE event_key=$1', [replay.json.eventId])).result_code, 'TRANSACTION_ALREADY_USED');
  assert.equal((await row('SELECT status FROM bookings WHERE id=$1', [other.id])).status, 'pending');
});

test('verified failure and explicit abandonment release PostgreSQL and owner-specific Redis holds', async () => {
  for (const cause of ['failed', 'abandoned']) {
    const booking = await reserve();
    const seat = booking.seats[0].id;
    const payment = (await checkout(booking)).json.data;
    assert.ok(await seatHolds.holder(booking.showtimeId, seat));
    if (cause === 'failed') {
      const id = providerTransaction(payment, { status: 'failed' });
      await notify(payment, id, 'failed');
      await processNextPaymentEvent(pool());
    } else {
      assert.equal((await http('/bookings/' + booking.id + '/cancel', 'POST')).status, 200);
    }
    assert.equal((await row('SELECT status FROM bookings WHERE id=$1', [booking.id])).status, 'cancelled');
    await waitFor(async () => !(await seatHolds.holder(booking.showtimeId, seat)), 'Redis hold release');
    const replacement = await reserve(booking.showtimeId, outsider, seat);
    assert.notEqual(replacement.id, booking.id);
  }
});

test('expiry releases holds and late payment queues one refund without taking the rebooked seat', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  await pool().query("UPDATE bookings SET expires_at = NOW() - INTERVAL '1 second' WHERE id=$1", [booking.id]);
  assert.ok(await expirePendingBookings(pool()));
  const seat = booking.seats[0].id;
  await waitFor(async () => !(await seatHolds.holder(booking.showtimeId, seat)), 'expired Redis hold release');
  const replacement = await reserve(booking.showtimeId, outsider, seat);
  const id = providerTransaction(payment);
  await notify(payment, id);
  await processNextPaymentEvent(pool());
  assert.equal((await row('SELECT status FROM bookings WHERE id=$1', [booking.id])).status, 'expired');
  assert.equal((await row('SELECT booking_id FROM booking_seats WHERE showtime_id=$1 AND seat_id=$2', [booking.showtimeId, seat])).booking_id, replacement.id);
  const queued = await row('SELECT id,status FROM refunds WHERE transaction_id=$1', [id]);
  assert.equal(queued.status, 'queued');
  const before = refundCalls;
  await Promise.all(Array.from({ length: 4 }, () => processNextRefund(pool())));
  assert.equal(refundCalls - before, 1);
  assert.equal((await row('SELECT status FROM refunds WHERE id=$1', [queued.id])).status, 'pending');
  refunds.get(id)!.status = 'completed-mpgs';
  await due('refunds', queued.id);
  await processNextRefund(pool());
  assert.equal((await row('SELECT status FROM refunds WHERE id=$1', [queued.id])).status, 'succeeded');
});

test('admin cancellation preserves ticket history and a lost refund response cannot trigger a second POST', async () => {
  const booking = await reserve('wf-cancel');
  const payment = (await checkout(booking)).json.data;
  const id = providerTransaction(payment);
  await notify(payment, id);
  await processNextPaymentEvent(pool());
  assert.equal((await http('/showtimes/wf-cancel/cancel', 'POST', {}, outsider)).status, 403);
  const replies = await Promise.all(Array.from({ length: 4 }, () => http('/showtimes/wf-cancel/cancel', 'POST', {}, admin)));
  assert.equal(replies.filter(reply => reply.json.data.refunds === 1).length, 1);
  assert.equal((await row('SELECT COUNT(*)::int AS count FROM tickets WHERE booking_id=$1', [booking.id])).count, 1);
  assert.equal((await http('/payments/' + booking.id + '/status')).json.data.isConfirmed, false);
  const refund = await row('SELECT id FROM refunds WHERE transaction_id=$1', [id]);
  const before = refundCalls;
  simulateAmbiguousRefund = true;
  try { await Promise.all(Array.from({ length: 6 }, () => processNextRefund(pool()))); }
  finally { simulateAmbiguousRefund = false; }
  assert.equal(refundCalls - before, 1);
  assert.equal((await row('SELECT status FROM refunds WHERE id=$1', [refund.id])).status, 'submitting');
  refunds.get(id)!.status = 'completed-mpgs';
  await due('refunds', refund.id);
  await Promise.all(Array.from({ length: 6 }, () => processNextRefund(pool())));
  assert.equal(refundCalls - before, 1);
  assert.deepEqual((await pool().query('SELECT status FROM refund_ledger WHERE refund_id=$1 ORDER BY id', [refund.id]))
    .rows.map(item => item.status), ['queued', 'submitting', 'submitting', 'succeeded']);
  assert.equal((await http('/bookings', 'POST', { showtimeId: 'wf-cancel', seatIds: ['wf-seat-50'] })).status, 409);
});

test('provider errors back off and stop at five attempts with a durable failure report', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  const event = await notify(payment, '99999');
  for (let attempt = 1; attempt <= 5; attempt++) {
    await processNextPaymentEvent(pool());
    const state = await row('SELECT status,attempts,next_attempt_at>NOW() AS backoff FROM payment_events WHERE event_key=$1', [event.json.eventId]);
    assert.equal(state.attempts, attempt);
    assert.equal(state.status, attempt < 5 ? 'queued' : 'failed');
    assert.equal(state.backoff, true);
    if (attempt < 5) await due('payment_events', event.json.eventId);
  }
  assert.equal(await processNextPaymentEvent(pool()), false);
  const report = await http('/payments/admin/workflow', 'GET', undefined, admin);
  assert.ok(report.json.data.events.some((eventRow: any) => eventRow.event_key === event.json.eventId && eventRow.status === 'failed'));
});

test('a separately started BullMQ worker drains events received while the worker was stopped', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  const event = await notify(payment, providerTransaction(payment));
  assert.equal((await row('SELECT status FROM payment_events WHERE event_key=$1', [event.json.eventId])).status, 'queued');
  const worker = await startPaymentWorker(pool(), cache.getRedisClient()!);
  try {
    await waitFor(async () => (await row('SELECT status FROM bookings WHERE id=$1', [booking.id])).status === 'confirmed', 'BullMQ settlement');
  } finally { await worker.close(); }
});

test('waiting room preserves position and admits in order as active leases expire', async () => {
  const redis = cache.getRedisClient()!;
  const policy = { capacity: 1, rate: 1, leaseMs: 500 };
  assert.equal(await admissionPosition(redis, 'fifo-test', 'first', policy), 0);
  assert.equal(await admissionPosition(redis, 'fifo-test', 'second', policy), 1);
  assert.equal(await admissionPosition(redis, 'fifo-test', 'third', policy), 2);
  await delay(1050);
  // Third polls first but the next available place is assigned to second.
  assert.equal(await admissionPosition(redis, 'fifo-test', 'third', policy), 1);
  assert.equal(await admissionPosition(redis, 'fifo-test', 'second', policy), 0);
  await delay(1050);
  assert.equal(await admissionPosition(redis, 'fifo-test', 'third', policy), 0);
});

test('Redis enforces account and IP budgets atomically', async () => {
  const redis = cache.getRedisClient()!;
  const attempt = (account: string, ip: string) => consumeBudget(redis, 'budget-test',
    [{ id: account, limit: 1 }, { id: ip, limit: 2 }]);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => attempt('a1', 'ip1')));
  assert.equal(concurrent.filter(result => result === 0).length, 1);
  assert.ok(await attempt('a1', 'ip2') > 0);
  assert.equal(await attempt('a2', 'ip1'), 0);
  assert.ok(await attempt('a3', 'ip1') > 0);
});

test('showtime refresh plans read-only and adds inventory without altering existing records', async () => {
  const old = await row("SELECT start_time, end_time FROM showtimes WHERE id='wf-showtime'");
  const dryRun = await refreshDemoShowtimes(pool());
  assert.ok(dryRun.planned > 0);
  assert.equal(dryRun.created, 0);
  const [first, second] = await Promise.all([refreshDemoShowtimes(pool(), true), refreshDemoShowtimes(pool(), true)]);
  assert.equal(first.created + second.created, dryRun.planned);
  const expected = await row(`SELECT COUNT(*)::int AS count FROM showtimes s JOIN seats a USING (auditorium_id)
    WHERE s.id LIKE 'demo-next-%'`);
  assert.equal(first.seats + second.seats, expected.count);
  const missing = await row(`SELECT COUNT(*)::int AS count FROM showtimes s JOIN seats a USING (auditorium_id)
    LEFT JOIN showtime_seats i ON i.showtime_id = s.id AND i.seat_id = a.id
    WHERE s.id LIKE 'demo-next-%' AND i.seat_id IS NULL`);
  assert.equal(missing.count, 0);
  assert.deepEqual(await row("SELECT start_time, end_time FROM showtimes WHERE id='wf-showtime'"), old);
  assert.equal((await refreshDemoShowtimes(pool())).planned, 0);
});

test('two distinct captures for one booking issue one ticket and queue one extra-capture refund', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  const ids = [providerTransaction(payment), providerTransaction(payment)];
  await Promise.all(ids.map(id => notify(payment, id)));
  await Promise.all(ids.map(() => processNextPaymentEvent(pool())));
  const records = await pool().query('SELECT disposition FROM payment_captures WHERE booking_id=$1 ORDER BY disposition', [booking.id]);
  assert.deepEqual(records.rows.map(record => record.disposition), ['booked', 'refund_due']);
  assert.equal((await row('SELECT COUNT(*)::int AS count FROM tickets WHERE booking_id=$1', [booking.id])).count, 1);
  assert.equal((await row('SELECT COUNT(*)::int AS count FROM refunds WHERE transaction_id = ANY($1::text[])', [ids])).count, 1);
  const settled = (await http('/payments/' + booking.id + '/status')).json.data;
  const mismatch = await http('/payments/verify', 'POST', { bookingId: booking.id,
    transactionId: ids.find(id => id !== settled.payment.transactionId) });
  assert.equal(mismatch.status, 409);
});

test('legacy successful payment with an incomplete booking can only be repaired by a verified event', async () => {
  const booking = await reserve();
  const payment = (await checkout(booking)).json.data;
  const id = providerTransaction(payment);
  await pool().query("UPDATE payments SET status='successful',transaction_id=$2 WHERE id=$1", [payment.paymentId, id]);
  assert.equal((await http('/payments/' + booking.id + '/status')).json.data.isConfirmed, false);
  await notify(payment, id);
  assert.equal(await processNextPaymentEvent(pool()), true);
  assert.equal((await http('/payments/' + booking.id + '/status')).json.data.isConfirmed, true);
});

async function verifyReleaseStartup(entries: string[], supervised = false) {
  const processes = entries.map(entry => spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  let output = '';
  for (const child of processes) {
    child.stdout!.setEncoding('utf8').on('data', text => { output += text; });
    child.stderr!.setEncoding('utf8').on('data', text => { output += text; });
  }
  try {
    await waitFor(async () => output.includes('reelpass_api_ready') && output.includes('payment_worker_ready'),
      'release API and worker readiness');
    const address = output.split(/\r?\n/).find(line => line.startsWith('{"event":"reelpass_api_ready"'))!;
    const { port } = JSON.parse(address);
    const result = await fetch('http://127.0.0.1:' + port + '/api/v1/health', { signal: AbortSignal.timeout(3000) });
    assert.equal(result.status, 200);
    assert.equal((await result.json() as { dataMode: string }).dataMode, 'postgres');
  } finally {
    await Promise.all(processes.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, 'close');
      if (supervised && process.platform === 'win32') {
        // Windows force-terminates a Node process for SIGTERM. Stop its owned child tree as well.
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill();
      }
      await closed;
    }));
  }
}

test('compiled API and payment worker boot as separate processes against the test stack', async () => {
  await verifyReleaseStartup(['dist/index.js', 'dist/worker.js']);
});

test('staging launcher boots both compiled processes against the test stack', async () => {
  await verifyReleaseStartup(['../../scripts/start-staging.cjs'], true);
});
