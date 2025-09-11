// utils/logger.js
export function logInfo(msg, obj={}) {
  try { console.log(JSON.stringify({ level:'info', msg, ...obj })); } catch {}
}
export function logWarn(msg, obj={}) {
  try { console.warn(JSON.stringify({ level:'warn', msg, ...obj })); } catch {}
}
export function logErr(msg, err) {
  try {
    console.error(JSON.stringify({
      level:'error', msg,
      error: String(err?.message || err),
      stack: err?.stack || null
    }));
  } catch {}
}
