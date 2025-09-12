import React, { useEffect, useMemo, useRef, useState, useContext } from 'react';
import { AppContext } from '.../AppContext';
import { useNavigate } from 'react-router-dom';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0, v = c==='x'? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function DoctorCard({ d, onClick }) {
  return (
    <div className="border rounded-xl overflow-hidden hover:translate-y-[-4px] transition cursor-pointer" onClick={onClick} title={d.name}>
      <img className="w-full h-40 object-cover bg-[#EAEFFF]" src={d.image} alt={d.name} />
      <div className="p-3">
        <div className="text-sm text-gray-500">{d.speciality}</div>
        <div className="font-semibold text-[#262626]">{d.name}</div>
        <div className="text-xs text-gray-600">Experience: {d.experience}</div>
        <div className="text-xs text-gray-600">Fee: ${d.fees}</div>
      </div>
    </div>
  );
}

export default function ChatbotComponent() {
  const { backendUrl, user } = useContext(AppContext) || {};
  const tenantId = user?.tenantId || 'default';
  const userId = user?._id || 'anon';

  const [chatId, setChatId] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([
    { role:'assistant', content:"👋 I’m Pandoc Health Assistant. Tell me your symptoms or what you need help with." }
  ]);
  const [lastDoctors, setLastDoctors] = useState([]); // render latest doctor list under last assistant turn
  const [meta, setMeta] = useState(null); // pagination meta from backend
  const scrollRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    let id = localStorage.getItem('pandoc_chat_id');
    if (!id) {
      id = uuid();
      localStorage.setItem('pandoc_chat_id', id);
    }
    setChatId(id);
  }, []);

  useEffect(() => {
    // autoscroll
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, lastDoctors]);

  const send = async (text) => {
    if (!text?.trim() || busy) return;
    setBusy(true);
    setMessages(prev => [...prev, { role:'user', content: text }]);
    setInput('');
    try {
      const res = await fetch(`${backendUrl}/api/ai/chat`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ tenantId, userId, chatId, message: text })
      });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.message || 'Request failed');

      setMessages(prev => [...prev, { role:'assistant', content: json.reply }]);

      // doctors (if any) appear under the last assistant message
      if (Array.isArray(json.doctors) && json.doctors.length) {
        setLastDoctors(json.doctors);
      } else if (json.intent !== 'paginate') {
        setLastDoctors([]); // clear if not pagination append
      }
      setMeta(json.meta || null);
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role:'assistant', content: 'Sorry, something went wrong. Try again.' }]);
    } finally {
      setBusy(false);
    }
  };

  const onLoadMore = async () => {
    await send('more');
  };

  const quick = useMemo(() => ([
    'Show doctors',
    'Cheapest',
    'Most experienced',
    'Female doctor',
    'Load more'
  ]), []);

  return (
    <div className="flex flex-col h-full max-h-[85vh] sm:max-h-[80vh] border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b bg-white font-semibold">PANDOC</div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#fafbff] p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[85%] ${m.role==='assistant' ? 'self-start' : 'self-end ml-auto'} flex flex-col`}>
            <div className={`${m.role==='assistant' ? 'bg-white' : 'bg-[#E2E5FF]'} border rounded-2xl px-3 py-2 text-sm text-[#262626]`}>
              {m.content}
            </div>
            {/* After the latest assistant message, show doctor list if present */}
            {i === messages.length - 1 && lastDoctors.length > 0 && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {lastDoctors.map((d) => (
                  <DoctorCard
                    key={d._id}
                    d={d}
                    onClick={() => { navigate(`/appointment/${d._id}`); window.scrollTo(0,0); }}
                  />
                ))}
              </div>
            )}
            {/* Load more button only if we have doctors in view */}
            {i === messages.length - 1 && lastDoctors.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={onLoadMore}
                  className="px-4 py-2 text-sm rounded-full border bg-white hover:bg-[#f2f4ff] disabled:opacity-50"
                  disabled={busy}
                >
                  {busy ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="self-start bg-white border rounded-2xl px-3 py-2 text-sm text-[#262626] w-fit">
            …
          </div>
        )}
      </div>

      <div className="border-t p-2 bg-white">
        <div className="flex gap-2 mb-2">
          {quick.map((q) => (
            <button
              key={q}
              className="text-xs border rounded-full px-3 py-1 bg-[#F5F7FF] hover:bg-[#EAEFFF]"
              onClick={() => send(q.toLowerCase())}
              disabled={busy}
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e)=>{ e.preventDefault(); send(input); }}
        >
          <input
            className="flex-1 border rounded-full px-4 py-2 text-sm outline-none"
            placeholder="Type your symptoms or ask for a doctor…"
            value={input}
            onChange={e=>setInput(e.target.value)}
          />
          <button
            type="submit"
            className="px-5 py-2 rounded-full bg-[#4F63FF] text-white text-sm disabled:opacity-50"
            disabled={busy || !input.trim()}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
