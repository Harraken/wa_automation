import axios from 'axios';
import { Session, Message } from '../store/session.store';

const API_URL = (import.meta as any).env?.VITE_API_URL || '/api';

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

export async function getStreamData(sessionId: string): Promise<{ streamUrl: string | null; vncPort: number | null }> {
  const response = await axios.get(`${API_URL}/sessions/${sessionId}/stream`);
  return { streamUrl: response.data.streamUrl ?? null, vncPort: response.data.vncPort ?? null };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await axios.delete(`${API_URL}/sessions/${sessionId}`);
}

export async function activateSession(sessionId: string): Promise<{ success: boolean; message?: string }> {
  const response = await axios.post(`${API_URL}/sessions/${sessionId}/activate`);
  return response.data;
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

export async function startClickCapture(sessionId: string, buttonType: string = 'NEXT'): Promise<{ success: boolean; message?: string }> {
  const response = await axios.post(`${API_URL}/sessions/${sessionId}/capture-click/start`, { buttonType });
  return response.data;
}

export async function stopClickCapture(sessionId: string): Promise<{ success: boolean }> {
  const response = await axios.post(`${API_URL}/sessions/${sessionId}/capture-click/stop`);
  return response.data;
}

export async function saveClickCoordinates(sessionId: string, x: number, y: number, buttonType: string = 'NEXT'): Promise<{ success: boolean; message?: string }> {
  const response = await axios.post(`${API_URL}/sessions/${sessionId}/capture-click/save`, { x, y, buttonType });
  return response.data;
}

export async function getLearnedClick(sessionId: string, buttonType: string): Promise<{ success: boolean; x?: number; y?: number; message?: string }> {
  const response = await axios.get(`${API_URL}/sessions/${sessionId}/learned-click/${buttonType}`);
  return response.data;
}



