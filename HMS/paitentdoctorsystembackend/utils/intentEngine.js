// utils/intentEngine.js
import { mapTextToSpecialties } from './specMap.js';

const clean = (s='') =>
  String(s)
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .toLowerCase()
    .trim();

const hasHealthish = (t) =>
  /\b(fever|pain|headache|rash|injur|bleed|swollen|swelling|cough|cold|breath|fracture|sprain|nausea|vomit|diarrh|burn|cut|wound|fall|fell|accident|bruise|dizzy|fatigue)\b/i.test(t);

const yesish = /\b(yes|yep|yeah|yup|ok|okay|sure|please|do it|go ahead)\b/i;
const wantShowDoctors =
  /\b(show|give|list|find|provide|send)\b.*\bdoctor(s)?\b/i;

const genderRx = /\b(female|male|woman|man|lady|gent(leman)?)\b/i;
const cheapestRx = /\b(cheapest|low\s*cost|affordable|budget)\b/i;
const expensiveRx = /\b(expensive|premium|top\s*tier)\b/i;
const capRx = /\b(under|below|<=?|less than)\s*\$?\s*(\d{1,4})\b/i;
const expMinRx = /\b(\d{1,2})\s*\+?\s*years?\b/i;

function parseFilters(t) {
  const f = {};
  const g = t.match(genderRx);
  if (g) f.gender = /female|woman|lady/.test(g[0]) ? 'female' : 'male';
  if (cheapestRx.test(t)) f.price = 'cheapest';
  if (expensiveRx.test(t)) f.price = 'expensive';
  const cap = t.match(capRx);
  if (cap) f.price = { cap: Number(cap[2]) };
  const e = t.match(expMinRx);
  if (e) f.expMin = Number(e[1]);
  if (/\b(most experienced|best|senior)\b/i.test(t)) f.wantBest = true;
  return f;
}

export function parseTurn({ text, dbSpecs = [], prevOffered = false, lastSpecialty = null }) {
  const raw = text || '';
  const t = clean(raw);

  // 0) abuse
  if (/\b(fuck|shit|bitch|idiot|stupid)\b/i.test(t)) {
    return { intent: 'abusive', flags: { abusive: true }, entities: {} };
  }

  // 1) trivial small talk
  if (/\b(hi|hello|hey)\b/.test(t)) return { intent: 'greeting', flags: {}, entities: {} };
  if (/\bhow are you\b/.test(t)) return { intent: 'how_are_you', flags: {}, entities: {} };

  // 2) HMS help
  if (/\b(reschedul|cancel|upload report|where is my appointment|pandoc)\b/i.test(t)) {
    return { intent: 'hms_help', flags: {}, entities: {} };
  }

  // 3) “show doctor(s)” — accept lots of variants, including “for <thing>”
  if (wantShowDoctors.test(t) || (prevOffered && yesish.test(t))) {
    // capture “for <thing>”
    let explicitSpecs = [];
    const forMatch = t.match(/\bfor\s+([a-z0-9 \-']{2,40})$/i);
    if (forMatch) {
      explicitSpecs = mapTextToSpecialties(forMatch[1]);
    }
    if (!explicitSpecs.length && lastSpecialty) explicitSpecs = [lastSpecialty];

    return {
      intent: 'show_doctors',
      flags: { wantsDoctors: true },
      entities: { explicitSpecs, inferredSpecs: mapTextToSpecialties(t), filters: parseFilters(t) }
    };
  }

  // 4) Specialty by name (from DB list)
  const explicitSpecs = [];
  for (const name of dbSpecs) {
    const rx = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (rx.test(t)) explicitSpecs.push(name);
  }
  if (explicitSpecs.length) {
    return {
      intent: 'specialty_explicit',
      flags: {},
      entities: { explicitSpecs, filters: parseFilters(t) }
    };
  }

  // 5) Symptom/body-part → inferred specialties
  const inferred = mapTextToSpecialties(t);
  if (inferred.length || hasHealthish(t)) {
    return {
      intent: 'symptoms',
      flags: {},
      entities: { inferredSpecs: inferred, filters: parseFilters(t) }
    };
  }

  // 6) Out of scope — only if clearly no health context
  if (!hasHealthish(t) && /\b(price of bitcoin|weather|news|politics|stock)\b/i.test(t)) {
    return { intent: 'out_of_scope', flags: {}, entities: {} };
  }

  // 7) Unknown
  return { intent: 'unknown', flags: {}, entities: { filters: parseFilters(t) } };
}
