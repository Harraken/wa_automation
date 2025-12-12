import { Session, Message, MessageDirection, MessageStatus } from '@prisma/client';
import { prisma } from '../utils/db';
import { createChildLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = createChildLogger('session-service');

export interface CreateSessionInput {
  provisionId: string;
  containerId?: string;
  streamUrl?: string;
  vncPort?: number;
  appiumPort?: number;
  agentToken?: string;
}

export class SessionService {
  /**
   * Create a new session
   */
  async createSession(input: CreateSessionInput): Promise<Session> {
    logger.info({ input }, 'Creating session');

    // Session is created as inactive - will be activated only after WhatsApp is fully configured
    const session = await prisma.session.create({
      data: {
        provisionId: input.provisionId,
        containerId: input.containerId,
        streamUrl: input.streamUrl,
        vncPort: input.vncPort,
        appiumPort: input.appiumPort,
        agentToken: input.agentToken,
        isActive: false, // Will be activated only after WhatsApp is fully set up
      },
    });

    logger.info({ sessionId: session.id }, 'Session created (inactive until WhatsApp is configured)');
    return session;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<any> {
    return await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        provision: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
  }

  /**
   * Update session
   */
  async updateSession(
    sessionId: string,
    data: Partial<CreateSessionInput>
  ): Promise<Session> {
    logger.info({ sessionId, data }, 'Updating session');

    return await prisma.session.update({
      where: { id: sessionId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Activate session (mark as ready to use)
   */
  async activateSession(sessionId: string): Promise<Session> {
    logger.info({ sessionId }, 'Activating session');

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        isActive: true,
      },
    });

    logger.info({ sessionId }, 'Session activated');
    return session;
  }

  /**
   * Deactivate session and delete its screenshots
   */
  async deactivateSession(sessionId: string): Promise<Session> {
    logger.info({ sessionId }, 'Deactivating session');

    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        isActive: false,
      },
    });
    
    // Delete screenshots for this session
    await this.deleteSessionScreenshots(sessionId);
    
    return session;
  }

  /**
   * List active sessions
   */
  async listActiveSessions(limit = 50): Promise<any[]> {
    return await prisma.session.findMany({
      where: { isActive: true },
      include: {
        provision: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * List ALL sessions (active and inactive)
   */
  async listAllSessions(limit = 50): Promise<any[]> {
    return await prisma.session.findMany({
      include: {
        provision: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Update last seen timestamp
   */
  async updateLastSeen(sessionId: string): Promise<Session> {
    return await prisma.session.update({
      where: { id: sessionId },
      data: {
        lastSeen: new Date(),
      },
    });
  }

  /**
   * Update session last seen (alias for updateLastSeen)
   */
  async updateSessionLastSeen(sessionId: string): Promise<Session> {
    return this.updateLastSeen(sessionId);
  }

  /**
   * Create a message
   */
  async createMessage(data: {
    sessionId: string;
    from: string;
    to: string;
    text: string;
    direction: MessageDirection;
    status?: MessageStatus;
    raw?: any;
    externalId?: string;
  }): Promise<Message> {
    logger.info({ data }, 'Creating message');

    return await prisma.message.create({
      data: {
        sessionId: data.sessionId,
        from: data.from,
        to: data.to,
        text: data.text,
        direction: data.direction,
        status: data.status || MessageStatus.PENDING,
        raw: data.raw,
        externalId: data.externalId,
      },
    });
  }

  /**
   * Get session messages
   */
  async getSessionMessages(sessionId: string, limit = 50): Promise<Message[]> {
    return await prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    messageId: string,
    status: MessageStatus
  ): Promise<Message> {
    logger.info({ messageId, status }, 'Updating message status');

    return await prisma.message.update({
      where: { id: messageId },
      data: { status },
    });
  }

  /**
   * Mark session as linked to web
   */
  async markSessionLinkedToWeb(
    sessionId: string,
    webSessionId: string
  ): Promise<Session> {
    logger.info({ sessionId, webSessionId }, 'Marking session as linked to web');

    return await prisma.session.update({
      where: { id: sessionId },
      data: {
        linkedWeb: true,
        webSessionId,
      },
    });
  }

  /**
   * Update session snapshot
   */
  async updateSessionSnapshot(
    sessionId: string,
    snapshotPath: string
  ): Promise<Session> {
    logger.info({ sessionId, snapshotPath }, 'Updating session snapshot');

    return await prisma.session.update({
      where: { id: sessionId },
      data: { snapshotPath },
    });
  }

  /**
   * Create a session log entry
   */
  async createLog(data: {
    sessionId: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    source?: string;
    metadata?: any;
  }): Promise<any> {
    try {
      logger.info({ sessionId: data.sessionId, level: data.level, message: data.message.substring(0, 100) }, 'Creating session log');

      const log = await prisma.sessionLog.create({
        data: {
          sessionId: data.sessionId,
          level: data.level,
          message: data.message,
          source: data.source,
          metadata: data.metadata,
        },
      });
      
      logger.info({ logId: log.id, sessionId: data.sessionId }, 'Session log created successfully');
      return log;
    } catch (error: any) {
      logger.error({ error: error.message, sessionId: data.sessionId, message: data.message.substring(0, 100) }, 'Failed to create session log');
      throw error;
    }
  }

  /**
   * Get session logs
   */
  async getSessionLogs(sessionId: string, limit = 500): Promise<any[]> {
    return await prisma.sessionLog.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Delete screenshot directory for a session
   */
  private async deleteSessionScreenshots(sessionId: string): Promise<void> {
    try {
      // Try Docker volume path first, then local path
      const dockerPath = `/data/screenshots/${sessionId}`;
      const localPath = path.join(process.cwd(), 'data', 'screenshots', sessionId);
      
      const screenshotDir = fs.existsSync('/data/screenshots') ? dockerPath : localPath;
      
      if (fs.existsSync(screenshotDir)) {
        fs.rmSync(screenshotDir, { recursive: true, force: true });
        logger.info({ sessionId, screenshotDir }, 'Screenshot directory deleted');
      }
    } catch (error: any) {
      logger.warn({ error: error.message, sessionId }, 'Failed to delete screenshot directory');
    }
  }

  /**
   * Delete all sessions and related data
   * Optimized to run deletions in parallel where possible
   */
  async deleteAllSessions(): Promise<{ sessionsDeleted: number; messagesDeleted: number; provisionsDeleted: number; logsDeleted: number; screenshotsDeleted: number }> {
    logger.info('Deleting all sessions and related data');

    // Get all session IDs before deletion to clean up screenshots
    const allSessions = await prisma.session.findMany({
      select: { id: true },
    });
    const sessionIds = allSessions.map(s => s.id);

    // Delete messages first (foreign key constraint), then parallelize the rest
    const messagesDeleted = await prisma.message.deleteMany({});
    
    // Delete session logs, OTP logs, and sessions in parallel (no dependencies between them after messages are deleted)
    const [logsDeleted, sessionsDeleted, provisionsDeleted] = await Promise.all([
      prisma.sessionLog.deleteMany({}),
      prisma.session.deleteMany({}),
      prisma.provision.deleteMany({}),
      prisma.otpLog.deleteMany({}), // Also delete OTP logs in parallel
    ]);

    // Delete all screenshot directories
    let screenshotsDeleted = 0;
    for (const sessionId of sessionIds) {
      try {
        await this.deleteSessionScreenshots(sessionId);
        screenshotsDeleted++;
      } catch (error: any) {
        logger.warn({ error: error.message, sessionId }, 'Failed to delete screenshots for session');
      }
    }

    // Also delete the base screenshots directory if it's empty (local only, not Docker volume)
    try {
      const localBaseDir = path.join(process.cwd(), 'data', 'screenshots');
      if (fs.existsSync(localBaseDir) && !fs.existsSync('/data/screenshots')) {
        const entries = fs.readdirSync(localBaseDir);
        if (entries.length === 0) {
          fs.rmdirSync(localBaseDir);
          logger.info({ localBaseDir }, 'Empty screenshots base directory removed');
        }
      }
    } catch (error: any) {
      // Ignore errors when cleaning base directory
    }

    logger.info({ 
      sessionsDeleted: sessionsDeleted.count, 
      messagesDeleted: messagesDeleted.count, 
      logsDeleted: logsDeleted.count,
      provisionsDeleted: provisionsDeleted.count,
      screenshotsDeleted
    }, 'All sessions deleted');

    return {
      sessionsDeleted: sessionsDeleted.count,
      messagesDeleted: messagesDeleted.count,
      logsDeleted: logsDeleted.count,
      provisionsDeleted: provisionsDeleted.count,
      screenshotsDeleted,
    };
  }

}

export const sessionService = new SessionService();

