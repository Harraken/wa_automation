import { useEffect, useRef, useState } from 'react';
import { Session } from '../store/session.store';

interface StreamViewProps {
  session: Session;
}

export default function StreamView({ session }: StreamViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [containerNotRunning, setContainerNotRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session.vncPort) {
      setError('VNC port not available. The emulator may still be starting up.');
      setIsLoading(false);
      return;
    }

    setError(null);
    setIsLoading(true);
  }, [session.vncPort, session.id]);

  const handleFullscreen = () => {
    if (!containerRef.current) return;
    
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleReconnect = () => {
    setError(null);
    setContainerNotRunning(false);
    setIsLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src; // Force reload
    }
  };

  if (!session.vncPort) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center text-gray-500">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-whatsapp-green mx-auto mb-4"></div>
          <p className="font-medium">Port VNC non disponible</p>
          <p className="text-sm mt-2">L'émulateur démarre...</p>
        </div>
      </div>
    );
  }

  if (error || containerNotRunning) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg className="w-16 h-16 mx-auto text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {containerNotRunning ? 'Conteneur VNC inactif' : 'Stream VNC non disponible'}
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            {containerNotRunning 
              ? 'Le conteneur VNC pour cette session n\'est pas actif. La session a peut-être été arrêtée ou a échoué lors du provisioning.'
              : error}
          </p>
          {!containerNotRunning && (
          <button
            onClick={handleReconnect}
            className="px-4 py-2 bg-whatsapp-green text-white rounded hover:bg-whatsapp-light transition-colors"
          >
            🔄 Réessayer
          </button>
          )}
          <p className="text-xs text-gray-400 mt-4">
            {containerNotRunning 
              ? 'Sélectionnez une session active dans la sidebar ou lancez un nouveau provisioning.'
              : 'Le provisioning WhatsApp fonctionne en arrière-plan. Consultez l\'onglet "Logs" pour suivre la progression.'}
          </p>
        </div>
      </div>
    );
  }

  // Access VNC through nginx proxy: /vnc/{provisionId}/ routes to websockify-{provisionId}:8080/
  // easy-novnc serves the client at root and handles websocket on the same path
  const vncUrl = `/vnc/${session.provisionId}/`;

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-gray-900">
      {/* Control bar */}
      <div className="bg-gray-800 px-4 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isLoading ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}></div>
          <span className="text-sm font-medium text-gray-300">Stream VNC</span>
          <span className="text-xs text-gray-500">Port {session.vncPort}</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Reconnect button */}
          <button
            onClick={handleReconnect}
            className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors flex items-center gap-1"
            title="Reconnecter"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reconnecter
          </button>

          {/* Fullscreen button */}
          <button
            onClick={handleFullscreen}
            className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors flex items-center gap-1"
            title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
          >
            {isFullscreen ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Quitter
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
                Plein écran
              </>
            )}
          </button>
        </div>
      </div>

      {/* VNC iframe */}
      <div className="flex-1 overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
            <div className="text-center text-gray-400">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-whatsapp-green mx-auto mb-4"></div>
              <p>Connexion au stream VNC...</p>
            </div>
          </div>
        )}
        
        <iframe
          ref={iframeRef}
          src={vncUrl}
          className="w-full h-full border-0"
          title="VNC Stream"
          allow="clipboard-read; clipboard-write"
          onLoad={() => {
            // Mark as loaded after a short delay
            setTimeout(() => setIsLoading(false), 1000);
          }}
          onError={async () => {
            // Check if it's a 502 error (container not running)
            try {
              const response = await fetch(vncUrl, { method: 'HEAD' });
              if (response.status === 502 || response.status === 503) {
                setContainerNotRunning(true);
              } else {
                setError('Impossible de charger le stream VNC. Vérifiez que l\'émulateur est en cours d\'exécution.');
              }
            } catch {
            setError('Impossible de charger le stream VNC. Vérifiez que l\'émulateur est en cours d\'exécution.');
            }
            setIsLoading(false);
          }}
        />
      </div>
    </div>
  );
}
