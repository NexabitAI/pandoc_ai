// utils/openaiClient.js
import OpenAI from 'openai';
import 'dotenv/config';

export const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const CANDIDATES = (process.env.MODEL_CANDIDATES ||
  'gpt-4o,gpt-4.1-mini,gpt-4.1,gpt-3.5-turbo')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let SELECTED_MODEL = (process.env.INTENT_MODEL || '').trim() || null;

export async function selectModel() {
  if (!openai) {
    console.warn('[openai] no API key configured');
    return null;
  }
  const tryModels = SELECTED_MODEL
    ? [SELECTED_MODEL, ...CANDIDATES.filter(m => m !== SELECTED_MODEL)]
    : CANDIDATES;

  for (const m of tryModels) {
    try {
      // cheap test: small chat completion
      const r = await openai.chat.completions.create({
        model: m,
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0
      });
      if (r?.choices?.[0]?.message?.content) {
        SELECTED_MODEL = m;
        console.log('[openai] selected model:', m);
        return m;
      }
    } catch (e) {
      const code = e?.error?.code || e?.code || e?.status;
      console.warn('[openai] model failed:', m, code || e.message);
    }
  }
  console.error('[openai] No usable model found from candidates');
  return null;
}

export function getSelectedModel() {
  return SELECTED_MODEL;
}

export async function embed(input) {
  if (!openai) throw new Error('OpenAI not configured');
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const arr = Array.isArray(input) ? input : [String(input || '')];
  const res = await openai.embeddings.create({ model, input: arr });
  return res.data.map(d => d.embedding);
}

export async function llmJSON({ system, user, temperature = 0.2 }) {
  if (!openai) throw new Error('OpenAI not configured');
  if (!SELECTED_MODEL) await selectModel();
  const r = await openai.chat.completions.create({
    model: SELECTED_MODEL,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      system ? { role: 'system', content: system } : null,
      { role: 'user', content: user }
    ].filter(Boolean)
  });
  const txt = r?.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(txt); } catch { return {}; }
}

export async function llmText({ system, user, temperature = 0.3 }) {
  if (!openai) throw new Error('OpenAI not configured');
  if (!SELECTED_MODEL) await selectModel();
  const r = await openai.chat.completions.create({
    model: SELECTED_MODEL,
    temperature,
    messages: [
      system ? { role: 'system', content: system } : null,
      { role: 'user', content: user }
    ].filter(Boolean)
  });
  return (r?.choices?.[0]?.message?.content || '').trim();
}
