// utils/ctxStore.js
import 'dotenv/config'; // no .js

const TTL_SEC = parseInt(process.env.CHAT_CTX_TTL_SEC || '172800', 10); // 2 days
const mem = new Map();         // key -> ctx
const timers = new Map();      // key -> timeout
let redis = null;              // lazily resolved client or false

const key = (tenantId, userId, chatId) => `pandoc:ctx:${tenantId}:${userId}:${chatId}`;

const DEFAULT = () => ({
  lastSpecialty: null,
  filters: {},
  lastList: [],
  pagination: { page: 1, pageSize: 6 },
  lastOfferWasShowDoctors: false,
  language: 'en',
  messages: []
});

async function getRedis() {
  if (redis !== null) return redis; // already decided
  const url = process.env.REDIS_URL;
  if (!url) { redis = false; return redis; }

  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on('error', (e) => console.error('[ctxStore] redis error:', e.message));
    try { await client.ping(); } catch (e) { console.error('[ctxStore] redis ping failed:', e.message); }
    redis = client;
    return redis;
  } catch (e) {
    console.error('[ctxStore] ioredis not available, falling back to memory:', e.message);
    redis = false;
    return redis;
  }
}

function setMemWithTTL(k, ctx) {
  mem.set(k, ctx);
  // reset existing timer to avoid stacking
  const t = timers.get(k);
  if (t) clearTimeout(t);
  const nt = setTimeout(() => {
    mem.delete(k);
    timers.delete(k);
  }, TTL_SEC * 1000);
  // avoid keeping the process alive
  nt.unref?.();
  timers.set(k, nt);
}

export async function getCtx(tenantId = 'default', userId = 'anon', chatId = 'local') {
  const k = key(tenantId, userId, chatId);
  const r = await getRedis();
  if (r) {
    const raw = await r.get(k);
    return raw ? JSON.parse(raw) : DEFAULT();
  }
  // memory path
  if (!mem.has(k)) {
    const d = DEFAULT();
    setMemWithTTL(k, d);
  }
  return mem.get(k);
}

export async function saveCtx(tenantId = 'default', userId = 'anon', chatId = 'local', ctx) {
  const k = key(tenantId, userId, chatId);
  const r = await getRedis();
  if (r) {
    await r.set(k, JSON.stringify(ctx), 'EX', TTL_SEC);
    return;
  }
  setMemWithTTL(k, ctx);
}

export async function clearCtx(tenantId = 'default', userId = 'anon', chatId = 'local') {
  const k = key(tenantId, userId, chatId);
  const r = await getRedis();
  if (r) return r.del(k);
  mem.delete(k);
  const t = timers.get(k);
  if (t) clearTimeout(t);
  timers.delete(k);
}
