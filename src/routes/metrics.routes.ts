import { Router, Request, Response } from 'express';
import { register, Counter, Gauge } from 'prom-client';
import { agentManager } from '../websocket/agent.manager';

const router = Router();

// Define metrics
export const provisionCounter = new Counter({
  name: 'wa_provisioner_provisions_total',
  help: 'Total number of provision requests',
  labelNames: ['status'],
});

export const activeSessionsGauge = new Gauge({
  name: 'wa_provisioner_active_sessions',
  help: 'Number of active WhatsApp sessions',
});

export const connectedAgentsGauge = new Gauge({
  name: 'wa_provisioner_connected_agents',
  help: 'Number of connected agents',
});

export const messageCounter = new Counter({
  name: 'wa_provisioner_messages_total',
  help: 'Total number of messages',
  labelNames: ['direction', 'status'],
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Update gauges
    connectedAgentsGauge.set(agentManager.getConnectedAgentsCount());

    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

export default router;

