import { useState, useEffect } from 'react';

interface DeleteProgressModalProps {
  onClose: () => void;
  onComplete: (result: any) => void;
  onError: (error: string) => void;
}

export default function DeleteProgressModal({ onClose, onComplete, onError }: DeleteProgressModalProps) {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const deleteAll = async () => {
      try {
        const { deleteAllSessions } = await import('../api/sessions.api');
        
        // Start deletion with immediate progress updates
        setCurrentStep('Starting deletion...');
        setProgress(5);

        // Use a promise that updates progress as it goes
        const progressInterval = setInterval(() => {
          setProgress(prev => {
            if (prev < 90) {
              return prev + 2; // Increment by 2% every interval
            }
            return prev;
          });
        }, 200); // Update every 200ms for smooth progress

        // Update step messages periodically
        let stepIndex = 0;
        const steps = [
          'Deleting messages...',
          'Deleting session logs...',
          'Deleting sessions...',
          'Deleting OTP logs...',
          'Deleting provisions...',
          'Deleting screenshot directories...',
          'Stopping Docker containers...',
          'Removing Docker containers...',
        ];
        
        const stepInterval = setInterval(() => {
          if (stepIndex < steps.length) {
            setCurrentStep(steps[stepIndex]);
            stepIndex++;
          }
        }, 500);

        // Perform actual deletion
        const result = await deleteAllSessions();
        
        // Clear intervals
        clearInterval(progressInterval);
        clearInterval(stepInterval);
        
        const containersInfo = result.containersStopped ? `, ${result.containersStopped} containers stopped` : '';
        const screenshotsInfo = result.screenshotsDeleted ? `, ${result.screenshotsDeleted} screenshot directories` : '';
        const summary = `Deletion completed! ${result.sessionsDeleted} sessions, ${result.messagesDeleted} messages${screenshotsInfo}${containersInfo}, ${result.provisionsDeleted} provisions deleted.`;
        setCurrentStep(summary);
        setProgress(100);

        // Auto-close after showing completion message for 2 seconds
        setTimeout(() => {
          onComplete(result);
        }, 2000);
      } catch (err: any) {
        setError(err.response?.data?.error || err.message || 'Unknown error');
        onError(err.response?.data?.error || err.message || 'Unknown error');
      }
    };

    deleteAll();
  }, [onComplete, onError]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ zIndex: 9999 }}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4 text-gray-800">Deleting All Sessions</h2>
        
        {error ? (
          <div className="text-red-600 mb-4">
            <p className="font-medium">Error:</p>
            <p>{error}</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>{currentStep}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-whatsapp-green h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {progress === 100 && (
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                Close
              </button>
            )}
            
            {progress < 100 && (
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors mt-2"
                disabled={progress < 100}
              >
                Cancel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
