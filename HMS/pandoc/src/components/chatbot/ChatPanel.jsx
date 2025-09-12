import { useEffect, useRef, useState } from "react";

export default function ChatPanel({ onClose }) {
  const [msgs, setMsgs] = useState([
    {
      from: "assistant",
      text: "👋 I’m Pandoc Health Assistant. Tell me your symptoms or what you need help with.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { from: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error("Network error");
      const data = await res.json();
      // ⬇️ Keep reply + attach doctors array (if any)
      setMsgs((m) => [
        ...m,
        {
          from: "assistant",
          text: data?.reply || "…",
          doctors: Array.isArray(data?.doctors) ? data.doctors : [],
        },
      ]);
    } catch (_e) {
      setMsgs((m) => [...m, { from: "assistant", text: "Network error." }]);
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[92vw]">
      <div className="rounded-2xl shadow-xl border bg-white overflow-hidden">
        {/* header */}
        <div className="bg-indigo-600 text-white px-5 py-3 flex items-center justify-between">
          <div className="font-semibold">Pandoc AI Assistant</div>
          <button
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-full hover:bg-white/15"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* messages */}
        <div ref={scrollerRef} className="max-h-[60vh] overflow-y-auto p-4 space-y-3">
          {msgs.map((m, i) => {
            const isUser = m.from === "user";
            return (
              <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={[
                    "max-w-[88%] rounded-2xl px-4 py-3",
                    isUser ? "bg-indigo-50 text-indigo-900" : "bg-gray-100 text-gray-900",
                  ].join(" ")}
                >
                  {/* text bubble */}
                  <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>

                  {/* doctor cards (only for assistant messages with results) */}
                  {!isUser && Array.isArray(m.doctors) && m.doctors.length > 0 && (
                    <div className="mt-3 space-y-3">
                      {m.doctors.map((d) => (
                        <a
                          key={d._id}
                          href={`/appointment/${d._id}`}
                          className="block group"
                          title={`View ${d?.name}`}
                        >
                          <div className="flex gap-3 rounded-xl border bg-white p-3 shadow-sm group-hover:shadow">
                            {/* thumbnail */}
                            <img
                              src={d?.image}
                              alt={d?.name || "Doctor"}
                              className="w-14 h-14 rounded-lg object-cover border"
                              loading="lazy"
                            />
                            {/* details */}
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate group-hover:underline">
                                {d?.name || "Doctor"}
                              </div>
                              <div className="text-sm text-gray-600 truncate">
                                {d?.speciality}
                                {d?.experience ? ` • ${d.experience}` : ""}
                              </div>
                              {d?.address?.line1 && (
                                <div className="text-xs text-gray-500 truncate">
                                  {d.address.line1}
                                  {d?.address?.line2 ? `, ${d.address.line2}` : ""}
                                </div>
                              )}
                              <div className="text-sm font-semibold mt-1">
                                {typeof d?.fees === "number" ? `$${d.fees}` : ""}
                              </div>
                            </div>
                            {/* CTA */}
                            <div className="self-center">
                              <span className="text-indigo-600 text-sm font-medium">View</span>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* input */}
        <div className="px-4 pb-3 pt-2">
          <div className="flex gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Type here..."
              className="flex-1 resize-none rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleSend}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <div className="text-[11px] text-gray-400 mt-2">powered by Nexabit AI</div>
        </div>
      </div>
    </div>
  );
}
