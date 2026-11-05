import { apiRequest } from '../shared/api-client.js';

export const TOKEN_KEY = 'fox_admin_token_v2';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(t) {
  sessionStorage.setItem(TOKEN_KEY, t);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function authOpts(extra = {}) {
  return { token: getToken(), ...extra };
}

export function api(path, opts = {}) {
  return apiRequest(path, authOpts(opts));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function toast(message, type = 'info') {
  const root = document.getElementById('fox-toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `fox-toast fox-toast--${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/**
 * @param {{ title: string, html: string, submitLabel?: string, onSubmit: (form: HTMLFormElement) => Promise<void> }} opts
 */
export function openModal(opts) {
  const root = document.getElementById('fox-modal-root');
  if (!root) return;
  root.innerHTML = `
    <div class="fox-modal-backdrop" data-modal-backdrop>
      <div class="fox-modal" role="dialog" aria-modal="true">
        <div class="fox-modal__head">
          <h3>${escapeHtml(opts.title)}</h3>
          <button type="button" class="fox-modal__close" data-modal-close aria-label="Close">&times;</button>
        </div>
        <form id="fox-modal-form">
          <div class="fox-modal__body">${opts.html}</div>
          <div class="fox-modal__foot">
            <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
            <button type="submit" class="btn btn-primary">${escapeHtml(opts.submitLabel || 'Save')}</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  root.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', close));
  const backdrop = root.querySelector('[data-modal-backdrop]');
  backdrop?.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const form = root.querySelector('#fox-modal-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await opts.onSubmit(form);
      close();
    } catch (err) {
      toast(err.message || 'Action failed', 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

export function setPageHeader(title, sub) {
  const t = document.getElementById('fox-page-title');
  const s = document.getElementById('fox-page-sub');
  if (t) t.textContent = title;
  if (s) s.textContent = sub || '';
}

export function mountLoading() {
  const el = document.getElementById('fox-content');
  if (el) el.innerHTML = '<div class="fox-loading">Loading…</div>';
}

export const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  devices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  plans: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
  playlists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  replace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/></svg>',
  resellers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>',
  versions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v6l4 2"/></svg>',
  trial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
};
