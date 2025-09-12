// src/components/chatbot/ChatPanel.jsx
import React, { useRef, useState, useEffect } from "react";

export default function ChatPanel({ onClose }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "👋 I’m Pandoc Health Assistant. Tell me your symptoms or what you need help with." }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);

    try {
      const base = import.meta.env.VITE_API_BASE || ""; // keep relative proxy working
      const r = await fetch(`${base}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();

      const parts = [data.reply || ""];
      if (Array.isArray(data.doctors) && data.doctors.length) {
        const names = data.doctors.map((d) => `${d.name} — ${d.speciality} ($${d.fees})`).join("\n");
        parts.push(`\n—\n${names}`);
      }
      setMessages((m) => [...m, { role: "assistant", content: parts.join("") }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Network error." }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white">
        <div className="font-semibold">Pandoc AI Assistant</div>
        <button
          className="w-7 h-7 rounded-full hover:bg-white/20"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {messages.map((m, i) => {
          const isUser = m.role === "user";             // user LEFT, assistant RIGHT (as requested)
          return (
            <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "max-w-[80%] rounded-xl px-3 py-2 text-[14px] leading-5 whitespace-pre-wrap",
                  isUser ? "bg-indigo-50 text-indigo-900" : "bg-gray-100 text-gray-900"
                ].join(" ")}
              >
                {m.content}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="bg-white p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type here…"
            rows={1}
            className="flex-1 resize-none rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 text-xs text-gray-400 border-t bg-white">
        powered by Nexabit AI
      </div>
    </div>
  );
}
