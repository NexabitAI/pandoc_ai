// routes/aiChat.js
import express from 'express';
import 'dotenv/config.js';
import OpenAI from 'openai';
import doctorModel from '../models/doctorModel.js';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// helper: fetch available doctors by specialties (case-insensitive)
async function getDoctorsBySpecialties(specialties, limitPerSpec = 6) {
  if (!Array.isArray(specialties) || specialties.length === 0) return [];
  const ors = specialties.map(s => ({ speciality: { $regex: new RegExp(`^${s}$`, 'i') } }));
  const docs = await doctorModel
    .find({ available: true, $or: ors })
    .select('_id name speciality fees experience degree image address')
    .limit(limitPerSpec * specialties.length)
    .lean();
  // keep reasonable max
  return docs.slice(0, 24);
}

const SYSTEM_PROMPT = `
You are "Pandoc Health Assistant", a virtual intake assistant for an HMS called Pandoc.
STRICT RULES:
- Topics limited to health/medical well-being or Pandoc HMS usage. For any other topic, politely refuse and offer to help with health or the Pandoc platform instead.
- Show empathy and professionalism. Ask concise, targeted follow-up questions to clarify symptoms (onset, severity, key negatives/positives).
- DO NOT diagnose. DO NOT prescribe or suggest medications or dosage. DO NOT provide treatment plans.
- If the user expresses intent to find a doctor or asks "who should I see", map symptoms to appropriate medical specialties.
- When you intend to present doctors, DO NOT recommend one specific person. Provide a list of relevant specialties only.
- Never include external links outside the Pandoc site.
- Keep messages short and readable.

OUTPUT FORMAT (MUST be valid JSON):
{
  "assistant_message": "string",
  "intent": "refuse" | "chat" | "request_more_info" | "show_doctors",
  "symptom_summary": "string|null",
  "specialties": string[] // OPTIONAL; include when intent is "show_doctors"
}
`;

router.post('/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body;

    // 1) Ask OpenAI for structured guidance
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // pass through prior conversation turns (role, content)
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
      response_format: { type: 'json_object' },
    });

    let parsed = null;
    try {
      parsed = JSON.parse(completion.choices?.[0]?.message?.content || '{}');
    } catch {
      parsed = { assistant_message: "I'm sorry, I had trouble processing that. Could you rephrase?", intent: 'chat' };
    }

    const { assistant_message, intent, specialties = [] } = parsed;

    // 2) If we should show doctors, query DB
    let doctors = [];
    if (intent === 'show_doctors' && specialties.length) {
      doctors = await getDoctorsBySpecialties(specialties);
    }

    return res.json({
      success: true,
      reply: assistant_message || "How can I help you with your health today?",
      intent: intent || 'chat',
      doctors,
    });
  } catch (e) {
    console.error('[ai/chat] error:', e);
    return res.status(500).json({ success: false, message: 'AI service error' });
  }
});

export default router;
