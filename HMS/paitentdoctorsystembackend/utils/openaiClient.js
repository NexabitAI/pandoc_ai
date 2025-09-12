// utils/openaiClient.js
import OpenAI from 'openai';
import 'dotenv/config';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Return a single embedding (number[] with length EMBED_DIM)
export async function embed(text) {
  const model = process.env.EMBED_MODEL || 'text-embedding-3-small';
  const input = String(text ?? '').replace(/\n/g, ' ');
  if (!input.trim()) return new Array(Number(process.env.EMBED_DIM || 1536)).fill(0);
  const res = await openai.embeddings.create({ model, input });
  return res.data[0].embedding; // number[]
}

// Chat completion wrapper with a sane fallback if a model isn’t allowed
export async function chatJSON({ messages, model, temperature = 0.2 }) {
  const primary = model || process.env.AI_MODEL || 'gpt-4o';
  const tryModels = [primary, 'gpt-4o', 'gpt-4o-mini'];
  let lastErr;
  for (const m of tryModels) {
    try {
      const out = await openai.chat.completions.create({
        model: m,
        messages,
        temperature,
        response_format: { type: 'json_object' }
      });
      return out;
    } catch (e) {
      lastErr = e;
      // continue to next model
    }
  }
  throw lastErr;
}
