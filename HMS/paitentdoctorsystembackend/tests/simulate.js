// tests/simulate.js
import fetch from 'node-fetch';

const BASE = process.env.CHAT_URL || 'https://mypandoc.com/api/ai/chat';
const tenantId = 'default', userId = 'test-user', chatId = 'sim-1';

async function send(message) {
  const r = await fetch(BASE, {
    method:'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ tenantId, userId, chatId, message })
  });
  const j = await r.json();
  console.log('\nUser:', message);
  console.log('Bot :', j.reply);
  if (j.doctors?.length) {
    console.log('Docs:', j.doctors.map(d=>`${d.name} (${d.speciality}) $${d.fees}`).join(' | '));
  }
}

(async ()=>{
  // Conversation sample (trauma)
  await send('hi');
  await send('fell off bike; knee swollen, arm bleeding');
  await send('yes show doctors');
  await send('female only');
  await send('cheapest');

  // Brain doctor direct
  await send('give me a brain doctor');
  await send('most experienced');

  // Price cap + specialty
  await send('female under 90');
  await send('skin rash');

  // Booking refusal
  await send('book with #1');

  // Out of scope
  await send('what is bitcoin price');

  console.log('\nDone.');
})();
