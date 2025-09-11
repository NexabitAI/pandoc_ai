// utils/openaiClient.js
import 'dotenv/config';
import OpenAI from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function embed(texts) {
  const input = Array.isArray(texts) ? texts : [texts];
  const { data } = await openai.embeddings.create({
    model: process.env.AI_EMBED_MODEL || 'text-embedding-3-small',
    input
  });
  // return Float32Array buffers
  return data.map(e => Float32Array.from(e.embedding));
}
