// routes/aiChat.js
import express from 'express';
import 'dotenv/config.js';
import OpenAI from 'openai';
import doctorModel from '../models/doctorModel.js';
import Specialty from '../models/Specialty.js';
import { getCtx, saveCtx } from '../utils/ctxStore.js';

const router = express.Router();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// ------------ helpers ------------
const norm = (s='') => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const stripYears = (s='') => {
  const n = parseInt(String(s).match(/\d+/)?.[0] || '0', 10);
  return isNaN(n) ? 0 : n;
};
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isAffirmative(t) {
  return /\b(yes|yep|yeah|y|ok|okay|sure|please|pls|do it|go ahead)\b/i.test(t);
}

function parseFilters(t) {
  const out = {};
  if (/\b(female|woman|lady)\b/i.test(t)) out.gender = 'female';
  if (/\b(male|man|gent|gentleman)\b/i.test(t)) out.gender = 'male';
  if (/\b(cheapest|cheap|low\s*-?\s*cost|budget|affordable)\b/i.test(t)) out.price = 'cheapest';
  if (/\b(expensive|premium|top\s*-?\s*tier|highest\s*fee)\b/i.test(t)) out.price = 'expensive';
  const cap = t.match(/\b(?:under|below|within|<=?)\s*\$?(\d{2,4})\b/i);
  if (cap) out.price = { cap: Number(cap[1]) };
  const y = t.match(/(\d{1,2})\+?\s*(years?|yrs?)\s*(experience|exp)?/i);
  if (y) out.expMin = Number(y[1]);
  if (/\b(best|most experienced|senior|top doctor)\b/i.test(t)) out.wantBest = true;
  return out;
}

async function listSpecialties() {
  const rows = await Specialty.find({ active: true }).select('name').lean();
  return rows.map(r => r.name);
}

