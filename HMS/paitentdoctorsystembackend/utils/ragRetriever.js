// utils/ragRetriever.js
import { embed } from './openaiClient.js';
import { knnSearch } from './redisVec.js';

export async function retrieveCards({ tenant = 'default', userText, k = 5 }) {
  const query = String(userText ?? '').trim();
  if (!query) return ''; // nothing to retrieve

  const vec = await embed(query);                 // number[] (length DIM)
  const docs = await knnSearch({ tenant, queryEmbedding: vec, k });

  if (!Array.isArray(docs) || !docs.length) return '';
  return docs.map(d => `# ${d.title}\n${d.text}`).join('\n\n---\n\n');
}
