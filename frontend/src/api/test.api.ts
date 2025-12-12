/**
 * Test API for debugging purposes
 */

import axios from 'axios';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002';

export interface TestVncContainerResponse {
  success: boolean;
  message: string;
  testId: string;
  sessionId: string;
  containerId: string;
  streamUrl: string;
  vncPort: number;
  appiumPort: number;
  vncReady: boolean;
  instructions: string;
}

export interface TestVncStatusResponse {
  testId: string;
  websockifyRunning: boolean;
  timestamp: string;
}

/**
 * Create a test VNC container (Android only, no WhatsApp)
 */
export async function createTestVncContainer(): Promise<TestVncContainerResponse> {
  const response = await axios.post(`${API_URL}/test/vnc-container`);
  return response.data;
}

/**
 * Check websockify status for a test container
 */
export async function checkTestVncStatus(testId: string): Promise<TestVncStatusResponse> {
  const response = await axios.get(`${API_URL}/test/vnc-container/${testId}/status`);
  return response.data;
}
