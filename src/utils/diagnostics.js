/**
 * FOX PLAYER — Centralized Diagnostics & Telemetry
 * Provides structured logging for synchronization, cache, and player lifecycles.
 * Never exposes passwords, credentials, tokens, or private URLs.
 */

const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

/**
 * Redact credentials embedded in free-form strings (Xtream URLs, query strings).
 */
export function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/(username|password|token|pass)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/[REDACTED]/[REDACTED]/');
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return typeof meta === 'string' ? redactString(meta) : meta;
  const cleaned = {};
  for (const [key, val] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('auth') ||
      lowerKey.includes('pin')
    ) {
      cleaned[key] = '[REDACTED]';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      cleaned[key] = sanitizeMeta(val);
    } else if (typeof val === 'string') {
      cleaned[key] = redactString(val);
    } else {
      cleaned[key] = val;
    }
  }
  return cleaned;
}

let opCounter = 0;
/**
 * Stable, human-readable operation identifiers for correlating log lines.
 */
export function nextOpId(prefix = 'op') {
  opCounter = (opCounter + 1) % 1000000;
  return `${prefix}-${opCounter}`;
}

/**
 * Report an unexpected failure. Emitted in all builds (as a warning, so it never
 * triggers a fatal red box) with credentials redacted.
 */
export function logError(scope, event, err, meta = {}) {
  const message = redactString(err?.message || String(err || 'unknown error'));
  console.warn(`[${scope}:ERROR] ${event}: ${message}`, sanitizeMeta({ ...meta, code: err?.code, status: err?.statusCode }));
}

export function logSync(event, meta = {}) {
  if (!IS_DEV) return;
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[SYNC:${timestamp}] ${event}`, meta ? sanitizeMeta(meta) : '');
}

export function logRefresh(event, meta = {}) {
  if (!IS_DEV) return;
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[REFRESH:${timestamp}] ${event}`, meta ? sanitizeMeta(meta) : '');
}

export function logPlaylist(event, meta = {}) {
  if (!IS_DEV) return;
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[PLAYLIST:${timestamp}] ${event}`, meta ? sanitizeMeta(meta) : '');
}

export function logCache(event, meta = {}) {
  if (!IS_DEV) return;
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[CACHE:${timestamp}] ${event}`, meta ? sanitizeMeta(meta) : '');
}

export function logPlayer(event, meta = {}) {
  if (!IS_DEV) return;
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(`[PLAYER:${timestamp}] ${event}`, meta ? sanitizeMeta(meta) : '');
}
