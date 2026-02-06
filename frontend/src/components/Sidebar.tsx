import { useState, useEffect } from 'react';
import { useSessionStore } from '../store/session.store';
import { useAuthStore } from '../store/auth.store';
import { APP_VERSION } from '../version';
import DeleteProgressModal from './DeleteProgressModal';
import { deleteSession } from '../api/sessions.api';

interface SidebarProps {
  onSessionCreated: () => void;
}

export default function Sidebar({ onSessionCreated }: SidebarProps) {
  const [showDeleteProgress, setShowDeleteProgress] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { sessions, selectedSessionId, selectSession, refreshSessions } = useSessionStore();
  const { username, logout } = useAuthStore();

  // Auto-refresh sessions every 3 seconds to show new sessions without manual refresh
  useEffect(() => {
    // Initial load
    refreshSessions();

    // Set up polling interval
    const interval = setInterval(() => {
      refreshSessions();
    }, 3000); // Refresh every 3 seconds

    // Cleanup on unmount
    return () => clearInterval(interval);
  }, [refreshSessions]);

  const handleDeleteAll = async () => {
    // No confirmation needed - the modal provides sufficient feedback
    setDeleting(true);
    setShowDeleteProgress(true);
  };

  const handleDeleteComplete = () => {
    // Clear sessions from store immediately for instant UI update
    const { setSessions } = useSessionStore.getState();
    setSessions([]);
    
    // Deselect if any session was selected
    if (selectedSessionId) {
      selectSession(null);
    }
    
    // Refresh from server to ensure sync (async, won't block UI)
    refreshSessions().catch(err => console.error('Failed to refresh sessions:', err));
    
    // Notify parent component
    onSessionCreated();
    
    setShowDeleteProgress(false);
    setDeleting(false);
    
    // No alert needed - the modal shows completion and closes
  };

  const handleDeleteError = () => {
    setShowDeleteProgress(false);
    setDeleting(false);
    // No alert needed - error is displayed in the modal
    refreshSessions().catch(err => console.error('Failed to refresh sessions:', err));
  };

  const inProgressState = (state: string) => {
    const s = (state || '').toUpperCase();
    return ['SPAWNING_CONTAINER', 'LAUNCHING_WHATSAPP', 'BUYING_NUMBER', 'ENTERING_PHONE', 'WAITING_OTP', 'INJECTING_OTP', 'PROVISIONING'].some((k) => s.includes(k));
  };

  const filteredSessions = sessions.filter((session) =>
    session.phone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-96 bg-white border-r border-gray-200 flex flex-col">
      {/* Header */}
      <div className="bg-whatsapp-teal text-white p-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Sessions</h1>
          <p className="text-xs opacity-90">{username}</p>
        </div>
        <button
          onClick={logout}
          className="px-3 py-1 bg-white/20 rounded hover:bg-white/30 transition-colors text-sm"
        >
          Logout
        </button>
      </div>

      {/* Search & Provision */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp-green"
          />
          <button
            onClick={() => {
              // Switch to provisioning tab instead of opening modal
              if ((window as any).switchToProvisioning) {
                (window as any).switchToProvisioning();
              }
            }}
            className="px-4 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-whatsapp-light transition-colors font-medium"
          >
            + New
          </button>
        </div>
        <button
          onClick={handleDeleteAll}
          disabled={deleting}
          className="w-full px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {deleting ? 'Deleting...' : '🗑️ Delete All Sessions'}
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No sessions yet</p>
            <p className="text-sm mt-2">Click "+ New" to provision</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                className={`p-4 hover:bg-gray-50 transition-colors ${
                  selectedSessionId === session.id ? 'bg-gray-100' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div 
                    onClick={() => selectSession(session.id)}
                    className="flex-1 cursor-pointer"
                  >
                    <div className="font-semibold text-gray-900">
                      {session.phone || 'Unknown'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.linkedWeb && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        WEB
                      </span>
                    )}
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        session.isActive
                          ? 'bg-green-100 text-green-700'
                          : inProgressState(session.state)
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {session.isActive ? 'Active' : inProgressState(session.state) ? 'En cours' : 'Inactive'}
                    </span>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        // No confirmation needed - deletion is immediate and reversible via refresh
                        try {
                          await deleteSession(session.id);
                          // Remove from store immediately for instant UI update
                          const { removeSession } = useSessionStore.getState();
                          removeSession(session.id);
                          
                          // Deselect if this was the selected session
                          if (selectedSessionId === session.id) {
                            selectSession(null);
                          }
                          
                          // Refresh from server to ensure sync (async, won't block UI)
                          refreshSessions().catch(err => console.error('Failed to refresh sessions:', err));
                          
                          // Notify parent component
                          onSessionCreated();
                        } catch (error: any) {
                          console.error('Failed to delete session:', error);
                          // Log error but don't show alert - user can see in console/logs if needed
                          // Refresh anyway to ensure UI is in sync
                          await refreshSessions();
                        }
                      }}
                      className="text-red-500 hover:text-red-700 px-2 py-1 text-sm"
                      title="Delete session"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                
                {session.lastMessage && (
                  <div 
                    onClick={() => selectSession(session.id)}
                    className="text-sm text-gray-600 truncate cursor-pointer"
                  >
                    {session.lastMessage.text}
                  </div>
                )}

                <div 
                  onClick={() => selectSession(session.id)}
                  className="text-xs text-gray-400 mt-1 cursor-pointer flex justify-between"
                >
                  <span>State: {session.state}</span>
                  <span>{session.createdAt ? new Date(session.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Provision Modal */}

      {/* Delete Progress Modal */}
      {showDeleteProgress && (
        <DeleteProgressModal
          onClose={() => {
            setShowDeleteProgress(false);
            setDeleting(false);
          }}
          onComplete={handleDeleteComplete}
          onError={handleDeleteError}
        />
      )}

      {/* Version Footer */}
      <div className="p-2 border-t border-gray-200 bg-gray-50 text-center">
        <span className="text-xs text-gray-500">v{APP_VERSION}</span>
      </div>
    </div>
  );
}





