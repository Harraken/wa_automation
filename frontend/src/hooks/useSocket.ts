import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = (import.meta as any).env?.VITE_SOCKET_URL || 'http://localhost:3000';

interface UseSocketOptions {
  onNewMessage?: (data: any) => void;
  onSessionStatus?: (data: any) => void;
  onSessionLog?: (data: any) => void;
}

let socket: Socket | null = null;

export function useSocket(options: UseSocketOptions) {
  useEffect(() => {
    // Initialize socket connection
    if (!socket) {
      socket = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
      });

      socket.on('connect', () => {
        console.log('Socket connected', socket?.id);
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected');
      });
    }

    // Register event handlers
    if (options.onNewMessage) {
      socket.on('new_message', options.onNewMessage);
    }

    if (options.onSessionStatus) {
      socket.on('session_status', options.onSessionStatus);
    }

    if (options.onSessionLog) {
      socket.on('session_log', options.onSessionLog);
    }

    // Cleanup
    return () => {
      if (options.onNewMessage) {
        socket?.off('new_message', options.onNewMessage);
      }
      if (options.onSessionStatus) {
        socket?.off('session_status', options.onSessionStatus);
      }
      if (options.onSessionLog) {
        socket?.off('session_log', options.onSessionLog);
      }
    };
  }, [options.onNewMessage, options.onSessionStatus, options.onSessionLog]);

  return socket;
}



