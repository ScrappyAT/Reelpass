import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// This file is supplied to k6 by the disposable runner. No production URL or
// authentication token can be supplied through command-line overrides.
const run = /* DISPOSABLE_RUN */ null;
if (!run || !/^http:\/\/127\.0\.0\.1:[0-9]+\/api\/v1$/.test(run.url) || run.tokens.length !== 500) {
  throw new Error('Run via scripts/test-isolated.ps1 -Load');
}

const created = new Counter('holds_created');
const conflicts = new Counter('seat_conflicts');
const unexpected = new Counter('unexpected_responses');
const holdRequests = new Counter('hold_requests');
const warmupErrors = new Counter('warmup_errors');
const transport = new Counter('transport_errors');
const serverErrors = new Counter('server_errors');
const rateRejected = new Counter('admission_or_rate_rejected');
const startDelay = new Trend('dispatch_delay_ms', true);
const holdDuration = new Trend('hold_duration_ms', true);
http.setResponseCallback(http.expectedStatuses(200, 201, 409));

export const options = {
  scenarios: { simultaneous_hold: { executor: 'per-vu-iterations', vus: 500, iterations: 1, maxDuration: '45s' } },
  thresholds: {
    hold_requests: ['count==500'], holds_created: ['count==50'], seat_conflicts: ['count==450'],
    unexpected_responses: ['count==0'], warmup_errors: ['count==0'], hold_duration_ms: ['p(95)<5000'],
  },
};

export function setup() {
  return { releaseAt: Date.now() + 9000 };
}

export default function (data) {
  const index = __VU - 1;
  // Open existing-client connections gradually. Only the seat requests are
  // synchronized, so the benchmark measures booking, not a TCP SYN burst.
  sleep(Math.max(0, (data.releaseAt - 7000 + index * 10 - Date.now()) / 1000));
  const warmup = http.get(run.url + '/payments/status', { timeout: '2s', tags: { phase: 'warmup' } });
  warmupErrors.add(warmup.status === 200 ? 0 : 1);
  sleep(Math.max(0, (data.releaseAt - Date.now()) / 1000));
  startDelay.add(Math.max(0, Date.now() - data.releaseAt));
  const response = http.post(run.url + '/bookings', JSON.stringify({
    showtimeId: 'load-500x50',
    seatIds: ['load-seat-' + (1 + index % 50)],
  }), { timeout: '15s', tags: { phase: 'hold' }, headers: {
    'Content-Type': 'application/json', Authorization: 'Bearer ' + run.tokens[index],
    'Idempotency-Key': 'load-hold-' + index,
  } });
  holdRequests.add(1);
  holdDuration.add(response.timings.duration);
  let correctConflict = false;
  if (response.status === 409) {
    try { correctConflict = response.json('error.code') === 'SEAT_UNAVAILABLE'; } catch { /* unexpected */ }
  }
  created.add(response.status === 201 ? 1 : 0);
  conflicts.add(correctConflict ? 1 : 0);
  unexpected.add(response.status !== 201 && !correctConflict ? 1 : 0);
  transport.add(response.status === 0 ? 1 : 0);
  serverErrors.add(response.status >= 500 ? 1 : 0);
  rateRejected.add(response.status === 429 ? 1 : 0);
}

export function handleSummary(data) {
  const value = (metric, key) => data.metrics[metric]?.values[key] ?? 0;
  const result = {
    virtualUsers: 500, contestedSeats: 50,
    requests: value('hold_requests', 'count'),
    warmupErrors: value('warmup_errors', 'count'),
    holdsCreated: value('holds_created', 'count'),
    expectedSeatConflicts: value('seat_conflicts', 'count'),
    unexpectedResponses: value('unexpected_responses', 'count'),
    transportErrors: value('transport_errors', 'count'),
    serverErrors: value('server_errors', 'count'),
    admissionOrRateRejected: value('admission_or_rate_rejected', 'count'),
    unexpectedHttpRate: value('unexpected_responses', 'count') / 500,
    meanMs: value('hold_duration_ms', 'avg'),
    p95Ms: value('hold_duration_ms', 'p(95)'),
    dispatchP95Ms: value('dispatch_delay_ms', 'p(95)'),
    dispatchMaxMs: value('dispatch_delay_ms', 'max'),
  };
  return { stdout: 'REELPASS_GRADUATION_K6 ' + JSON.stringify(result) + '\n' };
}
