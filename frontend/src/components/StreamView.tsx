import { useRef, useState, useEffect } from 'react';
import { Session } from '../store/session.store';
import { startClickCapture, stopClickCapture, getLearnedClick, getStreamData } from '../api/sessions.api';

interface StreamViewProps {
  session: Session;
}

// Build VNC URL using the same host as the app (works with localhost or remote/Docker host)
function buildVncUrl(host: string, port: number): string {
  const protocol = typeof window !== 'undefined' && window.location?.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${host}:${port}/vnc.html?autoconnect=true&resize=scale`;
}

// Extract port from streamUrl like http://localhost:6081/vnc.html?...
function portFromStreamUrl(streamUrl: string | null): number | null {
  if (!streamUrl) return null;
  try {
    const u = new URL(streamUrl);
    return u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return null;
  }
}

export default function StreamView({ session }: StreamViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [learnedCoords, setLearnedCoords] = useState<{ x: number; y: number } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [reconnectKey, setReconnectKey] = useState(0);
  const [fetchedPort, setFetchedPort] = useState<number | null>(null);
  const [streamLoadError, setStreamLoadError] = useState<string | null>(null);

  // Resolve VNC port: from session, or from streamUrl, or fetch from API
  const resolvedPort = session.vncPort ?? fetchedPort ?? portFromStreamUrl(session.streamUrl);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  // Build URL so the browser connects to the same host as the app (not hardcoded localhost)
  const vncUrl: string | null = resolvedPort
    ? buildVncUrl(host, resolvedPort)
    : null;

  // Always fetch stream from API when session is selected (API resolves live VNC port from Docker for persistent sessions)
  useEffect(() => {
    let cancelled = false;
    setStreamLoadError(null);
    getStreamData(session.id)
      .then((data) => {
        if (cancelled) return;
        const port = data.vncPort ?? (data.streamUrl ? portFromStreamUrl(data.streamUrl) : null);
        if (port != null) setFetchedPort(port);
      })
      .catch(() => {
        if (!cancelled) setStreamLoadError('Stream not available');
      });
    return () => { cancelled = true; };
  }, [session.id]);

  if (!vncUrl) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center text-gray-500">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-whatsapp-green mx-auto mb-4"></div>
          <p>VNC stream not available</p>
          <p className="text-sm mt-2">
            {streamLoadError || 'The emulator may still be starting up. Ensure the session has a VNC port.'}
          </p>
        </div>
      </div>
    );
  }

  // Monitor iframe load to detect connection status and auto-reconnect
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      setConnectionStatus('connected');
    };

    const handleError = () => {
      setConnectionStatus('disconnected');
    };

    iframe.addEventListener('load', handleLoad);
    iframe.addEventListener('error', handleError);

    // Check connection status periodically and auto-reconnect if needed
    const checkInterval = setInterval(() => {
      try {
        // Try to access iframe content to check if it's loaded
        if (iframe.contentWindow) {
          setConnectionStatus('connected');
        }
      } catch (e) {
        // Cross-origin error is normal, but means iframe is loaded
        setConnectionStatus('connected');
      }
      
      // Auto-reconnect if disconnected for more than 10 seconds
      if (connectionStatus === 'disconnected') {
        const timeout = setTimeout(() => {
          console.log('🔄 Auto-reconnecting VNC...');
          handleReconnect();
        }, 10000);
        return () => clearTimeout(timeout);
      }
    }, 5000);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      iframe.removeEventListener('error', handleError);
      clearInterval(checkInterval);
    };
  }, [reconnectKey, connectionStatus]);

  const handleReconnect = () => {
    setConnectionStatus('connecting');
    setReconnectKey(prev => prev + 1);
  };

  const handleStartCapture = async () => {
    try {
      const result = await startClickCapture(session.id, 'NEXT');
      if (result.success) {
        setIsCapturing(true);
        // Check for existing learned coordinates
        const learned = await getLearnedClick(session.id, 'NEXT');
        if (learned.success && learned.x && learned.y) {
          setLearnedCoords({ x: learned.x, y: learned.y });
        }
      } else {
        throw new Error(result.message || 'Failed to start capture');
      }
    } catch (error: any) {
      console.error('Failed to start click capture:', error);
      let errorMessage = 'Unknown error';
      if (error.response?.data?.error) {
        errorMessage = typeof error.response.data.error === 'string' 
          ? error.response.data.error 
          : JSON.stringify(error.response.data.error);
      } else if (error.message) {
        errorMessage = error.message;
      }
      alert('Failed to start click capture: ' + errorMessage);
    }
  };

  const handleStopCapture = async () => {
    try {
      await stopClickCapture(session.id);
      setIsCapturing(false);
    } catch (error: any) {
      console.error('Failed to stop click capture:', error);
      alert('Failed to stop click capture: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Status bar */}
      <div className="bg-gray-800 px-4 py-2 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' :
            connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            'bg-red-500'
          }`}></div>
          <span className="text-sm text-gray-300">VNC Stream</span>
          {connectionStatus === 'disconnected' && (
            <button
              onClick={handleReconnect}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
            >
              🔄 Reconnect
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {learnedCoords && (
            <div className="text-xs text-green-400">
              📍 Learned: ({learnedCoords.x}, {learnedCoords.y})
            </div>
          )}
          {isCapturing ? (
            <button
              onClick={handleStopCapture}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors flex items-center gap-2"
            >
              <div className="w-2 h-2 rounded-full bg-white animate-pulse"></div>
              Stop Capture
            </button>
          ) : (
            <button
              onClick={handleStartCapture}
              className="px-3 py-1 bg-whatsapp-green hover:bg-green-600 text-white text-xs rounded transition-colors"
            >
              🎯 Capture Click
            </button>
          )}
          <div className="text-xs text-gray-400">
            Port: {resolvedPort ?? '—'}
          </div>
          {vncUrl && (
            <a
              href={vncUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Open in new tab
            </a>
          )}
        </div>
      </div>

      {/* VNC iframe */}
      <div className="flex-1 overflow-hidden relative">
        <iframe
          key={reconnectKey}
          ref={iframeRef}
          src={vncUrl}
          className="w-full h-full border-0"
          title="VNC Stream"
          allow="clipboard-read; clipboard-write"
          onLoad={() => setConnectionStatus('connected')}
          onError={() => setConnectionStatus('disconnected')}
        />
        {connectionStatus === 'disconnected' && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
            <div className="bg-white rounded-lg p-6 text-center">
              <div className="text-red-500 text-4xl mb-4">⚠️</div>
              <h3 className="text-lg font-semibold mb-2">VNC Connection Lost</h3>
              <p className="text-sm text-gray-600 mb-4">The emulator connection was lost. Click reconnect to restore.</p>
              <button
                onClick={handleReconnect}
                className="px-4 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                🔄 Reconnect
              </button>
            </div>
          </div>
        )}
        {connectionStatus === 'connecting' && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="text-white text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <p>Connecting to emulator...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}






