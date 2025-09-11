// routes/aiChat.js
import express from 'express';
import 'dotenv/config.js';
import OpenAI from 'openai';
import doctorModel from '../models/doctorModel.js';
import Specialty from '../models/Specialty.js';
import { getCtx, saveCtx } from '../utils/ctxStore.js';
import {
  parseTurn,
  summarizeEmpathetic,
  stripYears,
  escapeRx
} from '../utils/intentEngine.js';
import { logInfo, logWarn, logErr } from '../utils/logger.js';
import { mapTextToSpecialties } from '../utils/specMap.js';


const router = express.Router();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// --- helpers ---
const norm = (s='') => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

async function listSpecialtyNames() {
  const rows = await Specialty.find({ active: true }).select('name').lean();
  return rows.map(r => r.name);
}

async function queryDoctors({ specialties, gender, price, expMin, wantBest, page, pageSize }) {
  const or = (specialties && specialties.length)
    ? specialties.map(s => ({ speciality: { $regex: new RegExp(`^${escapeRx(s)}$`, 'i') } }))
    : [{ speciality: { $regex: /Emergency Medicine/i } }];

  const q = { available: true, $or: or };

  if (gender) q.gender = new RegExp(`^${gender}$`, 'i');

  let docs = await doctorModel
    .find(q)
    .select('_id name speciality fees experience degree image address gender')
    .lean();

  if (expMin) docs = docs.filter(d => stripYears(d.experience) >= expMin);
  if (price && typeof price === 'object' && typeof price.cap === 'number') {
    docs = docs.filter(d => Number(d.fees) <= price.cap);
  }

  if (price === 'cheapest') docs.sort((a,b)=>a.fees-b.fees);
  else if (price === 'expensive') docs.sort((a,b)=>b.fees-a.fees);
  else if (wantBest) {
    docs.sort((a,b)=>{
      const d = stripYears(b.experience)-stripYears(a.experience);
      return d!==0? d : (a.fees-b.fees);
    });
  } else {
    docs.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  }

  const start = (page-1)*pageSize;
  return {
    total: docs.length,
    page, pageSize,
    results: docs.slice(start, start+pageSize)
  };
}

function cardsFromDocs(docs=[]) {
  return docs.map(d => ({
    _id: d._id,
    name: d.name,
    speciality: d.speciality,
    gender: d.gender,
    experience: d.experience,
    fees: d.fees,
    degree: d.degree,
    image: d.image,
    address: d.address
  }));
}

