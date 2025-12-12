import { useEffect, useState, useRef } from 'react';
import { Session, useSessionStore } from '../store/session.store';
import { fetchSessionMessages, sendMessage } from '../api/sessions.api';
import { useSocket } from '../hooks/useSocket';

interface MessagesViewProps {
  session: Session;
}

export default function MessagesView({ session }: MessagesViewProps) {
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const { messages, setMessages, addMessage } = useSessionStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sessionMessages = messages[session.id] || [];
  
  // Get the contact phone from the created contact (Jean Leroy: +972544463186)
  const contactPhone = '+972544463186';

  // Listen for new messages via WebSocket
  useSocket({
    onNewMessage: (data: any) => {
      console.log('📨 New message received via WebSocket:', data);
      if (data.sessionId === session.id) {
        addMessage(data.sessionId, data.message);
      }
    },
  });

  useEffect(() => {
    loadMessages();
    
    // Poll for messages every 3 seconds as fallback
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [session.id]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionMessages]);

  const loadMessages = async () => {
    try {
      const msgs = await fetchSessionMessages(session.id);
      setMessages(session.id, msgs);
    } catch (error) {
      console.error('Failed to load messages', error);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!messageText.trim()) {
      return;
    }

    setSending(true);
    try {
      await sendMessage(session.id, contactPhone, messageText);
      setMessageText('');
      // Message will be added via WebSocket event
      setTimeout(loadMessages, 1000);
    } catch (error) {
      console.error('Failed to send message', error);
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Sort messages by date (oldest first for chat display)
  const sortedMessages = [...sessionMessages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex flex-col h-full" style={{ background: '#e5ddd5' }}>
      {/* WhatsApp-style header */}
      <div className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-bold">
          JL
        </div>
        <div className="flex-1">
          <div className="font-semibold">Jean Leroy</div>
          <div className="text-xs text-green-200">{contactPhone}</div>
        </div>
        <div className="flex gap-4 text-white/80">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M15.9 14.3H15l-.3-.3c1-1.1 1.6-2.7 1.6-4.3 0-3.7-3-6.7-6.7-6.7S3 6 3 9.7s3 6.7 6.7 6.7c1.6 0 3.2-.6 4.3-1.6l.3.3v.8l5.1 5.1 1.5-1.5-5-5.2zm-6.2 0c-2.6 0-4.6-2.1-4.6-4.6s2.1-4.6 4.6-4.6 4.6 2.1 4.6 4.6-2 4.6-4.6 4.6z"/>
          </svg>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
          </svg>
        </div>
      </div>

      {/* Messages List - WhatsApp style */}
      <div 
        className="flex-1 overflow-y-auto p-4 space-y-2"
        style={{ 
          backgroundImage: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAMAAAAp4XiDAAAAUVBMVEWFhYWDg4N3d3dtbW17e3t1dXWBgYGHh4d5eXlzc3Oeli/")',
          backgroundSize: '500px'
        }}
      >
        {sortedMessages.length === 0 ? (
          <div className="text-center text-gray-600 mt-8 bg-yellow-50/90 p-4 rounded-lg mx-auto max-w-sm">
            <p className="font-medium">💬 Aucun message</p>
            <p className="text-sm mt-2">Envoyez un message pour commencer la conversation</p>
          </div>
        ) : (
          sortedMessages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[70%] px-3 py-2 rounded-lg shadow-sm relative ${
                  message.direction === 'OUTBOUND'
                    ? 'bg-[#dcf8c6] text-gray-900'
                    : 'bg-white text-gray-900'
                }`}
                style={{
                  borderRadius: message.direction === 'OUTBOUND' 
                    ? '8px 0 8px 8px' 
                    : '0 8px 8px 8px'
                }}
              >
                <div className="break-words text-sm">{message.text}</div>
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-[10px] text-gray-500">
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {message.direction === 'OUTBOUND' && (
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/>
                    </svg>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer - WhatsApp style */}
      <div className="bg-[#f0f0f0] px-4 py-2">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <button type="button" className="p-2 text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          </button>
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Tapez un message..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="w-full px-4 py-2 bg-white rounded-full focus:outline-none focus:ring-2 focus:ring-[#075e54]"
            />
          </div>
          {messageText.trim() ? (
            <button
              type="submit"
              disabled={sending}
              className="p-2 bg-[#075e54] text-white rounded-full hover:bg-[#054d44] transition-colors disabled:opacity-50"
            >
              {sending ? (
                <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
          ) : (
            <button type="button" className="p-2 text-gray-500 hover:text-gray-700">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
