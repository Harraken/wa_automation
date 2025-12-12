import { useState, useEffect } from 'react';
import { useSessionStore } from '../store/session.store';
import { useAuthStore } from '../store/auth.store';
import ProvisionModal from './ProvisionModal';
import DeleteProgressModal from './DeleteProgressModal';
import { deleteSession } from '../api/sessions.api';
import TestVncProgressModal from './TestVncProgressModal';

interface SidebarProps {
  onSessionCreated: () => void;
}

export default function Sidebar({ onSessionCreated }: SidebarProps) {
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [showDeleteProgress, setShowDeleteProgress] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTestVncProgress, setShowTestVncProgress] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [creatingTestVnc, setCreatingTestVnc] = useState(false);
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
    setShowDeleteConfirm(true);
  };

  const confirmDeleteAll = async () => {
    setShowDeleteConfirm(false);
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

  const handleCreateTestVnc = () => {
    if (creatingTestVnc) {
      console.log('Test VNC creation already in progress, ignoring click');
      return;
    }
    setCreatingTestVnc(true);
    setShowTestVncProgress(true);
  };

  const handleTestVncComplete = async (sessionId: string) => {
    // Refresh sessions to show the new test session
    await refreshSessions();
    
    // Select the new test session
    selectSession(sessionId);
    
    // Notify parent
    onSessionCreated();
    
    // Close modal and reset state
    setShowTestVncProgress(false);
    setCreatingTestVnc(false);
  };

  const handleTestVncError = (error: string) => {
    console.error('Test VNC error:', error);
    // Reset state so user can try again
    setCreatingTestVnc(false);
    // Modal will show the error, we just keep it open
  };

  const filteredSessions = sessions.filter((session) => {
    const phone = session.phone || '';
    return phone.toLowerCase().includes(searchQuery.toLowerCase());
  });

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
            onClick={() => setShowProvisionModal(true)}
            className="px-4 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-whatsapp-light transition-colors font-medium"
          >
            + New
          </button>
        </div>
        
        {/* Test VNC Button */}
        <button
          onClick={handleCreateTestVnc}
          disabled={creatingTestVnc}
          className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium text-sm mb-3 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creatingTestVnc ? (
            <>
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Création en cours...
            </>
          ) : (
            <>
              🧪 Test VNC (Debug Mode)
            </>
          )}
        </button>
        
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
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {session.isActive ? 'Active' : 'Inactive'}
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
                  className="text-xs text-gray-400 mt-1 cursor-pointer"
                >
                  State: {session.state}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Version Footer */}
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-2">
        <div className="text-xs text-gray-500 text-center">
          Version: <span className="font-mono font-semibold text-blue-600 font-bold">3.87.0-ANDROID-13</span>
        </div>
      </div>

      {/* Provision Modal */}
      {showProvisionModal && (
        <ProvisionModal
          onClose={() => setShowProvisionModal(false)}
          onSuccess={() => {
            setShowProvisionModal(false);
            onSessionCreated();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center mb-4">
              <svg className="w-12 h-12 text-red-500 mr-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Supprimer toutes les sessions ?</h3>
                <p className="text-sm text-gray-600 mt-1">Cette action est irréversible.</p>
              </div>
            </div>
            
            <p className="text-gray-700 mb-6">
              Vous êtes sur le point de supprimer <strong>{sessions.length} session(s)</strong> et leurs conteneurs Docker associés.
              Êtes-vous sûr de vouloir continuer ?
            </p>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmDeleteAll}
                className="px-4 py-2 text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
              >
                Supprimer tout
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Test VNC Progress Modal */}
      {showTestVncProgress && (
        <TestVncProgressModal
          onClose={() => setShowTestVncProgress(false)}
          onComplete={handleTestVncComplete}
          onError={handleTestVncError}
        />
      )}
    </div>
  );
}
