import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import pinoHttp from 'pino-http';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { connectDB, disconnectDB } from './utils/db';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { agentManager } from './websocket/agent.manager';
import authRoutes from './routes/auth.routes';
import provisionRoutes from './routes/provision.routes';
import sessionRoutes from './routes/session.routes';
import metricsRoutes from './routes/metrics.routes';
import screenshotRoutes from './routes/screenshot.routes';
import testRoutes from './routes/test.routes';
import contactRoutes from './routes/contact.routes';
import { messagePollingService } from './services/message-polling.service';

const app = express();
const server = createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin: '*', // Configure appropriately for production
    methods: ['GET', 'POST'],
  },
});

// Validate configuration
try {
  validateConfig();
} catch (error) {
  logger.error({ error }, 'Configuration validation failed');
  process.exit(1);
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(pinoHttp({ logger }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/provision', provisionRoutes);
app.use('/sessions', sessionRoutes);
app.use('/metrics', metricsRoutes);
app.use('/screenshots', screenshotRoutes);
app.use('/test', testRoutes);
app.use('/contacts', contactRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize WebSocket manager
agentManager.initialize(io);

// Socket.IO frontend namespace
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Frontend client connected');

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Frontend client disconnected');
  });
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down gracefully');

  // Stop message polling
  messagePollingService.stopPolling();

  server.close(() => {
    logger.info('HTTP server closed');
  });

  await disconnectDB();

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
async function start() {
  try {
    await connectDB();

    // Start message polling service
    await messagePollingService.startPolling();
    logger.info('Message polling service started (every 3 seconds)');

    server.listen(config.port, () => {
      logger.info({ 
        port: config.port, 
        env: config.env 
      }, 'Server started');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();



