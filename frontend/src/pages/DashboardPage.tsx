import { useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import MainPanel from '../components/MainPanel';
import { useSessionStore } from '../store/session.store';
import { useSocket } from '../hooks/useSocket';
import { fetchSessions } from '../api/sessions.api';

export default function DashboardPage() {
  const { setSessions, addMessage, updateSession } = useSessionStore();

  // Initialize Socket.IO connection
  useSocket({
    onNewMessage: (data) => {
      addMessage(data.sessionId, data.message);
    },
    onSessionStatus: (data) => {
      updateSession(data.sessionId, { state: data.state });
    },
  });

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const sessions = await fetchSessions();
      setSessions(sessions);
    } catch (error) {
      console.error('Failed to load sessions', error);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar onSessionCreated={loadSessions} />
      <MainPanel />
    </div>
  );
}






