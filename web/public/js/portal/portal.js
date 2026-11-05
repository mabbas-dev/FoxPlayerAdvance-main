import { apiRequest, apiEncrypted, readQueryParams } from '../shared/api-client.js';
import { onReady, byId } from '../shared/dom-safe.js';

/** @type {Record<string, HTMLElement|null>} */
let els = {};
let state = {
  deviceId: '',
  token: '',
  activeTab: 'xtream',
  playlists: [],
  registered: false,
  paired: false,
  idLock: false,
};

function normalizeDeviceId(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Accept plain ID or full /portal/…?token=… pasted into Device ID field. */
function parseDeviceInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { deviceId: '', token: '' };
  if (s.includes('/') || s.includes('token=')) {
    try {
      const url = s.startsWith('http') ? new URL(s) : new URL(s, 'https://foxplayer.app');
      const pathMatch = url.pathname.match(/\/(?:portal|manage)\/([^/]+)/i);
      const deviceId =
        (pathMatch ? decodeURIComponent(pathMatch[1]) : '') ||
        url.searchParams.get('device_id') ||
        url.searchParams.get('deviceId') ||
        '';
      const token =
        url.searchParams.get('token') ||
        url.searchParams.get('pairing_token') ||
        url.searchParams.get('t') ||
        '';
      return { deviceId: normalizeDeviceId(deviceId), token: String(token).trim() };
    } catch {
      return { deviceId: '', token: '' };
    }
  }
  return { deviceId: normalizeDeviceId(s), token: '' };
}

function bindEls() {
  return {
    entryPanel: byId('entry-panel'),
    entryErr: byId('entry-err'),
    deviceCard: byId('device-card'),
    entryForm: byId('portal-entry-form'),
    uploadSection: byId('main-panel'),
    uploadLockHint: byId('upload-lock-hint'),
    playlistsCard: byId('playlists-card'),
    manageHint: byId('manage-hint'),
    status: byId('pair-status'),
    deviceBadge: byId('device-badge'),
    deviceMeta: byId('device-meta'),
    lockBanner: byId('lock-banner'),
    mainPanel: byId('main-panel'),
    playlistList: byId('playlist-list'),
    playlistEmpty: byId('playlist-empty'),
    result: byId('result'),
    panelXtream: byId('panel-xtream'),
    panelM3u: byId('panel-m3u'),
    submitBtn: byId('submit-playlist'),
    editDpId: byId('edit-dp-id'),
    formTitle: byId('form-title'),
    formSub: byId('form-sub'),
    cancelEdit: byId('cancel-edit-btn'),
    editorCard: byId('editor-card'),
  };
}

function showStatus(type, message) {
  if (!els.status) return;
  const map = { success: 'alert-success', error: 'alert-error', info: 'alert-info' };
  els.status.className = `alert ${map[type] || 'alert-info'}`;
  els.status.textContent = message;
  els.status.classList.remove('hidden');
}

function showResult(type, message) {
  if (!els.result) return;
  els.result.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
  els.result.textContent = message;
  els.result.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab[data-tab]').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  els.panelXtream?.classList.toggle('hidden', tab !== 'xtream');
  els.panelM3u?.classList.toggle('hidden', tab !== 'm3u');
}

function updateDeviceMeta() {
  if (!els.deviceMeta) return;
  const badges = [];
  if (state.registered) badges.push('<span class="badge ok">FOX PLAYER registered</span>');
  else badges.push('<span class="badge err">Not registered — open the app first</span>');
  if (state.paired) badges.push('<span class="badge ok">Manage mode (QR link)</span>');
  else if (state.registered && !state.idLock) badges.push('<span class="badge ok">Upload enabled</span>');
  if (state.idLock) badges.push('<span class="badge err">ID lock ON</span>');
  els.deviceMeta.innerHTML = badges.join('');
  els.manageHint?.classList.toggle('hidden', state.paired || !state.playlists?.length);
}

/** Add new playlist — Device ID + registered + not locked (no token required). */
function canUpload() {
  return state.registered && !state.idLock;
}

/** Edit / delete — requires valid QR pairing token. */
function canModifyPlaylists() {
  return state.registered && state.paired && !state.idLock;
}

