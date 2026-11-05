import { apiRequest, apiEncrypted } from '../shared/api-client.js';
import { decryptPayload } from '../shared/payload-crypto.js';
import { onReady, byId, toggleHidden } from '../shared/dom-safe.js';

const KEY = 'fox_reseller_token';
const NAME_KEY = 'fox_reseller_name';
let token = sessionStorage.getItem(KEY) || '';
let plans = [];
let selectedPlanCode = '';

function fmtCredits(n) {
  return Number(n ?? 0).toLocaleString();
}

function authHeaders() {
  return {
    Authorization: `Bearer ${token}`,
    'X-Reseller-Token': token,
  };
}

function show(loggedIn) {
  toggleHidden(byId('login-box'), loggedIn);
  toggleHidden(byId('panel'), !loggedIn);
  toggleHidden(byId('header-user'), !loggedIn);
}

function showLoginError(message) {
  const err = byId('login-err');
  if (!err) return;
  err.textContent = message;
  err.className = 'alert alert-error';
  err.classList.remove('hidden');
}

function payloadFrom(res) {
  if (res?.payload != null && typeof res.payload === 'object') return res.payload;
  return res?.payload ?? {};
}

function setBalance(value) {
  const n = fmtCredits(value);
  const balance = byId('balance');
  const headerBalance = byId('header-balance');
  if (balance) balance.textContent = n;
  if (headerBalance) headerBalance.textContent = n;
}

function setUserHeader(name) {
  const el = byId('header-name');
  if (el) el.textContent = name || 'Partner';
}

async function loginReseller(username, password) {
  const json = await apiRequest('/api/reseller/login', {
    method: 'POST',
    body: { username, password },
  });
  if (json?.encrypted && json.data) {
    const payload = decryptPayload(json.data);
    if (!payload || !payload.token) {
      throw new Error('Could not read login response. Try again or contact support.');
    }
    return payload;
  }
  if (json?.token) return json;
  throw new Error('Unexpected server response.');
}

function renderPlanCards(planList) {
  const root = byId('plan-cards');
  if (!root) return;
  plans = planList || [];
  if (!plans.length) {
    root.innerHTML = '<p class="lead" style="margin:0">No plans available. Contact your operator.</p>';
    return;
  }
  root.innerHTML = plans
    .map((p) => {
      const active = selectedPlanCode === p.code ? ' is-selected' : '';
      const daysLabel = Number(p.duration_days) >= 18000 ? 'Lifetime' : `${p.duration_days} days`;
      return `<button type="button" class="reseller-plan-card${active}" data-plan="${p.code}">
        <span class="reseller-plan-card__title">${escapeHtml(p.label || p.code)}</span>
        <span class="reseller-plan-card__dur">${escapeHtml(daysLabel)}</span>
        <span class="reseller-plan-card__cost">${fmtCredits(p.credits_cost)} credits</span>
      </button>`;
    })
    .join('');

  root.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.addEventListener('click', () => selectPlan(btn.dataset.plan));
  });

  if (!selectedPlanCode && plans[0]) selectPlan(plans[0].code);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectPlan(code) {
  selectedPlanCode = code || '';
  const hidden = byId('plan-code');
  if (hidden) hidden.value = selectedPlanCode;
  document.querySelectorAll('.reseller-plan-card').forEach((el) => {
    el.classList.toggle('is-selected', el.dataset.plan === selectedPlanCode);
  });
  const plan = plans.find((p) => p.code === selectedPlanCode);
  const hint = byId('selected-plan-hint');
  const btn = byId('activate-btn');
  if (plan && hint) {
    hint.textContent = `Selected: ${plan.label} — ${fmtCredits(plan.credits_cost)} credits will be deducted.`;
    hint.classList.remove('hidden');
  }
  if (btn) btn.disabled = !selectedPlanCode;
}