// --- main chat route ---
router.post('/chat', async (req, res) => {
  const started = Date.now();
  try {
    const { tenantId='default', userId='anon', chatId='local', message='' } = req.body || {};
    const raw = String(message || '');
    const text = norm(raw);

    let ctx = await getCtx(tenantId, userId, chatId);
    // init defaults if absent
    ctx.pagination = ctx.pagination || { page: 1, pageSize: 6 };
    ctx.filters = ctx.filters || {};
    ctx.lastList = ctx.lastList || [];
    ctx.messages = ctx.messages || [];

    // record user turn
    ctx.messages.push({ role:'user', content: raw });
    if (ctx.messages.length > 80) ctx.messages.shift();

    // parse + route
    const dbSpecs = await listSpecialtyNames();
    const turn = parseTurn({ text: raw, dbSpecs, prevOffered: ctx.lastOfferWasShowDoctors, lastSpecialty: ctx.lastSpecialty });

    // Abuse filter (polite redirect)
    if (turn.flags.abusive) {
      const reply = "Let’s keep it respectful. I’m here to help with your health or the Pandoc HMS.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'abusive_block', doctors:[] });
    }

    // Out of scope → nudge back
    if (turn.intent === 'out_of_scope') {
      const reply = "I can help with your health or the Pandoc HMS. Any health concern I can help with?";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'nudge_back', doctors:[] });
    }

    // Booking / scheduling → hard stop
    if (turn.flags.wantsBooking) {
      const reply = "Sorry, I can’t do that; you have to do it yourself. You can open a doctor’s profile and book from there.";
      ctx.messages.push({ role:'assistant', content: reply });
      ctx.lastOfferWasShowDoctors = false;
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'booking_refusal', doctors:[] });
    }

    // Greetings / small talk
    if (turn.intent === 'greeting') {
      const reply = "Hi — tell me what’s going on and I’ll point you to the right doctor.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'chat', doctors:[] });
    }
    if (turn.intent === 'how_are_you') {
      const reply = "I’m doing well and here to help with your health.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'chat', doctors:[] });
    }

    // HMS help
    if (turn.intent === 'hms_help') {
      const reply = "In Pandoc: Appointments → select visit → reschedule/cancel or upload reports.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'hms_help', doctors:[] });
    }

    // Compare within last list
    if (turn.intent === 'compare' && ctx.lastList?.length) {
      let reply = '';
      if (turn.flags.askCheapest) {
        const c = [...ctx.lastList].sort((a,b)=>a.fees-b.fees)[0];
        reply = c ? `Cheapest: ${c.name} ($${c.fees}).` : "No doctors to compare.";
      } else if (turn.flags.askExpensive) {
        const m = [...ctx.lastList].sort((a,b)=>b.fees-a.fees)[0];
        reply = m ? `Most expensive: ${m.name} ($${m.fees}).` : "No doctors to compare.";
      } else if (turn.flags.askMostExperienced) {
        const e = [...ctx.lastList].sort((a,b)=>stripYears(b.experience)-stripYears(a.experience))[0];
        reply = e ? `Most experienced: ${e.name} (${e.experience}).` : "No doctors to compare.";
      } else {
        reply = "Tell me what to compare: cheapest, most experienced, or most expensive.";
      }
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'compare', doctors:[] });
    }

    // Pagination
    if (turn.intent === 'paginate' && ctx.lastSpecialty) {
      ctx.pagination.page += 1;
      const { results, total, page, pageSize } = await queryDoctors({
        specialties: [ctx.lastSpecialty],
        gender: ctx.filters.gender,
        price: ctx.filters.price,
        expMin: ctx.filters.expMin,
        wantBest: ctx.filters.wantBest,
        page: ctx.pagination.page,
        pageSize: ctx.pagination.pageSize
      });
      ctx.lastList = ctx.lastList.concat(results);
      ctx.lastOfferWasShowDoctors = false;
      const reply = results.length ? "Here are more options." : "No more results.";
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'paginate', doctors: cardsFromDocs(results), meta: { total, page, pageSize } });
    }

    // Direct name lookup (exact/loose)
    if (turn.intent === 'name_lookup' && turn.entities.name) {
      const rx = new RegExp(`(^|\\b)${escapeRx(turn.entities.name)}(\\b|$)`, 'i');
      const q = { available: true, name: rx };
      if (turn.entities.filters.gender) q.gender = new RegExp(`^${turn.entities.filters.gender}$`, 'i');

      let docs = await doctorModel.find(q).select('_id name speciality fees experience degree image address gender').lean();
      if (!docs.length) {
        const loose = new RegExp(escapeRx(turn.entities.name), 'i');
        const alt = { available: true, name: loose };
        if (turn.entities.filters.gender) alt.gender = new RegExp(`^${turn.entities.filters.gender}$`, 'i');
        docs = await doctorModel.find(alt).select('_id name speciality fees experience degree image address gender').lean();
      }
      // refine by price/experience if asked
      const f = turn.entities.filters || {};
      docs = docs.filter(d => (f.expMin ? stripYears(d.experience) >= f.expMin : true));
      if (f.price && typeof f.price==='object' && typeof f.price.cap==='number') docs = docs.filter(d => Number(d.fees) <= f.price.cap);
      if (f.price==='cheapest') docs.sort((a,b)=>a.fees-b.fees);
      if (f.price==='expensive') docs.sort((a,b)=>b.fees-a.fees);

      const reply = docs.length ? "Here are the matching doctors." : "I didn’t find that exact doctor—here are close matches.";
      ctx.lastList = docs.slice(0, ctx.pagination.pageSize);
      ctx.lastSpecialty = docs[0]?.speciality || ctx.lastSpecialty;
      ctx.pagination.page = 1;
      ctx.filters = { ...ctx.filters, ...f };
      ctx.lastOfferWasShowDoctors = false;

      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'show_doctors', doctors: cardsFromDocs(ctx.lastList) });
    }

    // DIRECT SHOW: “show doctors / doctor please / yes” after offer
    if (turn.intent === 'show_doctors') {
      const baseSpecs =
        (turn.entities.explicitSpecs?.length ? turn.entities.explicitSpecs :
         ctx.lastSpecialty ? [ctx.lastSpecialty] :
         (turn.entities.inferredSpecs?.length ? turn.entities.inferredSpecs.slice(0,3) : ['Emergency Medicine']));

      const filters = { ...ctx.filters, ...(turn.entities.filters || {}) };

      const { results } = await queryDoctors({
        specialties: baseSpecs,
        gender: filters.gender,
        price:  filters.price,
        expMin: filters.expMin,
        wantBest: filters.wantBest,
        page: 1,
        pageSize: ctx.pagination.pageSize
      });

      const reply = results.length ? "Here are doctors that match what you described." : "No matching doctors right now.";
      ctx.lastSpecialty = baseSpecs[0] || ctx.lastSpecialty;
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.filters = filters;
      ctx.lastOfferWasShowDoctors = false;

      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'show_doctors', doctors: cardsFromDocs(results) });
    }

    // EXPLICIT SPECIALTY → list now
    if (turn.intent === 'specialty_explicit' && turn.entities.explicitSpecs?.length) {
      const filters = { ...ctx.filters, ...(turn.entities.filters || {}) };
      const specs = turn.entities.explicitSpecs.slice(0,3);
      const { results } = await queryDoctors({
        specialties: specs,
        gender: filters.gender,
        price:  filters.price,
        expMin: filters.expMin,
        wantBest: filters.wantBest,
        page: 1,
        pageSize: ctx.pagination.pageSize
      });
      const reply = results.length ? "Here are doctors for that specialty." : "No matching doctors right now.";
      ctx.lastSpecialty = specs[0];
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.filters = filters;
      ctx.lastOfferWasShowDoctors = false;

      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'show_doctors', doctors: cardsFromDocs(results) });
    }

    // FILTER REFINEMENTS (gender/price/experience) with context
    if (turn.intent === 'refine' && (ctx.lastSpecialty || ctx.lastList?.length)) {
      const filters = { ...ctx.filters, ...(turn.entities.filters || {}) };
      const baseSpecs = ctx.lastSpecialty ? [ctx.lastSpecialty] : (turn.entities.inferredSpecs?.slice(0,3) || []);
      const { results } = await queryDoctors({
        specialties: baseSpecs.length ? baseSpecs : (ctx.lastList[0]?.speciality ? [ctx.lastList[0].speciality] : ['Emergency Medicine']),
        gender: filters.gender,
        price:  filters.price,
        expMin: filters.expMin,
        wantBest: filters.wantBest,
        page: 1,
        pageSize: ctx.pagination.pageSize
      });
      const reply = results.length ? "Updated list." : "No matching doctors with those filters.";
      ctx.filters = filters;
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;

      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'refine_list', doctors: cardsFromDocs(results) });
    }

    // SYMPTOMS → infer specialty, **offer show** (empathetic, safe tips)
    if (turn.intent === 'symptoms') {
      // remember last specialty guess
      if (turn.entities.inferredSpecs?.length) {
        ctx.lastSpecialty = turn.entities.inferredSpecs[0];
      }

      // empathy summary (OpenAI optional)
      const summary = await summarizeEmpathetic(openai, raw);
      // minor safe tips (non-diagnostic, general, no dosing)
      const tips = (turn.entities.safeTips?.length)
        ? ` ${turn.entities.safeTips.join(' ')}`
        : '';
      const reply = `${summary}${tips} Want me to show suitable doctors here?`;

      ctx.lastOfferWasShowDoctors = true;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'offer_show', doctors:[] });
    }

    // EMPTY / unclear → if we just offered, treat “yes/ok” as show; else ask to rephrase
    // UNKNOWN / unclear
