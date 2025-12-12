import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { connectDB, disconnectDB } from './utils/db';
import { closeQueues } from './services/queue.service';
import { provisionWorker } from './workers/provision.worker';
import { otpWorker } from './workers/otp.worker';
import { messageWorker } from './workers/message.worker';
import { messagePollingWorker } from './workers/message-listener.worker';

// Validate configuration
try {
  validateConfig();
} catch (error) {
  logger.error({ error }, 'Configuration validation failed');
  process.exit(1);
}

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down workers gracefully');

  await provisionWorker.close();
  await otpWorker.close();
  await messageWorker.close();
  await messagePollingWorker.close();
  
  await closeQueues();
  await disconnectDB();

  logger.info('Workers shut down');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start workers
async function start() {
  try {
    console.log('🚀 [WORKER] Starting workers...');
    await connectDB();

    console.log('✅ [WORKER] Database connected');
    console.log('👷 [WORKER] Provision worker started');
    console.log('👷 [WORKER] OTP worker started');
    console.log('👷 [WORKER] Message worker started');
    console.log('👷 [WORKER] Message polling worker started (3s interval)');

    logger.info({ 
      env: config.env,
      workers: ['provision', 'otp', 'message', 'message-polling'],
    }, 'Workers started');
  } catch (error) {
    console.log('❌ [WORKER] Failed to start workers:', error);
    logger.error({ error }, 'Failed to start workers');
    process.exit(1);
  }
}

start();


