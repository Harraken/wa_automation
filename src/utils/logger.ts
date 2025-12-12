import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.monitoring.logLevel,
  transport: config.env === 'development' 
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.token',
      '*.password',
      '*.secret',
      'SMSMAN_TOKEN',
    ],
    remove: true,
  },
});

export function createChildLogger(component: string) {
  return logger.child({ component });
}



