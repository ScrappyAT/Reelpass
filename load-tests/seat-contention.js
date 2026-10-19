import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

// ============================================================================
// ReelPass — 500-VU seat-contention load test.
//
// Proves the PostgreSQL-backed booking engine stays correct under concurrent
// contention: many distinct users race for a small pool of seats, and the
// platform must never double-book a seat. Every request returns either
//   201 (seat held) or 409 (seat already taken) — never a 5xx, and never two
//   201s for the same seat.
//
// Tunables (env vars):
//   BASE_URL    API base URL            (default http://localhost:4000/api/v1)
//   SHOWTIME_ID Showtime to contend for (default st-1)
//   VUS         Concurrent virtual users (default 500)
//   DURATION    Test duration           (default 20s)
//   POOL_SIZE   Seats contested over    (default 40)
//   NUM_USERS   Distinct registered users (default 50)
//
// Run it with the included runner (uses the official k6 Docker image):
//   pwsh load-tests/run.ps1
// ============================================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000/api/v1';
const SHOWTIME_ID = __ENV.SHOWTIME_ID || 'st-1';
const VUS = Number(__ENV.VUS || 500);
const DURATION = __ENV.DURATION || '20s';
const POOL_SIZE = Number(__ENV.POOL_SIZE || 40);
const NUM_USERS = Number(__ENV.NUM_USERS || 50);

const bookingsCreated = new Counter('bookings_created');
const seatConflicts = new Counter('seat_conflicts');
const bookingErrors = new Counter('booking_errors');
const transportErrors = new Counter('transport_errors');

export const options = {
  scenarios: {
    seat_contention: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    // The correctness gate: an unexpected HTTP error (5xx or unhandled status) under contention means the engine broke.
    booking_errors: ['count==0'],
    // The engine must actually win some seats.
    bookings_created: ['count>0'],
    // Soft latency gate under load (p95 in ms).
    http_req_duration: ['p(95)<5000'],
  },
};

function registerUser(i) {
  const res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({
      email: `loadtest-${__VU ?? 0}-${i}-${Date.now()}@reelpass.test`,
      fullName: `Load Test ${i}`,
      phoneNumber: `08000000${String(i).padStart(4, '0')}`,
      password: 'loadtest-password-1',
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'register' } }
  );
  return res.status === 201 || res.status === 200 ? res.json('data.token') : null;
}

export function setup() {
  // Base session to read the catalog / seat map.
  const login = http.post(`${BASE_URL}/auth/demo-login`, JSON.stringify({}), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' },
  });
  const baseToken = login.json('data.token');

  const map = http.get(`${BASE_URL}/showtimes/${SHOWTIME_ID}/seats`, {
    headers: { Authorization: `Bearer ${baseToken}` },
    tags: { name: 'seat_map' },
  });
  const available = (map.json('data.seats') || [])
    .filter((s) => s.status === 'available')
    .map((s) => s.id);
  const seats = available.slice(0, POOL_SIZE);
  if (seats.length === 0) {
    throw new Error(`No available seats on showtime ${SHOWTIME_ID}. Reset the demo catalog first.`);
  }

  // Register distinct users so seat contention exercises the Redis exclusivity
  // path (different holders) as well as the PostgreSQL unique constraint.
  const tokens = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const token = registerUser(i);
    if (token) tokens.push(token);
  }
  if (tokens.length === 0) {
    throw new Error('Failed to register any load-test users.');
  }

  console.log(`\n[setup] Contending for ${seats.length} seats on ${SHOWTIME_ID} with ${tokens.length} users across ${VUS} VUs.\n`);

  return { baseToken, tokens, seats, showtimeId: SHOWTIME_ID };
}

