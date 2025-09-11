// utils/ctxStore.js
import 'dotenv/config';
import { createRequire } from 'module';
console.log('[ctxStore] module loaded:', new Date().toISOString());

const TTL_SEC = parseInt(process.env.CHAT_CTX_TTL_SEC || '172800', 10);
const mem = new Map();
const timers = new Map();
let redis = null; // client instance or false

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

// --- REPLACE getRedis WITH THIS ---
async function getRedis() {
  if (redis !== null) return redis;     // already decided (client or false)
  const url = process.env.REDIS_URL;
  if (!url) { redis = false; return redis; }

  // Prefer CommonJS require from ESM (more reliable under PM2/Node18)
  const req = createRequire(import.meta.url);
  try {
    const Redis = req('ioredis');
    const client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on('error', (e) => console.error('[ctxStore] redis error:', e.message));
    try {
      const pong = await client.ping();
      console.log('[ctxStore] redis ping:', pong);
    } catch (e) {
      console.error('[ctxStore] redis ping failed:', e.message);
    }
    redis = client;
    console.log('[ctxStore] redis connected (require) ✅');
    return redis;
  } catch (e1) {
    console.error('[ctxStore] require(ioredis) failed:', e1.message);
    // Fallback to dynamic import (should not be needed, but kept as backup)
    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
      client.on('error', (e) => console.error('[ctxStore] redis error:', e.message));
      try {
        const pong = await client.ping();
        console.log('[ctxStore] redis ping:', pong);
      } catch (e) {
        console.error('[ctxStore] redis ping failed:', e.message);
      }
      redis = client;
      console.log('[ctxStore] redis connected (import) ✅');
      return redis;
    } catch (e2) {
      console.error('[ctxStore] ioredis not available, falling back to memory:', e2.message);
      redis = false;
      return redis;
    }
  }
}

function setMemWithTTL(k, ctx) {
  mem.set(k, ctx);
  const t = timers.get(k);
  if (t) clearTimeout(t);
  const nt = setTimeout(() => { mem.delete(k); timers.delete(k); }, TTL_SEC * 1000);
  nt.unref?.();
  timers.set(k, nt);
}

export async function getCtx(tenantId='default', userId='anon', chatId='local') {
  const k = key(tenantId, userId, chatId);
  const r = await getRedis();
  if (r) {
    const raw = await r.get(k);
    return raw ? JSON.parse(raw) : DEFAULT();
  }
  if (!mem.has(k)) setMemWithTTL(k, DEFAULT());
  return mem.get(k);
}

export async function saveCtx(tenantId='default', userId='anon', chatId='local', ctx) {
  const k = key(tenantId, userId, chatId);
  const r = await getRedis();
  if (r) {
    await r.set(k, JSON.stringify(ctx), 'EX', TTL_SEC);
    return;
  }
  setMemWithTTL(k, ctx);
}

export async function clearCtx(tenantId='default', userId='anon', chatId='local') {
  const k = key(tenantId, userId, chatId);
  const r = await getRedis();
  if (r) { await r.del(k); return; }
  mem.delete(k);
  const t = timers.get(k); if (t) clearTimeout(t); timers.delete(k);
}

// --- ADD THIS STARTUP SELF-CHECK AT THE BOTTOM ---
(async () => {
  try {
    const r = await getRedis();
    console.log('[ctxStore] startup store:', r ? 'redis' : 'memory');
  } catch (e) {
    console.error('[ctxStore] startup check failed:', e.message);
  }
})();
