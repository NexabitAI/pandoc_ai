// utils/intentSchema.js
export const INTENTS = [
  'greeting','how_are_you','symptoms','show_doctors','specialty_explicit',
  'refine','compare','paginate','name_lookup','hms_help','out_of_scope','unknown'
];

// Very light validator to avoid crashes
export function coerceIntent(json) {
  try {
    const x = typeof json === 'string' ? JSON.parse(json) : json;
    const intent = INTENTS.includes(x.intent) ? x.intent : 'unknown';
    return {
      intent,
      specialty: x.specialty || null,
      entities: x.entities || {},
      filters: x.filters || {},
      flags: x.flags || {}
    };
  } catch {
    return { intent: 'unknown', specialty: null, entities:{}, filters:{}, flags:{} };
  }
}
