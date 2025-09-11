// utils/ctxStore.js
import Redis from 'ioredis';

const hasRedis = !!process.env.REDIS_URL;
let redis = null;
if (hasRedis) {
  redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
  try { await redis.connect(); } catch { /* ignore connect now; will auto-connect */ }
}

const mem = new Map(); // fallback

const k = (tenantId, userId, chatId) => `pandoc:ctx:${tenantId || 'default'}:${userId || 'anon'}:${chatId || 'local'}`;
const DEFAULT_CTX = () => ({
  lastSpecialty: null,
  filters: {},
  lastList: [],
  pagination: { page: 1, pageSize: 6 },
  lastOfferWasShowDoctors: false,
  language: 'en',
  messages: []
});
const TTL_SEC = parseInt(process.env.CHAT_CTX_TTL_SEC || '172800', 10); // 48h

export async function getCtx(tenantId, userId, chatId) {
  const key = k(tenantId, userId, chatId);
  if (hasRedis) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : DEFAULT_CTX();
  }
  const row = mem.get(key);
  if (!row || (row.expiresAt && Date.now() > row.expiresAt)) return DEFAULT_CTX();
  return row.ctx;
}

export async function saveCtx(tenantId, userId, chatId, ctx, ttlSec = TTL_SEC) {
  const key = k(tenantId, userId, chatId);
  if (hasRedis) {
    await redis.set(key, JSON.stringify(ctx), 'EX', ttlSec);
    return;
  }
  mem.set(key, { ctx, expiresAt: Date.now() + ttlSec * 1000 });
}
