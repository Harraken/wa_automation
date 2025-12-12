import { Server as SocketServer, Socket } from 'socket.io';
import { createChildLogger } from '../utils/logger';
import { verifyAgentToken } from '../middleware/auth.middleware';
import { sessionService } from '../services/session.service';

const logger = createChildLogger('agent-manager');

export interface AgentCommand {
  type: 'inject_otp' | 'send_message' | 'link_to_web' | 'snapshot' | 'restart';
  [key: string]: any;
}

export interface AgentResponse {
  success: boolean;
  data?: any;
  error?: string;
}

interface ConnectedAgent {
  socket: Socket;
  sessionId: string;
  connectedAt: Date;
}

class AgentManager {
  private io?: SocketServer;
  private agents: Map<string, ConnectedAgent> = new Map();
  private pendingCommands: Map<string, {
    resolve: (value: AgentResponse) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  initialize(io: SocketServer) {
    this.io = io;
    
    // Agent namespace
    const agentNamespace = io.of('/agent');

    agentNamespace.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          throw new Error('No token provided');
        }

        const { sessionId } = verifyAgentToken(token);
        (socket as any).sessionId = sessionId;
        
        logger.info({ sessionId }, 'Agent authenticated');
        next();
      } catch (error) {
        logger.error({ error }, 'Agent authentication failed');
        next(new Error('Authentication failed'));
      }
    });

    agentNamespace.on('connection', (socket) => {
      this.handleAgentConnection(socket);
    });

    logger.info('Agent manager initialized');
  }

  private handleAgentConnection(socket: Socket) {
    const sessionId = (socket as any).sessionId;
    
    logger.info({ sessionId, socketId: socket.id }, 'Agent connected');

    const agent: ConnectedAgent = {
      socket,
      sessionId,
      connectedAt: new Date(),
    };

    this.agents.set(sessionId, agent);

    // Update session last seen
    sessionService.updateSessionLastSeen(sessionId).catch((err) => {
      logger.error({ err, sessionId }, 'Failed to update session last seen');
    });

    // Handle events from agent
    socket.on('status', (data) => {
      this.handleAgentStatus(sessionId, data);
    });

    socket.on('message_received', (data) => {
      this.handleMessageReceived(sessionId, data);
    });

    socket.on('command_response', (data) => {
      this.handleCommandResponse(data);
    });

    socket.on('error', (error) => {
      logger.error({ error, sessionId }, 'Agent error');
    });

    socket.on('disconnect', () => {
      logger.info({ sessionId, socketId: socket.id }, 'Agent disconnected');
      this.agents.delete(sessionId);
    });

    // Send welcome
    socket.emit('welcome', { message: 'Connected to backend' });
  }

  private handleAgentStatus(sessionId: string, data: any) {
    logger.debug({ sessionId, status: data }, 'Agent status update');

    // Broadcast to frontend clients
    if (this.io) {
      this.io.emit('session_status', {
        sessionId,
        ...data,
      });
    }
  }

  private async handleMessageReceived(sessionId: string, data: any) {
    logger.info({ sessionId, from: data.from }, 'Message received from agent');

    try {
      const session = await sessionService.getSession(sessionId);
      if (!session) {
        logger.error({ sessionId }, 'Session not found for incoming message');
        return;
      }

      // Save message to database
      const message = await sessionService.createMessage({
        sessionId,
        from: data.from,
        to: data.to || session.provision.phone || '',
        text: data.text,
        direction: 'INBOUND',
        status: 'DELIVERED',
        raw: data.raw,
        externalId: data.externalId,
      });

      // Broadcast to frontend
      if (this.io) {
        this.io.emit('new_message', {
          sessionId,
          message,
        });
      }
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to process received message');
    }
  }

  private handleCommandResponse(data: any) {
    const { commandId, success, data: responseData, error } = data;

    const pending = this.pendingCommands.get(commandId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.resolve({ success, data: responseData, error });
      this.pendingCommands.delete(commandId);
    }
  }

  /**
   * Send a command to an agent
   */
  async sendCommand(sessionId: string, command: AgentCommand, timeoutMs = 30000): Promise<AgentResponse> {
    const agent = this.agents.get(sessionId);
    if (!agent) {
      throw new Error('Agent not connected');
    }

    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise<AgentResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error('Command timeout'));
      }, timeoutMs);

      this.pendingCommands.set(commandId, { resolve, reject, timeout });

      agent.socket.emit('command', {
        commandId,
        ...command,
      });

      logger.debug({ sessionId, commandId, type: command.type }, 'Command sent to agent');
    });
  }

  /**
   * Check if agent is connected
   */
  isAgentConnected(sessionId: string): boolean {
    return this.agents.has(sessionId);
  }

  /**
   * Get connected agents count
   */
  getConnectedAgentsCount(): number {
    return this.agents.size;
  }

  /**
   * Broadcast to all frontend clients
   */
  broadcastToFrontend(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}

export const agentManager = new AgentManager();






