// utils/ragRetriever.js
import { embed } from './openaiClient.js';
import { knnSearch } from './redisVec.js';

export async function retrieveCards({ tenant='default', userText, k=5 }) {
  const [vec] = await embed(userText);
  const docs = await knnSearch({ tenant, queryEmbedding: vec, k });
  // compact card text
  return docs.map(d => `# ${d.title}\n${d.text}`).join('\n\n---\n\n');
}
