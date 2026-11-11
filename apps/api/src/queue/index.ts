import { Queue, Worker } from 'bullmq';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { processNextPaymentEvent } from '../services/paymentWorkflow';
import { expirePendingBookings, processNextRefund } from '../services/refundWorkflow';

export const PAYMENT_QUEUE = 'reelpass-payment-workflow';

export async function startPaymentWorker(pool: Pool, redis: Redis) {
  // PostgreSQL is the durable inbox/outbox. The BullMQ schedule wakes the worker,
  // including after Redis loss or a crash between webhook receipt and processing.
  const queue = new Queue(PAYMENT_QUEUE, { connection: redis });
  const worker = new Worker(PAYMENT_QUEUE, async job => {
    console.log(JSON.stringify({ event: 'workflow_job_started', jobId: job.id, attempt: job.attemptsMade + 1 }));
    for (let i = 0; i < 8 && await processNextPaymentEvent(pool); i++) { /* drain due events */ }
    const expired = await expirePendingBookings(pool);
    if (expired) console.log(JSON.stringify({ event: 'holds_expired', count: expired }));
    for (let i = 0; i < 4 && await processNextRefund(pool); i++) { /* drain due refunds */ }
  }, { connection: redis, concurrency: 2 });
  worker.on('failed', (job, error) => console.error(JSON.stringify({
    event: 'workflow_job_failed', jobId: job?.id, attempt: job?.attemptsMade, code: error.name,
  })));
  worker.on('error', error => console.error(JSON.stringify({ event: 'workflow_worker_error', code: error.name })));
  queue.on('error', error => console.error(JSON.stringify({ event: 'workflow_queue_error', code: error.name })));
  try {
    await worker.waitUntilReady();
    await queue.upsertJobScheduler('payment-workflow', { every: 2_000 }, {
      name: 'drain', data: {}, opts: {
        attempts: 3, backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 100 }, removeOnFail: { count: 100 },
      },
    });
  } catch (error) {
    await worker.close(true);
    await queue.close();
    throw error;
  }
  return { close: async () => { await worker.close(); await queue.close(); } };
}
