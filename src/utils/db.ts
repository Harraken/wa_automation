import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const prismaLogger = logger.child({ component: 'prisma' });

export const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
});

prisma.$on('query', (e) => {
  prismaLogger.debug({ query: e.query, params: e.params, duration: e.duration }, 'DB query');
});

prisma.$on('error', (e) => {
  prismaLogger.error({ target: e.target, message: e.message }, 'DB error');
});

prisma.$on('warn', (e) => {
  prismaLogger.warn({ target: e.target, message: e.message }, 'DB warning');
});

export async function connectDB() {
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to database');
    throw error;
  }
}

export async function disconnectDB() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}



