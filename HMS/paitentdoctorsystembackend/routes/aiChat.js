// routes/aiChat.js
import express from 'express';
import 'dotenv/config.js';
import OpenAI from 'openai';
import doctorModel from '../models/doctorModel.js';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- helpers ---
function lastUserWantsDoctors(latestUserText = '') {
  const t = (latestUserText || '').toLowerCase();
  return /\b(doctor|give me (a|the) doctor|find (a|the) doctor|see (a|the) doctor|book|appointment|who should i see|show doctors)\b/.test(t);
}

function conversationText(messages = []) {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
}

// Simple fallback mapping from symptoms to specialties
function fallbackSpecialtiesFromText(text = '') {
  const t = text.toLowerCase();
  const picks = new Set();

  // trauma / musculoskeletal
  if (/(fall|accident|injur|fractur|sprain|bruise|swollen|swelling|limited movement|joint|knee|ankle|wrist|shoulder)/.test(t)) {
    picks.add('Orthopedic Surgery'); picks.add('Sports Medicine'); picks.add('Emergency Medicine');
  }
  // bleeding / cuts / wounds
  if (/(bleed|laceration|cut|wound|gash)/.test(t)) {
    picks.add('Emergency Medicine'); picks.add('Wound Care'); picks.add('General Surgery');
  }
  // neuro red flags
  if (/(faint|blackout|seiz|weakness|numb|tingl|head injur|headache after fall)/.test(t)) {
    picks.add('Emergency Medicine'); picks.add('Neurologist');
  }
  // default if nothing hit but they asked for a doctor
  if (picks.size === 0) picks.add('Emergency Medicine');
  return Array.from(picks);
}

async function getDoctorsBySpecialties(specialties, limitPerSpec = 6) {
  if (!Array.isArray(specialties) || specialties.length === 0) return [];
  const ors = specialties.map(s => ({ speciality: { $regex: new RegExp(`^${s}$`, 'i') } }));
  const docs = await doctorModel
    .find({ available: true, $or: ors })
    .select('_id name speciality fees experience degree image address')
    .limit(limitPerSpec * specialties.length)
    .lean();
  return docs.slice(0, 24);
}

const SYSTEM_PROMPT = `
You are "Pandoc Health Assistant", a virtual intake assistant for Pandoc HMS.

SCOPE:
- Only discuss health/wellness or the Pandoc platform. If outside scope, politely refuse and steer back.
- Never diagnose, prescribe, or give medication recommendations or dosages. No treatment plans.
- No external links. Only internal Pandoc profile links returned by the server.

STYLE:
- Be empathetic but concise: 1–2 short sentences max per reply.
- Avoid repeating questions. Use the entire chat history to infer symptoms already mentioned.
- Ask at most ONE focused follow-up ONLY if needed to pick an appropriate specialty.

INTENT LOGIC (YOU MUST OUTPUT JSON AS DESCRIBED BELOW):
- If user asks directly to see a doctor or book, set "intent":"show_doctors" and infer 1–3 likely specialties based on context.
- If the topic is not health/Pandoc, set "intent":"refuse".
- Otherwise:
  - If you need a key detail to map to a specialty, set "intent":"request_more_info" and ask ONE focused question.
  - Else set "intent":"chat".

OUTPUT (valid JSON):
{
  "assistant_message": "string",
  "intent": "refuse" | "chat" | "request_more_info" | "show_doctors",
  "symptom_summary": "string|null",
  "specialties": string[] // include only when intent is "show_doctors"
}
Keep assistant_message <= 220 characters.
`;

// --- route ---
router.post('/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;
    const latestUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const forceShow = lastUserWantsDoctors(latestUser);
    const convoText = conversationText(messages);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
      response_format: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    } catch {
      parsed = { assistant_message: "Sorry, I couldn't process that. Can you rephrase?", intent: 'chat' };
    }

    let { assistant_message, intent, specialties } = parsed;
    if (!assistant_message) assistant_message = "How can I help you with your health today?";
    if (!intent) intent = 'chat';

    // If user asked for a doctor explicitly, force the switch.
    if (forceShow && intent !== 'refuse') {
      intent = 'show_doctors';
      // prefer LLM specialties, else fallback from conversation text
      if (!Array.isArray(specialties) || specialties.length === 0) {
        specialties = fallbackSpecialtiesFromText(convoText);
      }
      if (!assistant_message || assistant_message.toLowerCase().includes('describe')) {
        assistant_message = "Here are some doctors who may be suitable based on what you shared.";
      }
    }

    let doctors = [];
    if (intent === 'show_doctors') {
      // ensure we have specialties (LLM or fallback)
      if (!Array.isArray(specialties) || specialties.length === 0) {
        specialties = fallbackSpecialtiesFromText(convoText);
      }
      doctors = await getDoctorsBySpecialties(specialties);
      // If still nothing, soften with a short ask instead of looping
      if (doctors.length === 0) {
        intent = 'request_more_info';
        assistant_message = "I can help find the right specialist. Is the pain focused in a joint or is it widespread?";
      }
    }

    return res.json({
      success: true,
      reply: assistant_message,
      intent,
      doctors,
    });
  } catch (e) {
    console.error('[ai/chat] error:', e);
    return res.status(500).json({ success: false, message: 'AI service error' });
  }
});

export default router;