function inferByBodyPart(t) {
  const bag = new Set();
  const rules = [
    { rx: /\b(knee|ankle|wrist|shoulder|hip|elbow|sprain|fractur|dislocation|meniscus|acl|rotator)\b/i, add: ['Orthopedic Surgery','Sports Medicine'] },
    { rx: /\bskin|rash|acne|eczema|psoriasis|hives|itch|alopecia\b/i, add: ['Dermatologist'] },
    { rx: /\b(chest pain|heart|palpitation|cardio)\b/i, add: ['Cardiology'] },
    { rx: /\b(headache|migraine|seiz|stroke|numb|tingl|neuro|brain)\b/i, add: ['Neurologist'] },
    { rx: /\beye|vision|red eye|ophthal\b/i, add: ['Ophthalmology'] },
    { rx: /\b(ent|ear|nose|throat|sinus|tonsil|adenoid)\b/i, add: ['Otolaryngology (ENT)'] },
    { rx: /\b(thyroid|hormone|diabet|endocrin)\b/i, add: ['Endocrinology, Diabetes & Metabolism'] },
    { rx: /\b(stomach|abdomen|belly|reflux|gerd|ulcer|nausea|vomit|diarrhea|constipation|gastro)\b/i, add: ['Gastroenterologist'] },
    { rx: /\b(kidney|renal|uti|urinary|prostate|urolog)\b/i, add: ['Urology'] },
    { rx: /\b(pediatr|child|kid|toddler|infant)\b/i, add: ['Pediatricians'] },
    { rx: /\b(pregnan|period|gyne|obgyn|pelvic|uter|ovary|cervix|vagin)\b/i, add: ['Gynecologist'] },
    { rx: /\b(bleed|laceration|cut|gash|fainted|unconscious|severe pain|shortness of breath|can'?t breathe|head injury|accident|trauma|fell|fall|collision)\b/i, add: ['Emergency Medicine'] },
  ];
  rules.forEach(r => { if (r.rx.test(t)) r.add.forEach(s => bag.add(s)); });
  if (/(fall|accident|injur|fractur|sprain|bruise|swollen|swelling|limited movement|joint)/i.test(t)) {
    bag.add('Orthopedic Surgery'); bag.add('Sports Medicine'); bag.add('Emergency Medicine');
  }
  return Array.from(bag);
}

function matchExplicitSpecialty(t, dbSpecs) {
  const hits = [];
  dbSpecs.forEach(s => {
    const rx = new RegExp(`\\b${escapeRx(s.toLowerCase())}\\b`, 'i');
    if (rx.test(t)) hits.push(s);
  });
  return hits;
}

// Tolerant detector: typos like "doctorw", "docter", "dr", and bare "yes" after an offer
function wantDoctors(t, prevOffered) {
  const hasDoctorWord = /\b(doct\w*r?s?|dr)\b/i.test(t); // doctor|doctors|docter|doctorw|dr
  if (/\b(show|give|send|provide|list|share|find|get|book)\b/i.test(t) && hasDoctorWord) return true;
  if (/\bdoctor(s)?\s*(please|now)\b/i.test(t)) return true;
  if (/\bshow doctors?\b/i.test(t) || /\bdoctor please\b/i.test(t)) return true;
  if (prevOffered && isAffirmative(t)) return true; // "yes/ok/sure" after we offered = show
  return false;
}

async function queryDoctors({ specialties, gender, price, expMin, wantBest, page=1, pageSize=6 }) {
  if (!Array.isArray(specialties) || specialties.length === 0) specialties = ['Emergency Medicine'];
  const or = specialties.map(s => ({ speciality: { $regex: new RegExp(`^${escapeRx(s)}$`, 'i') } }));
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
  return { total: docs.length, page, pageSize, results: docs.slice(start, start+pageSize) };
}

async function oneLineForSymptoms(text) {
  const fallback = "I’m sorry you’re dealing with that.";
  const t = norm(text);
  if (!t) return fallback;
  if (!openai) return `${fallback} Want me to show suitable doctors here?`;
  const prompt = `
Summarize empathetically in <= 120 chars, no questions, no directives.
Text: """${text}"""
`.trim();
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'You write ultra-brief, empathetic health summaries.' },
        { role: 'user', content: prompt }
      ]
    });
    const line = resp.choices?.[0]?.message?.content?.trim() || fallback;
    return `${line} Want me to show suitable doctors here?`;
  } catch {
    return `${fallback} Want me to show suitable doctors here?`;
  }
}