if (!text || turn.intent === 'unknown') {
  // permissive fallback: "show doctor(s)" anywhere → show
  if (/\b(show|give|find|list|provide|send)\b/i.test(raw) && /\bdoctor(s)?\b/i.test(raw)) {
    const wantSpecs = turn.entities?.explicitSpecs?.length
      ? turn.entities.explicitSpecs
      : (ctx.lastSpecialty ? [ctx.lastSpecialty] : (mapTextToSpecialties(raw)[0] ? [mapTextToSpecialties(raw)[0]] : ['Emergency Medicine']));

    const { results } = await queryDoctors({
      specialties: wantSpecs,
      gender: ctx.filters.gender,
      price:  ctx.filters.price,
      expMin: ctx.filters.expMin,
      wantBest: ctx.filters.wantBest,
      page: 1,
      pageSize: ctx.pagination.pageSize
    });

    const reply = results.length ? "Here are doctors that match what you described." : "No matching doctors right now.";
    ctx.lastSpecialty = wantSpecs[0] || ctx.lastSpecialty;
    ctx.lastList = results;
    ctx.pagination.page = 1;
    ctx.lastOfferWasShowDoctors = false;

    ctx.messages.push({ role:'assistant', content: reply });
    await saveCtx(tenantId, userId, chatId, ctx);
    return res.json({ success:true, reply, intent:'show_doctors', doctors: cardsFromDocs(results) });
  }

  const reply = "I couldn’t quite understand that. You can say things like “knee pain” or “show doctors”.";
  ctx.lastOfferWasShowDoctors = false;
  ctx.messages.push({ role:'assistant', content: reply });
  await saveCtx(tenantId, userId, chatId, ctx);
  return res.json({ success:true, reply, intent:'chat', doctors:[] });
}


    // Fallback (shouldn’t normally hit)
    const fallback = "I can help summarize symptoms and show relevant doctors. Try “knee pain” or “show doctors”.";
    ctx.messages.push({ role:'assistant', content: fallback });
    await saveCtx(tenantId, userId, chatId, ctx);
    return res.json({ success:true, reply: fallback, intent:'chat', doctors:[] });

  } catch (e) {
    logErr('[ai/chat] fatal', e);
    return res.status(500).json({ success:false, message:'AI service error' });
  } finally {
    logInfo('ai/chat turn ms', { took: Date.now() - started });
  }
});

export default router;
