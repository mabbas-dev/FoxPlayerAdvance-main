/**
 * Pure helpers for Xtream / Trex / XUI panel auth responses (no RN deps — testable in Node).
 */

/** HTTP codes used by some IPTV panels (incl. Trex) for bad credentials — not generic 5xx. */
export const XTREAM_AUTH_HTTP_STATUSES = new Set([401, 403, 511, 512, 513, 514, 515]);

export function isXtreamAuthHttpStatus(statusCode) {
  return XTREAM_AUTH_HTTP_STATUSES.has(Number(statusCode));
}

/**
 * Whether user_info indicates a successful login across panel variants.
 */
export function isXtreamAuthSuccess(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return false;

  const auth = userInfo.auth;
  if (auth === 0 || auth === '0' || auth === false) {
    return false;
  }
  if (auth === 1 || auth === '1' || auth === true) {
    return true;
  }

  const status = String(userInfo.status || '').toLowerCase().trim();
  if (status === 'expired' || status === 'disabled' || status === 'banned') {
    return false;
  }
  if (status === 'active' || status === 'enabled') {
    return true;
  }

  // Some panels omit auth when credentials are valid but include username
  if (userInfo.username && auth == null && status !== 'expired') {
    return true;
  }

  return false;
}

export function parseXtreamAuthPayload(rawText) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) {
    return { ok: false, reason: 'EMPTY_BODY', data: null };
  }
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'INVALID_JSON', data: null };
    }
    if (isXtreamAuthSuccess(data.user_info)) {
      return { ok: true, reason: 'OK', data };
    }
    if (data.user_info) {
      return { ok: false, reason: 'AUTH_REJECTED', data };
    }
    return { ok: false, reason: 'NO_USER_INFO', data };
  } catch (_e) {
    return { ok: false, reason: 'INVALID_JSON', data: null };
  }
}