function setUploadEnabled(enabled) {
  const form = byId('playlist-form');
  form?.querySelectorAll('input, button, select, textarea').forEach((el) => {
    if (el.id === 'cancel-edit-btn') return;
    el.disabled = !enabled;
  });
  document.querySelectorAll('.tab[data-tab]').forEach((t) => {
    t.disabled = !enabled;
  });
  els.lockBanner?.classList.toggle('hidden', !state.idLock);
  els.uploadSection?.classList.toggle('is-locked', !enabled);
  els.editorCard?.classList.toggle('is-ready', enabled);
  if (els.uploadLockHint) {
    els.uploadLockHint.classList.toggle('hidden', enabled || state.idLock);
  }
}

function resetForm() {
  if (els.editDpId) els.editDpId.value = '';
  if (els.formTitle) els.formTitle.textContent = 'Add playlist';
  if (els.formSub) els.formSub.textContent = 'Xtream / Trex or M3U from your licensed provider.';
  els.cancelEdit?.classList.add('hidden');
  byId('pl-name').value = '';
  byId('pl-server').value = '';
  byId('pl-user').value = '';
  byId('pl-pass').value = '';
  byId('pl-m3u').value = '';
  byId('pl-pass')?.setAttribute('placeholder', 'Required for new uploads');
}

function renderPlaylists() {
  const rows = state.playlists || [];
  const showList = state.deviceId && (rows.length > 0 || state.paired);
  els.playlistsCard?.classList.toggle('hidden', !showList);
  els.playlistEmpty?.classList.toggle('hidden', rows.length > 0);
  if (!els.playlistList) return;
  if (!rows.length) {
    els.playlistList.innerHTML = '';
    return;
  }
  els.playlistList.innerHTML = rows
    .map((p) => {
      const label = p.playlist_name || p.type || 'Playlist';
      const url = (p.server_url || p.playlist_url || '').trim() || '—';
      const active = p.is_active ? '<span class="badge ok">Active</span>' : '';
      const actions = canModifyPlaylists()
        ? `<button type="button" class="icon-btn btn-edit" data-id="${p.device_playlist_id}" title="Edit">Edit</button>
          <button type="button" class="icon-btn btn-del" data-id="${p.device_playlist_id}" title="Remove" style="color:#fca5a5">Del</button>`
        : '';
      return `<div class="playlist-row" data-dp="${p.device_playlist_id}">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600">${escapeHtml(label)} ${active}</div>
          <div style="font-size:0.82rem;color:var(--text-muted);word-break:break-all">${escapeHtml(url)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">${actions}</div>
      </div>`;
    })
    .join('');

  els.playlistList.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => startEdit(Number(btn.dataset.id)));
  });
  els.playlistList.querySelectorAll('.btn-del').forEach((btn) => {
    btn.addEventListener('click', () => removePlaylist(Number(btn.dataset.id)));
  });
}

async function loadPlaylists() {
  if (!state.deviceId) return;

  try {
    if (state.token && state.paired) {
      const res = await apiEncrypted(
        `/api/device/${encodeURIComponent(state.deviceId)}/portal-data?token=${encodeURIComponent(state.token)}`,
      );
      state.playlists = res.payload?.playlists || [];
      if (typeof res.payload?.id_lock === 'boolean') state.idLock = res.payload.id_lock;
    } else {
      const res = await apiEncrypted(`/api/device/${encodeURIComponent(state.deviceId)}/playlists`);
      const list = res.payload?.playlists ?? res.payload ?? [];
      state.playlists = Array.isArray(list) ? list : [];
      if (typeof res.payload?.id_lock === 'boolean') state.idLock = res.payload.id_lock;
    }
  } catch {
    state.playlists = [];
  }

  updateDeviceMeta();
  setUploadEnabled(canUpload());
  renderPlaylists();
}

function startEdit(devicePlaylistId) {
  if (!canModifyPlaylists()) return;
  const p = state.playlists.find((x) => Number(x.device_playlist_id) === devicePlaylistId);
  if (!p) return;
  if (els.editDpId) els.editDpId.value = String(devicePlaylistId);
  if (els.formTitle) els.formTitle.textContent = 'Edit playlist';
  if (els.formSub) els.formSub.textContent = `Editing “${p.playlist_name || 'Playlist'}”. Password optional.`;
  els.cancelEdit?.classList.remove('hidden');
  byId('pl-name').value = p.playlist_name || '';
  if (p.type === 'm3u' || p.playlist_url) {
    setTab('m3u');
    byId('pl-m3u').value = p.playlist_url || '';
  } else {
    setTab('xtream');
    byId('pl-server').value = p.server_url || '';
    byId('pl-user').value = p.username || '';
  }
  byId('pl-pass').value = '';
  byId('pl-pass')?.setAttribute('placeholder', 'Leave blank to keep current password');
  els.editorCard?.scrollIntoView({ behavior: 'smooth' });
}

