// utils/intentEngine.js
import 'dotenv/config';

/**
 * Utility: Normalize text gently (keep letters/numbers/apostrophes, collapse spaces).
 */
export function normalize(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape a string for use inside a RegExp.
 */
export function escapeRx(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert "10 Years" -> 10 (number), robust for variants.
 */
export function stripYears(exp = '') {
  const m = String(exp).match(/(\d+)\s*y/i);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Optional empathy summary using OpenAI. If no client, do a simple local summary.
 */
export async function summarizeEmpathetic(openai, rawText) {
  const text = normalize(rawText);
  if (!text) return "I’m here to help. ";

  // Basic local summary (fallback)
  const local = (() => {
    // pull a few key tokens for a friendly 1-liner
    const pick = text.split(' ').slice(0, 14).join(' ');
    return `I’m sorry you’re dealing with this — I see: “${pick}…”. `;
  })();

  if (!openai) return local;

  try {
    const prompt = [
      "You are an empathetic medical triage assistant.",
      "Given the user's message, produce a single empathetic sentence (<=25 words) summarizing what they’re experiencing.",
      "Do NOT diagnose or recommend medications. Avoid clinical jargon.",
      "User message:\n",
      rawText
    ].join('\n');

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an empathetic, concise medical assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 60
    });

    const out = resp?.choices?.[0]?.message?.content?.trim();
    return out || local;
  } catch {
    return local;
  }
}

/* ------------------ PATTERNS ------------------ */

const YES = /\b(y|yes|yeah|yup|ok|okay|sure|please|do it|go ahead|affirmative|proceed)\b/i;

const GREETING = /\b(hi|hello|hey|salam|salaam|aoa)\b/i;
const HOW_ARE_YOU = /\b(how\s*are\s*you|how r u|howru|how are u|how r you|hoe r u|h r u)\b/i;

// very permissive “show doctors” triggers (verbs + doctor variant)
const SHOW_DOCTORS = [
  /\b(show|give|send|provide|list|share|find|get|book)\s+(me\s+)?((a|the)\s+)?(suitable|relevant|any)?\s*(doc|doctor|doctors|dr|drs|specialist|specialists)\b/i,
  /\b(show\s*(doc|doctor|doctors|dr|drs))\b/i,
  /\b(doc|doctor|doctors)\s*(please|now)\b/i,
  /\b(need|want)\s+(a|the)?\s*(doc|doctor|specialist)\b/i
];

// pagination
const PAGINATE = /\b(more|next|load\s*more|show\s*more)\b/i;

// rude/offensive (very small list; keep minimal)
const ABUSIVE = /\b(fuck|idiot|stupid|shut\s*up)\b/i;

// booking/transactions
const BOOKING = /\b(book|schedule|reserve|pay|payment|checkout|purchase)\b/i;

// platform help
const HMS_HELP = /\b(reschedule|cancel\s*appointment|upload\s*reports?|where\s*is\s*my\s*appointment|how\s*to\s*use|help\s*with\s*pandoc)\b/i;

// out-of-scope: ask for non-health topics
const OUT_OF_SCOPE = /\b(stock|bitcoin|btc|politics|election|weather|sports\s*score|movie|news)\b/i;

// comparisons
const ASK_CHEAPEST = /\b(cheapest|lowest\s*price|least\s*expensive)\b/i;
const ASK_EXPENSIVE = /\b(most\s*expensive|highest\s*price|costliest)\b/i;
const ASK_MOST_EXP = /\b(most\s*experienced|senior|max\s*experience|highest\s*experience)\b/i;

// refinements
const FEMALE = /\b(female|woman|lady)\b/i;
const MALE = /\b(male|man|gent)\b/i;
const CHEAPEST = /\b(cheapest|affordable|low\s*cost)\b/i;
const EXPENSIVE = /\b(expensive|premium)\b/i;
const UNDER_PRICE = /\b(under|below|within|upto|up\s*to)\s*\$?\s*(\d{1,5})\b/i;
const EXP_MIN = /\b(\d{1,2})\s*\+?\s*(years?|yrs?)\s*(experience|exp)?\b/i;
const WANT_BEST = /\b(best|top|most\s*experienced|senior)\b/i;

// name lookup
const NAME_LOOKUP = /\bdr\.?\s*([a-z][a-z\s.'-]{1,40})$/i;

// symptom keywords → specialty inference; plus colloquial “<part> doctor”
const MAP = {
  'Neurologist': [
    /\b(neuro|brain|migraine|seiz(ure|ing)?|stroke|head\s*(injury|ache|pain))\b/i,
    /\b(brain\s*(doc|doctor|specialist))\b/i
  ],
  'Dermatologist': [
    /\b(dermat|skin|rash|acne|eczema|psoriasis|itch|hives)\b/i,
    /\b(skin\s*(doc|doctor|specialist))\b/i
  ],
  'Cardiology': [
    /\b(cardio|heart|chest\s*pain|palpitation|short(ness)?\s*of\s*breath)\b/i,
    /\b(heart\s*(doc|doctor|specialist))\b/i
  ],
  'Otolaryngology (ENT)': [
    /\b(ent|ear|nose|throat|sinus|tonsil)\b/i,
    /\b(ear|nose|throat)\s*(doc|doctor|specialist)\b/i
  ],
  'Ophthalmology': [
    /\b(eye|vision|red\s*eye|conjunctivitis)\b/i,
    /\b(eye\s*(doc|doctor|specialist))\b/i
  ],
  'Urology': [
    /\b(uro|urine|urinary|prostate|kidney\s*stone|uti)\b/i,
    /\b(ur(ology|ologist)?\s*(doc|doctor|specialist))\b/i
  ],
  'Gastroenterologist': [
    /\b(gastro|stomach|abd(omen|ominal)|acid|reflux|nausea|vomit|diarrhea|constipation)\b/i,
    /\b(stomach|abdomen)\s*(doc|doctor|specialist)\b/i
  ],
  'Gynecologist': [
    /\b(obgyn|gyne|gyn|pregnan|pelvic|period|menstrual|pcos)\b/i,
    /\b(gyne(cologist)?\s*(doc|doctor|specialist))\b/i
  ],
  'Pediatricians': [
    /\b(pediat|child|kid|infant|baby)\b/i,
    /\b(child|kids?)\s*(doc|doctor|specialist)\b/i
  ],
  'Endocrinology, Diabetes & Metabolism': [
    /\b(endocrin|thyroid|diabet|hormone|metab)\b/i,
    /\b(thyroid|diabetes?)\s*(doc|doctor|specialist)\b/i
  ],
  'Orthopedic Surgery': [
    /\b(ortho|orthop(ae|e)dic|bone|joint|knee|shoulder|fracture|sprain|dislocat|back\s*pain|spine)\b/i,
    /\b(bone|joint|knee|shoulder|back|spine)\s*(doc|doctor|specialist)\b/i
  ],
  'Sports Medicine': [
    /\b(sports\s*med|sports\s*injury|strain|ligament|tendon)\b/i
  ],
  'Psychiatry': [
    /\b(psych|anxiet(y|ies)?|depress(ion)?|panic|bipolar|ocd)\b/i,
    /\b(mental\s*health)\b/i
  ],
  'Emergency Medicine': [
    /\b(fell\s*(off|from)\s*(bike|bicycle|motor\s*bike|motorbike|motorcycle|scooter)|bike\s*(fall|accident|crash)|road\s*rash|accident|crash|collision|hit\s*by|trauma|severe\s*bleeding|can.t\s*breathe|fainted|head\s*injury)\b/i
  ]
};

/**
 * Try to match an explicit specialty by name, using dbSpecs as the source of truth.
 * Accepts plural/singular and partials like "derma", "cardio".
 */
function matchExplicitSpecialty(text, dbSpecs = []) {
  const out = [];
  for (const s of dbSpecs) {
    const base = normalize(s);
    const token = base.replace(/\s*&\s*/g, ' & ').replace(/\s+/g, ' ').trim();
    // accept “derma”, “cardio”, etc.
    const head = token.split(' ')[0];
    const rx = new RegExp(`\\b(${escapeRx(token)}|${escapeRx(head)})s?\\b`, 'i');
    if (rx.test(text)) out.push(s);
  }
  return [...new Set(out)];
}

/**
 * Infer specialties from symptoms/body-part slang.
 */
function inferSpecialties(text) {
  const hits = new Set();
  for (const [spec, arr] of Object.entries(MAP)) {
    for (const r of arr) if (r.test(text)) hits.add(spec);
  }
  return [...hits];
}

/**
 * Extract filters/gender/price/experience/best from free text.
 */
function extractFilters(text) {
  const filters = {};

  if (FEMALE.test(text)) filters.gender = 'female';
  else if (MALE.test(text)) filters.gender = 'male';

  if (CHEAPEST.test(text)) filters.price = 'cheapest';
  else if (EXPENSIVE.test(text)) filters.price = 'expensive';

  const cap = text.match(UNDER_PRICE);
  if (cap) filters.price = { cap: parseInt(cap[2], 10) };

  const em = text.match(EXP_MIN);
  if (em) filters.expMin = parseInt(em[1], 10);

  if (WANT_BEST.test(text)) filters.wantBest = true;

  return filters;
}

/**
 * Parse a turn. Return a consistent, forgiving intent + entities bundle.
 * This function is intentionally order-biased to reduce ambiguity.
 */
export function parseTurn({ text: raw, dbSpecs = [], prevOffered = false, lastSpecialty = null }) {
  const text = normalize(raw || '');

  const entities = {
    explicitSpecs: [],
    inferredSpecs: [],
    filters: {},
    name: null,
    safeTips: []
  };
  const flags = {
    abusive: false,
    wantsBooking: false,
    askCheapest: false,
    askExpensive: false,
    askMostExperienced: false
  };

  if (!text) return { intent: 'unknown', entities, flags };

  // 0) quick flags
  if (ABUSIVE.test(text)) flags.abusive = true;
  if (BOOKING.test(text)) flags.wantsBooking = true;

  // 1) out of scope
  if (OUT_OF_SCOPE.test(text)) return { intent: 'out_of_scope', entities, flags };

  // 2) greetings
  if (GREETING.test(text)) return { intent: 'greeting', entities, flags };
  if (HOW_ARE_YOU.test(text)) return { intent: 'how_are_you', entities, flags };

  // 3) platform help
  if (HMS_HELP.test(text)) return { intent: 'hms_help', entities, flags };

  // 4) pagination
  if (PAGINATE.test(text)) return { intent: 'paginate', entities, flags };

  // 5) comparisons
  if (ASK_CHEAPEST.test(text)) { flags.askCheapest = true; return { intent: 'compare', entities, flags }; }
  if (ASK_EXPENSIVE.test(text)) { flags.askExpensive = true; return { intent: 'compare', entities, flags }; }
  if (ASK_MOST_EXP.test(text)) { flags.askMostExperienced = true; return { intent: 'compare', entities, flags }; }

  // 6) name lookup (dr <name>)
  {
    const m = text.match(NAME_LOOKUP);
    if (m && m[1]) {
      entities.name = m[1].trim();
      entities.filters = extractFilters(text);
      return { intent: 'name_lookup', entities, flags };
    }
  }

  // 7) explicit specialty by DB names
  entities.explicitSpecs = matchExplicitSpecialty(text, dbSpecs);
  if (entities.explicitSpecs.length) {
    entities.filters = extractFilters(text);
    return { intent: 'specialty_explicit', entities, flags };
  }

  // 8) direct SHOW DOCTORS triggers
  if (SHOW_DOCTORS.some(rx => rx.test(text))) {
    entities.filters = extractFilters(text);

    // look for “<part> doctor” phrasing to pick a spec immediately
    const inferred = inferSpecialties(text);
    if (inferred.length) entities.inferredSpecs = inferred;

    return { intent: 'show_doctors', entities, flags };
  }

  // 9) confirmation after offer (“yes/ok/please”)
  if (prevOffered && YES.test(text)) {
    // keep it show_doctors; let route pick lastSpecialty when listing
    entities.filters = extractFilters(text);
    entities.inferredSpecs = inferSpecialties(text); // might refine lastSpecialty
    return { intent: 'show_doctors', entities, flags };
  }

  // 10) refinements (gender/price/experience) if user already has context
  const maybeFilters = extractFilters(text);
  if (Object.keys(maybeFilters).length) {
    entities.filters = maybeFilters;
    // carry inferredSpecs too (e.g. “female brain doctor”)
    const inferred = inferSpecialties(text);
    if (inferred.length) entities.inferredSpecs = inferred;
    return { intent: 'refine', entities, flags };
  }

  // 11) symptoms → infer specialties; we keep it forgiving
  const inferred = inferSpecialties(text);
  if (inferred.length) {
    entities.inferredSpecs = inferred;
    // add safe, generic tips (non-diagnostic)
    if (inferred.includes('Emergency Medicine')) {
      entities.safeTips.push('If symptoms are severe (heavy bleeding, head injury, trouble breathing), please seek emergency care first.');
    }
    return { intent: 'symptoms', entities, flags };
  }

  // 12) unknown → let route decide fallback message
  return { intent: 'unknown', entities, flags };
}
