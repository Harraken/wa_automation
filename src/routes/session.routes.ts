import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { MessageDirection } from '@prisma/client';
import { sessionService } from '../services/session.service';
import { messageQueue } from '../services/queue.service';
import { dockerService } from '../services/docker.service';
import { authenticateJWT } from '../middleware/auth.middleware';
import { createChildLogger } from '../utils/logger';
import { prisma } from '../utils/db';

const logger = createChildLogger('session-routes');
const router = Router();

// Validation schemas
const sendMessageSchema = z.object({
  to: z.string(),
  text: z.string(),
});

/**
 * GET /sessions
 * List all sessions (active and inactive)
 */
router.get('/', authenticateJWT, async (_req: Request, res: Response) => {
  try {
    // Changed to list ALL sessions, not just active ones, so user can see failed/incomplete sessions
    const sessions = await sessionService.listAllSessions();

    const sessionsWithLastMessage = sessions.map((session) => ({
      id: session.id,
      provisionId: session.provisionId,
      phone: session.provision.phone,
      state: session.provision.state,
      isActive: session.isActive,
      linkedWeb: session.linkedWeb,
      streamUrl: session.streamUrl,
      vncPort: session.vncPort,
      lastMessage: session.messages[0] || null,
      createdAt: session.createdAt,
      lastSeen: session.lastSeen,
    }));

    res.json({ sessions: sessionsWithLastMessage });
  } catch (error) {
    logger.error({ error }, 'Failed to list sessions');
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

/**
 * GET /sessions/:id
 * Get session details
 */
router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const session = await sessionService.getSession(req.params.id);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      id: session.id,
      phone: session.provision.phone,
      isActive: session.isActive,
      linkedWeb: session.linkedWeb,
      streamUrl: session.streamUrl,
      vncPort: session.vncPort,
      messages: session.messages,
      createdAt: session.createdAt,
      lastSeen: session.lastSeen,
    });
  } catch (error) {
    logger.error({ error, sessionId: req.params.id }, 'Failed to get session');
    res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * POST /sessions/:id/send
 * Send a message from this session
 */
router.post('/:id/send', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const input = sendMessageSchema.parse(req.body);
    const sessionId = req.params.id;

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Create message record
    const message = await sessionService.createMessage({
      sessionId,
      from: session.provision.phone || '',
      to: input.to,
      text: input.text,
      direction: MessageDirection.OUTBOUND,
    });

    // Enqueue message sending job
    await messageQueue.add('send-message', {
      sessionId,
      to: input.to,
      text: input.text,
      messageId: message.id,
    });

    logger.info({ sessionId, messageId: message.id, to: input.to }, 'Message queued');

    res.status(201).json({ message });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    
    logger.error({ error, sessionId: req.params.id }, 'Failed to send message');
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * GET /sessions/:id/messages
 * Get messages for a session
 */
router.get('/:id/messages', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;

    const messages = await sessionService.getSessionMessages(req.params.id, limit);

    res.json({ messages, limit });
  } catch (error) {
    logger.error({ error, sessionId: req.params.id }, 'Failed to get messages');
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

/**
 * GET /sessions/:id/logs
 * Get logs for a session
 */
router.get('/:id/logs', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 500;

    const logs = await sessionService.getSessionLogs(req.params.id, limit);

    res.json({ logs, limit });
  } catch (error) {
    logger.error({ error, sessionId: req.params.id }, 'Failed to get logs');
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

/**
 * GET /sessions/:id/stream
 * Get stream URL with token
 */
router.get('/:id/stream', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const session = await sessionService.getSession(req.params.id);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.streamUrl) {
      res.status(404).json({ error: 'Stream not available' });
      return;
    }

    // Check if the websockify container is actually running
    // @ts-ignore - TODO: Fix DockerService interface
    const isWebsockifyRunning = await dockerService.isWebsockifyRunning(session.id);
    if (!isWebsockifyRunning) {
      res.status(503).json({ 
        error: 'Stream container not running', 
        message: 'Le conteneur VNC n\'est pas actif. La session a peut-être été arrêtée ou a échoué.',
        sessionId: session.id
      });
      return;
    }

    // For now, return the stream URL directly
    // In production, you'd generate a signed URL or token
    res.json({
      streamUrl: session.streamUrl,
      vncPort: session.vncPort,
    });
  } catch (error) {
    logger.error({ error, sessionId: req.params.id }, 'Failed to get stream');
    res.status(500).json({ error: 'Failed to get stream' });
  }
});

/**
 * POST /sessions/:id/snapshot
 * Create a snapshot of the session
 */
router.post('/:id/snapshot', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const session = await sessionService.getSession(req.params.id);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.containerId) {
      res.status(400).json({ error: 'No container associated with session' });
      return;
    }

    const snapshotPath = `/data/snapshots/${session.id}.tar.gz`;
    
    await dockerService.snapshotContainer(
      session.containerId,
      snapshotPath
    );

    await sessionService.updateSessionSnapshot(session.id, snapshotPath);

    logger.info({ sessionId: session.id, snapshotPath }, 'Snapshot created');

    res.json({ snapshotPath });
  } catch (error) {
    logger.error({ error, sessionId: req.params.id }, 'Failed to create snapshot');
    res.status(500).json({ error: 'Failed to create snapshot' });
  }
});

