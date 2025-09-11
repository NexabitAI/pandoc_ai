// utils/ctxStore.js
import 'dotenv/config';
import Redis from 'ioredis';

console.log('[ctxStore] module loaded:', new Date().toISOString());

const TTL_SEC = parseInt(process.env.CHAT_CTX_TTL_SEC || '172800', 10);
const mem = new Map();
const timers = new Map();

let redis = null;
if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    const pong = await redis.ping();
    console.log('[ctxStore] redis ping:', pong);
    console.log('[ctxStore] startup store: redis');
  } catch (e) {
    console.error('[ctxStore] redis connect failed, fallback memory:', e.message);
    redis = null;
  }
} else {
  console.log('[ctxStore] startup store: memory (no REDIS_URL)');
}

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

function setMemWithTTL(k, ctx) {
  mem.set(k, ctx);
  if (timers.get(k)) clearTimeout(timers.get(k));
  const t = setTimeout(() => { mem.delete(k); timers.delete(k); }, TTL_SEC * 1000);
  t.unref?.();
  timers.set(k, t);
}

export async function getCtx(tenantId='default', userId='anon', chatId='local') {
  const k = key(tenantId, userId, chatId);
  if (redis) {
    const raw = await redis.get(k);
    return raw ? JSON.parse(raw) : DEFAULT();
  }
  if (!mem.has(k)) setMemWithTTL(k, DEFAULT());
  return mem.get(k);
}

export async function saveCtx(tenantId='default', userId='anon', chatId='local', ctx) {
  const k = key(tenantId, userId, chatId);
  if (redis) {
    await redis.set(k, JSON.stringify(ctx), 'EX', TTL_SEC);
    return;
  }
  setMemWithTTL(k, ctx);
}

export async function clearCtx(tenantId='default', userId='anon', chatId='local') {
  const k = key(tenantId, userId, chatId);
  if (redis) return redis.del(k);
  mem.delete(k);
  if (timers.get(k)) clearTimeout(timers.get(k));
  timers.delete(k);
}
