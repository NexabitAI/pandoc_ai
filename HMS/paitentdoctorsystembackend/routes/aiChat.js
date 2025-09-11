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

function lastUserWantsDoctors(txt='') {
  const t = txt.toLowerCase();
  return /\b(doctor|doctors|give me (a|the) doctor|find (a|the) doctor|see (a|the) doctor|book|appointment|who should i see|show doctors|yes show|yes please|show me)\b/.test(t);
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
  // synonyms / keywords
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

function fallbackSpecialtiesFromText(text='') {
  const t = text.toLowerCase();
  const picks = new Set();

  if (/\bdermat(o|ology|ologist)|skin\b/.test(t)) picks.add('Dermatologist');
  if (/\bcardio|chest pain|heart\b/.test(t)) picks.add('Cardiology');
  if (/\bneuro|nerv|seiz|stroke|head injur(y)?|headache\b/.test(t)) picks.add('Neurologist');
  if (/\bpsych|anxiety|depress|mental\b/.test(t)) picks.add('Psychiatry');
  if (/\bent|ear|nose|throat\b/.test(t)) picks.add('Otolaryngology (ENT)');
  if (/\bophthal|eye\b/.test(t)) picks.add('Ophthalmology');
  if (/\buro|urine|prostate\b/.test(t)) picks.add('Urology');
  if (/\bgastro|stomach|abdomen|acid\b/.test(t)) picks.add('Gastroenterologist');
  if (/\bobgyn|gyne|pregnan|pelvic|period\b/.test(t)) picks.add('Gynecologist');
  if (/\bpedia|child|kid\b/.test(t)) picks.add('Pediatricians');
  if (/\bendocrin|thyroid|diabet\b/.test(t)) picks.add('Endocrinology, Diabetes & Metabolism');
  if (/\bbone(s)?\b|orthopedic|orthopaedic/.test(t)) picks.add('Orthopedic Surgery');
  // t must be lowercase already: const t = text.toLowerCase()
if (/\bdermat(o|ology|ologist)|skin|rash|acne|eczema|psoriasis|hives|itch|alopecia|hair loss|nail|fungus\b/.test(t)) picks.add('Dermatologist');

if (/\bcardio|heart|chest pain|angina|palpitation|arrhythmia|murmur|hypertension|blood pressure\b/.test(t)) picks.add('Cardiology');

if (/\blung|pulmo|breath(ing)?|shortness of breath|sob|wheeze|asthma|copd|pneumonia|cough|pleur|emphysema\b/.test(t)) picks.add('Pulmonology');

if (/\bgastro|stomach|abdomen|abdominal|belly|gastric|acid reflux|gerd|ulcer|diarrhea|constipation|vomit|nausea|ibs|bloating|indigestion\b/.test(t)) picks.add('Gastroenterologist');

if (/\bliver|hepat|jaundice|cirrhosis|fatty liver|hepatitis|biliary|gallbladder|cholecyst|\bascites\b/.test(t)) picks.add('Hepatology');

if (/\bkidney|renal\b/.test(t)) picks.add('Nephrology');
if (/\b(kidney|urinary|ureter|bladder|stone|uti|u(t|r)inary tract|prostate|testicular|erectile|penile|scrotal|varicocele|nocturia)\b/.test(t)) picks.add('Urology');

if (/\bendocrin|hormone|thyroid|goiter|hyperthy|hypothy|diabet(es|ic)|insulin|pituitar(y)?|adrenal|pcos\b/.test(t)) picks.add('Endocrinology, Diabetes & Metabolism');

if (/\brheumat|autoimmune|arthritis|gout|lupus|scleroderma|sjogren|vasculitis|ankylosing|psoriatic\b/.test(t)) picks.add('Rheumatology');

if (/\binfect(ion)?|fever of unknown|hiv|aids|tb|malaria|typhoid|hepatitis\b/.test(t)) picks.add('Infectious Diseases');

if (/\bblood|anemi(a)?|hemoglobin|clot|dvt|bleeding disorder|thrombo|platelet|hemophilia|sickle\b/.test(t)) picks.add('Hematology');

if (/\bcancer|tumou?r|oncolog|mass|lump|metastasis|chemo(therapy)?\b/.test(t)) picks.add('Medical Oncology');

if (/\ballerg(y|ies)?|immunolog|sneeze|hay fever|rhinitis|anaphylaxis|urticaria\b/.test(t)) picks.add('Allergy & Immunology');

if (/\bneuro|brain|seiz(ure)?|epilep|stroke|tia|weakness|numb|tingl|parkinson|tremor|memory|dementia|migraine|headache|neuropath(y)?\b/.test(t)) picks.add('Neurologist');

if (/\bpsychiat|mental|depress|anxiety|panic|bipolar|schizo|adhd|ocd|ptsd|addiction (treatment|help)?\b/.test(t)) picks.add('Psychiatry');
if (/\baddiction|substance|alcohol(ism)?|opioid|drug (use|dependence)\b/.test(t)) picks.add('Addiction Medicine');

if (/\bobgyn|gyne|gyn|pregnan|antenatal|postnatal|pelvic pain|pcos|fibroid|period|menstrual|menopause|uter(ine)?|ovary|cervix|vaginal\b/.test(t)) picks.add('Gynecologist');

if (/\bpediatr(ic|ician|ics)|child|kid|toddler|infant|newborn|neonat(al|ology)?\b/.test(t)) picks.add('Pediatricians');

if (/\bgeriatr(ic|ics)|elder(ly)?|senior|older adult\b/.test(t)) picks.add('Geriatric Medicine');

if (/\bemergency|er|trauma|accident|urgent|laceration|acute distress|severe pain|fainted|unconscious\b/.test(t)) picks.add('Emergency Medicine');

if (/\bcritical care|icu|ventilator|shock|sepsis\b/.test(t)) picks.add('Critical Care Medicine');

if (/\banesthes(io|ia)|anesthetist|pain block\b/.test(t)) picks.add('Anesthesiology');

if (/\bgeneral (surgery|surgeon)|append(ici)?tis|hernia|lump removal|biopsy|abscess drainage|gallbladder surgery|pilonoidal\b/.test(t)) picks.add('General Surgery');

if (/\bcardiothoracic|heart surgery|bypass|cabg|valve\b/.test(t)) picks.add('Cardiothoracic Surgery');

if (/\bvascular (surg|surgeon)?|peripheral artery|pad|claudication|aneurysm|carotid|varicose vein(s)?\b/.test(t)) picks.add('Vascular Surgery');

if (/\bneurosurg(ery|eon)|brain surgery|spinal tumor\b/.test(t)) picks.add('Neurosurgery');

if (/\borthopedic|orthopaedic|bone(s)?|fracture|sprain|ligament|tendon|rotator cuff|meniscus|dislocation|joint replacement\b/.test(t)) picks.add('Orthopedic Surgery');

if (/\bsports (med|medicine)|sports injur(y|ies)|acl|mcl|tennis elbow|runner'?s knee|shin splints\b/.test(t)) picks.add('Sports Medicine');

if (/\bent\b|\bear(ache| infection)?|hearing|tinnitus|nose|sinus(it|itis)|throat|tonsil|adenoid|hoarse|voice|snoring\b/.test(t)) picks.add('Otolaryngology (ENT)');

if (/\bophthal|eye|vision|blurred vision|red eye|conjunctivitis|glaucoma|cataract|retina\b/.test(t)) picks.add('Ophthalmology');

if (/\bplastic (and )?reconstruct(ive)?|cosmetic surgery|burn reconstruction|scar revision\b/.test(t)) picks.add('Plastic & Reconstructive Surgery');

if (/\bhand (surgery|surgeon)?|carpal tunnel|trigger finger|hand tendon|dupuytren\b/.test(t)) picks.add('Hand Surgery');

if (/\bspine (surgery|surgeon)?|sciatica (surgery)?|spinal stenosis\b/.test(t)) picks.add('Spine Surgery');

if (/\bbreast lump|nipple discharge|mastectomy|lumpectomy|breast surgery\b/.test(t)) picks.add('Breast Surgery');

if (/\bbariatric|weight loss surgery|gastric (bypass|sleeve)|obesity surgery\b/.test(t)) picks.add('Bariatric & Metabolic Surgery');

if (/\bcolorectal|rectal|anal fissure|fistula|hemorrhoid|rectal bleeding|pilonidal\b/.test(t)) picks.add('Colorectal Surgery');

if (/\btransplant (surgery|evaluation)|kidney transplant|liver transplant\b/.test(t)) picks.add('Transplant Surgery');

if (/\bendocrine surgery|thyroid nodule surgery|parathyroid|adrenalectomy\b/.test(t)) picks.add('Endocrine Surgery');

if (/\bpediatric (surgery|surgeon)\b/.test(t)) picks.add('Pediatric Surgery');

if (/\bradiology|x-?ray|ct scan|mri|ultrasound (result)?\b/.test(t)) picks.add('Diagnostic Radiology');

if (/\binterventional radiology|embolization|angioplasty|stent (placement)?\b/.test(t)) picks.add('Interventional Radiology');

if (/\bradiation oncology|radiotherapy|brachytherapy\b/.test(t)) picks.add('Radiation Oncology');

if (/\bnuclear medicine|pet[- ]?scan|thyroid uptake\b/.test(t)) picks.add('Nuclear Medicine');

if (/\bpathology|biopsy report|histopathology\b/.test(t)) picks.add('Anatomic Pathology');

if (/\bclinical pathology|lab medicine|coagulation workup\b/.test(t)) picks.add('Clinical Pathology (Laboratory Medicine)');

if (/\bforensic (pathology|examiner)\b/.test(t)) picks.add('Forensic Pathology');

if (/\bpm&r|physiatry|rehabilitation|stroke rehab|spinal cord injury|prosthetic\b/.test(t)) picks.add('Physical Medicine & Rehabilitation (PM&R)');

if (/\bpain (clinic|medicine)|chronic pain|nerve pain|neuropathic pain\b/.test(t)) picks.add('Pain Medicine');

if (/\bsleep (apnea|medicine)|insomnia|snor(ing|e)\b/.test(t)) picks.add('Sleep Medicine');

if (/\boccupational (medicine|health)|work injury|industrial exposure\b/.test(t)) picks.add('Occupational & Environmental Medicine');

if (/\bpalliative|hospice|end-of-life|comfort care\b/.test(t)) picks.add('Palliative Care / Hospice Medicine');

if (/\bwound care|chronic ulcer|diabetic foot|pressure sore|bed sore\b/.test(t)) picks.add('Wound Care');

if (/\bphlebology|vein clinic|varicose|spider veins\b/.test(t)) picks.add('Phlebology (Vein Medicine)');

if (/\bclinical nutrition|diet counsel|malnutrition|tube feed|tpn|obesity (management)?\b/.test(t)) picks.add('Clinical Nutrition');

if (/\bmen'?s health|andrology|erectile dysfunction|male infertility\b/.test(t)) picks.add('Men’s Health / Andrology');

if (/\bwomen'?s health|pap smear|well woman exam\b/.test(t)) picks.add('Women’s Health');

if (/\btravel (clinic|medicine)|travel vaccine|malaria prophylaxis|yellow fever\b/.test(t)) picks.add('Travel & Tropical Medicine');

if (/\bmedical genetics|genomic(s)?|inherited disorder\b/.test(t)) picks.add('Medical Genetics & Genomics');

if (/\bclinical informatics|ehr|interoperability\b/.test(t)) picks.add('Clinical Informatics');

if (/\bhyperbaric (medicine|oxygen)\b/.test(t)) picks.add('Hyperbaric Medicine');

if (/\bmedical toxicology|poison(ing)?|overdose|toxin exposure\b/.test(t)) picks.add('Medical Toxicology');

if (/\bwilderness medicine|altitude sickness|frostbite|hypothermia\b/.test(t)) picks.add('Wilderness Medicine');

if (/\bgeriatr(ic|ics) psychiatry|late-life depression|memory care\b/.test(t)) picks.add('Geriatric Psychiatry');

if (/\bchild(ren)? (and )?adolescent psychiatry|adolescent mental health\b/.test(t)) picks.add('Child & Adolescent Psychiatry');

if (/\bbehavioral neurology|neuropsychiatry\b/.test(t)) picks.add('Behavioral Neurology & Neuropsychiatry');

if (/\bneurocritical care|icu neuro|intracranial pressure\b/.test(t)) picks.add('Neurocritical Care');

if (/\baesthetic|cosmetic (medicine|injectable)|botox|filler\b/.test(t)) picks.add('Aesthetic Medicine');


  // trauma / MSK
  if (/(fall|accident|injur|fractur|sprain|bruise|swollen|swelling|limited movement|joint|knee|ankle|wrist|shoulder)/.test(t)) {
    picks.add('Orthopedic Surgery'); picks.add('Sports Medicine'); picks.add('Emergency Medicine');
  }
  // bleeding / cuts / wounds
  if (/(bleed|laceration|cut|wound|gash)/.test(t)) {
    picks.add('Emergency Medicine'); picks.add('Wound Care'); picks.add('General Surgery');
  }

  // FINAL fallback: Emergency Medicine (NOT General physician)
  if (picks.size === 0) picks.add('Emergency Medicine');
  return Array.from(picks);
}

async function queryDoctorsBySpecialties({ specialties, gender, pricePref, expMin, wantBest }) {
  // If nothing provided, prefer Emergency Medicine
  if (!Array.isArray(specialties) || specialties.length === 0) specialties = ['Emergency Medicine'];
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

  return docs; // return ALL matches
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
- Health/wellness or Pandoc platform only. If outside scope, politely refuse and steer back.
- No diagnosis, meds, dosages, or treatment plans. No external links.

STYLE
- Empathetic and concise: <= 2 short sentences (<= 220 chars).
- Answer small-talk briefly ("I'm doing well and here to help with your health.").
- Use full history; don't repeat prior questions. Ask at most ONE focused follow-up only if truly needed.

INTENT & PREFERENCES
- If user asks to see doctors/book, "intent":"show_doctors".
- If user names a doctor or a specialty explicitly, prefer that target.
- Infer gender ("male"|"female"|null), price ("cheapest"|"expensive"|null), min experience years (number|null), and specialties (1–3 strings).
- If requested specialty doesn’t exist or is unclear, choose the closest reasonable specialties (e.g., orthopedic/sports/emergency for trauma). If nothing fits, prefer "Emergency Medicine".
- Do NOT say "I can help refine the list".

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
    const forceShow = lastUserWantsDoctors(latestUser);
    const doneFeeling = userSeemsDone(latestUser);
    const convo = conversationText(messages);

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

    // Heuristic fallbacks (preferences)
    const heur = extractHeuristicPrefs(latestUser);
    gender = gender || heur.gender;
    const expMin = (typeof min_experience_years === 'number' ? min_experience_years : null) || heur.expMin || null;
    const wantBest = (typeof want_best === 'boolean' ? want_best : null) || heur.wantBest || null;
    const pricePref = price || heur.pricePref || null;

    // Server-side direct extraction
    if (!directName) {
      const n = guessDoctorNameFromText(latestUser);
      if (n) directName = n;
    }
    if (!directSpecs || directSpecs.length === 0) {
      const mentioned = await findMentionedSpecialtiesInText(latestUser);
      if (mentioned.length) directSpecs = mentioned;
    }

    // Force show if asked
    if (forceShow && intent !== 'refuse') {
      intent = 'show_doctors';
      if (!specialties || specialties.length === 0) specialties = fallbackSpecialtiesFromText(convo);
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = "Here are doctors that match what you described.";
      }
    }

    // If user done and didn't ask → suggest (unchanged)
    if (!forceShow && doneFeeling && intent !== 'refuse' && intent !== 'show_doctors') {
      assistant_message = "Understood. Would you like me to show doctors that fit your needs?";
      intent = 'chat';
    }

    let doctors = [];

    // 1) Direct name (priority)
    if (directName) {
      intent = 'show_doctors';
      doctors = await queryDoctorsByName({ name: directName, gender, pricePref, expMin, wantBest });

      if (doctors.length === 0 && directSpecs && directSpecs.length) {
        doctors = await queryDoctorsBySpecialties({ specialties: directSpecs, gender, pricePref, expMin, wantBest });
      }
      if (doctors.length === 0) {
        const closeSpecs = fallbackSpecialtiesFromText(convo);
        doctors = await queryDoctorsBySpecialties({ specialties: closeSpecs, gender, pricePref, expMin, wantBest });
      }

      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are the matching doctors."
          : "I didn’t find that exact doctor. Here are close matches.";
      }
    }

    // 2) Direct specialty (without name)
    if (!directName && (!doctors.length) && directSpecs && directSpecs.length) {
      intent = 'show_doctors';
      doctors = await queryDoctorsBySpecialties({ specialties: directSpecs, gender, pricePref, expMin, wantBest });
      if (doctors.length === 0) {
        const closeSpecs = Array.from(new Set([...directSpecs, ...fallbackSpecialtiesFromText(convo)]));
        doctors = await queryDoctorsBySpecialties({ specialties: closeSpecs, gender, pricePref, expMin, wantBest });
      }
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are doctors for that specialty."
          : "I couldn’t find that specialty here. Showing close options.";
      }
    }

    // 3) LLM/forced show without direct name/spec
    if (!doctors.length && intent === 'show_doctors') {
      if (!specialties || specialties.length === 0) specialties = fallbackSpecialtiesFromText(convo);
      doctors = await queryDoctorsBySpecialties({ specialties, gender, pricePref, expMin, wantBest });
      // NO General physician fallback branch here.
      if (!assistant_message || /describe|symptom/i.test(assistant_message)) {
        assistant_message = doctors.length
          ? "Here are doctors that match what you described."
          : "I can pull the right specialists. Is the issue mainly joint-related or something else?";
      }
    }

    return res.json({ success: true, reply: assistant_message, intent, doctors });
  } catch (e) {
    console.error('[ai/chat]', e);
    return res.status(500).json({ success: false, message: 'AI service error' });
  }
});

export default router;
