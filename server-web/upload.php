<?php
$pageTitle = 'Upload Playlist — FOX PLAYER';
$activeNav = 'upload';
require_once __DIR__ . '/header.php';
$prefillId = htmlspecialchars($_GET['device-id'] ?? ($_GET['mac'] ?? ''));
?>

<main class="section">
  <div class="container" style="max-width: 860px;">
    <!-- Notice Banner -->
    <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-lg); padding: 16px 20px; display: flex; align-items: center; gap: 14px; margin-bottom: 28px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <div style="font-size: 14px; color: #93C5FD;">
        <strong>FOX PLAYER</strong> supports all formats of M3U playlists and Xtream Codes servers with ultra-low latency playback.
      </div>
    </div>

    <!-- Main Management Card -->
    <div class="panel-card">
      <!-- Tabs Navigation -->
      <div class="tab-nav">
        <button class="tab-btn active" onclick="switchTab('upload')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          Upload Playlist
        </button>
        <button class="tab-btn" onclick="switchTab('manage')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          My Playlists
        </button>
        <button class="tab-btn" onclick="switchTab('delete')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          Wipe Playlist
        </button>
      </div>

      <!-- Tab 1: Upload Playlist Form -->
      <div id="tab-upload">
        <div class="panel-header">
          <h2 class="panel-title">Upload your Playlist</h2>
          <p class="panel-desc">Enter your Device ID or MAC Address from the FOX PLAYER app to link your playlist.</p>
        </div>

        <form id="upload-form" onsubmit="handleUploadPlaylist(event)">
          <div class="form-group">
            <label class="form-label" for="mac-input">Device ID or MAC Address *</label>
            <input type="text" id="mac-input" class="form-input" placeholder="e.g. 00:1A:79:XX:XX:XX or 1PFDES0P" value="<?php echo $prefillId; ?>" required autocomplete="off">
            <div id="mac-validation-msg"></div>
            <small style="color: var(--text-muted); font-size: 12px; display: block; margin-top: 4px;">Found in FOX PLAYER Settings or Pairing screen.</small>
          </div>

          <div class="form-group">
            <label class="form-label" for="playlist-name">Playlist Name</label>
            <input type="text" id="playlist-name" class="form-input" placeholder="e.g. My VIP IPTV" value="My Playlist">
          </div>

          <div class="form-group">
            <label class="form-label">Playlist Type</label>
            <div style="display: flex; gap: 16px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" name="playlist-type" value="m3u" checked onchange="toggleType('m3u')">
                <span>M3U Playlist URL</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" name="playlist-type" value="xtream" onchange="toggleType('xtream')">
                <span>Xtream Codes API</span>
              </label>
            </div>
          </div>

          <!-- M3U Fields -->
          <div id="m3u-fields">
            <div class="form-group">
              <label class="form-label" for="m3u-url">M3U Playlist URL *</label>
              <input type="url" id="m3u-url" class="form-input" placeholder="http://server.example:8080/get.php?username=...&password=...&type=m3u_plus">
            </div>
          </div>

          <!-- Xtream Fields -->
          <div id="xtream-fields" style="display: none;">
            <div class="form-group">
              <label class="form-label" for="xtream-server">Server URL (Host & Port) *</label>
              <input type="text" id="xtream-server" class="form-input" placeholder="http://iptv-server.domain:8080">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label class="form-label" for="xtream-user">Username *</label>
                <input type="text" id="xtream-user" class="form-input" placeholder="Username">
              </div>
              <div class="form-group">
                <label class="form-label" for="xtream-pass">Password *</label>
                <input type="password" id="xtream-pass" class="form-input" placeholder="Password">
              </div>
            </div>
          </div>

          <button type="submit" id="btn-upload" class="btn btn-primary btn-block" style="padding: 14px; margin-top: 10px;">
            Save & Link Playlist
          </button>
        </form>
      </div>

      <!-- Tab 2: My Playlists -->
      <div id="tab-manage" style="display: none;">
        <div class="panel-header">
          <h2 class="panel-title">Manage Connected Playlists</h2>
          <p class="panel-desc">View existing playlists linked to your device, switch active playlist, or remove items.</p>
        </div>

        <div style="margin-bottom: 24px;">
          <div style="display: flex; gap: 12px;">
            <input type="text" id="manage-mac" class="form-input" placeholder="Enter Device ID or MAC Address" value="<?php echo $prefillId; ?>" autocomplete="off">
            <button class="btn btn-primary" id="btn-fetch-playlists" onclick="loadMyPlaylists()">Fetch Playlists</button>
          </div>
          <div id="manage-validation-msg"></div>
        </div>

        <div id="playlists-list-container">
          <p style="color: var(--text-muted); text-align: center; padding: 30px;">Enter your Device ID or MAC above and click Fetch Playlists.</p>
        </div>
      </div>

      <!-- Tab 3: Wipe All Playlists -->
      <div id="tab-delete" style="display: none;">
        <div class="panel-header">
          <h2 class="panel-title">Delete All Playlists</h2>
          <p class="panel-desc">Completely remove all uploaded playlist links and servers from your device.</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="wipe-mac">Your MAC Address or Device ID *</label>
          <input type="text" id="wipe-mac" class="form-input" placeholder="e.g. 00:1A:79:XX:XX:XX or 1PFDES0P" value="<?php echo $prefillId; ?>" autocomplete="off">
          <div id="wipe-validation-msg"></div>
        </div>

        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--radius-md); padding: 14px; margin-bottom: 20px; font-size: 13px; color: #FCA5A5;">
          <strong>Warning:</strong> This operation will irreversibly wipe all linked playlists from your FOX PLAYER account. You will need to re-upload your list to resume watching.
        </div>

        <button class="btn btn-danger btn-block" id="btn-wipe" onclick="handleWipeAll()">Delete All Playlist Links</button>
      </div>
    </div>
  </div>
