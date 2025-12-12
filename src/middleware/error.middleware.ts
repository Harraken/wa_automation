import { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('error-middleware');

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Error handling middleware
 */
export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const code = err.code || 'INTERNAL_ERROR';

  logger.error({
    err,
    statusCode,
    method: req.method,
    path: req.path,
    body: req.body,
  }, 'Request error');

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

/**
 * 404 handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