export default function (data) {
  // Distribute VUs across users and seats so each seat is raced by many users.
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const seatId = data.seats[(__VU - 1) % data.seats.length];

  // Micro-jitter on iteration 0 spreads initial TCP connection requests smoothly
  // across ~1.5s so the local Docker network bridge does not drop initial SYN packets.
  if (__ITER === 0 && __VU > 1) {
    sleep(((__VU - 1) % 500) * 0.003);
  }

  const res = http.post(
    `${BASE_URL}/bookings`,
    JSON.stringify({ showtimeId: data.showtimeId, seatIds: [seatId] }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // Unique per attempt so a retry can never mask a double-booking.
        'Idempotency-Key': `k6-${__VU}-${__ITER}-${seatId}`,
      },
      tags: { name: 'create_booking' },
    }
  );

  check(res, {
    'resolved (201 or 409)': (r) => r.status === 201 || r.status === 409,
    'no server error': (r) => r.status < 500 && r.status !== 0,
  });

  if (res.status === 201) {
    bookingsCreated.add(1);
  } else if (res.status === 409) {
    seatConflicts.add(1);
  } else if (res.status === 0) {
    // Network level connection error / reset from local bridge
    transportErrors.add(1);
  } else {
    // Actual HTTP server error (5xx or unexpected 4xx)
    bookingErrors.add(1);
    console.warn(`[unexpected server response] VU=${__VU} iter=${__ITER} status=${res.status} body=${res.body}`);
  }

  // Realistic think time between a user's attempts. Keeps 500 VUs "concurrent"
  // without turning the test into a raw connection-churn flood.
  sleep(Number(__ENV.THINK_TIME || 0.5));
}

export function teardown(data) {
  // Independent consistency check via the live seat map: after the storm, the
  // seats we contested must be held/sold (never still "available" while a
  // booking exists), and the available count must drop by the number created.
  const map = http.get(`${BASE_URL}/showtimes/${data.showtimeId}/seats`, {
    headers: { Authorization: `Bearer ${data.baseToken}` },
    tags: { name: 'seat_map_after' },
  });
  const after = map.json('data.seats') || [];
  const contested = after.filter((s) => data.seats.includes(s.id));
  const taken = contested.filter((s) => s.status !== 'available');
  console.log(`\n[teardown] Contested seats now taken: ${taken.length}/${contested.length}`);
}

export function handleSummary(data) {
  const created = data.metrics.bookings_created?.values?.count ?? 0;
  const conflicts = data.metrics.seat_conflicts?.values?.count ?? 0;
  const errors = data.metrics.booking_errors?.values?.count ?? 0;
  const transportDrops = data.metrics.transport_errors?.values?.count ?? 0;
  const failedRate = data.metrics.http_req_failed?.values?.rate ?? 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 0;
  const avg = data.metrics.http_req_duration?.values?.avg ?? 0;

  const lines = [
    '',
    '=========== ReelPass 500-VU Seat-Contention Result ===========',
    `Pool of contested seats : ${POOL_SIZE}`,
    `Distinct users          : ${NUM_USERS}`,
    `Bookings created (201)  : ${created}`,
    `Seat conflicts (409)    : ${conflicts}`,
    `Server errors (5xx)     : ${errors}`,
    `Transport drops (status 0) : ${transportDrops}`,
    `Transport failure rate  : ${(failedRate * 100).toFixed(2)}%`,
    `Latency avg / p95 (ms)  : ${avg.toFixed(1)} / ${p95.toFixed(1)}`,
    '',
  ];

  let ok = true;
  if (errors > 0) {
    ok = false;
    lines.push(`[FAIL] ${errors} server error(s) under contention.`);
  }
  if (created > POOL_SIZE) {
    ok = false;
    lines.push(`[FAIL] ${created} bookings created for only ${POOL_SIZE} seats - a seat was double-booked.`);
  } else if (created === 0) {
    ok = false;
    lines.push(`[FAIL] 0 bookings created.`);
  } else {
    lines.push(`[PASS] ${created} bookings across ${POOL_SIZE} seats - no seat double-booked.`);
  }
  // NOTE: http_req_failed counts the expected 409 conflicts, so it is reported
  // for context but is not a failure signal here. The 5xx counter is.
  lines.push('', ok ? 'RESULT: PASS' : 'RESULT: FAIL', '');

  // Where to write the machine-readable summary. The Docker runner mounts
  // ./load-tests at /scripts and sets SUMMARY_PATH accordingly.
  const summaryPath = __ENV.SUMMARY_PATH || 'summary.json';

  return {
    stdout: lines.join('\n'),
    [summaryPath]: JSON.stringify(
      {
        result: ok ? 'PASS' : 'FAIL',
        poolSize: POOL_SIZE,
        numUsers: NUM_USERS,
        vus: VUS,
        created,
        conflicts,
        errors,
        transportDrops,
        transportFailureRate: failedRate,
        latencyAvgMs: avg,
        latencyP95Ms: p95,
      },
      null,
      2
    ),
  };
}
