// utils/intentEngine.js
export const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const stripYears = (s='') => {
  const n = parseInt(String(s).match(/\d+/)?.[0] || '0', 10);
  return isNaN(n) ? 0 : n;
};

const norm = (s='') => String(s).toLowerCase().replace(/\s+/g,' ').trim();

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

function matchExplicitSpecialty(t, dbSpecs=[]) {
  const hits = [];
  dbSpecs.forEach(s => {
    const rx = new RegExp(`\\b${escapeRx(s.toLowerCase())}\\b`, 'i');
    if (rx.test(t)) hits.push(s);
  });
  return hits;
}

function inferByBodyPart(t) {
  const bag = new Set();
  const rules = [
    { rx: /\b(knee|ankle|wrist|shoulder|hip|elbow|sprain|fractur|dislocation|meniscus|acl|rotator|bone)\b/i, add: ['Orthopedic Surgery','Sports Medicine'] },
    { rx: /\bskin|rash|acne|eczema|psoriasis|hives|itch|alopecia\b/i, add: ['Dermatologist'] },
    { rx: /\b(chest pain|heart|palpitation|cardio)\b/i, add: ['Cardiology'] },
    { rx: /\b(headache|migraine|seiz|stroke|numb|tingl|neuro|brain|concussion|head injury)\b/i, add: ['Neurologist'] },
    { rx: /\beye|vision|red eye|ophthal|blurry\b/i, add: ['Ophthalmology'] },
    { rx: /\b(ent|ear|nose|throat|sinus|tonsil|adenoid|sore throat)\b/i, add: ['Otolaryngology (ENT)'] },
    { rx: /\b(thyroid|hormone|diabet|endocrin)\b/i, add: ['Endocrinology, Diabetes & Metabolism'] },
    { rx: /\b(stomach|abdomen|belly|reflux|gerd|ulcer|nausea|vomit|diarrhea|constipation|gastro|acid)\b/i, add: ['Gastroenterologist'] },
    { rx: /\b(kidney|renal|uti|urinary|prostate|urolog|burning urination)\b/i, add: ['Urology'] },
    { rx: /\b(pediatr|child|kid|toddler|infant|baby)\b/i, add: ['Pediatricians'] },
    { rx: /\b(pregnan|period|gyne|obgyn|pelvic|uter|ovary|cervix|vagin|missed period)\b/i, add: ['Gynecologist'] },
    { rx: /\b(bleed|laceration|cut|gash|fainted|unconscious|severe pain|shortness of breath|can'?t breathe|accident|trauma|fell|fall|collision)\b/i, add: ['Emergency Medicine'] },
  ];
  rules.forEach(r => { if (r.rx.test(t)) r.add.forEach(s => bag.add(s)); });
  if (/(fall|accident|injur|fractur|sprain|bruise|swollen|swelling|limited movement|joint)/i.test(t)) {
    bag.add('Orthopedic Surgery'); bag.add('Sports Medicine'); bag.add('Emergency Medicine');
  }
  return Array.from(bag);
}

function emergencyCautionNeeded(t) {
  return /\b(bleeding a lot|severe bleeding|can'?t breathe|fainted|unconscious|chest pain|head injury|stroke|seizure)\b/i.test(t);
}

function wantDoctors(t, prevOffered) {
  const hasDoctorWord = /\b(doct\w*r?s?|dr)\b/i.test(t); // doctor|doctors|docter|doctorw|dr
  if (/\b(show|give|send|provide|list|share|find|get|book)\b/i.test(t) && hasDoctorWord) return true;
  if (/\bdoctor(s)?\s*(please|now)\b/i.test(t)) return true;
  if (/\bshow doctors?\b/i.test(t) || /\bdoctor please\b/i.test(t)) return true;
  if (prevOffered && isAffirmative(t)) return true; // “yes/ok” after we offered
  return false;
}

function detectAbuse(t) {
  return /\b(fuck|shit|bitch|idiot|dumb|stupid|kill yourself|retard)\b/i.test(t);
}

function detectBooking(t) {
  return /\b(book|schedule|reserve|make an appointment|confirm appointment)\b/i.test(t);
}

function detectHMSSupport(t) {
  return /\b(reschedule|upload (reports|files)|where is my appointment|reset password|cancel appointment)\b/i.test(t);
}

function detectOutOfScope(t) {
  return /\b(stock|bitcoin|crypto|politics|election|weather|sports score)\b/i.test(t);
}

function detectCompare(t) {
  return {
    askCheapest: /\b(cheapest|lowest fee|least expensive|who is cheapest)\b/i.test(t),
    askExpensive: /\b(most expensive|highest fee|who is priciest)\b/i.test(t),
    askMostExperienced: /\b(more experienced|most experienced|highest experience|senior)\b/i.test(t),
  };
}

function detectPagination(t) {
  return /\b(more|next|load more|show more)\b/i.test(t);
}

function detectNameLookup(raw) {
  const m = raw.match(/\b(?:dr\.?|doctor)\s+([a-z][a-z]+(?:\s+[a-z][a-z]+){0,2})\b/i);
  return m?.[1] || null;
}

// Safe, non-diagnostic general/self-care tips (enabled for minor issues)
function minorSafeTips(t) {
  const tips = [];
  if (/\b(headache|tension|mild fever)\b/i.test(t)) tips.push(
    "For mild headache/fever, rest, hydrate, and consider a general over-the-counter pain reliever if you usually tolerate it."
  );
  if (/\b(muscle strain|sprain|bruise)\b/i.test(t)) tips.push(
    "For mild sprain/strain, rest and gentle icing may help in the short term."
  );
  if (/\b(heartburn|reflux|acid)\b/i.test(t)) tips.push(
    "Avoid trigger foods and large meals close to bedtime; elevate head while sleeping."
  );
  if (/\b(allergy|itch|sneeze|hay fever)\b/i.test(t)) tips.push(
    "Limit exposure to triggers; saline nasal rinses may help with congestion."
  );
  return tips.slice(0,2);
}

export function parseTurn({ text, dbSpecs=[], prevOffered=false, lastSpecialty=null }) {
  const t = norm(text);

  if (!t) return { intent:'unknown', entities:{}, flags:{}, raw: text };

  // abuse & scope
  const abusive = detectAbuse(t);
  if (abusive) return { intent:'abusive', entities:{}, flags:{ abusive:true }, raw: text };

  if (detectOutOfScope(t)) return { intent:'out_of_scope', entities:{}, flags:{}, raw: text };
  if (detectHMSSupport(t)) return { intent:'hms_help', entities:{}, flags:{}, raw: text };
  if (detectBooking(t)) return { intent:'booking', entities:{}, flags:{ wantsBooking:true }, raw: text };

  // greetings
  if (/\b(h+i+|hello|hey)\b/i.test(t)) return { intent:'greeting', entities:{}, flags:{}, raw: text };
  if (/\bhow are you\b/i.test(t)) return { intent:'how_are_you', entities:{}, flags:{}, raw: text };

  // pagination
  if (detectPagination(t)) return { intent:'paginate', entities:{}, flags:{}, raw: text };

  // compare
  const cmp = detectCompare(t);
  if (cmp.askCheapest || cmp.askExpensive || cmp.askMostExperienced)
    return { intent:'compare', entities:{}, flags:{...cmp}, raw: text };

  // filters
  const filters = parseFilters(t);

  // name lookup
  const name = detectNameLookup(text);
  if (name) return { intent:'name_lookup', entities:{ name, filters }, flags:{}, raw: text };

  // explicit specialties by name
  const explicitSpecs = matchExplicitSpecialty(t, dbSpecs);
  // inferred by body part/symptoms
  const inferredSpecs = inferByBodyPart(t);

  // show doctors detector (top priority)
  if (wantDoctors(t, prevOffered)) {
    return {
      intent: 'show_doctors',
      entities: { explicitSpecs, inferredSpecs, filters },
      flags: { prevOffered },
      raw: text
    };
  }

  // refinements only (no specialty text but filters present)
  if (Object.keys(filters).length && !explicitSpecs.length && !inferredSpecs.length && !lastSpecialty) {
    return { intent:'refine_ask_specialty', entities:{ filters }, flags:{}, raw: text };
  }
  if (Object.keys(filters).length && (explicitSpecs.length || inferredSpecs.length || lastSpecialty)) {
    return { intent:'refine', entities:{ filters, explicitSpecs, inferredSpecs }, flags:{}, raw: text };
  }

  // explicit specialty intent
  if (explicitSpecs.length) {
    return { intent:'specialty_explicit', entities: { explicitSpecs, filters }, flags:{}, raw: text };
  }

  // symptoms intent (general)
  const flags = {
    emergency: emergencyCautionNeeded(t)
  };
  const safeTips = minorSafeTips(t);
  return { intent:'symptoms', entities: { inferredSpecs, filters, safeTips }, flags, raw: text };
}

// empathetic one-liner (OpenAI optional)
export async function summarizeEmpathetic(openai, raw) {
  const fallback = "Sorry you’re dealing with that.";
  if (!raw || !raw.trim()) return fallback;
  if (!openai) return `${fallback}`;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'You write ultra-brief, empathetic health summaries. No directives or questions.' },
        { role: 'user', content: `Summarize empathetically in <= 120 chars, no questions: """${raw}"""` }
      ]
    });
    return resp.choices?.[0]?.message?.content?.trim() || fallback;
  } catch {
    return fallback;
  }
}
