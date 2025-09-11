// utils/redisVec.js
import 'dotenv/config';
import Redis from 'ioredis';

const INDEX = process.env.RAG_INDEX || 'idx:rag:docs';
const PREFIX = process.env.RAG_PREFIX || 'rag:doc:';
export const DIM = 1536; // text-embedding-3-small

export const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });

export async function ensureIndex() {
  try {
    // Try INFO to detect existence
    await redis.call('FT.INFO', INDEX);
    return true;
  } catch {
    // Create index on HASH with vector + filters
    const args = [
      'FT.CREATE', INDEX, 'ON', 'HASH', 'PREFIX', '1', PREFIX,
      'SCHEMA',
      'tenant', 'TAG',
      'kind', 'TAG',
      'title', 'TEXT',
      'text', 'TEXT',
      'embedding', 'VECTOR', 'HNSW', '6',
        'TYPE', 'FLOAT32',
        'DIM', `${DIM}`,
        'DISTANCE_METRIC', 'COSINE'
    ];
    await redis.callBuffer(...args);
    return true;
  }
}

export async function storeDoc({ id, tenant='default', kind='policy', title='', text='', embedding /* Float32Array */ }) {
  const key = `${PREFIX}${id}`;
  const fields = [
    'tenant', tenant,
    'kind', kind,
    'title', title,
    'text', text,
    'embedding', Buffer.from(embedding.buffer) // binary blob
  ];
  await redis.hsetBuffer(key, fields);
  return key;
}

export async function knnSearch({ tenant='default', queryEmbedding /* Float32Array */, k=5 }) {
  const blob = Buffer.from(queryEmbedding.buffer);
  // nb: __embedding_score is set by RediSearch
  const resp = await redis.callBuffer(
    'FT.SEARCH', INDEX,
    `(@tenant:{${tenant}}) => [KNN ${k} @embedding $B]`,
    'PARAMS', '2', 'B', blob,
    'RETURN', '4', 'title', 'text', 'kind', 'tenant',
    'SORTBY', '__embedding_score',
    'DIALECT', '2'
  );

  // Parse minimal
  // resp = [count, key1, [field, val, ...], key2, [...], ...]
  const out = [];
  if (Array.isArray(resp) && resp.length > 1) {
    for (let i = 2; i < resp.length; i += 2) {
      const fields = resp[i];
      const obj = {};
      for (let j = 0; j < fields.length; j += 2) {
        const f = fields[j].toString();
        const v = fields[j+1].toString();
        obj[f] = v;
      }
      out.push(obj);
    }
  }
  return out;
}
