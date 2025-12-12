import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../utils/db';
import { generateToken } from '../middleware/auth.middleware';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('auth-routes');
const router = Router();

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

/**
 * POST /auth/login
 * Authenticate and get JWT token
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    // Find admin user
    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Verify password
    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Generate token
    const token = generateToken({
      userId: admin.id,
      username: admin.username,
    });

    logger.info({ userId: admin.id, username: admin.username }, 'User logged in');

    res.json({ token, username: admin.username });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    
    logger.error({ error }, 'Login failed');
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/register
 * Register a new admin user (for initial setup)
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    // Check if any admin exists
    const adminCount = await prisma.admin.count();
    if (adminCount > 0) {
      res.status(403).json({ error: 'Registration disabled' });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin
    const admin = await prisma.admin.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    logger.info({ userId: admin.id, username: admin.username }, 'Admin user registered');

    res.status(201).json({ message: 'Admin user created', username: admin.username });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    
    logger.error({ error }, 'Registration failed');
    res.status(500).json({ error: 'Registration failed' });
  }
});

export default router;






