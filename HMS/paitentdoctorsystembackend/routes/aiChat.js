import express from 'express';
import 'dotenv/config.js';
import OpenAI from 'openai';
import mongoose from 'mongoose';
import doctorModel from '../models/doctorModel.js';
import Specialty from '../models/Specialty.js';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- helpers ----------
const STRIP_YEARS = (s='') => {
  const n = parseInt(String(s).match(/\d+/)?.[0] || '0', 10);
  return isNaN(n) ? 0 : n;
};

function conversationText(messages=[]) {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

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
  if (/\b(cheapest|cheap|low( |-)?cost|budget)\b/.test(t)) pricePref = 'cheapest';
  if (/\b(expensive|premium|top( |-)?tier|highest fee)\b/.test(t)) pricePref = 'expensive';
  let expMin = null;
  const m = t.match(/(\d+)\+?\s*(years?|yrs?)\s*(experience)?/);
  if (m) expMin = parseInt(m[1], 10);
  const wantBest = /\b(best|most experienced|top doctor|senior)\b/.test(t);
  return { gender, pricePref, expMin, wantBest };
}

// Build a tolerant name regex: "dr emily king" → /(^|\b)emily\s+king(\b|$)/i
function buildNameRegex(name='') {
  const cleaned = String(name).replace(/dr\.?|doctor/ig, ' ').replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const pattern = tokens.map(t => `${escapeRegex(t)}`).join('\\s+');
  return new RegExp(`(^|\\b)${pattern}(\\b|$)`, 'i');
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Try to guess a doctor name directly from the user’s latest text.
// Returns string | null
function guessDoctorNameFromText(txt='') {
  // “dr emily king”, “doctor emily king”
  const m1 = txt.match(/(?:\bdr\.?\b|\bdoctor\b)\s+([a-z][a-z]+(?:\s+[a-z][a-z]+){0,2})/i);
  if (m1) return m1[1];
  // Quoted names: "Emily King"
  const m2 = txt.match(/"([a-z][a-z]+(?:\s+[a-z][a-z]+){0,2})"/i);
  if (m2) return m2[1];
  // Last fallback: if they say “Dr. Emily”, “Emily King please”
  const m3 = txt.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
  if (m3 && /\b(dr|doctor|please|want|need|see)\b/i.test(txt)) return m3[1];
  return null;
}

// Find specialties explicitly mentioned by the user from DB list (case-insensitive substring)
async function findMentionedSpecialtiesInText(txt='') {
  const t = txt.toLowerCase();
  const specs = await Specialty.find({ active: true }).select('name').lean();
  const found = [];
  for (const s of specs) {
    const name = (s.name || '').toLowerCase();
    if (!name) continue;
    if (t.includes(name)) found.push(s.name);
  }
  // simple synonyms
  if (/\bdermatolog(y|ist)\b/i.test(txt)) found.push('Dermatologist');
  if (/\bcardiolog(y|ist)\b/i.test(txt)) found.push('Cardiology');
  if (/\bneurolog(y|ist)\b/i.test(txt)) found.push('Neurologist');
  if (/\bent\b|\bear|nose|throat/i.test(txt)) found.push('Otolaryngology (ENT)');
  if (/\bgyn|gynecolog/i.test(txt)) found.push('Gynecologist');
  if (/\bpediatric/i.test(txt)) found.push('Pediatricians');
  if (/\bgastro|stomach|abdomen/i.test(txt)) found.push('Gastroenterologist');
  // dedupe
  return Array.from(new Set(found));
}

// Fallback mapping from symptoms → specialties (including trauma)
function fallbackSpecialtiesFromText(text='') {
  const t = text.toLowerCase();
  const picks = new Set();
  if (/\bdermat(o|ology|ologist)|skin\b/.test(t)) picks.add('Dermatologist');
  if (/\bcardio|chest pain|heart\b/.test(t)) picks.add('Cardiology');
  if (/\bneuro|nerv|seiz|stroke|head injur(y)?|headache\b/.test(t)) picks.add('Neurologist');
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

  if (picks.size === 0) picks.add('General physician');
  return Array.from(picks);
}

async function queryDoctorsBySpecialties({ specialties, gender, pricePref, expMin, wantBest }) {
  if (!Array.isArray(specialties) || specialties.length === 0) specialties = ['General physician'];
  const or = specialties.map(s => ({ speciality: { $regex: new RegExp(`^${escapeRegex(s)}$`, 'i') } }));
  const query = { available: true, $or: or };
  if (gender) query.gender = new RegExp(`^${gender}$`, 'i');

  let docs = await doctorModel
    .find(query)
    .select('_id name speciality fees experience degree image address gender')
    .lean();

  if (typeof expMin === 'number' && expMin > 0) {
    docs = docs.filter(d => STRIP_YEARS(d.experience) >= expMin);
  }

  if (pricePref === 'cheapest') {
    docs.sort((a, b) => a.fees - b.fees);
  } else if (pricePref === 'expensive') {
    docs.sort((a, b) => b.fees - a.fees);
  } else if (wantBest) {
    docs.sort((a, b) => {
      const d = STRIP_YEARS(b.experience) - STRIP_YEARS(a.experience);
      return d !== 0 ? d : (a.fees - b.fees);
    });
  } else {
    docs.sort((a, b) => (a.speciality || '').localeCompare(b.speciality || '') || (a.name||'').localeCompare(b.name||''));
  }

  return docs; // ALL matches
}

async function queryDoctorsByName({ name, gender, pricePref, expMin, wantBest }) {
  const rx = buildNameRegex(name);
  if (!rx) return [];
  const query = { available: true, name: rx };
  if (gender) query.gender = new RegExp(`^${gender}$`, 'i');

  let docs = await doctorModel
    .find(query)
    .select('_id name speciality fees experience degree image address gender')
    .lean();

  if (typeof expMin === 'number' && expMin > 0) {
    docs = docs.filter(d => STRIP_YEARS(d.experience) >= expMin);
  }

  // If multiple docs share the same name and specialty, we return ALL of them as requested.
  if (pricePref === 'cheapest') {
    docs.sort((a, b) => a.fees - b.fees);
  } else if (pricePref === 'expensive') {
    docs.sort((a, b) => b.fees - a.fees);
  } else if (wantBest) {
    docs.sort((a, b) => {
      const d = STRIP_YEARS(b.experience) - STRIP_YEARS(a.experience);
      return d !== 0 ? d : (a.fees - b.fees);
    });
  } else {
    docs.sort((a, b) => (a.speciality || '').localeCompare(b.speciality || '') || (a.name||'').localeCompare(b.name||''));
  }

  // If no exact-ish name matches, try a looser contains search as "closest one"
  if (docs.length === 0) {
    const loose = new RegExp(escapeRegex(String(name).trim()), 'i');
    const altQuery = { available: true, name: loose };
    if (gender) altQuery.gender = new RegExp(`^${gender}$`, 'i');
    docs = await doctorModel
      .find(altQuery)
      .select('_id name speciality fees experience degree image address gender')
      .lean();
  }

  return docs;
}

// ---------- OpenAI prompt ----------
const SYSTEM_PROMPT = `
You are "Pandoc Health Assistant" for the Pandoc HMS.

SCOPE
- Health/wellness or Pandoc platform only. If outside scope, politely refuse and steer back.
- No diagnosis, meds, dosages, or treatment plans. No external links.

STYLE
- Empathetic and concise: <= 2 short sentences (<= 220 chars).
- Answer small-talk briefly ("I'm doing well and here to help with your health.").
- Use full history; don't repeat prior questions. Ask at most ONE focused follow-up only if truly needed.

INTENT & PREFERENCES
- If user asks to see doctors/book, "intent":"show_doctors".
- If user names a doctor or a specialty explicitly, prefer that target.
- Infer gender ("male"|"female"|null), price ("cheapest"|"expensive"|null), min experience years (number|null), and specialties (1–3 strings).
- If requested specialty doesn’t exist or is unclear, choose closest reasonable specialties; if nothing fits, use "General physician".
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
  },
  "direct": {
    "doctor_name": string | null,
    "specialties": string[] | null
  }
}
Keep assistant_message <= 220 chars.
`;

// ---------- route ----------
router.post('/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;
    const latestUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const convo = conversationText(messages);
    const forceShow = lastUserWantsDoctors(latestUser);
    const doneFeeling = userSeemsDone(latestUser);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      response_format: { type: 'json_object' },
    });

    let parsed = {};
    try { parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}'); } catch {}
    let assistant_message = parsed.assistant_message || "How can I help you with your health today?";
    let intent = parsed.intent || 'chat';
    let specialties = Array.isArray(parsed.specialties) ? parsed.specialties : null;
    const prefs = parsed.preferences || {};
    let { gender=null, price=null, min_experience_years=null, want_best=null } = prefs;
    const direct = parsed.direct || {};
    let directName = direct.doctor_name || null;
    let directSpecs = Array.isArray(direct.specialties) ? direct.specialties : null;

    // Heuristic fallbacks
    const heur = extractHeuristicPrefs(latestUser);
    gender = gender || heur.gender;
    price = price || heur.pricePref;
    const expMin = (typeof min_experience_years === 'number' ? min_experience_years : null) || heur.expMin || null;
    const wantBest = (typeof want_best === 'boolean' ? want_best : null) || heur.wantBest || null;

    // Explicit doctor/specialty detection from user text (server-side)
    if (!directName) {
      const n = guessDoctorNameFromText(latestUser);
      if (n) directName = n;
    }
    if (!directSpecs || directSpecs.length === 0) {
      const mentioned = await findMentionedSpecialtiesInText(latestUser);
      if (mentioned.length) directSpecs = mentioned;
    }

    // Force show if user asked
    if (forceShow && intent !== 'refuse') {
      intent = 'show_doctors';
      if (!specialties || specialties.length === 0) specialties = fallbackSpecialtiesFromText(convo);
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = "Here are doctors that match what you described.";
      }
    }

    // If user done but not asked yet → suggest
    if (!forceShow && doneFeeling && intent !== 'refuse' && intent !== 'show_doctors') {
      assistant_message = "Understood. Would you like me to show doctors that fit your needs?";
      intent = 'chat';
    }

    let doctors = [];

    // 1) Direct NAME takes priority
    if (directName) {
      intent = 'show_doctors';
      doctors = await queryDoctorsByName({
        name: directName, gender, pricePref: price, expMin, wantBest
      });

      // If name found and user ALSO provided a specialty explicitly, narrow to those specialties (still return ALL matches)
      if (doctors.length && directSpecs && directSpecs.length) {
        const set = new Set(directSpecs.map(s => s.toLowerCase()));
        doctors = doctors.filter(d => set.has((d.speciality || '').toLowerCase()));
      }

      // If still empty, but they named a specialty, show that specialty
      if (doctors.length === 0 && directSpecs && directSpecs.length) {
        doctors = await queryDoctorsBySpecialties({ specialties: directSpecs, gender, pricePref: price, expMin, wantBest });
      }

      // If still empty → closest specialty from convo (or General physician)
      if (doctors.length === 0) {
        const closeSpecs = fallbackSpecialtiesFromText(convo);
        doctors = await queryDoctorsBySpecialties({ specialties: closeSpecs, gender, pricePref: price, expMin, wantBest });
      }

      // Message for direct name ask
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are the matching doctors."
          : "I didn’t find that exact doctor. Here are close matches.";
      }
    }

    // 2) Direct SPECIALTY (without name) → show all in that specialty
    if (!directName && (!doctors.length) && directSpecs && directSpecs.length) {
      intent = 'show_doctors';
      doctors = await queryDoctorsBySpecialties({ specialties: directSpecs, gender, pricePref: price, expMin, wantBest });

      if (doctors.length === 0) {
        // closest / general fallback
        const closeSpecs = Array.from(new Set([...directSpecs, ...fallbackSpecialtiesFromText(convo)]));
        doctors = await queryDoctorsBySpecialties({ specialties: closeSpecs, gender, pricePref: price, expMin, wantBest });
      }

      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are doctors for that specialty."
          : "I couldn’t find that specialty here. Showing close options.";
      }
    }

    // 3) If we still don't have doctors but intent=show_doctors from LLM or forced
    if (!doctors.length && intent === 'show_doctors') {
      if (!specialties || specialties.length === 0) specialties = fallbackSpecialtiesFromText(convo);
      doctors = await queryDoctorsBySpecialties({ specialties, gender, pricePref: price, expMin, wantBest });
      if (doctors.length === 0 && !specialties.includes('General physician')) {
        doctors = await queryDoctorsBySpecialties({
          specialties: [...specialties, 'General physician'],
          gender, pricePref: price, expMin, wantBest
        });
      }
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are doctors that match what you described."
          : "I can pull the right specialists. Is the issue mainly joint-related or something else?";
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
