import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { MessageStatus } from '@prisma/client';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';
import { SendMessageJobData } from '../services/queue.service';
import { sessionService } from '../services/session.service';
import whatsappAutomationService from '../services/whatsapp-automation.service';

const logger = createChildLogger('message-worker');

const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

async function processSendMessage(job: Job<SendMessageJobData>) {
  const { sessionId, to, text, messageId } = job.data;
  
  logger.info({ sessionId, messageId, to }, 'Processing send message');

  try {
    // Get session to find Appium port
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (!session.appiumPort) {
      throw new Error('Appium port not found for session');
    }

    // saveLog removed - message sending logs are handled internally by sendMessage now
    // const saveLog = async (message: string) => { ... };

    // Send message directly via Appium
    // Use container name (wa-emulator-{provisionId}) for Docker DNS resolution
    const containerName = `wa-emulator-${session.provisionId}`;
    logger.info({ sessionId, provisionId: session.provisionId, appiumPort: session.appiumPort, to, containerName }, 'Starting message send');
    await whatsappAutomationService.sendMessage({
      appiumPort: session.appiumPort!,
      to,
      message: text,
      sessionId,
      containerId: containerName, // Use container name for Docker DNS
    });

    // Update message status
    await sessionService.updateMessageStatus(messageId, MessageStatus.SENT);

    logger.info({ sessionId, messageId }, 'Message sent successfully');

    return { success: true };
  } catch (error) {
    logger.error({ error, sessionId, messageId }, 'Failed to send message');
    
    await sessionService.updateMessageStatus(messageId, MessageStatus.FAILED);
    
    throw error;
  }
}

// Create worker
export const messageWorker = new Worker<SendMessageJobData>(
  'message',
  processSendMessage,
  {
    connection,
    concurrency: 10,
  }
);

messageWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, sessionId: job.data.sessionId }, 'Message job completed');
});

messageWorker.on('failed', (job, err) => {
  logger.error({ 
    jobId: job?.id, 
    sessionId: job?.data.sessionId, 
    error: err 
  }, 'Message job failed');
});

logger.info('Message worker started');






