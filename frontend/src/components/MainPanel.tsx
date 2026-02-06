import { useState, useEffect } from 'react';
import { useSessionStore } from '../store/session.store';
import { activateSession as apiActivateSession } from '../api/sessions.api';
import StreamView from './StreamView';
import MessagesView from './MessagesView';
import LogsView from './LogsView';
import ScreenshotsView from './ScreenshotsView';
import ProvisionView from './ProvisionView';

type MainTab = 'provisioning' | 'messages' | 'screenshots' | 'logs';
type ProvisioningSubTab = 'suivi' | 'stream';

export default function MainPanel() {
  const [activeTab, setActiveTab] = useState<MainTab>('provisioning');
  const [provisioningSubTab, setProvisioningSubTab] = useState<ProvisioningSubTab>('suivi');
  const [activating, setActivating] = useState(false);
  const { sessions, selectedSessionId, refreshSessions } = useSessionStore();

  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const statusLabel = selectedSession
    ? selectedSession.isActive
      ? 'Active'
      : ['SPAWNING_CONTAINER', 'LAUNCHING_WHATSAPP', 'BUYING_NUMBER', 'ENTERING_PHONE', 'WAITING_OTP', 'INJECTING_OTP', 'PROVISIONING'].some((k) =>
          (selectedSession.state || '').toUpperCase().includes(k)
        )
        ? 'En cours'
        : 'Inactive'
    : '';

  // Expose functions for Sidebar and Dashboard (session created → show stream)
  useEffect(() => {
    (window as any).switchToProvisioning = () => {
      setActiveTab('provisioning');
      setProvisioningSubTab('suivi');
    };
    (window as any).switchToProvisioningStream = () => {
      setActiveTab('provisioning');
      setProvisioningSubTab('stream');
    };
    return () => {
      delete (window as any).switchToProvisioning;
      delete (window as any).switchToProvisioningStream;
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col">
      {/* Header - only show when session is selected */}
      {selectedSession && (
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{selectedSession.phone}</h2>
              <p className="text-sm text-gray-600">
                State: {selectedSession.state} • {statusLabel}
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {!selectedSession.isActive && !['SPAWNING_CONTAINER', 'LAUNCHING_WHATSAPP', 'BUYING_NUMBER', 'ENTERING_PHONE', 'WAITING_OTP', 'INJECTING_OTP', 'PROVISIONING'].some((k) => (selectedSession.state || '').toUpperCase().includes(k)) && (
                <button
                  onClick={async () => {
                    setActivating(true);
                    try {
                      await apiActivateSession(selectedSession.id);
                      await refreshSessions();
                    } catch (e: any) {
                      console.error('Activate failed:', e);
                      alert(e.response?.data?.error || e.message || 'Échec d\'activation');
                    } finally {
                      setActivating(false);
                    }
                  }}
                  disabled={activating}
                  className="px-4 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  {activating ? 'Activation...' : 'Activer la session'}
                </button>
              )}
              {selectedSession.linkedWeb && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                  Linked to Web
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="flex">
          <button
            onClick={() => setActiveTab('provisioning')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'provisioning'
                ? 'text-whatsapp-green border-b-2 border-whatsapp-green'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Provisioning
          </button>
          <button
            onClick={() => setActiveTab('messages')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'messages'
                ? 'text-whatsapp-green border-b-2 border-whatsapp-green'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Messages
          </button>
          <button
            onClick={() => setActiveTab('screenshots')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'screenshots'
                ? 'text-whatsapp-green border-b-2 border-whatsapp-green'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Screenshots
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'logs'
                ? 'text-whatsapp-green border-b-2 border-whatsapp-green'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Logs
          </button>
        </div>
        {/* Sub-tabs when Provisioning is selected: Suivi | Stream */}
        {activeTab === 'provisioning' && (
          <div className="flex border-t border-gray-100 bg-gray-50">
            <button
              onClick={() => setProvisioningSubTab('suivi')}
              className={`px-4 py-2 text-sm font-medium ${
                provisioningSubTab === 'suivi'
                  ? 'text-whatsapp-green border-b-2 border-whatsapp-green bg-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Suivi / Logs
            </button>
            <button
              onClick={() => setProvisioningSubTab('stream')}
              className={`px-4 py-2 text-sm font-medium ${
                provisioningSubTab === 'stream'
                  ? 'text-whatsapp-green border-b-2 border-whatsapp-green bg-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Stream (remote)
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'provisioning' && (
          provisioningSubTab === 'suivi' ? (
            <ProvisionView />
          ) : selectedSession ? (
            <StreamView session={selectedSession} />
          ) : (
            <div className="flex items-center justify-center h-full bg-gray-50 text-gray-500">
              <div className="text-center">
                <p className="text-lg mb-2">Aucune session sélectionnée</p>
                <p className="text-sm">Lancez un provisioning ou sélectionnez une session dans la liste pour voir le stream.</p>
              </div>
            </div>
          )
        )}
        {activeTab === 'messages' && selectedSession && <MessagesView session={selectedSession} />}
        {activeTab === 'screenshots' && selectedSession && <ScreenshotsView session={selectedSession} />}
        {activeTab === 'logs' && selectedSession && <LogsView session={selectedSession} />}
      </div>
    </div>
  );
}






