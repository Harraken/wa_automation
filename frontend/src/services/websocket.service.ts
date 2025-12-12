import { io, Socket } from 'socket.io-client';

class WebSocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Function[]> = new Map();

  connect(token: string) {
    console.log('🔌 [WEBSOCKET] Connect called with token:', token ? 'present' : 'missing');
    
    if (this.socket?.connected) {
      console.log('🔌 [WEBSOCKET] Already connected, skipping');
      return;
    }

    const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000';
    console.log('🔌 [WEBSOCKET] Connecting to:', API_URL);
    
    this.socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('✅ [WEBSOCKET] Connected successfully');
    });

    this.socket.on('disconnect', () => {
      console.log('❌ [WEBSOCKET] Disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.log('❌ [WEBSOCKET] Connection error:', error);
    });

    this.socket.on('error', (error) => {
      console.log('❌ [WEBSOCKET] Socket error:', error);
    });

    this.socket.on('provision_update', (data) => {
      console.log('📡 [WEBSOCKET] Received provision_update:', data);
      this.emit('provision_update', data);
    });

    this.socket.on('otp_received', (data) => {
      console.log('📱 [WEBSOCKET] Received otp_received:', data);
      this.emit('otp_received', data);
    });

    this.socket.on('session_ready', (data) => {
      console.log('🎉 [WEBSOCKET] Received session_ready:', data);
      this.emit('session_ready', data);
    });

    this.socket.on('session_log', (data) => {
      console.log('📋 [WEBSOCKET] Received session_log:', data);
      this.emit('session_log', data);
    });

    this.socket.on('error', (error) => {
      console.log('❌ [WEBSOCKET] Received error:', error);
      this.emit('error', error);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: Function) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(data));
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

export const websocketService = new WebSocketService();

