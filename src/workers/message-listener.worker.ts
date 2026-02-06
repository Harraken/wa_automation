import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import whatsappAutomationService from '../services/whatsapp-automation.service';
import { prisma } from '../utils/db';
import { createChildLogger } from '../utils/logger';
import { config } from '../config';
import { agentManager } from '../websocket/agent.manager';

const logger = createChildLogger('message-polling');

const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

// Queue for polling messages
export const messagePollingQueue = new Queue('message-polling', {
  connection,
});

// Worker to poll messages from WhatsApp
export const messagePollingWorker = new Worker(
  'message-polling',
  async (job) => {
    const { sessionId } = job.data;
    
    logger.info(`Starting message polling for session: ${sessionId}`);
    
    try {
      // Get session details
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
          provision: true,
        },
      });
      
      if (!session || !session.isActive) {
        logger.info(`Session ${sessionId} is not active, skipping`);
        return;
      }
      
      if (!session.appiumPort || !session.containerId) {
        logger.warn(`Session ${sessionId} missing appiumPort or containerId`);
        return;
      }
      
      // Get the contact phone number (the test recipient)
      const contactPhone = '+972545879642'; // Updated to match test phone number
      
      // Poll messages from WhatsApp
      const messages = await whatsappAutomationService.pollMessages({
        appiumPort: session.appiumPort,
        sessionId: session.id,
        contactPhone,
        containerId: session.containerId,
      });
      
      logger.info(`Polled ${messages.length} messages for session ${sessionId}`);
      
      // Save new messages to database
      for (const message of messages) {
        // Check if message already exists (duplicate detection)
        const existing = await prisma.message.findFirst({
          where: {
            sessionId: session.id,
            text: message.text,
            direction: message.direction,
            // Within last 5 minutes (to avoid false duplicates)
            createdAt: {
              gte: new Date(Date.now() - 5 * 60 * 1000),
            },
          },
        });
        
        if (!existing) {
          // Save new message
          const savedMessage = await prisma.message.create({
            data: {
              sessionId: session.id,
              from: message.from,
              to: message.to,
              text: message.text,
              direction: message.direction,
              status: 'DELIVERED',
            },
          });
          
          logger.info(`New message saved: ${message.text.substring(0, 50)}...`);
          
          // Emit WebSocket event for real-time updates
          agentManager.broadcastToFrontend('new_message', {
            sessionId: session.id,
            message: savedMessage,
          });
        }
      }
      
    } catch (error: any) {
      logger.error(`Error polling messages for session ${sessionId}: ${error.message}`);
      throw error;
    }
  },
  {
    connection,
    concurrency: 3, // Process up to 3 sessions in parallel
    limiter: {
      max: 10, // Max 10 jobs
      duration: 3000, // Per 3 seconds
    },
  }
);

messagePollingWorker.on('completed', (job) => {
  logger.info(`Completed polling for session: ${job.data.sessionId}`);
});

messagePollingWorker.on('failed', (job, err) => {
  logger.error(`Failed polling for session: ${job?.data?.sessionId} - ${err.message}`);
});

logger.info('Message polling worker started');

