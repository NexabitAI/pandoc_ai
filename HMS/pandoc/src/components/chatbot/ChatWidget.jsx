// src/components/chatbot/ChatWidget.jsx
import { useState } from "react";
import ChatRAG from "../ChatRAG"; // path is correct for your tree

export default function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Launcher button (TOP-LEFT) */}
      <button
        aria-label="Open chat"
        onClick={() => setOpen((v) => !v)}
        className="
          fixed left-4 top-4 z-[1000]
          h-12 w-12 rounded-full shadow-lg
          bg-indigo-600 text-white
          flex items-center justify-center
          hover:bg-indigo-700 focus:outline-none
        "
      >
        {/* chat bubble icon */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
          <path d="M2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12c0 5.385-4.365 9.75-9.75 9.75a9.7 9.7 0 01-4.259-.963l-3.31.88a.75.75 0 01-.914-.914l.88-3.31A9.7 9.7 0 012.25 12z"/>
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div
          className="
            fixed left-4 top-20 z-[1000]
            w-[360px] max-w-[95vw] h-[65vh]
            bg-white rounded-2xl border border-gray-200 shadow-2xl
            flex flex-col
          "
        >
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="font-semibold">Pandoc Assistant</div>
            <button
              className="text-gray-500 hover:text-gray-700"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {/* Your existing chat UI */}
            <ChatRAG embedMode />
          </div>
        </div>
      )}
    </>
  );
}
