/**
 * Test routes for debugging purposes
 * These routes allow testing individual components without full provisioning
 */

import { Router, Request, Response } from 'express';
import { dockerService } from '../services/docker.service';
import { sessionService } from '../services/session.service';
import { createChildLogger } from '../utils/logger';
import { authenticateJWT } from '../middleware/auth.middleware';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const logger = createChildLogger('test-routes');

// Global lock to prevent multiple test VNC creations at once
let isCreatingTestVnc = false;

/**
 * Create a test VNC container (Android only, no WhatsApp)
 * This is useful for debugging VNC/websockify issues without full provisioning
 */
router.post('/vnc-container', authenticateJWT, async (_req: Request, res: Response) => {
  // Check if already creating a test VNC
  if (isCreatingTestVnc) {
    logger.warn('Test VNC creation already in progress, rejecting request');
    res.status(429).json({
      error: 'A test VNC container is already being created. Please wait.',
      details: 'Only one test VNC can be created at a time.',
    });
    return;
  }

  // Set lock
  isCreatingTestVnc = true;
  const testId = `test-${uuidv4().substring(0, 8)}`;
  
  try {
    logger.info({ testId }, 'Creating test VNC container (Android only)');

    // Clean up any existing test containers to avoid port conflicts
    logger.info('Cleaning up existing test containers...');
    try {
      const docker = (await import('dockerode')).default;
      const dockerClient = new docker();
      const allContainers = await dockerClient.listContainers({ all: true });
      
      const testContainers = allContainers.filter(c => 
        c.Names.some(name => name.includes('wa-emulator-test') || name.includes('websockify-test'))
      );

      for (const containerInfo of testContainers) {
        try {
          const container = dockerClient.getContainer(containerInfo.Id);
          logger.info({ containerId: containerInfo.Id, names: containerInfo.Names }, 'Removing old test container');
          
          if (containerInfo.State === 'running') {
            await container.stop({ t: 5 });
          }
          await container.remove({ force: true });
        } catch (err: any) {
          logger.warn({ error: err.message, containerId: containerInfo.Id }, 'Failed to remove old test container');
        }
      }
      
      logger.info({ removedCount: testContainers.length }, 'Cleaned up old test containers');

      // Wait for Docker to fully release the ports (important!)
      if (testContainers.length > 0) {
        logger.info('Waiting 3 seconds for Docker to release ports...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Mark old test sessions as inactive
      const prisma = (await import('../utils/db')).prisma;
      const updated = await prisma.session.updateMany({
        where: { 
          provisionId: { startsWith: 'test-' },
          isActive: true,
        },
        data: { isActive: false },
      });
      logger.info({ updatedSessions: updated.count }, 'Marked old test sessions as inactive');
    } catch (cleanupError: any) {
      logger.warn({ error: cleanupError.message }, 'Cleanup of old test containers failed (non-fatal)');
      // Wait anyway to be safe
      logger.info('Waiting 2 seconds before proceeding...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Generate a simple agent token (not used but required by container)
    const agentToken = `test-${Date.now()}`;

    // Create a test provision entry in database (required for foreign key constraint)
    const prisma = (await import('../utils/db')).prisma;
    const { ProvisionState } = await import('@prisma/client');
    const provision = await prisma.provision.create({
      data: {
        id: testId,
        phone: 'TEST-VNC', // Identifier for the UI
        countryId: null,
        applicationId: null,
        state: ProvisionState.ACTIVE, // Directly active
        linkToWeb: false,
      },
    });

    logger.info({ testId, provisionId: provision.id }, 'Test provision created');

    // Spawn Android emulator container
    const emulatorInfo = await dockerService.spawnEmulator({
      sessionId: testId,
      phone: 'TEST-VNC',
      agentToken,
      linkToWeb: false,
    });

    logger.info({ testId, containerId: emulatorInfo.containerId }, 'Test container spawned');

    // Create a test session in database
    const session = await sessionService.createSession({
      provisionId: testId,
      containerId: emulatorInfo.containerId,
      streamUrl: emulatorInfo.streamUrl,
      vncPort: emulatorInfo.vncPort,
      appiumPort: emulatorInfo.appiumPort,
      agentToken,
    });

    logger.info({ testId, sessionId: session.id }, 'Test session created');

    // Wait for websockify to be ready (up to 30 seconds with retries)
    let vncReady = false;
    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info({ testId, attempt, maxRetries }, 'Checking websockify status');
      
      try {
        // @ts-ignore - TODO: Fix DockerService interface
        vncReady = await dockerService.isWebsockifyRunning(testId);
        if (vncReady) {
          logger.info({ testId, attempt }, 'Websockify is ready');
          break;
        }
      } catch (error: any) {
        logger.warn({ testId, attempt, error: error.message }, 'Websockify check failed');
      }

      if (attempt < maxRetries) {
        logger.info({ testId, attempt }, 'Websockify not ready yet, waiting 3 seconds...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    if (!vncReady) {
      logger.error({ testId }, 'Websockify failed to start after 30 seconds');
      res.status(500).json({
        error: 'VNC container started but websockify failed to become ready',
        testId,
        sessionId: session.id,
        containerId: emulatorInfo.containerId,
        vncReady: false,
      });
      return;
    }

    logger.info({ testId, sessionId: session.id }, 'Test VNC container is fully ready');

    // Activate session so it appears in the UI
    await prisma.session.update({
      where: { id: session.id },
      data: { isActive: true }
    });

    res.status(200).json({
      success: true,
      message: 'Test VNC container created successfully',
      testId,
      sessionId: session.id,
      containerId: emulatorInfo.containerId,
      streamUrl: emulatorInfo.streamUrl,
      vncPort: emulatorInfo.vncPort,
      appiumPort: emulatorInfo.appiumPort,
      vncReady: true,
      instructions: 'Navigate to the Stream tab to view the Android emulator via VNC',
    });
  } catch (error: any) {
    logger.error({ error: error.message, testId }, 'Failed to create test VNC container');
    res.status(500).json({
      error: 'Failed to create test VNC container',
      details: error.message,
      testId,
    });
  } finally {
    // Always release the lock
    isCreatingTestVnc = false;
    logger.info('Test VNC creation lock released');
  }
});

/**
 * Check websockify status for a test container
 */
router.get('/vnc-container/:testId/status', authenticateJWT, async (req: Request, res: Response) => {
  const { testId } = req.params;

  try {
    // @ts-ignore - TODO: Fix DockerService interface
    const isRunning = await dockerService.isWebsockifyRunning(testId);
    
    res.status(200).json({
      testId,
      websockifyRunning: isRunning,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error: error.message, testId }, 'Failed to check websockify status');
    res.status(500).json({
      error: 'Failed to check websockify status',
      details: error.message,
      testId,
    });
  }
});

export default router;