// ------------ main route ------------
router.post('/chat', async (req, res) => {
  try {
    const { tenantId='default', userId='anon', chatId='local', message='' } = req.body || {};
    const text = norm(message);

    const ctx = await getCtx(tenantId, userId, chatId);
    // push user turn (rolling history)
    ctx.messages.push({ role:'user', content: message });
    if (ctx.messages.length > 60) ctx.messages.shift();

    // Empty / noise handling: never say "no text provided"
    if (!text) {
      // If we just offered to show, a blank/short confirmation counts as YES
      if (ctx.lastOfferWasShowDoctors) {
        // show with last known or safe inference
        const { results } = await queryDoctors({
          specialties: ctx.lastSpecialty ? [ctx.lastSpecialty] : ['Emergency Medicine'],
          gender: ctx.filters.gender,
          price: ctx.filters.price,
          expMin: ctx.filters.expMin,
          wantBest: ctx.filters.wantBest,
          page: 1, pageSize: ctx.pagination.pageSize
        });
        const reply = results.length ? "Here are doctors that match what you need." : "No matching doctors right now.";
        ctx.lastList = results;
        ctx.pagination.page = 1;
        ctx.lastOfferWasShowDoctors = false;
        ctx.messages.push({ role:'assistant', content: reply });
        await saveCtx(tenantId, userId, chatId, ctx);
        return res.json({ success:true, reply, intent:'show_doctors', doctors: results });
      }
      const reply = "I didn’t catch that—could you rephrase, or say “show doctors”?";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'chat', doctors: [] });
    }

    // Slots & detectors
    const filters = parseFilters(text);
    const dbSpecs = await listSpecialties();
    const explicitSpecs = matchExplicitSpecialty(text, dbSpecs);
    const inferredSpecs = inferByBodyPart(text);
    const directShow = wantDoctors(text, ctx.lastOfferWasShowDoctors);

    // Name lookup
    const nameMatch = message.match(/\b(?:dr\.?|doctor)\s+([a-z][a-z]+(?:\s+[a-z][a-z]+){0,2})\b/i);
    const directName = nameMatch?.[1] || null;

    // Pagination
    const isMore = /\b(more|next|load more|show more)\b/i.test(text);

    // Compare within list
    const askCheapest = /\b(cheapest|lowest fee|least expensive|who is cheapest)\b/i.test(text);
    const askExpensive = /\b(most expensive|highest fee|who is priciest)\b/i.test(text);
    const askMostExperienced = /\b(more experienced|most experienced|highest experience)\b/i.test(text);

    // HMS help
    const hmsHelp = /\b(reschedule|upload (reports|files)|where is my appointment|reset password|cancel appointment)\b/i.test(text);

    // Small talk
    if (/\bhow are you\b/i.test(text)) {
      const reply = "I’m doing well and here to help with your health.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'chat', doctors:[] });
    }
    if (/\b(hi|hello|hey)\b/i.test(text) && !directShow) {
      const reply = "Hi — tell me what’s going on and I’ll point you to the right doctor.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'chat', doctors:[] });
    }

    if (hmsHelp) {
      const reply = "You can manage appointments in Pandoc: Appointments → pick visit → reschedule/cancel or upload reports.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'hms_help', doctors:[] });
    }

    // Compare current list (no re-query)
    if ((askCheapest || askExpensive || askMostExperienced) && ctx.lastList?.length) {
      let reply = '';
      const list = ctx.lastList;
      if (askCheapest) {
        const c = [...list].sort((a,b)=>a.fees-b.fees)[0];
        reply = c ? `Cheapest: ${c.name} ($${c.fees}).` : "No doctors to compare.";
      } else if (askExpensive) {
        const m = [...list].sort((a,b)=>b.fees-a.fees)[0];
        reply = m ? `Most expensive: ${m.name} ($${m.fees}).` : "No doctors to compare.";
      } else {
        const e = [...list].sort((a,b)=>stripYears(b.experience)-stripYears(a.experience))[0];
        reply = e ? `Most experienced: ${e.name} (${e.experience}).` : "No doctors to compare.";
      }
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'compare', doctors:[] });
    }

    // Pagination (same filters & last specialty)
    if (isMore && ctx.lastSpecialty) {
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
      const reply = results.length ? "Here are more options." : "No more results.";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'paginate', doctors: results, meta:{ total, page, pageSize } });
    }

    // Direct name lookup
    if (directName) {
      const rx = new RegExp(`(^|\\b)${escapeRx(directName)}(\\b|$)`, 'i');
      const q = { available: true, name: rx };
      if (filters.gender) q.gender = new RegExp(`^${filters.gender}$`, 'i');
      let docs = await doctorModel.find(q).select('_id name speciality fees experience degree image address gender').lean();
      if (!docs.length) {
        const loose = new RegExp(escapeRx(directName), 'i');
        const alt = { available: true, name: loose };
        if (filters.gender) alt.gender = new RegExp(`^${filters.gender}$`, 'i');
        docs = await doctorModel.find(alt).select('_id name speciality fees experience degree image address gender').lean();
      }
      if (filters.expMin) docs = docs.filter(d => stripYears(d.experience) >= filters.expMin);
      if (filters.price && typeof filters.price==='object' && typeof filters.price.cap==='number') {
        docs = docs.filter(d => Number(d.fees) <= filters.price.cap);
      }
      if (filters.price==='cheapest') docs.sort((a,b)=>a.fees-b.fees);
      else if (filters.price==='expensive') docs.sort((a,b)=>b.fees-a.fees);

      const reply = docs.length ? "Here are the matching doctors." : "I didn’t find that exact doctor—here are close matches.";
      ctx.filters = { ...ctx.filters, ...filters };
      ctx.lastSpecialty = docs[0]?.speciality || ctx.lastSpecialty;
      ctx.lastList = docs.slice(0, ctx.pagination.pageSize);
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'show_doctors', doctors: ctx.lastList });
    }

    // Direct "show doctors" → immediate list (now tolerant)
    if (directShow) {
      const baseSpecs =
        (explicitSpecs.length ? explicitSpecs :
        (ctx.lastSpecialty ? [ctx.lastSpecialty] :
        (inferredSpecs.length ? inferredSpecs.slice(0,3) : ['Emergency Medicine'])));

      const { results } = await queryDoctors({
        specialties: baseSpecs,
        gender: filters.gender ?? ctx.filters.gender,
        price:  filters.price ?? ctx.filters.price,
        expMin: filters.expMin ?? ctx.filters.expMin,
        wantBest: filters.wantBest ?? ctx.filters.wantBest,
        page: 1, pageSize: ctx.pagination.pageSize
      });

      const reply = results.length ? "Here are doctors that match what you described." : "No matching doctors right now.";
      ctx.filters = { ...ctx.filters, ...filters };
      ctx.lastSpecialty = baseSpecs[0] || ctx.lastSpecialty;
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'show_doctors', doctors: results });
    }

    // Explicit specialty → list
    if (explicitSpecs.length) {
      const { results } = await queryDoctors({
        specialties: explicitSpecs.slice(0,3),
        gender: filters.gender ?? ctx.filters.gender,
        price:  filters.price ?? ctx.filters.price,
        expMin: filters.expMin ?? ctx.filters.expMin,
        wantBest: filters.wantBest ?? ctx.filters.wantBest,
        page: 1, pageSize: ctx.pagination.pageSize
      });
      const reply = results.length ? "Here are doctors for that specialty." : "No matching doctors right now.";
      ctx.filters = { ...ctx.filters, ...filters };
      ctx.lastSpecialty = explicitSpecs[0];
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'show_doctors', doctors: results });
    }

    // Filters only, no specialty context → ask one focused question
    const hasFilterOnly = Object.keys(filters).length > 0 && !inferredSpecs.length && !ctx.lastSpecialty;
    if (hasFilterOnly) {
      const reply = "Which specialty or issue is this for?";
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'request_more_info', doctors:[] });
    }

    // Inferred specialty from symptoms → list
    if (inferredSpecs.length) {
      const { results } = await queryDoctors({
        specialties: inferredSpecs.slice(0,3),
        gender: filters.gender ?? ctx.filters.gender,
        price:  filters.price ?? ctx.filters.price,
        expMin: filters.expMin ?? ctx.filters.expMin,
        wantBest: filters.wantBest ?? ctx.filters.wantBest,
        page: 1, pageSize: ctx.pagination.pageSize
      });
      // Short, empathetic + offer only if we didn't already show
      const reply = results.length
        ? "Here are doctors that match what you described."
        : "I couldn’t find matches; want me to try another category?";
      ctx.filters = { ...ctx.filters, ...filters };
      ctx.lastSpecialty = inferredSpecs[0];
      ctx.lastList = results;
      ctx.pagination.page = 1;
      ctx.lastOfferWasShowDoctors = false;
      ctx.messages.push({ role:'assistant', content: reply });
      await saveCtx(tenantId, userId, chatId, ctx);
      return res.json({ success:true, reply, intent:'show_doctors', doctors: results });
    }

    // Symptom summary → offer to show (empathetic; never "no text")
    const summary = await oneLineForSymptoms(message);
    const reply = summary; // already ends with “Want me to show …?”
    ctx.lastOfferWasShowDoctors = true;
    ctx.messages.push({ role:'assistant', content: reply });
    await saveCtx(tenantId, userId, chatId, ctx);
    return res.json({ success:true, reply, intent:'offer_show', doctors:[] });

  } catch (e) {
    console.error('[ai/chat] error:', e);
    return res.status(500).json({ success:false, message:'AI service error' });
  }
});

export default router;
