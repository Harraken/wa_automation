import { useEffect, useState, useRef } from 'react';
import { Session } from '../store/session.store';
import { fetchSessionLogs, SessionLog } from '../api/sessions.api';
import { useSocket } from '../hooks/useSocket';

interface LogsViewProps {
  session: Session;
}

export default function LogsView({ session }: LogsViewProps) {
  const [logs, setLogs] = useState<SessionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error' | 'debug'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  useEffect(() => {
    loadLogs();
  }, [session.id]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Listen for real-time log events
  useSocket({
    onSessionLog: (data: any) => {
      if (data.sessionId === session.id) {
        // Add new log to the beginning (newest first, but we'll reverse for display)
        setLogs(prev => [{
          id: `realtime-${Date.now()}`,
          level: data.level,
          message: data.message,
          source: data.source,
          metadata: data.metadata,
          createdAt: data.timestamp || new Date().toISOString(),
        }, ...prev]);
      }
    },
  });

  const loadLogs = async () => {
    try {
      setLoading(true);
      const response = await fetchSessionLogs(session.id);
      // Show oldest first (chronological order) like live logs
      setLogs(response.logs.reverse());
    } catch (error) {
      console.error('Failed to load logs', error);
    } finally {
      setLoading(false);
    }
  };

  const formatLogMessage = (log: SessionLog): string => {
    const timestamp = new Date(log.createdAt).toLocaleTimeString();
    const source = log.source ? `[${log.source}]` : '';
    // Format: [timestamp] [source] message (same format as live logs)
    return `[${timestamp}] ${source} ${log.message}`;
  };

  const filteredLogs = logs.filter(log => {
    if (filter !== 'all' && log.level !== filter) return false;
    if (sourceFilter !== 'all' && log.source !== sourceFilter) return false;
    return true;
  });

  const uniqueSources = Array.from(new Set(logs.map(log => log.source).filter(Boolean)));

  const copyLogsToClipboard = async () => {
    try {
      const logText = filteredLogs.map(log => formatLogMessage(log)).join('\n');
      await navigator.clipboard.writeText(logText);
      alert('Logs copied to clipboard! ✅');
    } catch (error) {
      console.error('Failed to copy logs:', error);
      alert('Failed to copy logs ❌');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading logs...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Filters */}
      <div className="bg-white border-b border-gray-200 p-4 flex gap-4 items-center flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Level:</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-green"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        
        {uniqueSources.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Source:</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-whatsapp-green"
            >
              <option value="all">All</option>
              {uniqueSources.map(source => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={copyLogsToClipboard}
          disabled={filteredLogs.length === 0}
          className="ml-auto px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
          title="Copy logs to clipboard"
        >
          📋 Copy Logs
        </button>
        
        <button
          onClick={loadLogs}
          className="px-4 py-2 bg-whatsapp-green text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Logs Display - Same style as Live Logs */}
      <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden m-4 flex flex-col">
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700">Session Logs</h3>
        </div>
        <div className="bg-gray-900 text-green-400 p-4 font-mono text-xs flex-1 overflow-y-auto">
          {filteredLogs.length === 0 ? (
            <div className="text-gray-500">No logs found</div>
          ) : (
            <>
              {filteredLogs.map((log) => (
                <div key={log.id} className="mb-1">
                  {formatLogMessage(log)}
                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <details className="ml-8 mt-1">
                      <summary className="text-gray-500 cursor-pointer hover:text-gray-400 text-xs">
                        Metadata
                      </summary>
                      <pre className="mt-1 text-xs text-gray-400 overflow-x-auto">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
              <div ref={logsEndRef} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
