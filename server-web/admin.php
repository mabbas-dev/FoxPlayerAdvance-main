<?php
$pageTitle = 'Administration Portal — FOX PLAYER';
$activeNav = 'admin';
require_once __DIR__ . '/header.php';
?>

<main class="section">
  <div class="container">
    <!-- Admin Login Screen (shown when not authenticated) -->
    <div id="admin-login-wrap" style="max-width: 460px; margin: 40px auto;">
      <div class="panel-card" style="box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6); border: 1px solid rgba(249, 115, 22, 0.25);">
        <div class="panel-header" style="text-align: center;">
          <div style="margin-bottom: 20px;">
            <img src="/assets/inside-app-logo.png?v=2.2" alt="FOX PLAYER Logo" style="height: 60px; max-width: 260px; object-fit: contain; filter: drop-shadow(0 4px 12px rgba(249, 115, 22, 0.4));">
          </div>
          <h1 class="panel-title" style="font-size: 22px;">Administrator Sign In</h1>
          <p class="panel-desc">Master access to user licenses, trial settings, and playlists.</p>
        </div>

        <form id="login-form" onsubmit="handleAdminLogin(event)">
          <div class="form-group">
            <label class="form-label" for="admin-pass">Master Admin Key</label>
            <input type="password" id="admin-pass" class="form-input" placeholder="Enter key (default: fox_admin_2026)" required>
          </div>
          <button type="submit" id="btn-login" class="btn btn-primary btn-block" style="padding: 14px;">Access Portal</button>
        </form>
      </div>
    </div>

    <!-- Admin Dashboard (shown when authenticated) -->
    <div id="admin-dashboard-wrap" style="display: none;">
      <!-- Top Action Bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; flex-wrap: wrap; gap: 16px;">
        <div>
          <h1 style="font-family: var(--font-display); font-size: 32px; font-weight: 800;">
            FOX PLAYER <b>Admin Dashboard</b>
          </h1>
          <p style="color: var(--text-secondary); font-size: 14px;">Authoritative management of user subscriptions, playlists, and application trial settings.</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary btn-sm" onclick="loadDashboard()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            Refresh Data
          </button>
          <button class="btn btn-outline btn-sm" onclick="handleLogout()">Logout</button>
        </div>
      </div>

      <!-- KPI Cards Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 32px;">
        <div class="panel-card" style="padding: 22px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">TOTAL REGISTERED USERS</div>
          <div id="stat-total" style="font-size: 34px; font-weight: 800; margin: 8px 0 4px; color: #FFFFFF;">0</div>
          <div id="stat-active-7d" style="font-size: 13px; color: var(--success);">0 Active in past 7 days</div>
        </div>

        <div class="panel-card" style="padding: 22px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">FREE TRIAL USERS</div>
          <div id="stat-trial" style="font-size: 34px; font-weight: 800; margin: 8px 0 4px; color: var(--warning);">0</div>
          <div id="stat-trial-info" style="font-size: 13px; color: var(--text-secondary);">Currently on Free Trial</div>
        </div>

        <div class="panel-card" style="padding: 22px; border-color: rgba(34, 197, 94, 0.3);">
          <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">PAID LICENSED USERS</div>
          <div id="stat-paid" style="font-size: 34px; font-weight: 800; margin: 8px 0 4px; color: var(--success);">0</div>
          <div id="stat-paid-breakdown" style="font-size: 13px; color: var(--text-secondary);">1 Year: 0 | Forever: 0</div>
        </div>

        <div class="panel-card" style="padding: 22px;">
          <div style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">TOTAL PLAYLISTS UPLOADED</div>
          <div id="stat-playlists" style="font-size: 34px; font-weight: 800; margin: 8px 0 4px; color: var(--brand-accent);">0</div>
          <div id="stat-playlists-breakdown" style="font-size: 13px; color: var(--text-secondary);">M3U: 0 | Xtream: 0</div>
        </div>
      </div>

      <!-- Settings & Trial Days Configuration Box -->
      <div class="panel-card" style="margin-bottom: 32px; border: 1px solid rgba(249, 115, 22, 0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
          <div>
            <h2 style="font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              Default App Free Trial Configuration
            </h2>
            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
              Controls how many free trial days every new app user gets upon installation.
            </p>
          </div>

          <form id="trial-settings-form" onsubmit="handleUpdateTrialSettings(event)" style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <label for="trial-days-input" style="font-size: 14px; font-weight: 600;">Trial Duration (Days):</label>
              <input type="number" id="trial-days-input" min="1" max="90" class="form-input" style="width: 90px; text-align: center; padding: 10px;" required>
            </div>

            <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer;">
              <input type="checkbox" id="trial-enabled-chk" checked style="accent-color: var(--brand-primary);">
              <span>Trial Enabled</span>
            </label>

            <button type="submit" id="btn-save-settings" class="btn btn-primary btn-sm" style="padding: 10px 18px;">
              Save Trial Settings
            </button>
          </form>
        </div>
      </div>

      <!-- Users & Devices Table Section -->
      <div class="panel-card">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
          <div>
            <h2 class="panel-title">Devices & User Directory</h2>
            <p class="panel-desc">All devices connected to FOX PLAYER, their active subscription plans, and uploaded playlists.</p>
          </div>

          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <!-- Filter Tabs -->
            <select id="user-filter" class="form-select" style="width: 170px;" onchange="loadUsers()">
              <option value="all">All Users</option>
              <option value="trial">Free Trial Users</option>
              <option value="paid">Paid Users (1Y/Forever)</option>
              <option value="expired">Expired Users</option>
            </select>

            <!-- Search input -->
            <input type="text" id="user-search" class="form-input" placeholder="Search MAC or Device ID..." style="width: 240px;" oninput="debounceSearch()">
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Device ID / MAC</th>
                <th>Status</th>
                <th>Plan Type</th>
                <th>Days Left</th>
                <th>Expires At</th>
                <th>Playlists</th>
                <th>Last Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="users-table-body">
              <tr>
                <td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">Loading devices...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal: View Playlists per user -->
  <div class="modal-overlay" id="playlists-modal">
    <div class="modal-card">
      <button class="modal-close" onclick="closeModal('playlists-modal')">&times;</button>
      <div class="panel-header">
        <h2 class="panel-title" id="modal-playlists-title">Playlists for Device</h2>
        <p class="panel-desc">All playlists configured by this user.</p>
      </div>
      <div id="modal-playlists-content" style="display: flex; flex-direction: column; gap: 12px;"></div>
    </div>
  </div>

  <!-- Modal: Edit Subscription -->
  <div class="modal-overlay" id="edit-sub-modal">
    <div class="modal-card">
      <button class="modal-close" onclick="closeModal('edit-sub-modal')">&times;</button>
      <div class="panel-header">
        <h2 class="panel-title">Modify Device Subscription</h2>
        <p class="panel-desc" id="edit-sub-device-id">Update license plan or duration</p>
      </div>

      <form id="edit-sub-form" onsubmit="handleSaveSubscription(event)">
        <input type="hidden" id="edit-target-device">

        <div class="form-group">
          <label class="form-label" for="edit-plan-type">Subscription Plan</label>
          <select id="edit-plan-type" class="form-select">
            <option value="trial">Free Trial</option>
            <option value="year_1">1 Year License</option>
            <option value="forever">Lifetime Forever</option>
            <option value="custom">Custom Duration</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="edit-duration-days">Duration in Days</label>
          <input type="number" id="edit-duration-days" class="form-input" min="1" value="365">
        </div>

        <div class="form-group">
          <label class="form-label" for="edit-status">Status</label>
          <select id="edit-status" class="form-select">
            <option value="active">Active</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="edit-notes">Admin Notes</label>
          <input type="text" id="edit-notes" class="form-input" placeholder="e.g. Granted by customer support">
        </div>

        <button type="submit" id="btn-save-sub" class="btn btn-primary btn-block" style="padding: 14px;">Save Subscription Changes</button>
      </form>
    </div>
  </div>
