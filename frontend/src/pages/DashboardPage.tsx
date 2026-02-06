import { useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import MainPanel from '../components/MainPanel';
import { useSessionStore } from '../store/session.store';
import { useSocket } from '../hooks/useSocket';
import { fetchSessions } from '../api/sessions.api';

export default function DashboardPage() {
  const { setSessions, addMessage, updateSession, addSession, refreshSessions, selectSession } = useSessionStore();

  // Initialize Socket.IO connection
  useSocket({
    onNewMessage: (data) => {
      addMessage(data.sessionId, data.message);
    },
    onSessionStatus: (data) => {
      updateSession(data.sessionId, { state: data.state });
    },
    onSessionCreated: (data) => {
      // When a session is created, add it immediately and select it so Stream View shows
      console.log('🎉 [DASHBOARD] Session created received:', data);
      addSession({
        id: data.sessionId,
        phone: data.phone || null,
        state: data.state || 'SPAWNING_CONTAINER',
        isActive: data.isActive || false,
        linkedWeb: data.linkedWeb || false,
        streamUrl: data.streamUrl || null,
        vncPort: data.vncPort ?? null,
        lastMessage: null,
        createdAt: data.createdAt || new Date().toISOString(),
        lastSeen: null,
      });
      selectSession(data.sessionId);
      if ((window as any).switchToProvisioningStream) (window as any).switchToProvisioningStream();
    },
    onSessionReady: (data) => {
      // When a session is ready, update it in the store
      console.log('🎉 [DASHBOARD] Session ready received:', data);
      if (data.sessionId) {
        updateSession(data.sessionId, { 
          isActive: true,
          phone: data.phone || null,
        });
      }
      // Also refresh to ensure we have all the latest data
      refreshSessions();
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






