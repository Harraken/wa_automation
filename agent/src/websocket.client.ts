import { io, Socket } from 'socket.io-client';
import { config } from './config';
import { logger } from './logger';

export interface Command {
  commandId: string;
  type: string;
  [key: string]: any;
}

export class WebSocketClient {
  private socket: Socket | null = null;
  private commandHandlers: Map<string, (command: Command) => Promise<any>> = new Map();

  connect(): void {
    logger.info({ backendUrl: config.backendUrl }, 'Connecting to backend WebSocket');

    this.socket = io(`${config.backendUrl}/agent`, {
      auth: {
        token: config.agentToken,
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    this.socket.on('connect', () => {
      logger.info({ socketId: this.socket?.id }, 'Connected to backend');
    });

    this.socket.on('disconnect', (reason) => {
      logger.warn({ reason }, 'Disconnected from backend');
    });

    this.socket.on('welcome', (data) => {
      logger.info({ data }, 'Received welcome from backend');
    });

    this.socket.on('command', async (command: Command) => {
      logger.info({ commandId: command.commandId, type: command.type }, 'Received command');
      await this.handleCommand(command);
    });

    this.socket.on('connect_error', (error) => {
      logger.error({ error }, 'Connection error');
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      logger.info('Disconnected from backend');
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  private async handleCommand(command: Command): Promise<void> {
    const handler = this.commandHandlers.get(command.type);
    
    if (!handler) {
      logger.warn({ type: command.type }, 'No handler for command type');
      this.sendCommandResponse(command.commandId, false, null, 'Unknown command type');
      return;
    }

    try {
      const result = await handler(command);
      this.sendCommandResponse(command.commandId, true, result);
    } catch (error) {
      logger.error({ error, command }, 'Command handler failed');
      this.sendCommandResponse(
        command.commandId,
        false,
        null,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  registerCommandHandler(type: string, handler: (command: Command) => Promise<any>): void {
    this.commandHandlers.set(type, handler);
    logger.debug({ type }, 'Registered command handler');
  }

  sendCommandResponse(commandId: string, success: boolean, data: any = null, error?: string): void {
    if (!this.socket) {
      logger.error('Cannot send response: not connected');
      return;
    }

    this.socket.emit('command_response', {
      commandId,
      success,
      data,
      error,
    });

    logger.debug({ commandId, success }, 'Sent command response');
  }

  sendStatus(status: any): void {
    if (!this.socket) {
      return;
    }

    this.socket.emit('status', status);
  }

  sendMessageReceived(message: any): void {
    if (!this.socket) {
      return;
    }

    this.socket.emit('message_received', message);
    logger.debug({ from: message.from }, 'Sent message received event');
  }
}






