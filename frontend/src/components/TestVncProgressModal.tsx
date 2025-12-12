import React, { useState, useEffect } from 'react';
import { createTestVncContainer, checkTestVncStatus } from '../api/test.api';
import { fetchSessions } from '../api/sessions.api';

interface TestVncProgressModalProps {
  onClose: () => void;
  onComplete: (sessionId: string) => void;
  onError: (error: string) => void;
}

interface ProgressStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  progress?: number;
}

export default function TestVncProgressModal({ onClose, onComplete, onError }: TestVncProgressModalProps) {
  const [steps, setSteps] = useState<ProgressStep[]>([
    { id: 'create', label: 'Création du conteneur de test', status: 'pending' },
    { id: 'emulator', label: 'Démarrage de l\'émulateur Android', status: 'pending' },
    { id: 'vnc', label: 'Initialisation du stream VNC', status: 'pending' },
    { id: 'ready', label: 'Prêt à utiliser', status: 'pending' },
  ]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [overallProgress, setOverallProgress] = useState(0);
  
  // Use useState instead of useRef so it resets when modal reopens
  const [hasStarted, setHasStarted] = useState(false);
  
  // Store callbacks in refs to avoid useEffect re-triggering
  const onCompleteRef = React.useRef(onComplete);
  const onErrorRef = React.useRef(onError);
  
  // Update refs when callbacks change
  React.useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  const updateStepStatus = (stepId: string, status: ProgressStep['status'], progress?: number) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status, progress } : step
    ));
  };

  useEffect(() => {
    console.log('[TestVncModal] useEffect called, hasStarted:', hasStarted);
    if (hasStarted) {
      console.log('[TestVncModal] Already started, skipping');
      return;
    }
    setHasStarted(true);
    console.log('[TestVncModal] Starting test for the first time');

    let isMounted = true;
    const intervals: number[] = [];

    const safeSetProgress = (newVal: number) => {
      if (!isMounted) return;
      setOverallProgress(prev => Math.max(prev, newVal)); // Never decrease progress
    };

    const startTest = async () => {
      console.log('[TestVncModal] startTest() called');
      try {
        // Step 1: Create container (0% → 40%)
        if (!isMounted) return;
        updateStepStatus('create', 'active', 0);
        safeSetProgress(5);
        
        // Simulate smooth progress for visual feedback
        let currentProgress = 5;
        const progressInterval = setInterval(() => {
          if (!isMounted) return;
          currentProgress += 3;
          if (currentProgress <= 35) {
            safeSetProgress(currentProgress);
          }
        }, 300);
        intervals.push(progressInterval);

        // Use a race condition to handle network timeouts or "fire and forget" scenarios
        // where the server completes the task but the client never receives the response.
        console.log('[TestVncModal] About to call createTestVncContainer()');
        let result;
        try {
          const creationPromise = createTestVncContainer();
          console.log('[TestVncModal] createTestVncContainer() promise created, waiting...');
          // Increase timeout to 60s because "guest" rendering mode is slower to start
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT_CHECK')), 60000)
          );
          
          result = await Promise.race([creationPromise, timeoutPromise]);
          console.log('[TestVncModal] Got result from createTestVncContainer():', result);
        } catch (err: any) {
          if (err.message === 'TIMEOUT_CHECK') {
            // Timeout reached, let's check if the session was actually created
            // despite the network response being lost
            console.log('Timeout waiting for creation response, checking sessions list...');
            
            // Wait a bit more to ensure DB consistency
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const sessions = await fetchSessions();
            // Find a very recent test session (created < 2 mins ago)
            const recentTestSession = sessions.find((s: any) => 
              s.provisionId?.startsWith('test-') && 
              new Date(s.createdAt).getTime() > Date.now() - 120000
            );

            if (recentTestSession) {
              console.log('Found recent test session via recovery check:', recentTestSession);
              result = {
                success: true,
                testId: recentTestSession.provisionId,
                sessionId: recentTestSession.id,
                vncReady: true // Assume ready if it exists in DB
              };
            } else {
              throw new Error('Le serveur met trop de temps à répondre. Veuillez rafraîchir la page.');
            }
          } else {
            throw err;
          }
        }
        
        if (!isMounted) return;
        clearInterval(progressInterval);
        safeSetProgress(40);
        updateStepStatus('create', 'completed', 100);
        setSessionId(result.sessionId);

        // Step 2: Emulator starting (40% → 60%)
        if (!isMounted) return;
        updateStepStatus('emulator', 'active', 0);
        safeSetProgress(45);
        
        // Smooth progress for emulator
        let emulatorProgress = 45;
        const emulatorInterval = setInterval(() => {
          if (!isMounted) return;
          emulatorProgress += 2;
          if (emulatorProgress <= 58) {
            safeSetProgress(emulatorProgress);
          }
        }, 200);
        intervals.push(emulatorInterval);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (!isMounted) return;
        clearInterval(emulatorInterval);
        safeSetProgress(60);
        updateStepStatus('emulator', 'completed', 100);

        // Step 3: VNC ready (60% → 90%)
        if (!isMounted) return;
        updateStepStatus('vnc', 'active', 0);
        safeSetProgress(65);
        
        // Wait for VNC to be ready
        let vncReady = result.vncReady;
        let attempts = 0;
        const maxAttempts = 10;

        while (!vncReady && attempts < maxAttempts && isMounted) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
          
          // Smooth progress: 65% → 90%
          const vncProgress = 65 + (attempts / maxAttempts) * 25;
          if (isMounted) {
            safeSetProgress(Math.round(vncProgress));
          }
          
          try {
            const status = await checkTestVncStatus(result.testId);
            vncReady = status.websockifyRunning;
          } catch (e) {
            // Continue trying
          }
        }

        if (!isMounted) return;
        
        if (vncReady) {
          safeSetProgress(90);
          updateStepStatus('vnc', 'completed', 100);
          
          // Step 4: Ready (90% → 100%)
          updateStepStatus('ready', 'active');
          await new Promise(resolve => setTimeout(resolve, 500));
          
          if (!isMounted) return;
          safeSetProgress(100);
          updateStepStatus('ready', 'completed');
          setIsComplete(true);
          
          // Auto-close and complete after 2 seconds
          setTimeout(() => {
            if (isMounted) {
              onCompleteRef.current(result.sessionId);
            }
          }, 2000);
        } else {
          throw new Error('VNC n\'a pas démarré dans le temps imparti');
        }

      } catch (error: any) {
        if (!isMounted) return;
        
        const errorMsg = error.response?.data?.details || error.message || 'Une erreur est survenue';
        setErrorMessage(errorMsg);
        
        // Mark current active step as error
        setSteps(prev => prev.map(step => 
          step.status === 'active' ? { ...step, status: 'error' } : step
        ));
        
        onErrorRef.current(errorMsg);
      }
    };

    startTest();

    // Cleanup function
    return () => {
      isMounted = false;
      intervals.forEach(interval => clearInterval(interval));
    };
  }, []); // Empty deps - callbacks stored in refs to avoid re-triggering

  const getStepIcon = (status: ProgressStep['status']) => {
    switch (status) {
      case 'completed':
        return <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white">✓</div>;
      case 'active':
        return <div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>;
      case 'error':
        return <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white">✗</div>;
      default:
        return <div className="w-6 h-6 bg-gray-300 rounded-full"></div>;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {isComplete ? '✅ Test VNC créé avec succès !' : '🧪 Création du Test VNC'}
            </h3>
            {(isComplete || errorMessage) && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Overall Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">Progression globale</span>
              <span className="text-sm font-medium text-gray-700">{overallProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              ></div>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-4">
            {steps.map((step) => (
              <div key={step.id} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getStepIcon(step.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${
                    step.status === 'completed' ? 'text-green-600' :
                    step.status === 'active' ? 'text-blue-600' :
                    step.status === 'error' ? 'text-red-600' :
                    'text-gray-500'
                  }`}>
                    {step.label}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">
                <strong>Erreur:</strong> {errorMessage}
              </p>
            </div>
          )}

          {/* Success Message */}
          {isComplete && sessionId && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800 font-medium mb-1">
                Session ID: <code className="font-mono text-xs">{sessionId}</code>
              </p>
              <p className="text-xs text-green-700">
                Naviguez vers l'onglet "Stream" pour voir l'émulateur Android.
              </p>
            </div>
          )}

          {/* Close Button */}
          {(isComplete || errorMessage) && (
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
              >
                Fermer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