</main>

<script>
  let adminToken = sessionStorage.getItem('fox_admin_token') || '';
  let searchTimeout = null;

  // Initialize view
  document.addEventListener('DOMContentLoaded', () => {
    if (adminToken) {
      document.getElementById('admin-login-wrap').style.display = 'none';
      document.getElementById('admin-dashboard-wrap').style.display = 'block';
      loadDashboard();
    } else {
      document.getElementById('admin-login-wrap').style.display = 'block';
      document.getElementById('admin-dashboard-wrap').style.display = 'none';
    }
  });

  async function handleAdminLogin(e) {
    e.preventDefault();
    const pass = document.getElementById('admin-pass').value.trim();
    const btn = document.getElementById('btn-login');

    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
      const res = await fetch(`${window.API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      const data = await res.json();

      if (data.success) {
        adminToken = data.token || pass;
        sessionStorage.setItem('fox_admin_token', adminToken);
        document.getElementById('admin-login-wrap').style.display = 'none';
        document.getElementById('admin-dashboard-wrap').style.display = 'block';
        showToast('Logged in successfully.', 'success');
        loadDashboard();
      } else {
        showToast(data.error?.message || 'Incorrect admin secret.', 'error');
      }
    } catch (err) {
      showToast('Login error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Access Portal';
    }
  }

  function handleLogout() {
    sessionStorage.removeItem('fox_admin_token');
    location.reload();
  }

  async function loadDashboard() {
    await Promise.all([
      loadStats(),
      loadTrialSettings(),
      loadUsers()
    ]);
  }

  // Fetch KPI Stats
  async function loadStats() {
    try {
      const res = await fetch(`${window.API_BASE}/api/admin/stats`, {
        headers: { 'x-admin-key': adminToken }
      });
      const data = await res.json();
      if (!data.success) return;

      const s = data.stats;
      document.getElementById('stat-total').textContent = s.total_devices;
      document.getElementById('stat-active-7d').textContent = `${s.active_devices_7d} Active in past 7 days`;
      document.getElementById('stat-trial').textContent = s.trial_users;
      document.getElementById('stat-paid').textContent = s.paid_users;
      document.getElementById('stat-paid-breakdown').textContent = `1 Year: ${s.paid_1year} | Forever: ${s.paid_forever}`;
      document.getElementById('stat-playlists').textContent = s.total_playlists;
      document.getElementById('stat-playlists-breakdown').textContent = `M3U: ${s.m3u_playlists} | Xtream: ${s.xtream_playlists}`;
    } catch (e) {
      console.error('Stats error:', e);
    }
  }

  // Load Trial Duration Settings
  async function loadTrialSettings() {
    try {
      const res = await fetch(`${window.API_BASE}/api/admin/trial-settings`, {
        headers: { 'x-admin-key': adminToken }
      });
      const data = await res.json();
      if (data.success && data.settings) {
        document.getElementById('trial-days-input').value = data.settings.trial_duration_days || 7;
        document.getElementById('trial-enabled-chk').checked = Boolean(data.settings.trial_enabled);
      }
    } catch (e) {
      console.error('Trial settings error:', e);
    }
  }

  // Save Trial Duration Settings
  async function handleUpdateTrialSettings(e) {
    e.preventDefault();
    const days = parseInt(document.getElementById('trial-days-input').value, 10);
    const enabled = document.getElementById('trial-enabled-chk').checked ? 1 : 0;
    const btn = document.getElementById('btn-save-settings');

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const res = await fetch(`${window.API_BASE}/api/admin/trial-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminToken
        },
        body: JSON.stringify({ trial_duration_days: days, trial_enabled: enabled })
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Default trial duration updated to ${days} days!`, 'success');
      } else {
        showToast(data.error?.message || 'Failed to update settings.', 'error');
      }
    } catch (err) {
      showToast('Network error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Trial Settings';
    }
  }

  function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadUsers, 300);
  }

  // Load users table
  async function loadUsers() {
    const filter = document.getElementById('user-filter').value;
    const search = document.getElementById('user-search').value.trim();
    const tbody = document.getElementById('users-table-body');

    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;">Loading devices...</td></tr>';

    try {
      const url = `${window.API_BASE}/api/admin/devices?filter=${encodeURIComponent(filter)}&search=${encodeURIComponent(search)}`;
      const res = await fetch(url, { headers: { 'x-admin-key': adminToken } });
      const data = await res.json();

      if (!data.success || !data.devices || data.devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">No devices found matching filter.</td></tr>';
        return;
      }

      let html = '';
      data.devices.forEach(d => {
        const typeBadge = d.subscription_type === 'forever' ? 'badge-success' :
                         (d.subscription_type === 'year_1' ? 'badge-info' : 'badge-warning');
        const planName = d.subscription_type === 'forever' ? 'Forever' :
                        (d.subscription_type === 'year_1' ? '1 Year' : 'Trial');
        const statusBadge = d.is_active ? 'badge-success' : 'badge-error';

        html += `
          <tr>
            <td>
              <strong style="color: #FFFFFF;">${d.device_id}</strong>
              ${d.mac_address ? `<div style="font-size: 11px; color: var(--text-muted);">${d.mac_address}</div>` : ''}
            </td>
            <td><span class="badge ${statusBadge}">${d.is_active ? 'ACTIVE' : 'EXPIRED'}</span></td>
            <td><span class="badge ${typeBadge}">${planName.toUpperCase()}</span></td>
            <td><strong>${d.days_left} d</strong></td>
            <td>${d.expires_at ? new Date(d.expires_at).toLocaleDateString() : 'N/A'}</td>
            <td>
              <button class="btn btn-sm btn-secondary" onclick="viewPlaylists('${d.device_id}')">
                ${d.playlists_count} List(s)
              </button>
            </td>
            <td>${d.last_seen_at ? new Date(d.last_seen_at).toLocaleDateString() : 'N/A'}</td>
            <td>
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-sm btn-primary" onclick="openEditSub('${d.device_id}', '${d.subscription_type}', ${d.days_left})">
                  Edit Plan
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteDevice('${d.device_id}')">
                  Delete
                </button>
              </div>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" style="color: var(--error); text-align: center;">Error: ${e.message}</td></tr>`;
    }
  }

  // Open View Playlists Modal
  async function viewPlaylists(deviceId) {
    document.getElementById('modal-playlists-title').textContent = `Playlists for ${deviceId}`;
    const content = document.getElementById('modal-playlists-content');
    content.innerHTML = '<p style="text-align: center; padding: 20px;">Fetching playlists...</p>';
    openModal('playlists-modal');

    try {
      const res = await fetch(`${window.API_BASE}/api/admin/devices/${encodeURIComponent(deviceId)}`, {
        headers: { 'x-admin-key': adminToken }
      });
      const data = await res.json();

      if (!data.success || !data.device || !data.device.playlists || data.device.playlists.length === 0) {
        content.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No playlists linked to this device yet.</p>';
        return;
      }

      let html = '';
      data.device.playlists.forEach(p => {
        html += `
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-card); border-radius: var(--radius-md); padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <strong style="font-size: 15px;">${p.name}</strong>
              <div style="display: flex; gap: 6px;">
                <span class="badge ${p.is_active ? 'badge-success' : 'badge-info'}">${p.is_active ? 'Active' : 'Inactive'}</span>
                <span class="badge" style="background: rgba(255,255,255,0.06);">${p.type.toUpperCase()}</span>
              </div>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); word-break: break-all;">
              ${p.type === 'xtream' ? `<b>Server:</b> ${p.server_url}<br><b>User:</b> ${p.username}` : `<b>URL:</b> ${p.url}`}
            </div>
          </div>
        `;
      });
      content.innerHTML = html;
    } catch (e) {
      content.innerHTML = `<p style="color: var(--error);">Error: ${e.message}</p>`;
    }
  }

  // Open Edit Subscription Modal
  function openEditSub(deviceId, currentType, daysLeft) {
    document.getElementById('edit-target-device').value = deviceId;
    document.getElementById('edit-sub-device-id').textContent = `Target Device: ${deviceId}`;
    document.getElementById('edit-plan-type').value = currentType || 'year_1';
    document.getElementById('edit-duration-days').value = (daysLeft > 0) ? daysLeft : 365;
    openModal('edit-sub-modal');
  }

  async function handleSaveSubscription(e) {
    e.preventDefault();
    const deviceId = document.getElementById('edit-target-device').value;
    const planType = document.getElementById('edit-plan-type').value;
    const duration = parseInt(document.getElementById('edit-duration-days').value, 10);
    const status = document.getElementById('edit-status').value;
    const notes = document.getElementById('edit-notes').value.trim();
    const btn = document.getElementById('btn-save-sub');

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const res = await fetch(`${window.API_BASE}/api/admin/devices/${encodeURIComponent(deviceId)}/subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminToken
        },
        body: JSON.stringify({
          subscription_type: planType,
          duration_days: duration,
          status: status,
          notes: notes
        })
      });
      const data = await res.json();

      if (data.success) {
        showToast('Subscription updated successfully!', 'success');
        closeModal('edit-sub-modal');
        loadDashboard();
      } else {
        showToast(data.error?.message || 'Failed to update subscription.', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Subscription Changes';
    }
  }

  async function deleteDevice(deviceId) {
    if (!confirm(`Are you sure you want to permanently delete device ${deviceId}?`)) return;
    try {
      const res = await fetch(`${window.API_BASE}/api/admin/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: { 'x-admin-key': adminToken }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Device deleted.', 'success');
        loadDashboard();
      } else {
        showToast(data.error?.message || 'Delete failed.', 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  }

  function openModal(id) {
    document.getElementById(id).classList.add('active');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('active');
  }
</script>

<?php require_once __DIR__ . '/footer.php'; ?>