function renderLedger(entries) {
  const body = byId('ledger-body');
  const empty = byId('ledger-empty');
  const rows = entries || [];
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  body.innerHTML = rows
    .map((e) => {
      const delta = Number(e.delta ?? 0);
      const cls = delta >= 0 ? 'fox-credit-plus' : 'fox-credit-minus';
      const sign = delta >= 0 ? '+' : '';
      const when = String(e.created_at || '').replace('T', ' ').slice(0, 19);
      return `<tr>
        <td>${escapeHtml(when || '—')}</td>
        <td class="${cls}">${sign}${fmtCredits(delta)}</td>
        <td>${escapeHtml(e.reason || '—')}</td>
      </tr>`;
    })
    .join('');
}

async function loadPlans() {
  if (!token) throw new Error('Not signed in');
  const res = await apiEncrypted('/api/reseller/plans', { headers: authHeaders() });
  const data = payloadFrom(res);
  if (data.credits_balance != null) setBalance(data.credits_balance);
  renderPlanCards(data.plans || []);
}

async function loadLedger() {
  if (!token) return;
  try {
    const res = await apiEncrypted('/api/reseller/ledger?limit=30', { headers: authHeaders() });
    const data = payloadFrom(res);
    if (data.credits_balance != null) setBalance(data.credits_balance);
    renderLedger(data.entries || []);
  } catch {
    renderLedger([]);
  }
}

async function refreshDashboard() {
  await loadPlans();
  await loadLedger();
}

function initReseller() {
  if (document.body?.dataset?.foxPage !== 'reseller') return;
  const loginForm = byId('login-form');
  if (!loginForm) return;

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    byId('login-err')?.classList.add('hidden');
    const submitBtn = loginForm.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const username = byId('username')?.value?.trim() || '';
      const password = byId('password')?.value || '';
      if (!username || !password) {
        showLoginError('Enter username and password.');
        return;
      }
      const payload = await loginReseller(username, password);
      token = payload.token;
      sessionStorage.setItem(KEY, token);
      sessionStorage.setItem(NAME_KEY, payload.display_name || payload.username || '');
      setUserHeader(sessionStorage.getItem(NAME_KEY));
      if (payload.credits_balance != null) setBalance(payload.credits_balance);
      show(true);
      await refreshDashboard();
    } catch (ex) {
      const msg = ex.message || 'Login failed';
      if (msg.includes('Invalid reseller')) {
        showLoginError('Invalid username or password. Ask your operator to create a reseller account in the control panel.');
      } else {
        showLoginError(msg);
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  byId('activate-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = byId('act-msg');
    const btn = byId('activate-btn');
    msg?.classList.add('hidden');
    if (!selectedPlanCode) {
      if (msg) {
        msg.textContent = 'Select a subscription plan first.';
        msg.className = 'alert alert-error';
        msg.classList.remove('hidden');
      }
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const res = await apiEncrypted('/api/reseller/activate-device', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          device_id: byId('device-id')?.value?.trim().toUpperCase() || '',
          plan_code: selectedPlanCode,
        },
      });
      const data = payloadFrom(res);
      if (data.credits_balance != null) setBalance(data.credits_balance);
      if (msg) {
        const planLabel = data.plan?.label || selectedPlanCode;
        msg.textContent = `${planLabel} applied to ${data.device_id || 'device'}. Expires ${data.expires_at || '—'}. Spent ${fmtCredits(data.credits_spent)} credits. Balance: ${fmtCredits(data.credits_balance)}.`;
        msg.className = 'alert alert-success';
        msg.classList.remove('hidden');
      }
      byId('device-id').value = '';
      await loadLedger();
    } catch (ex) {
      if (msg) {
        msg.textContent = ex.message;
        msg.className = 'alert alert-error';
        msg.classList.remove('hidden');
      }
    } finally {
      if (btn) btn.disabled = !selectedPlanCode;
    }
  });

  byId('logout')?.addEventListener('click', () => {
    token = '';
    selectedPlanCode = '';
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(NAME_KEY);
    show(false);
  });

  if (token) {
    setUserHeader(sessionStorage.getItem(NAME_KEY));
    show(true);
    refreshDashboard().catch(() => {
      sessionStorage.removeItem(KEY);
      token = '';
      show(false);
      showLoginError('Session expired. Please sign in again.');
    });
  } else {
    show(false);
  }
}

onReady(initReseller);
