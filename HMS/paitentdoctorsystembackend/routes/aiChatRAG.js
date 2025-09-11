// routes/aiChatRAG.js
import express from 'express';
import 'dotenv/config';

import doctorModel from '../models/doctorModel.js';
import Specialty from '../models/Specialty.js';

import { getCtx, saveCtx, clearCtx } from '../utils/ctxStore.js';
import { retrieveCards } from '../utils/ragRetriever.js';
import { coerceIntent } from '../utils/intentSchema.js';
import { ensureIndex } from '../utils/redisVec.js';
import { SYSTEM_CORE, TOOL_INSTRUCTION } from '../utils/prompts.js';
import { llmJSON } from '../utils/openaiClient.js';

const router = express.Router();

// ---------- helpers ----------
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const stripYears = (s) => {
  const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};
const exactSpecRX = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}$`, 'i');

const cardsFromDocs = (docs = []) =>
  docs.map((d) => ({
    _id: d._id,
    name: d.name,
    speciality: d.speciality,
    gender: d.gender,
    experience: d.experience,
    fees: d.fees,
    degree: d.degree,
    image: d.image,
    address: d.address,
  }));

async function listSpecialtyNames() {
  const rows = await Specialty.find({ active: true }).select('name').lean();
  return rows.map((r) => r.name);
}

// Doctor query (same core as before, with consistent sorting)
async function queryDoctors({ specialties, gender, price, expMin, wantBest, page, pageSize }) {
  const or = (specialties && specialties.length)
    ? specialties.map((s) => ({ speciality: { $regex: exactSpecRX(s) } }))
    : [{ speciality: { $regex: /Emergency Medicine/i } }];

  const q = { available: true, $or: or };
  if (gender) q.gender = new RegExp(`^${gender}$`, 'i');

  let docs = await doctorModel
    .find(q)
    .select('_id name speciality fees experience degree image address gender')
    .lean();

  if (expMin) docs = docs.filter((d) => stripYears(d.experience) >= expMin);
  if (price && typeof price === 'object' && typeof price.cap === 'number') {
    docs = docs.filter((d) => Number(d.fees) <= price.cap);
  }

  if (price === 'cheapest') docs.sort((a, b) => a.fees - b.fees);
  else if (price === 'expensive') docs.sort((a, b) => b.fees - a.fees);
  else if (wantBest) {
    docs.sort((a, b) => {
      const d = stripYears(b.experience) - stripYears(a.experience);
      return d !== 0 ? d : a.fees - b.fees;
    });
  } else {
    docs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  const start = (page - 1) * pageSize;
  return {
    results: docs.slice(start, start + pageSize),
    total: docs.length,
    page,
    pageSize,
  };
}

// Heuristic fallback intent if LLM/RAG fails (keeps the bot helpful, not strict)
function heuristicIntent(text, specialties) {
  const t = norm(text);
  const out = {
    intent: 'unknown',
    filters: {},
    entities: {},
    flags: {},
  };

  if (!t) return out;

  // greetings & small talk
  if (/\b(hi|hello|hey|good (morning|evening|afternoon))\b/.test(t)) out.intent = 'greeting';
  if (/\b(how are you|how r u|how are ya)\b/.test(t)) out.intent = 'how_are_you';

  // show doctors keywords
  if (/\b(show|need|find|suggest|recommend).*(doctor|drs?)\b/.test(t) || /\b(doctor|drs?) please\b/.test(t)) {
    out.intent = 'show_doctors';
  }

  // simple confirms
  if (/\b(yes|yep|yeah|ok|okay|sure|please|do it|go ahead)\b/.test(t)) {
    out.flags.isConfirmation = true;
  }

  // pick a specialty if user mentions one
  const hit = specialties.find((s) => t.includes(s.toLowerCase()));
  if (hit) {
    out.intent = out.intent === 'unknown' ? 'specialty_explicit' : out.intent;
    out.entities.explicitSpecs = [hit];
    out.specialty = hit;
  } else if (/\b(heart|cardio)\b/.test(t)) {
    out.intent = 'specialty_explicit';
    out.entities.explicitSpecs = ['Cardiology'];
    out.specialty = 'Cardiology';
  } else if (/\b(skin|rash|derma)\b/.test(t)) {
    out.intent = 'specialty_explicit';
    out.entities.explicitSpecs = ['Dermatology'];
    out.specialty = 'Dermatology';
  } else if (/\b(knee|bone|fracture|sprain|orthopedic)\b/.test(t)) {
    out.intent = 'specialty_explicit';
    out.entities.explicitSpecs = ['Orthopedic Surgery'];
    out.specialty = 'Orthopedic Surgery';
  }

  // filters
  if (/\bfemale\b/.test(t)) out.filters.gender = 'female';
  if (/\bmale\b/.test(t)) out.filters.gender = 'male';
  if (/\bcheapest|under \d+|<=\s*\d+|budget\b/.test(t)) out.filters.price = 'cheapest';
  if (/\bmost experienced|experience(d)?\b/.test(t)) out.filters.wantBest = true;
  if (/\bunder\s+(\d{2,3})\b/.test(t)) {
    const cap = parseInt(t.match(/\bunder\s+(\d{2,3})\b/)[1], 10);
    if (Number.isFinite(cap)) out.filters.price = { cap };
  }

  // compare
  if (/\b(cheapest|most experienced|most expensive)\b/.test(t)) {
    out.intent = 'compare';
    if (/\bcheapest\b/.test(t)) out.flags.askCheapest = true;
    if (/\bmost expensive\b/.test(t)) out.flags.askExpensive = true;
    if (/\bmost experienced\b/.test(t)) out.flags.askMostExperienced = true;
  }

  // paginate
  if (/\b(more|next|show more|load more)\b/.test(t)) out.intent = 'paginate';

  // hms help
  if (/\b(pandoc|hms|reschedule|cancel|upload report)\b/.test(t)) out.intent = 'hms_help';

  // name lookup
  const nameMatch = t.match(/\bdr\.?\s+([a-z][a-z\s]+)$/i);
  if (nameMatch) {
    out.intent = 'name_lookup';
    out.entities.name = nameMatch[1].trim();
  }

  // symptoms
  if (/\b(i (fell|fall)|pain|swollen|bleeding|injury|fever|cough|rash|headache|dizzy)\b/.test(t)) {
    out.intent = out.intent === 'unknown' ? 'symptoms' : out.intent;
  }

  return out;
}

// ---------- routes ----------
router.get('/ai/health', (_req, res) => res.json({ ok: true }));

router.post('/ai/reset', async (req, res) => {
  const { tenantId = 'default', userId = 'anon', chatId = 'local' } = req.body || {};
  await clearCtx(tenantId, userId, chatId);
  res.json({ success: true });
});

router.post('/ai/chat', async (req, res) => {
  const started = Date.now();
  try {
    await ensureIndex(); // safe / idempotent

    const {
      tenantId = process.env.TENANT_ID || 'default',
      userId = 'anon',
      chatId = 'local',
      message = '',
    } = req.body || {};

    const raw = String(message || '');
    const text = norm(raw);

    // load ctx
    let ctx = await getCtx(tenantId, userId, chatId);
    ctx.messages = ctx.messages || [];
    ctx.filters = ctx.filters || {};
    ctx.pagination = ctx.pagination || { page: 1, pageSize: 6 };
    ctx.lastOfferWasShowDoctors = !!ctx.lastOfferWasShowDoctors;
    ctx.lastList = ctx.lastList || [];
    ctx.lastSpecialty = ctx.lastSpecialty || null;

    // record user turn
    ctx.messages.push({ role: 'user', content: raw });
    if (ctx.messages.length > 60) ctx.messages.shift();

    const specialties = await listSpecialtyNames();

    // If we just offered and the user says yes/ok, fast-path to show_doctors
    if (ctx.lastOfferWasShowDoctors && /\b(yes|yep|yeah|ok|okay|sure|please|do it|go ahead)\b/i.test(text)) {
      const baseSpecs = ctx.lastSpecialty ? [ctx.lastSpecialty] : ['Emergency Medicine'];
      const { results } = await queryDoctors({
        specialties: baseSpecs,
        gender: ctx.filters.gender,
        price: ctx.filters.price,
        expMin: ctx.filters.expMin,
        wantBest: !!ctx.filters.wantBest,
        page: 1,
        pageSize: ctx.pagination.pageSize,
      });
      const reply = results.length
        ? 'Here are doctors that match what you need.'
        : 'No matching doctors right now.';
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;

      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: cardsFromDocs(results) });
    }

    // 1) Retrieve short knowledge cards for RAG
    const cards = await retrieveCards({ tenant: tenantId, userText: raw, k: 5 });

    // 2) Ask model for JSON intent (with guardrails/tooling instruction)
    let parsed = {};
    try {
      const json = await llmJSON({
        system: SYSTEM_CORE,
        user:
          `Knowledge cards:\n${cards}\n\n` +
          `User: ${raw}\n` +
          `Available specialties: ${specialties.join(', ')}\n\n` +
          TOOL_INSTRUCTION,
      });
      parsed = coerceIntent(json);
    } catch (_) {
      // If OpenAI fails, we’ll fall back to heuristics next.
      parsed = {};
    }

    // 2b) If LLM didn’t give us a usable intent, fallback heuristics (less strict)
    if (!parsed || !parsed.intent || parsed.intent === 'unknown') {
      parsed = heuristicIntent(raw, specialties);
    }

    // 3) Safety & policy gates
    if (parsed.flags?.isRude) {
      const reply = "Let’s keep it respectful. I’m here to help with your health or the Pandoc HMS.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [], intent: 'abusive_block' });
    }

    if (parsed.intent === 'out_of_scope') {
      const reply = 'I can help with your health or the Pandoc HMS. Any health concern I can help with?';
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [], intent: 'nudge_back' });
    }

    if (parsed.flags?.wantsBooking) {
      const reply = "Sorry, I can’t do that; you have to do it yourself. You can open a doctor’s profile and book from there.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [], intent: 'booking_refusal' });
    }

    // 4) Conversation policies
    if (parsed.intent === 'greeting') {
      const reply = 'Hi — tell me what’s going on and I’ll point you to the right doctor.';
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [] });
    }

    if (parsed.intent === 'how_are_you') {
      const reply = 'I’m doing well and here to help with your health.';
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [] });
    }

    // 5) Name lookup
    if (parsed.intent === 'name_lookup' && parsed.entities?.name) {
      const esc = parsed.entities.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`(^|\\b)${esc}(\\b|$)`, 'i');
      let q = { available: true, name: rx };
      if (parsed.filters?.gender) q.gender = new RegExp(`^${parsed.filters.gender}$`, 'i');
      let docs = await doctorModel
        .find(q)
        .select('_id name speciality fees experience degree image address gender')
        .lean();

      if (!docs.length) {
        const rx2 = new RegExp(esc, 'i');
        q = { available: true, name: rx2 };
        if (parsed.filters?.gender) q.gender = new RegExp(`^${parsed.filters.gender}$`, 'i');
        docs = await doctorModel
          .find(q)
          .select('_id name speciality fees experience degree image address gender')
          .lean();
      }

      // refine price/exp if asked
      const f = parsed.filters || {};
      docs = docs.filter((d) => (f.expMin ? stripYears(d.experience) >= f.expMin : true));
      if (f.price && typeof f.price === 'object' && typeof f.price.cap === 'number') {
        docs = docs.filter((d) => Number(d.fees) <= f.price.cap);
      }
      if (f.price === 'cheapest') docs.sort((a, b) => a.fees - b.fees);
      if (f.price === 'expensive') docs.sort((a, b) => b.fees - a.fees);

      const reply = docs.length
        ? 'Here are the matching doctors.'
        : 'I didn’t find that exact doctor—here are close matches.';
      ctx.lastList = docs.slice(0, ctx.pagination.pageSize);
      ctx.lastSpecialty = docs[0]?.speciality || ctx.lastSpecialty;
      ctx.pagination.page = 1;
      ctx.filters = { ...ctx.filters, ...f };
      ctx.lastOfferWasShowDoctors = false;

      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: cardsFromDocs(ctx.lastList) });
    }

    // 6) Show doctors immediately on direct ask/confirmation
    if (parsed.intent === 'show_doctors' || parsed.flags?.isConfirmation) {
      const baseSpecs =
        (parsed.entities?.explicitSpecs?.length
          ? parsed.entities.explicitSpecs
          : parsed.specialty
          ? [parsed.specialty]
          : ctx.lastSpecialty
          ? [ctx.lastSpecialty]
          : parsed.entities?.inferredSpecs?.length
          ? parsed.entities.inferredSpecs.slice(0, 2)
          : ['Emergency Medicine']);

      const filters = { ...ctx.filters, ...(parsed.filters || {}) };
      const { results } = await queryDoctors({
        specialties: baseSpecs,
        gender: filters.gender,
        price: filters.price,
        expMin: filters.expMin,
        wantBest: !!filters.wantBest,
        page: 1,
        pageSize: ctx.pagination.pageSize,
      });

      ctx.lastSpecialty = baseSpecs[0] || ctx.lastSpecialty;
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.filters = filters;
      ctx.lastOfferWasShowDoctors = false;

      const reply = results.length
        ? 'Here are doctors that match what you described.'
        : 'No matching doctors right now.';
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: cardsFromDocs(results) });
    }

    // 7) Explicit specialty
    if (parsed.intent === 'specialty_explicit' && (parsed.specialty || parsed.entities?.explicitSpecs?.length)) {
      const specs = parsed.entities?.explicitSpecs?.length
        ? parsed.entities.explicitSpecs.slice(0, 2)
        : [parsed.specialty];

      const filters = { ...ctx.filters, ...(parsed.filters || {}) };
      const { results } = await queryDoctors({
        specialties: specs,
        gender: filters.gender,
        price: filters.price,
        expMin: filters.expMin,
        wantBest: !!filters.wantBest,
        page: 1,
        pageSize: ctx.pagination.pageSize,
      });

      ctx.lastSpecialty = specs[0];
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.filters = filters;
      ctx.lastOfferWasShowDoctors = false;

      const reply = results.length ? 'Here are doctors for that specialty.' : 'No matching doctors right now.';
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: cardsFromDocs(results) });
    }

    // 8) Refine (gender/price/experience)
    if (parsed.intent === 'refine' && (ctx.lastSpecialty || ctx.lastList?.length)) {
      const filters = { ...ctx.filters, ...(parsed.filters || {}) };
      const baseSpecs = ctx.lastSpecialty
        ? [ctx.lastSpecialty]
        : ctx.lastList?.[0]?.speciality
        ? [ctx.lastList[0].speciality]
        : parsed.entities?.inferredSpecs || ['Emergency Medicine'];

      const { results } = await queryDoctors({
        specialties: baseSpecs,
        gender: filters.gender,
        price: filters.price,
        expMin: filters.expMin,
        wantBest: !!filters.wantBest,
        page: 1,
        pageSize: ctx.pagination.pageSize,
      });

      ctx.filters = filters;
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;

      const reply = results.length ? 'Updated list.' : 'No matching doctors with those filters.';
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: cardsFromDocs(results) });
    }

    // 9) Compare within last list
    if (parsed.intent === 'compare' && ctx.lastList?.length) {
      let reply = '';
      if (parsed.flags?.askCheapest) {
        const c = [...ctx.lastList].sort((a, b) => a.fees - b.fees)[0];
        reply = c ? `Cheapest: ${c.name} ($${c.fees}).` : 'No doctors to compare.';
      } else if (parsed.flags?.askExpensive) {
        const m = [...ctx.lastList].sort((a, b) => b.fees - a.fees)[0];
        reply = m ? `Most expensive: ${m.name} ($${m.fees}).` : 'No doctors to compare.';
      } else if (parsed.flags?.askMostExperienced) {
        const e = [...ctx.lastList].sort((a, b) => stripYears(b.experience) - stripYears(a.experience))[0];
        reply = e ? `Most experienced: ${e.name} (${e.experience}).` : 'No doctors to compare.';
      } else {
        reply = 'Tell me what to compare: cheapest, most experienced, or most expensive.';
      }
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [] });
    }

    // 10) Symptoms → empathetic nudge to show
    if (parsed.intent === 'symptoms') {
      if (parsed.specialty) ctx.lastSpecialty = parsed.specialty;
      const tips = (parsed.entities?.safeTips || []).join(' ');
      const reply = tips
        ? `${tips} Want me to show suitable doctors here?`
        : `I’m sorry you’re feeling unwell. Want me to show suitable doctors here?`;
      ctx.lastOfferWasShowDoctors = true;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [] });
    }

    // 11) Paginate
    if (parsed.intent === 'paginate' && ctx.lastSpecialty) {
      ctx.pagination.page += 1;
      const { results } = await queryDoctors({
        specialties: [ctx.lastSpecialty],
        gender: ctx.filters.gender,
        price: ctx.filters.price,
        expMin: ctx.filters.expMin,
        wantBest: !!ctx.filters.wantBest,
        page: ctx.pagination.page,
        pageSize: ctx.pagination.pageSize,
      });
      ctx.lastList = ctx.lastList.concat(results);
      const reply = results.length ? 'Here are more options.' : 'No more results.';
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: cardsFromDocs(results) });
    }

    // 12) HMS help
    if (parsed.intent === 'hms_help') {
      const reply =
        'In Pandoc: Appointments → select your visit → reschedule/cancel, or upload reports from the Records tab.';
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role: 'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success: true, reply, doctors: [] });
    }

    // 13) Unknown → final nudge (still less strict)
    const reply = 'I didn’t catch that—could you rephrase, or say “show doctors”?';
    ctx.lastOfferWasShowDoctors = false;
    ctx.messages.push({ role: 'assistant', content: reply });
    await saveCtx(tenantId, userId, chatId, ctx);
    return res.json({ success: true, reply, doctors: [] });
  } catch (e) {
    console.error('[ai/chat] error', e);
    return res.status(500).json({ success: false, message: 'AI service error' });
  } finally {
    // lightweight timing is already logged elsewhere
  }
});

export default router;
