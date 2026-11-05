/** Safe DOM helpers for FOX web panels (avoid null.classList crashes). */

export function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    fn();
  }
}

export function byId(id) {
  return document.getElementById(id);
}

/**
 * Collect elements by id. Returns null if any are missing (logs warning).
 * @param {string[]} ids
 * @returns {Record<string, HTMLElement>|null}
 */
export function collect(ids) {
  /** @type {Record<string, HTMLElement>} */
  const out = {};
  const missing = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) missing.push(`#${id}`);
    else out[id] = el;
  }
  if (missing.length) {
    console.warn('[FOX] Missing elements on this page:', missing.join(', '));
    return null;
  }
  return out;
}

export function toggleHidden(el, hidden) {
  if (el) el.classList.toggle('hidden', hidden);
}
