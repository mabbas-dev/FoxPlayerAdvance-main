import { apiRequest, readQueryParams } from './api-client.js';
import { onReady, byId } from './dom-safe.js';

/** @type {Record<string, HTMLElement|null|NodeListOf<Element>>} */
let els = {};

function bindManageEls() {
  return {
    status: byId('pair-status'),
    deviceBadge: byId('device-badge'),
    formCard: byId('form-card'),
    result: byId('result'),
    tabs: document.querySelectorAll('.tab'),
    panelXtream: byId('panel-xtream'),
    panelM3u: byId('panel-m3u'),
    submitBtn: byId('submit-playlist'),
  };
}

let state = { deviceId: '', token: '', sessionReady: false, activeTab: 'xtream' };

function showAlert(el, type, message) {
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.classList.remove('hidden');
}

function setTab(tab) {
  state.activeTab = tab;
  els.tabs?.forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  els.panelXtream?.classList.toggle('hidden', tab !== 'xtream');
  els.panelM3u?.classList.toggle('hidden', tab !== 'm3u');
}

async function bootstrapFromUrl() {
  const fromPath = window.location.pathname.match(/\/manage\/([^/]+)\/?$/i);
  const q = readQueryParams();
  state.deviceId = (q.deviceId || (fromPath ? decodeURIComponent(fromPath[1]) : '')).toUpperCase();
  state.token = q.token;

  if (!state.deviceId) {
    showAlert(els.status, 'error', 'Missing device ID. Scan the QR code in FOX PLAYER — do not type your device ID manually.');
    els.formCard?.classList.add('hidden');
    return;
  }

  if (els.deviceBadge) els.deviceBadge.textContent = state.deviceId;

  if (!state.token) {
    showAlert(
      els.status,
      'info',
      'Device detected. Open this page from the in-app QR code so your secure pairing token is included in the link.',
    );
    els.formCard?.classList.remove('hidden');
    return;
  }

  try {
    const res = await apiRequest(
      `/api/device/${encodeURIComponent(state.deviceId)}/pairing-status?token=${encodeURIComponent(state.token)}`,
    );
    if (res.valid) {
      state.sessionReady = true;
      showAlert(els.status, 'success', 'Device verified. Add or update your IPTV playlist below, then reload in the app.');
      els.formCard?.classList.remove('hidden');
    } else {
      showAlert(els.status, 'error', 'Pairing link expired. In FOX PLAYER, open Setup and scan the QR code again.');
      els.formCard?.classList.add('hidden');
    }
  } catch (err) {
    showAlert(els.status, 'error', err.message || 'Could not verify pairing link.');
    els.formCard?.classList.add('hidden');
  }
}

async function submitPlaylist(e) {
  e.preventDefault();
  els.result?.classList.add('hidden');
  if (els.submitBtn) els.submitBtn.disabled = true;

  const name = document.getElementById('pl-name').value.trim() || 'My Playlist';
  let payload = { playlist_name: name, name };

  if (state.activeTab === 'xtream') {
    payload.type = 'xtream';
    payload.server_url = document.getElementById('pl-server').value.trim();
    payload.username = document.getElementById('pl-user').value.trim();
    payload.password = document.getElementById('pl-pass').value;
    if (!payload.server_url || !payload.username || !payload.password) {
      showAlert(els.result, 'error', 'Server URL, username, and password are required.');
      if (els.submitBtn) els.submitBtn.disabled = false;
      return;
    }
    if (!/^https?:\/\//i.test(payload.server_url)) {
      payload.server_url = `http://${payload.server_url}`;
    }
  } else {
    payload.type = 'm3u';
    payload.playlist_url = document.getElementById('pl-m3u').value.trim();
    if (!payload.playlist_url) {
      showAlert(els.result, 'error', 'M3U URL is required.');
      if (els.submitBtn) els.submitBtn.disabled = false;
      return;
    }
  }

  try {
    if (state.token) {
      await apiRequest('/api/auth/pair', {
        method: 'POST',
        body: { device_id: state.deviceId, token: state.token },
      });
    }
    const res = await apiRequest(`/api/device/${encodeURIComponent(state.deviceId)}/playlists`, {
      method: 'POST',
      body: payload,
      deviceId: state.deviceId,
    });
    showAlert(
      els.result,
      'success',
      res.message || 'Playlist saved. Return to FOX PLAYER and tap Reload playlist.',
    );
    document.getElementById('pl-pass').value = '';
  } catch (err) {
    showAlert(els.result, 'error', err.message || 'Failed to save playlist.');
  } finally {
    els.submitBtn.disabled = false;
  }
}

function initManage() {
  if (!byId('playlist-form')) return;
  els = bindManageEls();
  els.tabs?.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.tab)));
  byId('playlist-form')?.addEventListener('submit', submitPlaylist);
  setTab('xtream');
  bootstrapFromUrl();
}

onReady(initManage);
