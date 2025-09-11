// utils/openaiClient.js
import OpenAI from 'openai';
import 'dotenv/config.js';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('[openaiClient] OPENAI_API_KEY is missing');
}
export const openai = new OpenAI({ apiKey });

const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-large'; // 1536 dims

/**
 * Returns a single embedding array for a single string.
 */
export async function embed(text) {
  // Normalize to a non-empty string
  const q = (typeof text === 'string') ? text : JSON.stringify(text ?? '');
  const s = q.trim();
  if (!s) throw new Error('[embed] called with empty text');

  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: s, // MUST be string or string[]
  });
  if (!res?.data?.[0]?.embedding) {
    throw new Error('[embed] no embedding in response');
  }
  return res.data[0].embedding;
}

/**
 * Batch embeddings: returns array<embedding> aligned with inputs.
 */
export async function embedMany(texts) {
  if (!Array.isArray(texts) || !texts.length) {
    throw new Error('[embedMany] texts must be a non-empty array');
  }
  const inputs = texts.map(t => {
    const s = typeof t === 'string' ? t : JSON.stringify(t ?? '');
    const z = s.trim();
    if (!z) throw new Error('[embedMany] one of the inputs is empty');
    return z;
  });
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: inputs,
  });
  if (!res?.data?.length) {
    throw new Error('[embedMany] no embeddings in response');
  }
  // sort by index to be safe
  return res.data.sort((a,b)=>a.index-b.index).map(d => d.embedding);
}
