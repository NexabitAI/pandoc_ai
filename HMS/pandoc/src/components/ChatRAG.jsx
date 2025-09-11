import React, { useState, useRef } from 'react';

// Small, dependency-free chat
export default function ChatRAG({ backendUrl, tenantId='default', userId='web', chatId='web-1' }) {
  const [msgs, setMsgs] = useState([
    { role:'assistant', content:'👋 I’m Pandoc Health Assistant. Tell me your symptoms or what you need help with.' }
  ]);
  const [input, setInput] = useState('');
  const [cards, setCards] = useState([]); // latest doctor cards
  const boxRef = useRef(null);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setMsgs(m => [...m, { role:'user', content:text }]);
    setInput('');

    try {
      const r = await fetch(`${backendUrl}/api/ai/chat`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ tenantId, userId, chatId, message: text })
      });
      const j = await r.json();
      if (j.success) {
        setMsgs(m => [...m, { role:'assistant', content: j.reply }]);
        if (j.doctors?.length) setCards(j.doctors);
      } else {
        setMsgs(m => [...m, { role:'assistant', content:'Sorry, something went wrong.' }]);
      }
    } catch {
      setMsgs(m => [...m, { role:'assistant', content:'Network error.' }]);
    } finally {
      setTimeout(()=> boxRef.current?.scrollTo(0, boxRef.current?.scrollHeight || 0), 0);
    }
  }

  return (
    <div className="max-w-2xl mx-auto border rounded-lg p-3">
      <div ref={boxRef} className="h-96 overflow-y-auto space-y-3">
        {msgs.map((m,i)=>(
          <div key={i} className={m.role==='assistant'?'text-gray-900':'text-blue-700'}>
            <div className="rounded bg-gray-50 px-3 py-2 inline-block max-w-[90%]">
              {m.content}
            </div>
          </div>
        ))}

        {cards.length>0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-2">
            {cards.map(d=>(
              <div key={d._id} className="border rounded-lg overflow-hidden">
                <img src={d.image} alt="" className="w-full h-28 object-cover bg-gray-100" />
                <div className="p-2 text-sm">
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-gray-600">{d.speciality} {d.gender?`• ${d.gender}`:''}</div>
                  <div className="text-gray-600">{d.experience} • ${d.fees}</div>
                  <a className="text-blue-600 underline text-sm" href={`/appointment/${d._id}`}>View profile</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="Type here..."
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=> e.key==='Enter' && send()}
        />
        <button onClick={send} className="bg-blue-600 text-white rounded px-4">Send</button>
      </div>
    </div>
  );
}
