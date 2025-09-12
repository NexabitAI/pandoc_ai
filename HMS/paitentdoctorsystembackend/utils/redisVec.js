// utils/redisVec.js
import Redis from 'ioredis';
import 'dotenv/config';

const INDEX = 'idx:rag:docs';
const PREFIX = 'rag:doc:';
const DIM = Number(process.env.EMBED_DIM || 1536);   // must match your embedding model
const DIST = process.env.EMBED_DIST || 'COSINE';     // COSINE | L2 | IP

let client;

export function getVecClient() {
  if (!client) {
    const url = process.env.REDIS_VEC_URL || process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_VEC_URL/REDIS_URL not set');
    client = new Redis(url, { maxRetriesPerRequest: 2 });
    client.on('error', (e) => console.error('[redisVec] error:', e.message));
  }
  return client;
}

export async function ensureIndex() {
  const r = getVecClient();
  try {
    await r.call('FT.INFO', INDEX);
    return; // exists
  } catch {
    // continue to create
  }

  // Create vector index
  // HASH schema: title TEXT, text TEXT, kind TAG, tenant TAG, embedding VECTOR
  await r.call(
    'FT.CREATE', INDEX,
    'ON', 'HASH',
    'PREFIX', '1', PREFIX,
    'SCHEMA',
      'title', 'TEXT',
      'text',  'TEXT',
      'kind',  'TAG',
      'tenant','TAG',
      'embedding', 'VECTOR', 'HNSW', '12',
        'TYPE', 'FLOAT32',
        'DIM', String(DIM),
        'DISTANCE_METRIC', DIST,
        'M', '16',
        'EF_CONSTRUCTION', '200',
        'INITIAL_CAP', '1000'
  );
}

export async function upsertDoc({ id, title, text, kind='card', tenant='default', embedding }) {
  const r = getVecClient();
  const key = PREFIX + id;
  const vec = embedding;
  if (!Array.isArray(vec) || vec.length !== DIM) {
    throw new Error(`[upsertDoc] embedding length ${vec?.length} != DIM ${DIM}`);
  }
  const blob = Buffer.from(new Float32Array(vec).buffer);
  await r.hset(key, {
    title,
    text,
    kind,
    tenant,
    embedding: blob
  });
}

export async function knnSearch({ tenant='default', queryEmbedding, k=5 }) {
  const r = getVecClient();
  const vec = Array.isArray(queryEmbedding) ? queryEmbedding : Array.from(queryEmbedding || []);
  if (vec.length !== DIM) {
    throw new Error(`[knnSearch] queryEmbedding length ${vec.length} != DIM ${DIM}`);
  }
  const blob = Buffer.from(new Float32Array(vec).buffer);

  // RediSearch vector KNN with a tenant filter
  // Note: we alias the score so we can SORTBY it.
  const q = `(@tenant:{${tenant}}) => [KNN $K @embedding $B AS score]`;
  const args = [
    INDEX,
    q,
    'PARAMS', '4', 'K', String(k), 'B', blob,
    'RETURN', '4', 'title', 'text', 'kind', 'tenant',
    'SORTBY', 'score', 'ASC',
    'DIALECT', '2'
  ];

  // Using raw call because we need to pass binary blob
  const res = await r.call('FT.SEARCH', ...args);

  // Parse FT.SEARCH response
  // res = [total, key1, [field, val, ...], key2, [field, val, ...], ...]
  const out = [];
  if (Array.isArray(res) && res.length >= 2) {
    for (let i = 2; i < res.length; i += 2) {
      const _key = res[i - 1];
      const arr = res[i];
      const obj = {};
      for (let j = 0; j < arr.length; j += 2) {
        obj[arr[j]] = arr[j + 1];
      }
      out.push(obj);
    }
  }
  return out;
}