</main>

<script>
  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.remove('active');
    });
    event.currentTarget.classList.add('active');

    ['upload', 'manage', 'delete'].forEach(t => {
      document.getElementById('tab-' + t).style.display = (t === tab) ? 'block' : 'none';
    });
  }

  function toggleType(type) {
    document.getElementById('m3u-fields').style.display = (type === 'm3u') ? 'block' : 'none';
    document.getElementById('xtream-fields').style.display = (type === 'xtream') ? 'block' : 'none';
  }

  // Live Device Verification & Lock Check
  let validationDebounceTimer = null;

  async function checkDevice(deviceId, msgContainerId, btnId) {
    const container = document.getElementById(msgContainerId);
    const btn = btnId ? document.getElementById(btnId) : null;
    const clean = (deviceId || '').trim().toUpperCase();

    if (!clean) {
      if (container) container.innerHTML = '';
      if (btn) btn.disabled = false;
      return { valid: false, locked: false };
    }

    if (container) {
      container.innerHTML = `
        <div class="validation-alert validation-alert-loading">
          <div class="alert-icon">⏳</div>
          <div>Checking Device ID with FOX PLAYER server...</div>
        </div>
      `;
    }

    try {
      const res = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(clean)}/validate`);
      const data = await res.json();

      if (!res.ok || !data.success || !data.registered) {
        if (container) {
          container.innerHTML = `
            <div class="validation-alert validation-alert-error">
              <div class="alert-icon">❌</div>
              <div>
                <strong>Device ID Not Recognized</strong>
                <p>This Device ID has not been registered by FOX PLAYER app yet. Please open the FOX PLAYER app on your TV or phone first so your official Device ID is generated and registered.</p>
              </div>
            </div>
          `;
        }
        if (btn) btn.disabled = true;
        return { valid: false, locked: false };
      }

      if (data.id_lock) {
        if (container) {
          container.innerHTML = `
            <div class="validation-alert validation-alert-locked">
              <div class="alert-icon">🔒</div>
              <div>
                <strong>Device is Locked in FOX PLAYER App</strong>
                <p>Device ID Lock is currently turned ON in your TV / App Settings. Website playlist modifications are blocked for security. Please open FOX PLAYER on your TV/device, go to <em>Settings</em>, and turn OFF <strong>"Lock ID"</strong> to make changes here.</p>
              </div>
            </div>
          `;
        }
        if (btn) btn.disabled = true;
        return { valid: true, locked: true };
      }

      if (container) {
        container.innerHTML = `
          <div class="validation-alert validation-alert-success">
            <div class="alert-icon">✓</div>
            <div>
              <strong>Device Verified & Unlocked</strong>
              <p>Device ID confirmed in FOX PLAYER system. Ready for playlist management.</p>
            </div>
          </div>
        `;
      }
      if (btn) btn.disabled = false;
      return { valid: true, locked: false };
    } catch (err) {
      if (container) {
        container.innerHTML = `
          <div class="validation-alert validation-alert-error">
            <div class="alert-icon">⚠️</div>
            <div>Network error checking device: ${err.message}</div>
          </div>
        `;
      }
      return { valid: false, locked: false };
    }
  }

  // Setup live input listeners
  function setupDeviceInputWatcher(inputId, msgId, btnId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', (e) => {
      clearTimeout(validationDebounceTimer);
      const val = e.target.value.trim().toUpperCase();
      validationDebounceTimer = setTimeout(() => {
        checkDevice(val, msgId, btnId);
      }, 450);
    });

    input.addEventListener('blur', (e) => {
      const val = e.target.value.trim().toUpperCase();
      checkDevice(val, msgId, btnId);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupDeviceInputWatcher('mac-input', 'mac-validation-msg', 'btn-upload');
    setupDeviceInputWatcher('manage-mac', 'manage-validation-msg', 'btn-fetch-playlists');
    setupDeviceInputWatcher('wipe-mac', 'wipe-validation-msg', 'btn-wipe');

    // If prefilled, trigger check
    const prefill = document.getElementById('mac-input').value.trim();
    if (prefill) {
      checkDevice(prefill, 'mac-validation-msg', 'btn-upload');
    }
  });

  // Handle Upload Playlist
  async function handleUploadPlaylist(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-upload');
    const mac = document.getElementById('mac-input').value.trim().toUpperCase();
    const name = document.getElementById('playlist-name').value.trim();
    const type = document.querySelector('input[name="playlist-type"]:checked').value;

    if (!mac) {
      showToast('Please enter your Device ID or MAC Address.', 'error');
      return;
    }

    // Verify device status before sending
    btn.disabled = true;
    btn.textContent = 'Verifying Device...';

    const check = await checkDevice(mac, 'mac-validation-msg', 'btn-upload');
    if (!check.valid) {
      showToast('Device ID not found! Please open FOX PLAYER app on your TV/device first.', 'error');
      btn.disabled = false;
      btn.textContent = 'Save & Link Playlist';
      return;
    }
    if (check.locked) {
      showToast('Device is Locked! Unlock in FOX PLAYER App Settings first.', 'error');
      btn.disabled = true;
      btn.textContent = 'Save & Link Playlist (Locked)';
      return;
    }

    const payload = {
      device_id: mac,
      playlist_name: name || 'My Playlist',
      type: type
    };

    if (type === 'm3u') {
      const url = document.getElementById('m3u-url').value.trim();
      if (!url) {
        showToast('Please enter your M3U Playlist URL.', 'error');
        btn.disabled = false;
        btn.textContent = 'Save & Link Playlist';
        return;
      }
      payload.playlist_url = url;
    } else {
      const server = document.getElementById('xtream-server').value.trim();
      const user = document.getElementById('xtream-user').value.trim();
      const pass = document.getElementById('xtream-pass').value.trim();
      if (!server || !user || !pass) {
        showToast('Please fill all Xtream Codes server fields.', 'error');
        btn.disabled = false;
        btn.textContent = 'Save & Link Playlist';
        return;
      }
      payload.server_url = server;
      payload.username = user;
      payload.password = pass;
    }

    btn.textContent = 'Saving Playlist...';

    try {
      const res = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(mac)}/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        showToast('Playlist uploaded successfully! Reload your FOX PLAYER app.', 'success');
        document.getElementById('upload-form').reset();
        document.getElementById('mac-input').value = mac;
        checkDevice(mac, 'mac-validation-msg', 'btn-upload');
      } else {
        if (data.error?.code === 'DEVICE_LOCKED') {
          showToast('Device is Locked! Please unlock from FOX PLAYER app settings first.', 'error');
          checkDevice(mac, 'mac-validation-msg', 'btn-upload');
        } else if (data.error?.code === 'DEVICE_NOT_FOUND') {
          showToast('Device ID not found. Open FOX PLAYER app first so your ID is registered.', 'error');
          checkDevice(mac, 'mac-validation-msg', 'btn-upload');
        } else {
          showToast(data.error?.message || 'Failed to upload playlist.', 'error');
        }
      }
    } catch (err) {
      showToast('Network error contacting server: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save & Link Playlist';
    }
  }

  // Load playlists for device
  async function loadMyPlaylists() {
    const mac = document.getElementById('manage-mac').value.trim().toUpperCase();
    const container = document.getElementById('playlists-list-container');
    if (!mac) {
      showToast('Please enter Device ID or MAC Address.', 'error');
      return;
    }

    container.innerHTML = '<p style="text-align: center; padding: 20px;">Fetching playlists...</p>';

    // First validate
    const check = await checkDevice(mac, 'manage-validation-msg', 'btn-fetch-playlists');
    if (!check.valid) {
      container.innerHTML = `
        <div class="validation-alert validation-alert-error" style="margin: 20px 0;">
          <div class="alert-icon">❌</div>
          <div>
            <strong>Device ID Not Registered</strong>
            <p>Please open FOX PLAYER app on your TV or mobile device first so your Device ID is generated and registered.</p>
          </div>
        </div>
      `;
      return;
    }

    try {
      const res = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(mac)}/playlists`);
      const data = await res.json();

      if (!data.success) {
        container.innerHTML = `<p style="color: var(--error); text-align: center; padding: 30px;">${data.error?.message || 'Error fetching playlists.'}</p>`;
        return;
      }

      const isLocked = Boolean(data.id_lock);
      let lockNotice = '';
      if (isLocked) {
        lockNotice = `
          <div class="validation-alert validation-alert-locked" style="margin-bottom: 20px;">
            <div class="alert-icon">🔒</div>
            <div>
              <strong>Device is Locked in App Settings</strong>
              <p>Playlists can be viewed, but changing active playlist or deleting playlists is locked. Turn off "Lock ID" in FOX PLAYER App Settings to modify.</p>
            </div>
          </div>
        `;
      }

      if (!data.playlists || data.playlists.length === 0) {
        container.innerHTML = lockNotice + '<p style="color: var(--text-muted); text-align: center; padding: 30px;">No playlists found for this device. Go to "Upload Playlist" tab to add one.</p>';
        return;
      }

      let html = lockNotice + '<div style="display: flex; flex-direction: column; gap: 12px;">';
      data.playlists.forEach(p => {
        html += `
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-card); border-radius: var(--radius-md); padding: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 8px;">
                ${p.playlist_name}
                <span class="badge ${p.is_active ? 'badge-success' : 'badge-info'}">${p.is_active ? 'Active' : 'Inactive'}</span>
                <span class="badge" style="background: rgba(255,255,255,0.06);">${p.type.toUpperCase()}</span>
              </div>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; max-width: 450px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${p.type === 'xtream' ? (p.server_url + ' (' + p.username + ')') : p.playlist_url}
              </div>
            </div>
            <div style="display: flex; gap: 8px;">
              ${!p.is_active ? `<button class="btn btn-sm btn-secondary" ${isLocked ? 'disabled title="Device is Locked"' : ''} onclick="setActivePlaylist('${mac}', ${p.id})">Set Active</button>` : ''}
              <button class="btn btn-sm btn-danger" ${isLocked ? 'disabled title="Device is Locked"' : ''} onclick="deletePlaylist('${mac}', ${p.id})">Delete</button>
            </div>
          </div>
        `;
      });
      html += '</div>';
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<p style="color: var(--error); text-align: center;">Error: ${err.message}</p>`;
    }
  }

  async function setActivePlaylist(mac, id) {
    try {
      const res = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(mac)}/active-playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist_id: id })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Active playlist updated.', 'success');
        loadMyPlaylists();
      } else {
        if (data.error?.code === 'DEVICE_LOCKED') {
          showToast('Device is Locked in App! Unlock from FOX PLAYER settings first.', 'error');
        } else {
          showToast(data.error?.message || 'Error updating active playlist.', 'error');
        }
      }
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    }
  }

  async function deletePlaylist(mac, id) {
    if (!confirm('Are you sure you want to remove this playlist from your device?')) return;
    try {
      const res = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(mac)}/playlist/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        showToast('Playlist deleted.', 'success');
        loadMyPlaylists();
      } else {
        if (data.error?.code === 'DEVICE_LOCKED') {
          showToast('Device is Locked in App! Unlock from FOX PLAYER settings first.', 'error');
        } else {
          showToast(data.error?.message || 'Error deleting playlist.', 'error');
        }
      }
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    }
  }

  async function handleWipeAll() {
    const mac = document.getElementById('wipe-mac').value.trim().toUpperCase();
    if (!mac) {
      showToast('Please enter your Device ID or MAC Address.', 'error');
      return;
    }

    const check = await checkDevice(mac, 'wipe-validation-msg', 'btn-wipe');
    if (!check.valid) {
      showToast('Device ID not found! Launch FOX PLAYER app first.', 'error');
      return;
    }
    if (check.locked) {
      showToast('Device is Locked in App! Unlock from FOX PLAYER settings first.', 'error');
      return;
    }

    if (!confirm('Are you ABSOLUTELY SURE you want to delete ALL playlist links for ' + mac + '? This action cannot be undone.')) return;

    try {
      const res = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(mac)}/playlists/all`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'All playlists removed successfully.', 'success');
      } else {
        if (data.error?.code === 'DEVICE_LOCKED') {
          showToast('Device is Locked in App! Unlock from FOX PLAYER settings first.', 'error');
        } else {
          showToast(data.error?.message || 'Failed to wipe playlists.', 'error');
        }
      }
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    }
  }
</script>

<?php require_once __DIR__ . '/footer.php'; ?>
