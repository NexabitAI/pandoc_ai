import express from 'express';
import 'dotenv/config.js';
import OpenAI from 'openai';
import doctorModel from '../models/doctorModel.js';
import Specialty from '../models/Specialty.js';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STRIP_YEARS = (s='') => {
  const n = parseInt(String(s).match(/\d+/)?.[0] || '0', 10);
  return isNaN(n) ? 0 : n;
};

function conversationText(messages=[]) {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

/** EXPANDED: treat many “show/give/send … doctor(s)” phrasings, incl. adjectives. */
function lastUserWantsDoctors(txt = '') {
  const t = String(txt).toLowerCase().replace(/\s+/g, ' ').trim();

  const patterns = [
    /\b(show|give|send|provide|list|share|find|get|book)\s+(me\s+)?((a|the)\s+)?(suitable|relevant|nearby|any)?\s*doctor(s)?\b/,
    /\bdoctor(s)?\s*(please|now)\b/,
    /\bany doctor(s)?\b/,
    /\bshow doctor(s)?\b/,
    /\bshow doctors\b/,
    /\bshow me\b/,
    /\bjust show (me )?((a|the)\s+)?(suitable|relevant|nearby|any)?\s*doctor(s)?\b/,
    /\bgive me (suitable|relevant|nearby|any)?\s*doctor(s)?\b/,
    /\bdoctor(s)?\s+for\b/
  ];

  const yesWithDoctors = /\b(yes|yeah|yep|ok|okay|sure|please)\b.*\bdoctor(s)?\b/.test(t);

  return yesWithDoctors || patterns.some(rx => rx.test(t));
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

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildNameRegex(name='') {
  const cleaned = String(name).replace(/dr\.?|doctor/ig, ' ').replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const pattern = tokens.map(t => `${escapeRegex(t)}`).join('\\s+');
  return new RegExp(`(^|\\b)${pattern}(\\b|$)`, 'i');
}

function guessDoctorNameFromText(txt='') {
  const m1 = txt.match(/(?:\bdr\.?\b|\bdoctor\b)\s+([a-z][a-z]+(?:\s+[a-z][a-z]+){0,2})/i);
  if (m1) return m1[1];
  const m2 = txt.match(/"([a-z][a-z]+(?:\s+[a-z][a-z]+){0,2})"/i);
  if (m2) return m2[1];
  const m3 = txt.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
  if (m3 && /\b(dr|doctor|please|want|need|see)\b/i.test(txt)) return m3[1];
  return null;
}

async function findMentionedSpecialtiesInText(txt='') {
  const t = txt.toLowerCase();
  const specs = await Specialty.find({ active: true }).select('name').lean();
  const found = new Set();
  for (const s of specs) {
    const name = (s.name || '').toLowerCase();
    if (name && t.includes(name)) found.add(s.name);
  }
  if (/\bdermatolog(y|ist)|skin\b/i.test(txt)) found.add('Dermatologist');
  if (/\bcardiolog(y|ist)|chest pain|heart\b/i.test(txt)) found.add('Cardiology');
  if (/\bneurolog(y|ist)|nerv|seiz|stroke|head injur(y)?|headache\b/i.test(txt)) found.add('Neurologist');
  if (/\bpsych|anxiety|depress|mental\b/i.test(txt)) found.add('Psychiatry');
  if (/\bent\b|\bear|nose|throat\b/i.test(txt)) found.add('Otolaryngology (ENT)');
  if (/\bophthal|eye\b/i.test(txt)) found.add('Ophthalmology');
  if (/\buro|urine|prostate\b/i.test(txt)) found.add('Urology');
  if (/\bgastro|stomach|abdomen|acid\b/i.test(txt)) found.add('Gastroenterologist');
  if (/\bobgyn|gyne|pregnan|pelvic|period\b/i.test(txt)) found.add('Gynecologist');
  if (/\bpedia|child|kid\b/i.test(txt)) found.add('Pediatricians');
  if (/\bendocrin|thyroid|diabet\b/i.test(txt)) found.add('Endocrinology, Diabetes & Metabolism');
  if (/\bbone(s)?\b|orthopedic|orthopaedic/i.test(txt)) found.add('Orthopedic Surgery');
  return Array.from(found);
}

/** Use latest user text first; if empty, look at whole convo; if still empty, apply coarse safety fallbacks. */
function deriveSpecialties(latestUser = '', convo = '') {
  const t = latestUser.toLowerCase();
  const C = convo.toLowerCase();
  const picks = new Set();

  // Focused heuristics from the **latest** user message
  if (/(fall|accident|injur|fractur|sprain|bruise|swollen|swelling|limited movement|joint|knee|ankle|wrist|shoulder)/.test(t)) {
    picks.add('Orthopedic Surgery'); picks.add('Sports Medicine'); picks.add('Emergency Medicine');
  }
  if (/(bleed|laceration|cut|wound|gash)/.test(t)) {
    picks.add('Emergency Medicine'); picks.add('Wound Care'); picks.add('General Surgery');
  }
  if (/\b(pregnan|period|gyne|obgyn|pelvic|uter(us|ine)|ovary|vagin|cervix)\b/.test(t)) {
    picks.add('Gynecologist');
  }
  if (/\bskin|rash|acne|eczema|itch|psoriasis|hives|dermat(o|ology|ologist)\b/.test(t)) {
    picks.add('Dermatologist');
  }
  if (/\bheart|cardio|chest pain|palpitation\b/.test(t)) {
    picks.add('Cardiology');
  }
  if (/\bheadache|migraine|seiz|stroke|weakness|numb|tingl|neuro\b/.test(t)) {
    picks.add('Neurologist');
  }
  if (/\b(stomach|abdomen|belly|gastro|reflux|gerd|ulcer|diarrhea|constipation|vomit|nausea)\b/.test(t)) {
    picks.add('Gastroenterologist');
  }
  if (/\b(kidney|renal|uti|urinary|prostate|urolog)\b/.test(t)) {
    picks.add('Urology');
  }
  if (/\bthyroid|hormone|diabet|endocrin\b/.test(t)) {
    picks.add('Endocrinology, Diabetes & Metabolism');
  }
  if (/\b(pediatr|child|kid|toddler|infant)\b/.test(t)) {
    picks.add('Pediatricians');
  }
  if (/\b(ent|ear|nose|throat|sinus|tonsil|adenoid)\b/.test(t)) {
    picks.add('Otolaryngology (ENT)');
  }
  if (/\beye|vision|red eye|ophthal\b/.test(t)) {
    picks.add('Ophthalmology');
  }
  if (/\bpsychiat|depress|anxiety|panic|bipolar|schizo|adhd|ptsd\b/.test(t)) {
    picks.add('Psychiatry');
  }

  // If still empty, examine whole conversation
  if (picks.size === 0) {
    if (/(fall|accident|injur|fractur|sprain|bruise|swollen|swelling|limited movement|joint|knee|ankle|wrist|shoulder)/.test(C)) {
      picks.add('Orthopedic Surgery'); picks.add('Sports Medicine'); picks.add('Emergency Medicine');
    } else if (/(bleed|laceration|cut|wound|gash)/.test(C)) {
      picks.add('Emergency Medicine'); picks.add('Wound Care'); picks.add('General Surgery');
    }
  }

  // FINAL guard: if still nothing, prefer ER (safer than dumping “all doctors”).
  if (picks.size === 0) picks.add('Emergency Medicine');

  // return max 3 specialties
  return Array.from(picks).slice(0, 3);
}

async function queryDoctorsBySpecialties({ specialties, gender, pricePref, expMin, wantBest }) {
  // If nothing came in, enforce ER-only fallback (NEVER all doctors).
  if (!Array.isArray(specialties) || specialties.length === 0) {
    specialties = ['Emergency Medicine'];
  }

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

  return docs;
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

  // Loose contains fallback for "closest one"
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

const SYSTEM_PROMPT = `
You are "Pandoc Health Assistant" for the Pandoc HMS.

SCOPE
- Health/wellness or Pandoc platform only.
- If the question is clearly outside scope, **politely explain the scope and ask one short related question** (e.g., “Any health issue I can help with?”). Do not hard-refuse without a gentle redirect.
- No diagnosis, meds, dosages, or treatment plans. No external links.

STYLE
- Empathetic and concise: <= 2 short sentences (<= 220 chars).
- Answer small-talk briefly ("I'm doing well and here to help with your health.").
- Use full history; don't repeat prior questions. Ask at most ONE focused follow-up only if truly needed.
- Do not use filler like “please hold on”, “one moment”, or similar.
- Never say you can't recall previous messages; you do have the chat context.

INTENT & PREFERENCES
- If user explicitly asks to see doctors or books, set "intent":"show_doctors".
- If user names a doctor or a specialty explicitly, prefer that target.
- Infer gender ("male"|"female"|null), price ("cheapest"|"expensive"|null), min experience years (number|null), and specialties (1–3 strings).
- If requested specialty doesn’t exist or is unclear, choose the closest reasonable specialties (e.g., orthopedic/sports/emergency for trauma). If nothing fits, prefer "Emergency Medicine".
- Do NOT say "I can help refine the list".
- After urgent-sounding caution (e.g., “consider ER/urgent care”), **offer** “Want me to show suitable doctors here?” — **do not** show links unless the user asks.

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

router.post('/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;
    const latestUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    let forceShow = lastUserWantsDoctors(latestUser);
    const doneFeeling = userSeemsDone(latestUser);
    const convo = conversationText(messages);

    // If previous assistant offered to show docs, “yes/ok/please” counts as forceShow.
    const prevAssistant = [...messages].reverse().find(m => m.role === 'assistant')?.content || '';
    const userSaidYes = /\b(yes|yeah|yep|sure|ok|okay|please)\b/i.test(latestUser);
    const prevOffered = /show (relevant|suitable) doctors/i.test(prevAssistant);
    if (!forceShow && userSaidYes && prevOffered) {
      forceShow = true;
    }

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

    // Heuristics
    const heur = extractHeuristicPrefs(latestUser);
    gender = gender || heur.gender;
    const expMin = (typeof min_experience_years === 'number' ? min_experience_years : null) || heur.expMin || null;
    const wantBest = (typeof want_best === 'boolean' ? want_best : null) || heur.wantBest || null;
    const pricePref = price || heur.pricePref || null;

    if (!directName) {
      const n = guessDoctorNameFromText(latestUser);
      if (n) directName = n;
    }
    if (!directSpecs || directSpecs.length === 0) {
      const mentioned = await findMentionedSpecialtiesInText(latestUser);
      if (mentioned.length) directSpecs = mentioned;
    }

    // If the assistant is asking a question, don't show doctors — unless user clearly asked to see doctors.
    const askingNow =
      /\?\s*$/.test((assistant_message || '').trim()) ||
      /specif(y|ic)/i.test(assistant_message || '');
    if (askingNow && !forceShow) {
      return res.json({
        success: true,
        reply: assistant_message,
        intent: 'request_more_info',
        doctors: []
      });
    }

    // Don’t auto-show unless explicitly asked or direct target given
    const explicitAskOrDirect = forceShow || !!directName || (directSpecs && directSpecs.length > 0);
    if (intent === 'show_doctors' && !explicitAskOrDirect) {
      intent = 'chat';
      if (!/show (relevant|suitable) doctors/i.test(assistant_message)) {
        assistant_message = `${assistant_message} Want me to show suitable doctors here?`;
      }
    }

    // If user asked explicitly, ensure we show
    if (forceShow && intent !== 'refuse') {
      intent = 'show_doctors';
      if (!specialties || specialties.length === 0) {
        const fb = deriveSpecialties(latestUser, convo);
        const mentioned = await findMentionedSpecialtiesInText(convo);
        specialties = (fb && fb.length) ? fb : (mentioned && mentioned.length ? mentioned.slice(0,3) : ['Emergency Medicine']);
      }
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = "Here are doctors that match what you described.";
      }
    }

    if (!forceShow && doneFeeling && intent !== 'refuse' && intent !== 'show_doctors') {
      assistant_message = "Understood. Would you like me to show doctors that fit your needs?";
      intent = 'chat';
    }

    let doctors = [];

    // 1) Direct name
    if (directName) {
      intent = 'show_doctors';
      doctors = await queryDoctorsByName({ name: directName, gender, pricePref, expMin, wantBest });
      if (doctors.length === 0 && directSpecs && directSpecs.length) {
        doctors = await queryDoctorsBySpecialties({ specialties: directSpecs, gender, pricePref, expMin, wantBest });
      }
      if (doctors.length === 0) {
        const closeSpecs = deriveSpecialties(latestUser, convo);
        doctors = await queryDoctorsBySpecialties({ specialties: closeSpecs, gender, pricePref, expMin, wantBest });
      }
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are the matching doctors."
          : "I didn’t find that exact doctor. Here are close matches.";
      }
    }

    // 2) Direct specialty
    if (!directName && !doctors.length && directSpecs && directSpecs.length) {
      intent = 'show_doctors';
      doctors = await queryDoctorsBySpecialties({ specialties: directSpecs, gender, pricePref, expMin, wantBest });
      if (doctors.length === 0) {
        const closeSpecs = Array.from(new Set([...directSpecs, ...deriveSpecialties(latestUser, convo)]));
        doctors = await queryDoctorsBySpecialties({ specialties: closeSpecs.slice(0,3), gender, pricePref, expMin, wantBest });
      }
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are doctors for that specialty."
          : "I couldn’t find that specialty here. Showing close options.";
      }
    }

    // 3) Normal show (explicit ask)
    if (!doctors.length && intent === 'show_doctors' && explicitAskOrDirect) {
      if (!specialties || specialties.length === 0) {
        const fb = deriveSpecialties(latestUser, convo);
        const mentioned = await findMentionedSpecialtiesInText(convo);
        specialties = (fb && fb.length) ? fb : (mentioned && mentioned.length ? mentioned.slice(0,3) : ['Emergency Medicine']);
      }
      doctors = await queryDoctorsBySpecialties({ specialties, gender, pricePref, expMin, wantBest });
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are doctors that match what you described."
          : "I can pull the right specialists. Is the issue mainly joint-related or something else?";
      }
    }

    // Final safety: if still no doctors, show recent available (rare edge)
    if (!doctors.length && intent === 'show_doctors') {
      doctors = await doctorModel
        .find({ available: true })
        .select('_id name speciality fees experience degree image address gender')
        .sort({ date: -1 })
        .limit(12)
        .lean();

      assistant_message = doctors.length
        ? "Here are available doctors."
        : "No doctors are available right now.";
    }

    return res.json({ success: true, reply: assistant_message, intent, doctors });
  } catch (e) {
    console.error('[ai/chat]', e);
    return res.status(500).json({ success: false, message: 'AI service error' });
  }
});

export default router;
