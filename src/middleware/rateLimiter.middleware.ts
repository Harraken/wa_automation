import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('rate-limiter');

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

/**
 * Simple in-memory rate limiter
 * For production, use Redis-based rate limiter
 */
export function provisionRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = req.user?.userId || req.ip || 'unknown';
  const key = `provision:${userId}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxRequests = config.rateLimit.provisionPerHour;

  // Clean up old entries
  if (store[key] && store[key].resetTime < now) {
    delete store[key];
  }

  // Initialize or increment
  if (!store[key]) {
    store[key] = {
      count: 1,
      resetTime: now + windowMs,
    };
    next();
    return;
  }

  store[key].count++;

  if (store[key].count > maxRequests) {
    const resetIn = Math.ceil((store[key].resetTime - now) / 1000);
    logger.warn({ userId, count: store[key].count }, 'Rate limit exceeded');
    
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many provision requests. Try again in ${resetIn} seconds.`,
        resetIn,
      },
    });
    return;
  }

  next();
}






