import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('queue-service');

// Create Redis connection
const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

connection.on('connect', () => {
  logger.info('Redis connected for queues');
});

connection.on('error', (error) => {
  logger.error({ error }, 'Redis connection error');
});

const queueOptions: QueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600, // 24 hours
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 3600, // 7 days
    },
  },
};

export interface ProvisionJobData {
  provisionId: string;
  countryId?: string;
  applicationId?: string;
  linkToWeb?: boolean;
}

export interface ProcessOtpJobData {
  provisionId: string;
  requestId: string;
  otp: string;
}

export interface SendMessageJobData {
  sessionId: string;
  to: string;
  text: string;
  messageId: string;
}

// Define queues
export const provisionQueue = new Queue<ProvisionJobData>('provision', queueOptions);
export const otpQueue = new Queue<ProcessOtpJobData>('otp', queueOptions);
export const messageQueue = new Queue<SendMessageJobData>('message', queueOptions);

logger.info('Queues initialized');

export async function closeQueues() {
  await Promise.all([
    provisionQueue.close(),
    otpQueue.close(),
    messageQueue.close(),
  ]);
  await connection.quit();
  logger.info('Queues closed');
}



