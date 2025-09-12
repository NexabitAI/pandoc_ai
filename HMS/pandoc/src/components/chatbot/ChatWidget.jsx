// src/components/chatbot/ChatWidget.jsx
import React, { useEffect, useState } from "react";
import ChatPanel from "./ChatPanel.jsx";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  useEffect(() => console.log("[ChatWidget] mounted"), []);
  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-[9999] shadow-2xl rounded-2xl bg-white w-[360px] h-[560px] overflow-hidden border">
          <ChatPanel onClose={() => setOpen(false)} />
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-[10000] rounded-full w-14 h-14 shadow-xl bg-indigo-600 text-white hover:bg-indigo-700"
        aria-label={open ? "Close chat" : "Open chat"}
        title={open ? "Close chat" : "Open chat"}
      >
        {!open ? (
          <svg viewBox="0 0 24 24" className="w-7 h-7 m-auto" fill="currentColor">
            <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 9h12v2H6V9zm0-3h12v2H6V6zm0 6h9v2H6v-2z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-7 h-7 m-auto" fill="currentColor">
            <path d="M18.3 5.71 12 12.01l-6.3-6.3-1.4 1.41 6.29 6.29-6.3 6.3 1.41 1.4 6.3-6.29 6.29 6.3 1.41-1.41-6.3-6.3 6.3-6.29z"/>
          </svg>
        )}
      </button>
    </>
  );
}