/**
 * DELETE /sessions/:id
 * Deactivate a session and stop its container
 */
/**
 * DELETE /sessions/all
 * Delete all sessions and related data
 */
router.delete('/all', authenticateJWT, async (_req: Request, res: Response) => {
  try {
    logger.info('Starting deletion of all sessions...');
    
    // Get counts before deletion for progress tracking
    const sessionCount = await prisma.session.count();
    const messageCount = await prisma.message.count();
    const logCount = await prisma.sessionLog.count();
    const otpCount = await prisma.otpLog.count();
    const provisionCount = await prisma.provision.count();
    
    logger.info({ sessionCount, messageCount, logCount, otpCount, provisionCount }, 'Counts before deletion');
    
    const result = await sessionService.deleteAllSessions();
    
    logger.info({ result }, 'Database cleanup completed');
    
    // Also stop and remove all emulator containers
    let containersStopped = 0;
    let containersRemoved = 0;
    try {
      const Docker = (await import('dockerode')).default;
      const docker = new Docker();
      const containers = await docker.listContainers({ 
        all: true, 
        filters: { label: ['whatsapp-provisioner=true'] } 
      });
      
      logger.info({ containerCount: containers.length }, 'Found containers to remove');
      
      // Process containers in parallel for faster deletion
      const containerResults = await Promise.all(
        containers.map(async (containerInfo) => {
          const container = docker.getContainer(containerInfo.Id);
          let stopped = false;
          let removed = false;
          try {
            if (containerInfo.State === 'running') {
              logger.info({ containerId: containerInfo.Id }, 'Stopping container...');
              await container.stop({ t: 5 }); // Reduced timeout from 10s to 5s for faster deletion
              stopped = true;
            }
            logger.info({ containerId: containerInfo.Id }, 'Removing container...');
            await container.remove({ force: true });
            removed = true;
            logger.info({ containerId: containerInfo.Id }, 'Removed container');
          } catch (e: any) {
            logger.warn({ containerId: containerInfo.Id, error: e.message }, 'Failed to remove container');
          }
          return { stopped, removed };
        })
      );
      
      // Count successful operations
      containersStopped = containerResults.filter(r => r.stopped).length;
      containersRemoved = containerResults.filter(r => r.removed).length;
      logger.info({ containersStopped, containersRemoved }, 'Docker cleanup completed');
    } catch (dockerError: any) {
      logger.warn({ error: dockerError.message }, 'Failed to clean up Docker containers');
    }

    res.json({ 
      message: 'All sessions deleted successfully',
      sessionsDeleted: result.sessionsDeleted,
      messagesDeleted: result.messagesDeleted,
      logsDeleted: result.logsDeleted,
      provisionsDeleted: result.provisionsDeleted,
      screenshotsDeleted: result.screenshotsDeleted,
      containersStopped,
      containersRemoved
    });
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Failed to delete all sessions');
    res.status(500).json({ error: 'Failed to delete all sessions' });
  }
});

router.delete('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const session = await sessionService.getSession(req.params.id);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.containerId) {
      await dockerService.stopContainer(session.containerId);
    }

    await sessionService.deactivateSession(session.id);

    logger.info({ sessionId: session.id }, 'Session deactivated');

    res.json({ success: true });
  } catch (error) {
    logger.error({ error, sessionId: req.params.id }, 'Failed to deactivate session');
    res.status(500).json({ error: 'Failed to deactivate session' });
  }
});

export default router;
