import { apiRequest, apiEncrypted, readQueryParams } from './api-client.js';
import { onReady, byId } from './dom-safe.js';

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

function bindEls() {
  return {
    entryPanel: byId('entry-panel'),
    deviceCard: byId('device-card'),
    entryForm: byId('portal-entry-form'),
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
  if (state.registered) badges.push('<span class="badge ok">Registered in FOX PLAYER</span>');
  else badges.push('<span class="badge err">Not registered — open the app first</span>');
  if (state.paired) badges.push('<span class="badge ok">Secure link verified</span>');
  else if (state.token) badges.push('<span class="badge err">Pairing link invalid or expired</span>');
  if (state.idLock) badges.push('<span class="badge err">ID lock ON</span>');
  else if (state.registered) badges.push('<span class="badge ok">ID lock off — uploads allowed</span>');
  els.deviceMeta.innerHTML = badges.join('');
}

function setUploadEnabled(enabled) {
  const form = byId('playlist-form');
  form?.querySelectorAll('input, button, select, textarea').forEach((el) => {
    if (el.id === 'cancel-edit-btn') return;
    el.disabled = !enabled;
  });
  els.lockBanner?.classList.toggle('hidden', !state.idLock);
  els.editorCard?.classList.toggle('hidden', state.idLock && !state.playlists?.length);
}

function resetForm() {
  if (els.editDpId) els.editDpId.value = '';
  if (els.formTitle) els.formTitle.textContent = 'Upload playlist';
  if (els.formSub) els.formSub.textContent = 'Add your licensed Xtream or M3U playlist.';
  els.cancelEdit?.classList.add('hidden');
  byId('pl-name').value = '';
  byId('pl-server').value = '';
  byId('pl-user').value = '';
  byId('pl-pass').value = '';
  byId('pl-m3u').value = '';
  byId('pl-pass')?.setAttribute('placeholder', 'Required for new uploads');
}

function canModifyPlaylists() {
  return state.registered && state.paired && !state.idLock;
}

function renderPlaylists() {
  const rows = state.playlists || [];
  els.playlistEmpty?.classList.toggle('hidden', rows.length > 0);
  if (!els.playlistList) return;
  if (!rows.length) {
    els.playlistList.innerHTML = '';
    return;
  }
  els.playlistList.innerHTML = rows
    .map((p) => {
      const label = p.playlist_name || p.type || 'Playlist';
      const sub = p.server_url || p.playlist_url || '—';
      const active = p.is_active ? '<span class="badge ok">Active</span>' : '';
      return `<div class="playlist-row" data-dp="${p.device_playlist_id}">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600">${escapeHtml(label)} ${active}</div>
          <div style="font-size:0.82rem;color:var(--text-muted);word-break:break-all">${escapeHtml(sub)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(p.username || '')}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${canModifyPlaylists() ? `<button type="button" class="icon-btn btn-edit" data-id="${p.device_playlist_id}" title="Edit">Edit</button>
          <button type="button" class="icon-btn btn-del" data-id="${p.device_playlist_id}" title="Remove" style="color:#fca5a5">Del</button>` : '<span class="badge">View only</span>'}
        </div>
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
  if (!state.token) return;
  const res = await apiEncrypted(
    `/api/device/${encodeURIComponent(state.deviceId)}/portal-data?token=${encodeURIComponent(state.token)}`,
  );
  state.playlists = res.payload?.playlists || [];
  if (typeof res.payload?.id_lock === 'boolean') state.idLock = res.payload.id_lock;
  updateDeviceMeta();
  setUploadEnabled(canModifyPlaylists());
  renderPlaylists();
}

function startEdit(devicePlaylistId) {
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
  els.mainPanel?.classList.add('hidden');
  els.status?.classList.add('hidden');
}

function showPortalDeviceMode() {
  els.entryPanel?.classList.add('hidden');
  els.deviceCard?.classList.remove('hidden');
  els.mainPanel?.classList.remove('hidden');
}

function goToPortalWithCredentials(deviceId, token) {
  const id = normalizeDeviceId(deviceId);
  const t = String(token ?? '').trim();
  if (!id) return;
  const qs = t ? `?token=${encodeURIComponent(t)}` : '';
  window.location.assign(`/portal/${encodeURIComponent(id)}${qs}`);
}

async function bootstrapFromUrl() {
  const fromPath = window.location.pathname.match(/\/(?:portal|manage)\/([^/]+)\/?$/i);
  const q = readQueryParams();
  state.deviceId = normalizeDeviceId(q.deviceId || (fromPath ? decodeURIComponent(fromPath[1]) : ''));
  state.token = q.token ? String(q.token).trim() : '';

  if (!state.deviceId) {
    showPortalEntryMode();
    return;
  }
  showPortalDeviceMode();
  if (els.deviceBadge) els.deviceBadge.textContent = state.deviceId;

  els.mainPanel?.classList.remove('hidden');

  try {
    const val = await apiRequest(`/api/device/${encodeURIComponent(state.deviceId)}/validate`);
    state.registered = !!val.registered;
    state.idLock = !!val.id_lock;
  } catch (err) {
    state.registered = false;
    showStatus('error', err.message || 'This device is not registered. Open FOX PLAYER on your TV or phone first.');
    updateDeviceMeta();
    setUploadEnabled(false);
    return;
  }

  if (!state.token) {
    updateDeviceMeta();
    setUploadEnabled(false);
    showStatus('info', 'Scan the QR code in the app to verify this link, then you can upload your playlist.');
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
      setUploadEnabled(false);
      showStatus('error', 'Pairing link expired or invalid. Scan the QR code again in the app.');
      return;
    }

    if (state.idLock) {
      setUploadEnabled(false);
      showStatus('error', 'Device ID is locked in the app. Unlock it in Settings to upload your playlist here.');
      await loadPlaylists();
      return;
    }

    showStatus('success', 'Device verified — you can upload or manage your playlist below, then reload in the app.');
    setUploadEnabled(true);
    await loadPlaylists();
  } catch (err) {
    showStatus('error', err.message || 'Could not verify pairing link.');
    setUploadEnabled(false);
  }
}

async function submitPlaylist(e) {
  e.preventDefault();
  if (!canModifyPlaylists()) {
    showResult('error', state.idLock ? 'Device is locked — unlock in the app first.' : 'Verify your QR link before uploading.');
    return;
  }
  els.result?.classList.add('hidden');
  if (els.submitBtn) els.submitBtn.disabled = true;

  const editId = els.editDpId?.value ? Number(els.editDpId.value) : 0;
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
      await apiRequest('/api/auth/pair', {
        method: 'POST',
        body: { device_id: state.deviceId, token: state.token },
      });
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
  els.entryForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = byId('entry-device-id')?.value;
    const token = byId('entry-token')?.value;
    if (!normalizeDeviceId(id)) {
      alert('Enter your Device ID from FOX PLAYER Setup.');
      return;
    }
    if (!String(token ?? '').trim()) {
      alert('Paste the pairing token from the QR link (?token=…) in the app.');
      return;
    }
    goToPortalWithCredentials(id, token);
  });

  setTab('xtream');
  bootstrapFromUrl();
}

onReady(initPortal);
