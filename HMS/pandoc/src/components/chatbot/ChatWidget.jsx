// src/components/chatbot/ChatWidget.jsx
import React, { useEffect, useState } from 'react';
import ChatRAG from '../ChatRAG'; // uses your new RAG chat
// If ChatRAG export changes later, you can swap to your legacy:
// import ChatbotComponent from './widgets/ChatbotComponent.jsx';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // quick proof it's mounted
    // eslint-disable-next-line no-console
    console.log('[ChatWidget] mounted');
  }, []);

  return (
    <>
      {/* Panel */}
      {open && (
        <div
          id="pandoc-chat-widget"
          className="fixed bottom-24 right-6 z-[9999] shadow-2xl rounded-2xl bg-white w-[360px] h-[560px] overflow-hidden border"
        >
          {/* If you ever need to switch back: <ChatbotComponent embedded /> */}
          <ChatRAG embedded />
        </div>
      )}

      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-[10000] rounded-full w-14 h-14 shadow-xl bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none"
        aria-label={open ? 'Close chat' : 'Open chat'}
        title={open ? 'Close chat' : 'Open chat'}
      >
        {!open ? (
          // Chat bubble icon
          <svg viewBox="0 0 24 24" className="w-7 h-7 m-auto" fill="currentColor">
            <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm0-3h12v2H6V6zm0 6h9v2H6v-2z"/>
          </svg>
        ) : (
          // Close icon
          <svg viewBox="0 0 24 24" className="w-7 h-7 m-auto" fill="currentColor">
            <path d="M18.3 5.71 12 12.01l-6.3-6.3-1.4 1.41 6.29 6.29-6.3 6.3 1.41 1.4 6.3-6.29 6.29 6.3 1.41-1.41-6.3-6.3 6.3-6.29z"/>
          </svg>
        )}
      </button>
    </>
  );
}
