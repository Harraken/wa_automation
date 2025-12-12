import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { provisionService } from '../services/provision.service';
import { provisionQueue } from '../services/queue.service';
import { authenticateJWT } from '../middleware/auth.middleware';
import { provisionRateLimiter } from '../middleware/rateLimiter.middleware';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('provision-routes');
const router = Router();

// Validation schemas
const createProvisionSchema = z.object({
  country_id: z.string().optional(),
  application_id: z.string().optional(),
  label: z.string().optional(),
  linkToWeb: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * POST /provision
 * Create a new provision request
 */
router.post('/', authenticateJWT, provisionRateLimiter, async (req: Request, res: Response) => {
  try {
    const input = createProvisionSchema.parse(req.body);
    
    // Log the received country_id for debugging
    console.log(`📋 [PROVISION ROUTE] Received request - country_id: "${input.country_id}", application_id: "${input.application_id}"`);

    // Create provision record
    const provision = await provisionService.createProvision({
      countryId: input.country_id,
      applicationId: input.application_id,
      label: input.label,
      linkToWeb: input.linkToWeb,
      metadata: input.metadata,
    });

    // Enqueue provisioning job
    console.log(`📋 [PROVISION ROUTE] Adding job to queue for provision ${provision.id}`);
    console.log(`📋 [PROVISION ROUTE] Country from input: "${input.country_id}", stored as: "${provision.countryId}"`);
    const job = await provisionQueue.add('onboard-provision', {
      provisionId: provision.id,
      countryId: provision.countryId || input.country_id || undefined, // Use the stored countryId from provision (could be country name)
      applicationId: input.application_id,
      linkToWeb: input.linkToWeb,
    }, {
      // CRITICAL: NO automatic retries to prevent creating duplicate containers/sessions
      attempts: 1,
      removeOnComplete: 10, // Keep last 10 completed jobs for debugging
      removeOnFail: 50, // Keep last 50 failed jobs for debugging
    });

    console.log(`✅ [PROVISION ROUTE] Job added to queue with ID: ${job.id}`);
    logger.info({ provisionId: provision.id, userId: req.user?.userId, jobId: job.id }, 'Provision created and job enqueued');

    res.status(201).json({
      provision_id: provision.id,
      state: provision.state,
      createdAt: provision.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    
    logger.error({ error }, 'Failed to create provision');
    res.status(500).json({ error: 'Failed to create provision' });
  }
});

/**
 * GET /provision/:id
 * Get provision status and details
 */
router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const provision = await provisionService.getProvision(req.params.id);

    if (!provision) {
      res.status(404).json({ error: 'Provision not found' });
      return;
    }

    res.json({
      id: provision.id,
      phone: provision.phone,
      state: provision.state,
      label: provision.label,
      linkToWeb: provision.linkToWeb,
      lastError: provision.lastError,
      createdAt: provision.createdAt,
      updatedAt: provision.updatedAt,
      sessions: provision.sessions,
      otpLogs: provision.otpLogs,
    });
  } catch (error) {
    logger.error({ error, provisionId: req.params.id }, 'Failed to get provision');
    res.status(500).json({ error: 'Failed to get provision' });
  }
});

/**
 * GET /provision
 * List all provisions
 */
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const provisions = await provisionService.listProvisions(limit, offset);

    res.json({
      provisions,
      limit,
      offset,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list provisions');
    res.status(500).json({ error: 'Failed to list provisions' });
  }
});

/**
 * GET /provision/balance
 * Get SMS-MAN account balance
 */
router.get('/balance', authenticateJWT, async (_req: Request, res: Response) => {
  try {
    const balance = await provisionService.getBalance();
    res.json({ balance });
  } catch (error) {
    logger.error({ error }, 'Failed to get balance');
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

/**
 * POST /provision/broadcast
 * Broadcast WebSocket event (for workers)
 */
router.post('/broadcast', async (req: Request, res: Response) => {
  try {
    const { event, data } = req.body;
    
    // Import agentManager here to avoid circular dependency
    const { agentManager } = await import('../websocket/agent.manager');
    agentManager.broadcastToFrontend(event, data);
    
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to broadcast event');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

