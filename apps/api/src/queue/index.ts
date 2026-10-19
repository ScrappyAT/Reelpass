import { Queue, Worker, Job } from 'bullmq';
import { cache } from '../redis/client';

export interface BookingJobData {
  bookingId: string;
  showtimeId: string;
  seatIds: string[];
}

let bookingQueue: Queue | null = null;
let worker: Worker | null = null;

function getRedisConnection() {
  const redis = cache.getRedisClient();
  if (redis) {
    // BullMQ requires maxRetriesPerRequest to be null and benefits from a duplicated connection
    return redis.duplicate({ maxRetriesPerRequest: null });
  }
  return {
    host: 'localhost',
    port: 6385,
    maxRetriesPerRequest: null,
  };
}

export function getBookingQueue(): Queue | null {
  if (bookingQueue) return bookingQueue;
  if (!cache.isLive()) {
    return null;
  }

  try {
    const connection = getRedisConnection();
    bookingQueue = new Queue('ticket-processing', { connection });
    return bookingQueue;
  } catch (err) {
    console.warn('⚠️ [BullMQ] Could not initialize ticket-processing queue:', err);
    return null;
  }
}

export function startWorker() {
  if (worker) return;
  if (!cache.isLive()) {
    console.log('ℹ️ [BullMQ] Redis not active; running in direct in-process dispatch mode.');
    return;
  }

  try {
    const connection = getRedisConnection();
    worker = new Worker(
      'ticket-processing',
      async (job: Job<BookingJobData>) => {
        console.log(`[BullMQ] Processing job ${job.id} for booking: ${job.data.bookingId}`);
        // Phase 2 will handle automatic ticket release after 10-minute hold expiry
      },
      {
        connection,
      }
    );

    worker.on('completed', (job) => {
      console.log(`[BullMQ] Job ${job.id} completed.`);
    });

    console.log('✅ [BullMQ] Ticket processing worker started.');
  } catch (err) {
    console.warn('⚠️ [BullMQ] Worker could not be started:', err);
  }
}
