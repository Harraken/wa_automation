import { create } from 'zustand';
import { fetchSessions } from '../api/sessions.api';

export interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: string;
  createdAt: string;
}

export interface Session {
  id: string;
  phone: string;
  state: string;
  isActive: boolean;
  linkedWeb: boolean;
  streamUrl: string | null;
  vncPort: number | null;
  lastMessage: Message | null;
  createdAt: string;
  lastSeen: string | null;
}

interface SessionState {
  sessions: Session[];
  selectedSessionId: string | null;
  messages: Record<string, Message[]>;
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  selectSession: (id: string | null) => void;
  removeSession: (id: string) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  refreshSessions: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  selectedSessionId: null,
  messages: {},

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
    })),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  selectSession: (id: string | null) => set({ selectedSessionId: id }),
  
  removeSession: (id: string) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    })),

  addMessage: (sessionId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [message, ...(state.messages[sessionId] || [])],
      },
    })),

  refreshSessions: async () => {
    try {
      const sessions = await fetchSessions();
      set({ sessions });
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
    }
  },
}));





