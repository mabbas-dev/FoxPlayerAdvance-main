import { apiRequest, apiEncrypted } from './api-client.js';
import { decryptPayload } from './payload-crypto.js';
import { onReady, byId, toggleHidden } from './dom-safe.js';

const KEY = 'fox_reseller_token';
let token = sessionStorage.getItem(KEY) || '';

function show(loggedIn) {
  toggleHidden(byId('login-box'), loggedIn);
  toggleHidden(byId('panel'), !loggedIn);
}

function showLoginError(message) {
  const err = byId('login-err');
  if (!err) return;
  err.textContent = message;
  err.className = 'alert alert-error';
  err.classList.remove('hidden');
}

/** Login returns encrypted payload — decrypt explicitly for reliability. */
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
  if (json?.token) {
    return json;
  }
  throw new Error('Unexpected server response.');
}

async function loadPlans() {
  if (!token) throw new Error('Not signed in');
  const res = await apiEncrypted('/api/reseller/plans', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Reseller-Token': token,
    },
  });
  const balance = byId('balance');
  if (balance) balance.textContent = res.payload?.credits_balance ?? 0;
  const sel = byId('plan-code');
  if (sel) {
    const plans = res.payload?.plans || [];
    sel.innerHTML = plans.length
      ? plans.map((p) => `<option value="${p.code}">${p.label} (${p.credits_cost} credit(s), ${p.duration_days}d)</option>`).join('')
      : '<option value="">No plans configured</option>';
  }
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
      show(true);
      await loadPlans();
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
    msg?.classList.add('hidden');
    try {
      const res = await apiEncrypted('/api/reseller/activate-device', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Reseller-Token': token,
        },
        body: {
          device_id: byId('device-id')?.value?.trim().toUpperCase() || '',
          plan_code: byId('plan-code')?.value || '',
        },
      });
      if (msg) {
        msg.textContent = `Activated until ${res.payload?.expires_at}. Spent ${res.payload?.credits_spent} credit(s).`;
        msg.className = 'alert alert-success';
        msg.classList.remove('hidden');
      }
      await loadPlans();
    } catch (ex) {
      if (msg) {
        msg.textContent = ex.message;
        msg.className = 'alert alert-error';
        msg.classList.remove('hidden');
      }
    }
  });

  byId('logout')?.addEventListener('click', () => {
    token = '';
    sessionStorage.removeItem(KEY);
    show(false);
  });

  if (token) {
    show(true);
    loadPlans().catch(() => {
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
