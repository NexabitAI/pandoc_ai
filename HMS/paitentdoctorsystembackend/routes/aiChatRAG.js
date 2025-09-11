// routes/aiChatRAG.js
import express from 'express';
import 'dotenv/config';
import { openai } from '../utils/openaiClient.js';
import doctorModel from '../models/doctorModel.js';
import Specialty from '../models/Specialty.js';
import { getCtx, saveCtx, clearCtx } from '../utils/ctxStore.js';
import { retrieveCards } from '../utils/ragRetriever.js';
import { coerceIntent } from '../utils/intentSchema.js';
import { ensureIndex } from '../utils/redisVec.js';
import { SYSTEM_CORE, TOOL_INSTRUCTION } from '../utils/prompts.js';

const router = express.Router();

const norm = s => String(s || '').toLowerCase().trim();
const stripYears = s => {
  const n = parseInt(String(s||'').replace(/[^\d]/g,''),10);
  return Number.isFinite(n) ? n : 0;
};
const exactSpecRX = s => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'i');

// doctor query (same core as before, improved sorting)
async function queryDoctors({ specialties, gender, price, expMin, wantBest, page, pageSize }) {
  const or = (specialties && specialties.length)
    ? specialties.map(s => ({ speciality: { $regex: exactSpecRX(s) } }))
    : [{ speciality: { $regex: /Emergency Medicine/i } }];
  const q = { available: true, $or: or };
  if (gender) q.gender = new RegExp(`^${gender}$`,'i');

  let docs = await doctorModel.find(q).select('_id name speciality fees experience degree image address gender').lean();
  if (expMin) docs = docs.filter(d => stripYears(d.experience) >= expMin);
  if (price && typeof price === 'object' && typeof price.cap === 'number') docs = docs.filter(d => Number(d.fees) <= price.cap);

  if (price === 'cheapest') docs.sort((a,b)=>a.fees-b.fees);
  else if (price === 'expensive') docs.sort((a,b)=>b.fees-a.fees);
  else if (wantBest) docs.sort((a,b)=> {
    const d = stripYears(b.experience)-stripYears(a.experience);
    return d!==0 ? d : (a.fees-b.fees);
  });
  else docs.sort((a,b)=>(a.name||'').localeCompare(b.name||''));

  const start = (page-1)*pageSize;
  return {
    results: docs.slice(start, start+pageSize),
    total: docs.length,
    page, pageSize
  };
}

const cardsFromDocs = (docs=[]) => docs.map(d => ({
  _id: d._id, name: d.name, speciality: d.speciality, gender: d.gender,
  experience: d.experience, fees: d.fees, degree: d.degree, image: d.image, address: d.address
}));

// optional: list specialties from DB so LLM can choose exactly
async function listSpecialtyNames() {
  const rows = await Specialty.find({ active: true }).select('name').lean();
  return rows.map(r => r.name);
}

// Health check + reset
router.get('/ai/health', (_req,res)=> res.json({ok:true}));
router.post('/ai/reset', async (req,res)=>{
  const { tenantId='default', userId='anon', chatId='local' } = req.body || {};
  await clearCtx(tenantId, userId, chatId);
  res.json({success:true});
});

