import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';
import { websocketService } from '../services/websocket.service';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002';

interface AuthState {
  token: string | null;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      username: null,

      login: async (username: string, password: string) => {
        const response = await axios.post(`${API_URL}/auth/login`, {
          username,
          password,
        });

        const { token, username: user } = response.data;
        set({ token, username: user });

        // Set default authorization header
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        // Connect WebSocket
        websocketService.connect(token);
      },

      logout: () => {
        set({ token: null, username: null });
        delete axios.defaults.headers.common['Authorization'];
        
        // Disconnect WebSocket
        websocketService.disconnect();
      },

      checkAuth: () => {
        const storedToken = localStorage.getItem('auth-storage');
        if (storedToken) {
          try {
            const parsed = JSON.parse(storedToken);
            if (parsed.state?.token) {
              axios.defaults.headers.common['Authorization'] = `Bearer ${parsed.state.token}`;
              // Connect WebSocket if token exists
              websocketService.connect(parsed.state.token);
            }
          } catch (error) {
            console.error('Failed to parse auth token', error);
          }
        }
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);


