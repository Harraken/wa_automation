import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('auth-middleware');

export interface JwtPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Middleware to verify JWT token
 */
export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'No authorization header' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ error: 'Invalid authorization header format' });
    return;
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn({ error }, 'JWT verification failed');
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
}

/**
 * Generate JWT token
 */
export function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as any,
  });
}

/**
 * Generate short-lived agent token
 */
export function generateAgentToken(sessionId: string): string {
  return jwt.sign(
    { sessionId, type: 'agent' },
    config.agent.authSecret,
    { expiresIn: '24h' }
  );
}

/**
 * Verify agent token
 */
export function verifyAgentToken(token: string): { sessionId: string } {
  try {
    const decoded = jwt.verify(token, config.agent.authSecret) as any;
    if (decoded.type !== 'agent' || !decoded.sessionId) {
      throw new Error('Invalid agent token');
    }
    return { sessionId: decoded.sessionId };
  } catch (error) {
    throw new Error('Invalid or expired agent token');
  }
}