// MAIN chat
router.post('/ai/chat', async (req,res)=>{
  const started = Date.now();
  try {
    await ensureIndex(); // idempotent
    const {
      tenantId=process.env.TENANT_ID || 'default',
      userId='anon',
      chatId='local',
      message=''
    } = req.body || {};

    const raw = String(message||'');
    const text = norm(raw);
    let ctx = await getCtx(tenantId, userId, chatId);
    ctx.messages = ctx.messages || [];
    ctx.filters = ctx.filters || {};
    ctx.pagination = ctx.pagination || { page:1, pageSize:6 };

    ctx.messages.push({ role:'user', content: raw });
    if (ctx.messages.length>60) ctx.messages.shift();

    // 1) RAG retrieve (short cards, K=5)
    const cards = await retrieveCards({ tenant: tenantId, userText: raw, k: 5 });

    // 2) Ask model for intent JSON
    const specialties = await listSpecialtyNames(); // help LLM stay on your taxonomy
    const toolPrompt = [
      { role:'system', content: SYSTEM_CORE },
      { role:'user', content: `Knowledge cards:\n${cards}\n\nUser: ${raw}\nAvailable specialties: ${specialties.join(', ')}\n\n${TOOL_INSTRUCTION}` }
    ];

    const model = process.env.AI_MODEL || 'gpt-4o-mini';
    const { choices } = await openai.chat.completions.create({
      model,
      messages: toolPrompt,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });
    const parsed = coerceIntent(choices?.[0]?.message?.content || '{}');

    // 3) Guard: abusive/out-of-scope/booking
    if (parsed.flags?.isRude) {
      const reply = "Let’s keep it respectful. I’m here to help with your health or the Pandoc HMS.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[], intent:'abusive_block' });
    }
    if (parsed.intent === 'out_of_scope') {
      const reply = "I can help with your health or the Pandoc HMS. Any health concern I can help with?";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[], intent:'nudge_back' });
    }
    if (parsed.flags?.wantsBooking) {
      const reply = "Sorry, I can’t do that; you have to do it yourself. You can open a doctor’s profile and book from there.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[], intent:'booking_refusal' });
    }

    // 4) Conversation policies
    if (parsed.intent === 'greeting') {
      const reply = "Hi — tell me what’s going on and I’ll point you to the right doctor.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[] });
    }
    if (parsed.intent === 'how_are_you') {
      const reply = "I’m doing well and here to help with your health.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[] });
    }

    // Name lookup
    if (parsed.intent === 'name_lookup' && parsed.entities?.name) {
      const rx = new RegExp(parsed.entities.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
      let q = { available: true, name: rx };
      if (parsed.filters?.gender) q.gender = new RegExp(`^${parsed.filters.gender}$`,'i');
      let docs = await doctorModel.find(q).select('_id name speciality fees experience degree image address gender').lean();
      if (!docs.length) {
        // closest match by contains
        const rx2 = new RegExp(parsed.entities.name.split(/\s+/).join('.*'), 'i');
        q = { available:true, name: rx2 };
        if (parsed.filters?.gender) q.gender = new RegExp(`^${parsed.filters.gender}$`,'i');
        docs = await doctorModel.find(q).select('_id name speciality fees experience degree image address gender').lean();
      }
      ctx.lastList = docs.slice(0, ctx.pagination.pageSize);
      ctx.lastSpecialty = docs[0]?.speciality || ctx.lastSpecialty;
      ctx.pagination.page = 1;
      ctx.filters = { ...ctx.filters, ...(parsed.filters||{}) };
      const reply = docs.length ? "Here are the matching doctors." : "I didn’t find that exact doctor—here are close matches.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({success:true, reply, doctors: cardsFromDocs(ctx.lastList)});
    }

    // Show doctors immediately on direct ask/confirmation
    if (parsed.intent === 'show_doctors' || parsed.flags?.isConfirmation) {
      const baseSpecs =
        (parsed.entities?.explicitSpecs?.length ? parsed.entities.explicitSpecs :
         parsed.specialty ? [parsed.specialty] :
         ctx.lastSpecialty ? [ctx.lastSpecialty] :
         parsed.entities?.inferredSpecs?.length ? parsed.entities.inferredSpecs.slice(0,2) : ['Emergency Medicine']);

      const filters = { ...ctx.filters, ...(parsed.filters||{}) };
      const { results } = await queryDoctors({
        specialties: baseSpecs, gender: filters.gender, price: filters.price,
        expMin: filters.expMin, wantBest: !!filters.wantBest,
        page: 1, pageSize: ctx.pagination.pageSize
      });

      ctx.lastSpecialty = baseSpecs[0] || ctx.lastSpecialty;
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.filters = filters;
      ctx.lastOfferWasShowDoctors = false;
      const reply = results.length ? "Here are doctors that match what you described." : "No matching doctors right now.";
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors: cardsFromDocs(results) });
    }

    // Explicit specialty
    if (parsed.intent === 'specialty_explicit' && (parsed.specialty || parsed.entities?.explicitSpecs?.length)) {
      const specs = parsed.entities?.explicitSpecs?.length ? parsed.entities.explicitSpecs.slice(0,2) : [parsed.specialty];
      const filters = { ...ctx.filters, ...(parsed.filters||{}) };
      const { results } = await queryDoctors({
        specialties: specs, gender: filters.gender, price: filters.price,
        expMin: filters.expMin, wantBest: !!filters.wantBest,
        page: 1, pageSize: ctx.pagination.pageSize
      });
      ctx.lastSpecialty = specs[0];
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.filters = filters;
      ctx.lastOfferWasShowDoctors = false;
      const reply = results.length ? "Here are doctors for that specialty." : "No matching doctors right now.";
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors: cardsFromDocs(results) });
    }

    // Refine (gender/price/experience) — only if we have context or spec inferred
    if (parsed.intent === 'refine' && (ctx.lastSpecialty || ctx.lastList?.length)) {
      const filters = { ...ctx.filters, ...(parsed.filters||{}) };
      const baseSpecs = ctx.lastSpecialty ? [ctx.lastSpecialty] :
        (ctx.lastList?.[0]?.speciality ? [ctx.lastList[0].speciality] : (parsed.entities?.inferredSpecs||['Emergency Medicine']));
      const { results } = await queryDoctors({
        specialties: baseSpecs, gender: filters.gender, price: filters.price,
        expMin: filters.expMin, wantBest: !!filters.wantBest,
        page: 1, pageSize: ctx.pagination.pageSize
      });
      ctx.filters = filters;
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;
      const reply = results.length ? "Updated list." : "No matching doctors with those filters.";
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors: cardsFromDocs(results) });
    }

    // Compare within last list
    if (parsed.intent === 'compare' && ctx.lastList?.length) {
      let reply = '';
      if (parsed.flags?.askCheapest) {
        const c = [...ctx.lastList].sort((a,b)=>a.fees-b.fees)[0];
        reply = c ? `Cheapest: ${c.name} ($${c.fees}).` : "No doctors to compare.";
      } else if (parsed.flags?.askExpensive) {
        const m = [...ctx.lastList].sort((a,b)=>b.fees-a.fees)[0];
        reply = m ? `Most expensive: ${m.name} ($${m.fees}).` : "No doctors to compare.";
      } else if (parsed.flags?.askMostExperienced) {
        const e = [...ctx.lastList].sort((a,b)=>stripYears(b.experience)-stripYears(a.experience))[0];
        reply = e ? `Most experienced: ${e.name} (${e.experience}).` : "No doctors to compare.";
      } else {
        reply = "Tell me what to compare: cheapest, most experienced, or most expensive.";
      }
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[] });
    }

    // Symptoms → short empathy + offer to show
    if (parsed.intent === 'symptoms') {
      if (parsed.specialty) ctx.lastSpecialty = parsed.specialty;
      const tips = (parsed.entities?.safeTips||[]).join(' ');
      const reply = tips
        ? `${tips} Want me to show suitable doctors here?`
        : `I’m sorry you’re feeling unwell. Want me to show suitable doctors here?`;
      ctx.lastOfferWasShowDoctors = true;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[] });
    }

    // Paginate
    if (parsed.intent === 'paginate' && ctx.lastSpecialty) {
      ctx.pagination.page += 1;
      const { results } = await queryDoctors({
        specialties: [ctx.lastSpecialty], gender: ctx.filters.gender, price: ctx.filters.price,
        expMin: ctx.filters.expMin, wantBest: !!ctx.filters.wantBest,
        page: ctx.pagination.page, pageSize: ctx.pagination.pageSize
      });
      ctx.lastList = ctx.lastList.concat(results);
      const reply = results.length ? "Here are more options." : "No more results.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors: cardsFromDocs(results) });
    }

    // HMS help
    if (parsed.intent === 'hms_help') {
      const reply = "In Pandoc: Appointments → select your visit → reschedule/cancel, or upload reports from the Records tab.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, doctors:[] });
    }

    // Unknown → nudge
    const reply = `I didn’t catch that—could you rephrase, or say “show doctors”?`;
    ctx.lastOfferWasShowDoctors = false;
    ctx.messages.push({ role:'assistant', content: reply });
    await saveCtx(tenantId, userId, chatId, ctx);
    return res.json({ success:true, reply, doctors:[] });

  } catch (e) {
    console.error('[ai/chat] error', e);
    return res.status(500).json({ success:false, message:'AI service error' });
  } finally {
    // lightweight timing already exists in your logs
  }
});

export default router;
