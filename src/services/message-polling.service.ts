import { prisma } from '../utils/db';
import { messagePollingQueue } from '../workers/message-listener.worker';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('message-polling-service');

class MessagePollingService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  /**
   * Start polling messages for all active sessions
   * Runs every 3 seconds
   */
  async startPolling() {
    if (this.isPolling) {
      logger.warn('Polling is already running');
      return;
    }

    this.isPolling = true;
    logger.info('Starting message polling service (every 3 seconds)');

    // Initial poll
    await this.pollAllActiveSessions();

    // Set up interval for continuous polling
    this.pollingInterval = setInterval(async () => {
      await this.pollAllActiveSessions();
    }, 3000); // Every 3 seconds
  }

  /**
   * Stop the polling service
   */
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isPolling = false;
      logger.info('Message polling service stopped');
    }
  }

  /**
   * Poll messages for all active sessions
   */
  private async pollAllActiveSessions() {
    try {
      // Get all active sessions
      const activeSessions = await prisma.session.findMany({
        where: {
          isActive: true,
          appiumPort: {
            not: null,
          },
          containerId: {
            not: null,
          },
        },
        select: {
          id: true,
          appiumPort: true,
          containerId: true,
        },
      });

      if (activeSessions.length === 0) {
        logger.debug('No active sessions to poll');
        return;
      }

      logger.debug(`Polling ${activeSessions.length} active sessions`);

      // Enqueue polling job for each session
      for (const session of activeSessions) {
        try {
          await messagePollingQueue.add(
            'poll-messages',
            {
              sessionId: session.id,
            },
            {
              jobId: `poll-${session.id}-${Date.now()}`, // Unique job ID
              removeOnComplete: true, // Clean up completed jobs
              removeOnFail: false, // Keep failed jobs for debugging
            }
          );
        } catch (error: any) {
          logger.error(`Failed to enqueue polling for session ${session.id}: ${error.message}`);
        }
      }
    } catch (error: any) {
      logger.error(`Error in pollAllActiveSessions: ${error.message}`);
    }
  }

  /**
   * Get polling status
   */
  getStatus() {
    return {
      isPolling: this.isPolling,
      interval: '3 seconds',
    };
  }
}

export const messagePollingService = new MessagePollingService();

