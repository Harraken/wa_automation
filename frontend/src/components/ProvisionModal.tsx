import { useState, useEffect, useRef } from 'react';
import { createProvision } from '../api/provision.api';
import { useProvisionProgress } from '../hooks/useProvisionProgress';
import { websocketService } from '../services/websocket.service';

interface ProvisionModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProvisionModal({ onClose, onSuccess }: ProvisionModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<string>('');
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const { progress, startProvision, updateStep, setError: setProgressError, complete, reset } = useProvisionProgress();

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Poll for latest screenshot every 2 seconds when provisioning is active
  useEffect(() => {
    if (!progress.isActive || !currentSessionId) {
      setLatestScreenshot(''); // Clear screenshot when not active
      return;
    }

    const pollScreenshot = async () => {
      try {
        const timestamp = new Date().getTime();
        const url = `/api/screenshots/${currentSessionId}/latest?t=${timestamp}`;
        console.log('📸 Fetching screenshot:', url);
        
        // Force reload by creating a new URL with timestamp
        setLatestScreenshot(url);
      } catch (error) {
        console.error('❌ Error polling screenshot:', error);
      }
    };

    // Initial load
    pollScreenshot();

    // Poll every 1 second for real-time updates
    const interval = setInterval(pollScreenshot, 1000);

    return () => clearInterval(interval);
  }, [progress.isActive, currentSessionId]);

  // WebSocket listeners for real-time updates
  useEffect(() => {
    const handleProvisionUpdate = (data: any) => {
      console.log('🔔 [FRONTEND] Provision update received:', data);
      
      // Extract sessionId if present - UPDATE ALWAYS to ensure we have it
      if (data.sessionId) {
        console.log('📝 [FRONTEND] Setting currentSessionId:', data.sessionId);
        setCurrentSessionId(data.sessionId);
      }
      
      // Helper function to add log with timestamp (avoid duplicates)
      const addLog = (message: string, emoji: string = '') => {
        // Filter out overly detailed logs - keep only essential messages
        const skipPatterns = [
          '📸 === CAPTURE',
          '📱 PAGE ACTUELLE:',
          '📝 TEXTES VISIBLES:',
          '✅ Screenshot sauvegardé:',
          '🔍 Test sélecteur',
          '📍 isExisting:',
          '👁️ isDisplayed:',
          '🖱️ isClickable:',
          'Essai du sélecteur:',
          '🔍 Essai:',
          'Checking for',
          'Looking for',
          'Attempt',
          '//',
          'XPath:',
          'selector:',
          'Activity:',
          'Permission dialog',
          'Still on:',
          'Method 1:',
          'Found Android permission',
          'Android permission button clicked',
          'Popup détecté',
          '━━━━━━',
          'ANALYSE',
          'Tentative de clic',
          'Bouton',
          'trouvé',
          'cliqué',
          'visible',
          'exists',
          'Vérification'
        ];
        
        // Check if message should be skipped
        const shouldSkip = skipPatterns.some(pattern => 
          message.toLowerCase().includes(pattern.toLowerCase())
        );
        
        if (shouldSkip) {
          return; // Don't add this log
        }
        
        const timestamp = new Date().toLocaleTimeString();
        const formattedMessage = `[${timestamp}] ${emoji} ${message}`;
        setLogs(prev => {
          // Avoid adding duplicate consecutive logs
          if (prev.length > 0) {
            const lastLog = prev[prev.length - 1];
            // Extract message without timestamp for comparison
            const lastMessage = lastLog.substring(lastLog.indexOf(']') + 2);
            const currentMessage = formattedMessage.substring(formattedMessage.indexOf(']') + 2);
            if (lastMessage === currentMessage) {
              return prev; // Skip duplicate
            }
          }
          const newLogs = [...prev, formattedMessage];
          // Keep only the last 40 logs to avoid clutter
          return newLogs.slice(-40);
        });
      };
      
      // RESET progression if we return to SPAWNING_CONTAINER (new container being created)
      if (data.state === 'SPAWNING_CONTAINER' && progress.steps.find(s => s.status === 'completed' || s.status === 'active')) {
        console.log('🔄 [FRONTEND] Detected restart to SPAWNING_CONTAINER, resetting all steps');
        reset();
        startProvision(data.provisionId);
      }
      
      // Map backend states to our progress steps and add logs from backend messages
      switch (data.state) {
        case 'PENDING':
          if (data.message) addLog(data.message);
          updateStep('init', 'active', 50);
          break;
        case 'SPAWNING_CONTAINER':
          if (data.message) addLog(data.message);
          updateStep('init', 'completed', 100);
          updateStep('spawn_container', 'active', data.progress || 20);
          break;
        case 'LAUNCHING_WHATSAPP':
          if (data.message) addLog(data.message);
          updateStep('spawn_container', 'completed', 100);
          updateStep('launch_whatsapp', 'active', data.progress || 40);
          break;
        case 'BUYING_NUMBER':
          if (data.message) addLog(data.message);
          updateStep('launch_whatsapp', 'completed', 100);
          updateStep('buy_number', 'active', data.progress || 50);
          break;
        case 'ENTERING_PHONE':
          if (data.message) addLog(data.message);
          updateStep('buy_number', 'completed', 100);
          updateStep('enter_phone', 'active', data.progress || 60);
          break;
        case 'WAITING_OTP':
          if (data.message) addLog(data.message);
          updateStep('enter_phone', 'completed', 100);
          updateStep('wait_otp', 'active', data.progress || 70);
          break;
        case 'INJECTING_OTP':
          if (data.message) addLog(data.message);
          updateStep('wait_otp', 'completed', 100);
          updateStep('inject_otp', 'active', data.progress || 85);
          break;
        case 'SETTING_UP_PROFILE':
        case 'SETTING_UP':
        case 'COMPLETING_PROFILE':
          if (data.message) addLog(data.message);
          updateStep('inject_otp', 'completed', 100);
          updateStep('complete', 'active', data.progress || 95);
          break;
        case 'ACTIVE':
          addLog('✅ Session WhatsApp activée avec succès !', '🎉');
          updateStep('complete', 'completed', 100);
          complete();
          setTimeout(() => {
            onSuccess();
          }, 2000);
          break;
        case 'FAILED':
          console.log('❌ [FRONTEND] Provision failed:', data.error);
          addLog(`❌ Erreur: ${data.error}`);
          setProgressError(data.error || 'Provision failed');
          break;
      }
    };

    const handleOtpReceived = (data: any) => {
      console.log('📱 [FRONTEND] OTP received:', data);
      
      // Use addLog from the parent scope if we restructure, or inline it here
      const timestamp = new Date().toLocaleTimeString();
      const smsLogMessage = `[${timestamp}] 📱 Code SMS reçu: ${data.otp}`;
      setLogs(prev => {
        // Avoid duplicate
        if (prev.length > 0) {
          const lastLog = prev[prev.length - 1];
          if (lastLog.includes(`Code SMS reçu: ${data.otp}`)) {
            return prev; // Skip duplicate
          }
        }
        const newLogs = [...prev, smsLogMessage];
        return newLogs.slice(-30); // Keep only last 30 logs
      });
      
      updateStep('wait_otp', 'completed', 100);
      updateStep('inject_otp', 'active', 25);
    };

    const handleError = (error: any) => {
      const errorMsg = error.message || 'An error occurred';
      setProgressError(errorMsg);
      const timestamp = new Date().toLocaleTimeString();
      const logMessage = `[${timestamp}] ❌ Erreur: ${errorMsg}`;
      setLogs(prev => {
        const newLogs = [...prev, logMessage];
        return newLogs.slice(-30); // Keep only last 30 logs
      });
    };

    // Handler for real-time session logs from backend
    const handleSessionLog = (data: any) => {
      console.log('📋 [FRONTEND] Session log received:', data);
      
      // Only show logs for the current session we're provisioning
      if (!currentSessionId || data.sessionId !== currentSessionId) {
        return;
      }
      
      // Add log to Live Logs display
      const timestamp = new Date().toLocaleTimeString();
      const formattedMessage = `[${timestamp}] ${data.message}`;
      setLogs(prev => {
        // Avoid duplicates
        if (prev.length > 0 && prev[prev.length - 1].includes(data.message)) {
          return prev;
        }
        const newLogs = [...prev, formattedMessage];
        return newLogs.slice(-50); // Keep last 50 logs
      });
    };

    websocketService.on('provision_update', handleProvisionUpdate);
    websocketService.on('otp_received', handleOtpReceived);
    websocketService.on('session_log', handleSessionLog);
    websocketService.on('error', handleError);

    return () => {
      websocketService.off('provision_update', handleProvisionUpdate);
      websocketService.off('otp_received', handleOtpReceived);
      websocketService.off('session_log', handleSessionLog);
      websocketService.off('error', handleError);
    };
  }, [updateStep, setProgressError, complete, onSuccess, currentSessionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent double submission
    if (loading || progress.isActive) {
      console.log(`⚠️ [FRONTEND] Provision already in progress, ignoring duplicate submit`);
      return;
    }
    
    setError('');
    setLoading(true);

    try {
      // Backend will automatically find available country
      console.log(`🌍 [FRONTEND] Sending provision request (auto-detect country)...`);
      const response = await createProvision({ 
        country_id: "", // Empty = auto-detect available country
        application_id: "", // Let backend auto-detect WhatsApp
        linkToWeb: false // Always false, feature not needed
      });
      console.log(`✅ [FRONTEND] Provision created with ID: ${response.provision_id}`);
      startProvision(response.provision_id);
      setLoading(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create provision');
      setLoading(false);
    }
  };

  const handleClose = () => {
    reset();
    setLogs([]);
    onClose();
  };

  // Clear logs when starting new provision
  useEffect(() => {
    if (progress.isActive && logs.length === 0) {
      setLogs([`[${new Date().toLocaleTimeString()}] 🚀 Démarrage du provisioning...`]);
    }
  }, [progress.isActive]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {!progress.isActive ? (
          <div className="p-8">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-whatsapp-green rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">Nouvelle Session WhatsApp</h2>
              <p className="text-gray-600">
                Le système va automatiquement acheter un numéro et configurer WhatsApp
              </p>
              </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start">
                  <svg className="w-6 h-6 text-blue-600 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1">Configuration automatique :</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Pays sélectionné automatiquement (Canada, USA...)</li>
                      <li>Numéro acheté via SMS-MAN (fallback: OnlineSim)</li>
                      <li>WhatsApp configuré automatiquement</li>
                      <li>Durée estimée : 2-3 minutes</li>
                    </ul>
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  <strong>Erreur :</strong> {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-6 py-3 bg-whatsapp-green text-white rounded-lg font-medium hover:bg-whatsapp-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                >
                  {loading ? '⏳ Lancement...' : '🚀 Démarrer le Provisioning'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Provisioning in Progress</h2>
              <button
                onClick={handleClose}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none px-2 py-1"
                title="Close"
              >
                ✕
              </button>
            </div>

            {progress.error ? (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">
                <strong>Error:</strong> {progress.error}
              </div>
            ) : null}

            {/* Overall progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Progression globale</span>
                <span className="text-sm font-semibold text-gray-900">{progress.overallProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div 
                  className="bg-whatsapp-green h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress.overallProgress}%` }}
                />
              </div>
            </div>

            {/* Current step display */}
            <div className="mb-4">
              {(() => {
                const activeStep = progress.steps.find(s => s.status === 'active');
                if (activeStep) {
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-whatsapp-green rounded-full flex items-center justify-center text-white font-bold mr-3 animate-pulse">
                          {activeStep.id === 'init' ? '1' : 
                           activeStep.id === 'spawn_container' ? '2' :
                           activeStep.id === 'launch_whatsapp' ? '3' :
                           activeStep.id === 'buy_number' ? '4' :
                           activeStep.id === 'enter_phone' ? '5' :
                           activeStep.id === 'wait_otp' ? '6' :
                           activeStep.id === 'inject_otp' ? '7' : '8'}
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{activeStep.title}</div>
                          <div className="text-sm text-gray-600">{activeStep.description}</div>
                        </div>
                        <div className="text-2xl">⏳</div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Live logs and screenshot side by side */}
            <div className="flex gap-4">
              {/* Live logs section - LEFT */}
              <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700">📜 Live Logs</h3>
                </div>
                <div className="bg-gray-900 text-green-400 p-4 font-mono text-xs h-96 overflow-y-auto">
                  {logs.length === 0 ? (
                    <div className="text-gray-500">Waiting for logs...</div>
                  ) : (
                    <>
                      {logs.map((log, index) => (
                        <div key={index} className="mb-1">
                          {log}
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </>
                  )}
                </div>
              </div>

              {/* Screenshot preview - RIGHT */}
              <div className="w-64 flex-shrink-0">
                <div className="text-sm font-medium text-gray-700 mb-2">📸 Live Preview:</div>
                <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-gray-100 h-96 flex items-center justify-center">
                  {latestScreenshot ? (
                    <img 
                      key={latestScreenshot}
                      src={latestScreenshot} 
                      alt="Latest screenshot" 
                      className="w-full h-auto object-contain"
                      crossOrigin="anonymous"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        console.error('❌ Failed to load screenshot:', latestScreenshot);
                        console.error('Error details:', e);
                      }}
                      onLoad={(e) => {
                        const target = e.currentTarget as HTMLImageElement;
                        console.log('✅ Screenshot loaded successfully:', latestScreenshot);
                        console.log('Image dimensions:', target.naturalWidth, 'x', target.naturalHeight);
                      }}
                    />
                  ) : (
                    <div className="text-center text-gray-500 p-4">
                      <div className="text-2xl mb-2">📷</div>
                      <div className="text-sm">
                        {currentSessionId ? 'Waiting for screenshots...' : 'Session initializing...'}
                      </div>
                      {currentSessionId && (
                        <div className="text-xs mt-2 text-gray-400">
                          Session: {currentSessionId.substring(0, 8)}...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {progress.currentStep === 'complete' && (
              <div className="mt-6 text-center">
                <div className="text-green-600 text-lg font-semibold mb-2">
                  ✅ Provisioning Complete!
                </div>
                <p className="text-gray-600">
                  Your WhatsApp session is ready. You can now start using it.
                </p>
              </div>
            )}

            {progress.error && (
              <div className="mt-6 text-center">
                <div className="text-red-600 text-lg font-semibold mb-2">
                  ❌ Provisioning Failed
                </div>
                <p className="text-gray-600 mb-4">
                  {progress.error}
                </p>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
