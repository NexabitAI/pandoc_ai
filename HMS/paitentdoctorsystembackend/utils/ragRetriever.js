// utils/ragRetriever.js
import { embed } from './openaiClient.js';
import { knnSearch } from './redisVec.js';

export async function retrieveCards({ tenant = 'default', userText, k = 5 }) {
  const query = String(userText ?? '').trim();
  if (!query) return ''; // nothing to embed/retrieve

  // embed() returns a single embedding array
  const vec = await embed(query);

  // Some clients expect Float32Array; if yours needs plain number[],
  // you can pass `vec` directly. Adjust if your knnSearch wants a typed array:
  const qVec = Array.isArray(vec) ? new Float32Array(vec) : vec;

  const docs = await knnSearch({ tenant, queryEmbedding: qVec, k });
  if (!Array.isArray(docs) || docs.length === 0) return '';

  // Compact card text for prompt building
  return docs
    .map(d => `# ${d.title}\n${d.text}`)
    .join('\n\n---\n\n');
}