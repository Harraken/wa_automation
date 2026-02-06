// Test routes placeholder
import { Router } from 'express';

const router = Router();

// Placeholder route
router.get('/ping', (_, res) => {
  res.json({ pong: true, timestamp: new Date().toISOString() });
});

export default router;
