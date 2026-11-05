import { onReady, byId, toggleHidden } from '../dom-safe.js';
import { apiRequest } from '../api-client.js';
import {
  getToken, setToken, clearToken, api, toast, ICONS,
} from './core.js';
import { views, navigate } from './views.js';

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'devices', label: 'Devices' },
  { id: 'plans', label: 'Subscription plans' },
  { id: 'playlists', label: 'IPTV playlists' },
  { id: 'replace', label: 'URL replace' },
  { id: 'resellers', label: 'Resellers' },
  { id: 'versions', label: 'App versions' },
  { id: 'trial', label: 'Trial settings' },
  { id: 'audit', label: 'Audit log' },
];

let activeRoute = 'overview';

function buildNav() {
  const nav = byId('fox-nav');
  if (!nav) return;
  nav.innerHTML = NAV.map((item) => `
    <button type="button" class="fox-nav-item${item.id === activeRoute ? ' is-active' : ''}" data-route="${item.id}">
      ${ICONS[item.id] || ''}
      <span>${item.label}</span>
    </button>`).join('');

  nav.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.route));
  });
}

function go(routeId) {
  if (!views[routeId]) return;
  activeRoute = routeId;
  buildNav();
  const v = views[routeId];
  const titleEl = byId('fox-page-title');
  const subEl = byId('fox-page-sub');
  if (titleEl) titleEl.textContent = v.title;
  if (subEl) subEl.textContent = v.sub;
  navigate(routeId);
}

function showShell(loggedIn) {
  toggleHidden(byId('fox-login'), loggedIn);
  toggleHidden(byId('fox-app'), !loggedIn);
}

function initLogin() {
  const form = byId('fox-login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = byId('fox-login-error');
    errEl?.classList.add('hidden');
    try {
      const password = byId('fox-admin-password')?.value || '';
      const res = await apiRequest('/api/admin/login', { method: 'POST', body: { password } });
      setToken(res.token || password);
      showShell(true);
      buildNav();
      go('overview');
      toast('Signed in', 'success');
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  });

  byId('fox-logout')?.addEventListener('click', () => {
    clearToken();
    showShell(false);
  });
}

onReady(() => {
  initLogin();
  if (getToken()) {
    showShell(true);
    buildNav();
    go('overview');
  } else {
    showShell(false);
  }
});
