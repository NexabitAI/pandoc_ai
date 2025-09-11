import express from 'express';
import 'dotenv/config.js';
import OpenAI from 'openai';
import doctorModel from '../models/doctorModel.js';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- helpers ---
const STRIP_YEARS = (s='') => {
  const n = parseInt(String(s).match(/\d+/)?.[0] || '0', 10);
  return isNaN(n) ? 0 : n;
};

function lastUserWantsDoctors(txt='') {
  const t = txt.toLowerCase();
  return /\b(doctor|doctors|give me (a|the) doctor|find (a|the) doctor|see (a|the) doctor|book|appointment|who should i see|show doctors|yes show|yes please|show me)\b/.test(t);
}

function userSeemsDone(txt='') {
  const t = txt.toLowerCase();
  return /\b(that'?s all|nothing more|no other|nothing else|that is it|that'?s it)\b/.test(t);
}

function extractHeuristicPrefs(txt='') {
  const t = txt.toLowerCase();
  let gender = null;
  if (/\bfemale\b/.test(t)) gender = 'female';
  if (/\bmale\b/.test(t)) gender = 'male';
  let pricePref = null;
  if (/\bcheapest|cheap|low( |-)?cost|budget\b/.test(t)) pricePref = 'cheapest';
  if (/\bexpensive|premium|top( |-)?tier|highest fee\b/.test(t)) pricePref = 'expensive';
  let expMin = null;
  const m = t.match(/(\d+)\+?\s*(years?|yrs?)\s*(experience)?/);
  if (m) expMin = parseInt(m[1], 10);
  const wantBest = /\b(best|most experienced|top doctor|senior)\b/.test(t);
  return { gender, pricePref, expMin, wantBest };
}

function fallbackSpecialtiesFromText(text='') {
  const t = text.toLowerCase();
  const picks = new Set();

  // direct specialty words
  if (/\bdermat(o|ology|ologist)|skin\b/.test(t)) picks.add('Dermatologist');
  if (/\bcardio|chest pain|heart\b/.test(t)) picks.add('Cardiology');
  if (/\bneuro|nerv|seiz|stroke|head injur(y)?\b/.test(t)) picks.add('Neurologist');
  if (/\bpsych|anxiety|depress|mental\b/.test(t)) picks.add('Psychiatry');
  if (/\bent|ear|nose|throat\b/.test(t)) picks.add('Otolaryngology (ENT)');
  if (/\bophthal|eye\b/.test(t)) picks.add('Ophthalmology');
  if (/\buro|urine|prostate\b/.test(t)) picks.add('Urology');
  if (/\bgastro|stomach|abdomen|acid\b/.test(t)) picks.add('Gastroenterologist');
  if (/\bobgyn|gyne|pregnan|pelvic|period\b/.test(t)) picks.add('Gynecologist');
  if (/\bpedia|child|kid\b/.test(t)) picks.add('Pediatricians');
  if (/\bendocrin|thyroid|diabet\b/.test(t)) picks.add('Endocrinology, Diabetes & Metabolism');

  // trauma / MSK
  if (/(fall|accident|injur|fractur|sprain|bruise|swollen|swelling|limited movement|joint|knee|ankle|wrist|shoulder)/.test(t)) {
    picks.add('Orthopedic Surgery'); picks.add('Sports Medicine'); picks.add('Emergency Medicine');
  }
  // bleeding / cuts / wounds
  if (/(bleed|laceration|cut|wound|gash)/.test(t)) {
    picks.add('Emergency Medicine'); picks.add('Wound Care'); picks.add('General Surgery');
  }

  if (picks.size === 0) picks.add('General physician'); // ultimate fallback
  return Array.from(picks);
}

