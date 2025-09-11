// utils/ctxStore.js
import 'dotenv/config.js';

let mem = new Map();
let redis = null;

const TTL_SEC = parseInt(process.env.CHAT_CTX_TTL_SEC || '172800', 10);

if (process.env.REDIS_URL) {
  const Redis = (await import('ioredis')).default;
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
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

export async function getCtx(tenantId='default', userId='anon', chatId='local') {
  const k = key(tenantId, userId, chatId);
  if (redis) {
    const raw = await redis.get(k);
    return raw ? JSON.parse(raw) : DEFAULT();
  }
  return mem.get(k) || DEFAULT();
}

export async function saveCtx(tenantId='default', userId='anon', chatId='local', ctx) {
  const k = key(tenantId, userId, chatId);
  if (redis) {
    await redis.set(k, JSON.stringify(ctx), 'EX', TTL_SEC);
    return;
  }
  mem.set(k, ctx);
  // crude TTL cleanup
  setTimeout(()=> mem.delete(k), TTL_SEC*1000).unref?.();
}

export async function clearCtx(tenantId='default', userId='anon', chatId='local') {
  const k = key(tenantId, userId, chatId);
  if (redis) return redis.del(k);
  mem.delete(k);
}
