import './isolatedEnv';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { env } from '../../config/env';
import { checkDatabaseConnection, closeDbPool, getDbPool } from '../../db/pool';
import { runMigrations } from '../../db/migrate';
import { cache } from '../../redis/client';

async function main() {
  assert.equal(process.env.REELPASS_LOAD_TEST, '1');
  assert.equal(await cache.waitForReady(5000), true);
  await checkDatabaseConnection(true);
  await runMigrations();
  const pool = getDbPool()!;
  await pool.query(`INSERT INTO users (id,email,password_hash,full_name)
    SELECT 'load-vu-' || n,'load-vu-' || n || '@example.test','unused','Load User' FROM generate_series(1,500) n`);
  await pool.query("INSERT INTO cinemas (id,name,city,address) VALUES ('load-cinema','Load Fixture','Lagos','Disposable')");
  await pool.query("INSERT INTO movies (id,title) VALUES ('load-movie','Load Fixture')");
  await pool.query("INSERT INTO auditoriums (id,cinema_id,name,total_seats,rows_count,columns_count) VALUES ('load-aud','load-cinema','Load Hall',50,5,10)");
  await pool.query(`INSERT INTO seats (id,auditorium_id,row_label,seat_number)
    SELECT 'load-seat-' || n,'load-aud',chr(65+(n-1)/10),1+(n-1)%10 FROM generate_series(1,50) n`);
  await pool.query(`INSERT INTO showtimes (id,movie_id,cinema_id,auditorium_id,start_time,end_time,price_standard_kobo)
    VALUES ('load-500x50','load-movie','load-cinema','load-aud',NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 day 2 hours',450000)`);
  await pool.query("INSERT INTO showtime_seats (showtime_id,seat_id) SELECT 'load-500x50',id FROM seats");
  const tokens = Array.from({ length: 500 }, (_, index) => jwt.sign(
    { id: 'load-vu-' + (index + 1), role: 'customer' }, env.JWT_SECRET, { expiresIn: '5m' }));
  const executable = process.env.REELPASS_K6_EXE;
  assert.ok(executable, 'A native k6 executable is required for this loopback-only test');
  const server = app.listen(0, '127.0.0.1', 2048);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Load API did not start');
    const scriptPath = resolve(__dirname, '../../../../../load-tests/graduation-500x50.js');
    const script = (await readFile(scriptPath, 'utf8')).replace('/* DISPOSABLE_RUN */ null',
      JSON.stringify({ url: 'http://127.0.0.1:' + address.port + '/api/v1', tokens }));
    const child = spawn(executable, ['run', '--quiet', '--summary-mode=full', '-'],
      { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', data => { output += data; });
    child.stdin.on('error', () => {});
    child.stdin.end(script);
    const [exitCode] = await once(child, 'close');
    const line = output.split(/\r?\n/).find(text => text.startsWith('REELPASS_GRADUATION_K6 '));
    if (!line) throw new Error('k6 did not produce a summary (exit ' + exitCode + ')');
    const metrics = JSON.parse(line.slice('REELPASS_GRADUATION_K6 '.length));
    const { rows: [database] } = await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM bookings WHERE showtime_id='load-500x50') AS reservations,
      (SELECT COUNT(*)::int FROM showtime_seats WHERE showtime_id='load-500x50' AND status='HELD') AS held,
      (SELECT COUNT(*)::int FROM (SELECT seat_id FROM booking_seats WHERE showtime_id='load-500x50'
        GROUP BY seat_id HAVING COUNT(*)>1) AS d) AS duplicate_seat_claims,
      (SELECT COUNT(*)::int FROM tickets WHERE showtime_id='load-500x50') AS tickets,
      (SELECT COUNT(*)::int FROM payment_captures) AS captures`);
    const result = { recordedAt: new Date().toISOString(), metrics, database,
      environment: 'Disposable local PostgreSQL 16 and Redis 7; 500 distinct synthetic accounts',
      loadTransport: 'native k6 over loopback',
      policy: { capacity: env.WAITING_ROOM_CAPACITY, admissionsPerSecond: env.WAITING_ROOM_ADMISSIONS_PER_SECOND,
        ipBudgetMultiplier: env.TRAFFIC_IP_LIMIT_MULTIPLIER },
      passed: exitCode === 0 && database.reservations === 50 && database.held === 50
        && database.duplicate_seat_claims === 0 && database.tickets === 0 && database.captures === 0 };
    console.log('500x50_RESULT ' + JSON.stringify(result));
    await writeFile(resolve(__dirname, '../../../../../load-tests/graduation-500x50-result.json'), JSON.stringify(result, null, 2) + '\n');
    assert.equal(result.passed, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Load run failed');
  process.exitCode = 1;
}).finally(() => Promise.allSettled([cache.close(), closeDbPool()]));
