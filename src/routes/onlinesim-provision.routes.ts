import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { onlinesimProvisionService } from '../services/onlinesim-provision.service';
import { authenticateJWT } from '../middleware/auth.middleware';
import { provisionRateLimiter } from '../middleware/rateLimiter.middleware';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('onlinesim-provision-routes');
const router = Router();

// Validation schemas
const createProvisionSchema = z.object({
  country_id: z.number().optional(),
  service_id: z.string().optional(),
  label: z.string().optional(),
  linkToWeb: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * POST /onlinesim-provision
 * Create a new OnlineSim provision request
 */
router.post('/', authenticateJWT, provisionRateLimiter, async (req: Request, res: Response) => {
  try {
    const input = createProvisionSchema.parse(req.body);

    // Create provision record
    const provision = await onlinesimProvisionService.createProvision({
      countryId: input.country_id,
      serviceId: input.service_id,
      label: input.label,
      linkToWeb: input.linkToWeb,
      metadata: input.metadata,
    });

    // Enqueue provisioning job
    console.log(`📋 [ONLINESIM PROVISION ROUTE] Adding job to queue for provision ${provision.id}`);
    // Note: You'll need to create an OnlineSim provision queue
    // const job = await onlinesimProvisionQueue.add('onlinesim-provision', {
    //   provisionId: provision.id,
    //   countryId: input.country_id,
    //   serviceId: input.service_id,
    //   linkToWeb: input.linkToWeb,
    // });

    console.log(`✅ [ONLINESIM PROVISION ROUTE] Job would be added to queue for provision ${provision.id}`);
    logger.info({ provisionId: provision.id, userId: req.user?.userId }, 'OnlineSim provision created');

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
    
    logger.error({ error }, 'Failed to create OnlineSim provision');
    res.status(500).json({ error: 'Failed to create provision' });
  }
});

/**
 * GET /onlinesim-provision/:id
 * Get OnlineSim provision status and details
 */
router.get('/:id', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const provision = await onlinesimProvisionService.getProvision(req.params.id);

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
    logger.error({ error, provisionId: req.params.id }, 'Failed to get OnlineSim provision');
    res.status(500).json({ error: 'Failed to get provision' });
  }
});

/**
 * GET /onlinesim-provision
 * List all OnlineSim provisions
 */
router.get('/', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const provisions = await onlinesimProvisionService.listProvisions(limit, offset);

    res.json({
      provisions,
      limit,
      offset,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to list OnlineSim provisions');
    res.status(500).json({ error: 'Failed to list provisions' });
  }
});

/**
 * GET /onlinesim-provision/balance
 * Get OnlineSim account balance
 */
router.get('/balance', authenticateJWT, async (_req: Request, res: Response) => {
  try {
    const balance = await onlinesimProvisionService.getBalance();
    res.json({ balance });
  } catch (error) {
    logger.error({ error }, 'Failed to get OnlineSim balance');
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

/**
 * GET /onlinesim-provision/countries
 * Get available countries
 */
router.get('/countries', authenticateJWT, async (_req: Request, res: Response) => {
  try {
    const countries = await onlinesimProvisionService.getCountries();
    res.json({ countries });
  } catch (error) {
    logger.error({ error }, 'Failed to get countries');
    res.status(500).json({ error: 'Failed to get countries' });
  }
});

/**
 * GET /onlinesim-provision/services/:country
 * Get available services for a country
 */
router.get('/services/:country', authenticateJWT, async (req: Request, res: Response) => {
  try {
    const country = parseInt(req.params.country);
    const services = await onlinesimProvisionService.getServices(country);
    res.json({ services });
  } catch (error) {
    logger.error({ error }, 'Failed to get services');
    res.status(500).json({ error: 'Failed to get services' });
  }
});

export default router;