function conversationText(messages=[]) {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

async function queryDoctors({ specialties, gender, pricePref, expMin, wantBest }) {
  if (!Array.isArray(specialties) || specialties.length === 0) specialties = ['General physician'];

  // Build OR by specialties (case-insensitive)
  const or = specialties.map(s => ({ speciality: { $regex: new RegExp(`^${s}$`, 'i') } }));

  const query = { available: true, $or: or };
  if (gender) query.gender = new RegExp(`^${gender}$`, 'i');

  let docs = await doctorModel
    .find(query)
    .select('_id name speciality fees experience degree image address gender')
    .lean();

  // Filter by minimum experience if asked
  if (typeof expMin === 'number' && expMin > 0) {
    docs = docs.filter(d => STRIP_YEARS(d.experience) >= expMin);
  }

  // Sort strategy
  if (pricePref === 'cheapest') {
    docs.sort((a, b) => a.fees - b.fees);
  } else if (pricePref === 'expensive') {
    docs.sort((a, b) => b.fees - a.fees);
  } else if (wantBest) {
    // interpret "best" as most experienced (ties broken by lower fee)
    docs.sort((a, b) => {
      const d = STRIP_YEARS(b.experience) - STRIP_YEARS(a.experience);
      return d !== 0 ? d : (a.fees - b.fees);
    });
  } else {
    // default: stable-ish order by specialty then name
    docs.sort((a, b) => (a.speciality || '').localeCompare(b.speciality || '') || (a.name||'').localeCompare(b.name||''));
  }

  // Return ALL matches (your request). If you ever need cap, slice here.
  return docs;
}

const SYSTEM_PROMPT = `
You are "Pandoc Health Assistant" for the Pandoc HMS.

SCOPE
- Only health/wellness or Pandoc platform. Refuse other topics politely and steer back.
- No diagnosis, meds, dosages, or treatment plans. No external links.

STYLE
- Empathetic and concise: <= 2 short sentences (<= 220 chars).
- Answer small-talk briefly ("I'm doing well and here to help with your health.").
- Use full history; don't repeat questions. Ask at most ONE focused follow-up only if truly needed.

INTENT & PREFERENCES
- If user asks to see doctors/book, "intent":"show_doctors".
- Infer gender preference ("male"|"female"|null), price preference ("cheapest"|"expensive"|null), min experience in years (number|null), and specialties (1–3 strings).
- If requested specialty not available or unclear, choose the closest reasonable specialties; if nothing fits, use "General physician".
- If user wants "best doctor", interpret as "most experienced".
- Do NOT say "I can help refine the list".

OUTPUT valid JSON ONLY:
{
  "assistant_message": "string",
  "intent": "refuse" | "chat" | "request_more_info" | "show_doctors",
  "symptom_summary": "string|null",
  "specialties": string[] | null,
  "preferences": {
    "gender": "male" | "female" | null,
    "price": "cheapest" | "expensive" | null,
    "min_experience_years": number | null,
    "want_best": boolean | null
  }
}
Keep assistant_message <= 220 chars.
`;

router.post('/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;
    const latestUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const forceShow = lastUserWantsDoctors(latestUser);
    const doneFeeling = userSeemsDone(latestUser);
    const convo = conversationText(messages);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      response_format: { type: 'json_object' },
    });

    let parsed;
    try { parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}'); }
    catch { parsed = {}; }

    let assistant_message = parsed.assistant_message || "How can I help you with your health today?";
    let intent = parsed.intent || 'chat';
    let specialties = Array.isArray(parsed.specialties) ? parsed.specialties : null;
    const prefs = parsed.preferences || {};
    let { gender=null, price=null, min_experience_years=null, want_best=null } = prefs;

    // Heuristic fallbacks (in case the model missed them)
    const heur = extractHeuristicPrefs(latestUser);
    gender = gender || heur.gender;
    price = price || heur.pricePref;
    min_experience_years = (typeof min_experience_years === 'number' ? min_experience_years : null) || heur.expMin || null;
    want_best = (typeof want_best === 'boolean' ? want_best : null) || heur.wantBest || null;

    // Show doctors if explicitly asked, unless refused
    if (forceShow && intent !== 'refuse') {
      intent = 'show_doctors';
      if (!specialties || specialties.length === 0) specialties = fallbackSpecialtiesFromText(convo);
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = "Here are doctors that match what you described.";
      }
    }

    // If user says they’re done but hasn’t asked for doctors: suggest
    if (!forceShow && doneFeeling && intent !== 'refuse' && intent !== 'show_doctors') {
      assistant_message = "Understood. Would you like me to show doctors that fit your needs?";
      intent = 'chat';
    }

    // If we’re showing doctors, ensure specialties are present (fallback if needed)
    let doctors = [];
    if (intent === 'show_doctors') {
      if (!specialties || specialties.length === 0) specialties = fallbackSpecialtiesFromText(convo);

      // CLOSE CATEGORY fallback: if none found in first pass, broaden with General physician
      doctors = await queryDoctors({
        specialties,
        gender,
        pricePref: price,
        expMin: min_experience_years,
        wantBest: want_best
      });

      if (doctors.length === 0 && !specialties.includes('General physician')) {
        doctors = await queryDoctors({
          specialties: [...specialties, 'General physician'],
          gender,
          pricePref: price,
          expMin: min_experience_years,
          wantBest: want_best
        });
      }

      if (doctors.length === 0) {
        intent = 'request_more_info';
        assistant_message = "I can pull the right specialists. Is the problem mainly joint-related or something else?";
      }
    }

    return res.json({
      success: true,
      reply: assistant_message,
      intent,
      doctors
    });
  } catch (e) {
    console.error('[ai/chat]', e);
    return res.status(500).json({ success: false, message: 'AI service error' });
  }
});

export default router;
