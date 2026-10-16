import { Queue, Worker, Job } from 'bullmq';
import { env } from '../config/env';
import { cache } from '../redis/client';

export interface BookingJobData {
  bookingId: string;
  showtimeId: string;
  seatIds: string[];
}

let bookingQueue: Queue | null = null;

function getRedisConnectionConfig() {
  const redisUrl = env.REDIS_URL;
  if (redisUrl) {
    const isTls = redisUrl.startsWith('rediss://') || process.env.REDIS_TLS === 'true';
    return {
      url: redisUrl,
      ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
    };
  }
  return {
    host: 'localhost',
    port: 6379,
  };
}

export function getBookingQueue(): Queue | null {
  if (bookingQueue) return bookingQueue;
  if (!cache.isLive()) {
    return null;
  }

  try {
    const connection = getRedisConnectionConfig();
    bookingQueue = new Queue('ticket-processing', { connection });
    return bookingQueue;
  } catch (err) {
    console.warn('⚠️ [BullMQ] Could not initialize ticket-processing queue:', err);
    return null;
  }
}

export function startWorker() {
  if (!cache.isLive()) {
    console.log('ℹ️ [BullMQ] Redis not active; running in direct in-process dispatch mode.');
    return;
  }

  try {
    const worker = new Worker(
      'ticket-processing',
      async (job: Job<BookingJobData>) => {
        console.log(`[BullMQ] Processing job ${job.id} for booking: ${job.data.bookingId}`);
        // Phase 2 will handle automatic ticket release after 10-minute hold expiry
      },
      {
        connection: getRedisConnectionConfig(),
      }
    );

    worker.on('completed', (job) => {
      console.log(`[BullMQ] Job ${job.id} completed.`);
    });
  } catch (err) {
    console.warn('⚠️ [BullMQ] Worker could not be started:', err);
  }
}
