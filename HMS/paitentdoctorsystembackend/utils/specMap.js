// utils/specMap.js
const RX = (p) => new RegExp(p, 'i');

export function mapTextToSpecialties(text) {
  const t = (text || '').toLowerCase();

  const out = new Set();

  // explicit words → specialties
  if (/\bcardio|heart|chest pain|palpitation/.test(t)) out.add('Cardiology');
  if (/\bneuro|brain|migraine|headache|seiz|stroke|head injur(y)?/.test(t)) out.add('Neurology');
  if (/\bdermat(o|ology|ologist)|skin|rash|acne|eczema|psoriasis/.test(t)) out.add('Dermatology');
  if (/\bophthal|eye|vision|red eye|conjunct/.test(t)) out.add('Ophthalmology');
  if (/\bent\b|ear|nose|throat|sinus|tonsil/.test(t)) out.add('Otolaryngology (ENT)');
  if (/\buro|urine|prostate|kidney stone|uti\b/.test(t)) out.add('Urology');
  if (/\bgastro|stomach|abdomen|acid|ulcer|vomit|diarrh/.test(t)) out.add('Gastroenterology');
  if (/\bendocrin|thyroid|diabet|hormone/.test(t)) out.add('Endocrinology, Diabetes & Metabolism');
  if (/\bobgyn|gyne|pregnan|pelvic|period|menstru|uter(ine)?/.test(t)) out.add('Gynecology');
  if (/\bpedia|child|kid\b/.test(t)) out.add('Pediatrics');
  if (/\bpulmo|asthma|lung|short(ness)? of breath|can't breathe/.test(t)) out.add('Pulmonology');
  if (/\brheumat|joint pain(?!.*injur)/.test(t)) out.add('Rheumatology');

  // bones / joints / trauma → Orthopedics (and sometimes ER)
  if (/\borthop(ae|e)dic|bone(s)?|fracture|sprain|knee|shoulder|elbow|hip|ankle|wrist|back pain|fell|fall|injur(y|ies)/.test(t)) {
    out.add('Orthopedic Surgery');
  }

  // strong red flags → ER alongside inference
  if (/\bsevere bleeding|profuse bleeding|can't breathe|fainted|loss of consciousness|head injury|crushed|open fracture/.test(t)) {
    out.add('Emergency Medicine');
  }

  return Array.from(out);
}