async function removePlaylist(devicePlaylistId) {
  if (!canModifyPlaylists()) return;
  if (!confirm('Remove this playlist from your device?')) return;
  await apiRequest(
    `/api/device/${encodeURIComponent(state.deviceId)}/playlists/${devicePlaylistId}?token=${encodeURIComponent(state.token)}`,
    { method: 'DELETE' },
  );
  await loadPlaylists();
  resetForm();
}

function showPortalEntryMode() {
  els.entryPanel?.classList.remove('hidden');
  els.deviceCard?.classList.add('hidden');
  els.mainPanel?.classList.remove('hidden');
  setUploadEnabled(false);
}

function showPortalDeviceMode() {
  els.entryPanel?.classList.add('hidden');
  els.deviceCard?.classList.remove('hidden');
  els.mainPanel?.classList.remove('hidden');
}

function showEntryError(message) {
  if (!els.entryErr) return;
  if (!message) {
    els.entryErr.classList.add('hidden');
    return;
  }
  els.entryErr.textContent = message;
  els.entryErr.classList.remove('hidden');
}

function updateUrlForSession() {
  const onUpload = /\/upload\/?$/i.test(window.location.pathname);
  if (onUpload) {
    const params = new URLSearchParams();
    if (state.deviceId) params.set('device_id', state.deviceId);
    const qs = params.toString();
    history.replaceState({}, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    return;
  }
  if (state.deviceId) {
    const params = new URLSearchParams();
    if (state.token) params.set('token', state.token);
    const qs = params.toString();
    history.replaceState({}, '', `/portal/${encodeURIComponent(state.deviceId)}${qs ? `?${qs}` : ''}`);
  }
}

async function connectDevice(deviceId, token = '') {
  showEntryError('');
  state.deviceId = normalizeDeviceId(deviceId);
  state.token = String(token ?? '').trim();
  state.paired = false;

  if (!state.deviceId) {
    showEntryError('Enter your Device ID from FOX PLAYER Setup.');
    return;
  }

  updateUrlForSession();
  showPortalDeviceMode();
  if (els.deviceBadge) els.deviceBadge.textContent = state.deviceId;
  await bootstrapFromUrl();
}

async function bootstrapFromUrl() {
  const fromPath = window.location.pathname.match(/\/(?:portal|manage)\/([^/]+)\/?$/i);
  const q = readQueryParams();
  state.deviceId = normalizeDeviceId(q.deviceId || (fromPath ? decodeURIComponent(fromPath[1]) : ''));
  if (!state.token) state.token = q.token ? String(q.token).trim() : '';

  if (!state.deviceId) {
    showPortalEntryMode();
    return;
  }

  if (state.token || fromPath) {
    showPortalDeviceMode();
  }
  if (els.deviceBadge) els.deviceBadge.textContent = state.deviceId;
  els.mainPanel?.classList.remove('hidden');

  try {
    const val = await apiRequest(`/api/device/${encodeURIComponent(state.deviceId)}/validate`);
    state.registered = !!val.registered;
    state.idLock = !!val.id_lock;
  } catch (err) {
    state.registered = false;
    showPortalDeviceMode();
    showStatus('error', err.message || 'This device is not registered. Open FOX PLAYER on your device first.');
    updateDeviceMeta();
    setUploadEnabled(false);
    return;
  }

  if (state.idLock) {
    updateDeviceMeta();
    setUploadEnabled(false);
    showStatus('error', 'ID lock is on. Turn it off in FOX PLAYER Settings, then try again.');
    return;
  }

  if (!state.token) {
    updateDeviceMeta();
    setUploadEnabled(canUpload());
    showStatus(
      'success',
      'Device verified. Add your playlist below. To edit or delete playlists, open the QR link from the app.',
    );
    await loadPlaylists();
    return;
  }

  try {
    const res = await apiRequest(
      `/api/device/${encodeURIComponent(state.deviceId)}/pairing-status?token=${encodeURIComponent(state.token)}`,
    );
    state.paired = !!res.valid;
    if (typeof res.id_lock === 'boolean') state.idLock = res.id_lock;

    updateDeviceMeta();

    if (!state.paired) {
      setUploadEnabled(canUpload());
      showStatus('error', 'QR link expired or invalid. You can still add a new playlist if upload is enabled.');
      await loadPlaylists();
      return;
    }

    if (state.idLock) {
      setUploadEnabled(false);
      showStatus('error', 'ID lock is on. Unlock in the app to manage playlists.');
      await loadPlaylists();
      return;
    }

    showStatus('success', 'Manage mode — you can upload, edit, or delete playlists, then reload in the app.');
    setUploadEnabled(canUpload());
    await loadPlaylists();
  } catch (err) {
    showStatus('error', err.message || 'Could not verify QR link.');
    setUploadEnabled(canUpload());
    await loadPlaylists();
  }
}

async function submitPlaylist(e) {
  e.preventDefault();
  const editId = els.editDpId?.value ? Number(els.editDpId.value) : 0;

  if (editId) {
    if (!canModifyPlaylists()) {
      showResult('error', 'Edit requires the QR link from the app.');
      return;
    }
  } else if (!canUpload()) {
    showResult('error', state.idLock ? 'Device is locked — unlock in the app first.' : 'Verify your Device ID first.');
    return;
  }

  els.result?.classList.add('hidden');
  if (els.submitBtn) els.submitBtn.disabled = true;

  const name = byId('pl-name')?.value?.trim() || 'My Playlist';

  try {
    if (editId) {
      const body = { token: state.token, playlist_name: name };
      if (state.activeTab === 'xtream') {
        body.server_url = byId('pl-server')?.value?.trim();
        body.username = byId('pl-user')?.value?.trim();
        const pass = byId('pl-pass')?.value;
        if (pass) body.password = pass;
      } else {
        body.playlist_url = byId('pl-m3u')?.value?.trim();
      }
      await apiRequest(`/api/device/${encodeURIComponent(state.deviceId)}/playlists/${editId}`, {
        method: 'PUT',
        body,
      });
      showResult('success', 'Playlist updated.');
      resetForm();
      await loadPlaylists();
    } else {
      let payload = { playlist_name: name, name };
      if (state.activeTab === 'xtream') {
        payload.type = 'xtream';
        payload.server_url = byId('pl-server')?.value?.trim();
        payload.username = byId('pl-user')?.value?.trim();
        payload.password = byId('pl-pass')?.value;
        if (!payload.server_url || !payload.username || !payload.password) {
          showResult('error', 'Server URL, username, and password are required.');
          return;
        }
        if (!/^https?:\/\//i.test(payload.server_url)) payload.server_url = `http://${payload.server_url}`;
      } else {
        payload.type = 'm3u';
        payload.playlist_url = byId('pl-m3u')?.value?.trim();
        if (!payload.playlist_url) {
          showResult('error', 'M3U URL is required.');
          return;
        }
      }
      await apiRequest(`/api/device/${encodeURIComponent(state.deviceId)}/playlists`, {
        method: 'POST',
        body: payload,
        deviceId: state.deviceId,
      });
      showResult('success', 'Playlist saved. Open the app and tap Reload playlist.');
      resetForm();
      await loadPlaylists();
    }
  } catch (err) {
    showResult('error', err.message || 'Failed to save.');
  } finally {
    if (els.submitBtn) els.submitBtn.disabled = false;
  }
}

function initPortal() {
  if (document.body?.dataset?.foxPage !== 'portal') return;
  els = bindEls();
  if (!els.deviceBadge || !byId('playlist-form')) return;

  document.querySelectorAll('.tab[data-tab]').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  });
  byId('playlist-form')?.addEventListener('submit', submitPlaylist);
  els.cancelEdit?.addEventListener('click', resetForm);

  els.entryForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = byId('entry-device-id')?.value || '';
    const parsed = parseDeviceInput(raw);
    const btn = els.entryForm?.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      await connectDevice(parsed.deviceId || raw, parsed.token);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  byId('change-device-btn')?.addEventListener('click', () => {
    state.deviceId = '';
    state.token = '';
    state.paired = false;
    state.registered = false;
    state.playlists = [];
    const onUpload = /\/upload\/?$/i.test(window.location.pathname);
    history.replaceState({}, '', onUpload ? '/upload/' : '/portal/');
    showPortalEntryMode();
    els.status?.classList.add('hidden');
    byId('entry-device-id').value = '';
    renderPlaylists();
  });

  setTab('xtream');
  els.uploadSection?.classList.add('is-locked');
  bootstrapFromUrl();
}

onReady(initPortal);
