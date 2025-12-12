import axios from 'axios';
import { Session, Message } from '../store/session.store';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002';

export async function fetchSessions(): Promise<Session[]> {
  const response = await axios.get(`${API_URL}/sessions`);
  return response.data.sessions;
}

export async function fetchSessionMessages(sessionId: string): Promise<Message[]> {
  const response = await axios.get(`${API_URL}/sessions/${sessionId}/messages`);
  return response.data.messages;
}

export async function sendMessage(sessionId: string, to: string, text: string): Promise<Message> {
  const response = await axios.post(`${API_URL}/sessions/${sessionId}/send`, {
    to,
    text,
  });
  return response.data.message;
}

export async function getStreamUrl(sessionId: string): Promise<string> {
  const response = await axios.get(`${API_URL}/sessions/${sessionId}/stream`);
  return response.data.streamUrl;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await axios.delete(`${API_URL}/sessions/${sessionId}`);
}

export async function deleteAllSessions(): Promise<{ message: string; sessionsDeleted: number; messagesDeleted: number; provisionsDeleted: number; logsDeleted?: number; screenshotsDeleted?: number; containersStopped?: number; containersRemoved?: number }> {
  const response = await axios.delete(`${API_URL}/sessions/all`);
  return response.data;
}

export interface SessionLog {
  id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
  metadata?: any;
  createdAt: string;
}

export async function fetchSessionLogs(sessionId: string, limit?: number): Promise<{ logs: SessionLog[]; limit: number }> {
  const params = limit ? `?limit=${limit}` : '';
  const response = await axios.get(`${API_URL}/sessions/${sessionId}/logs${params}`);
  return response.data;
}



