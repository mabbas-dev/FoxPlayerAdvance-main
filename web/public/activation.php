<?php
$pageTitle = 'Device Activation — FOX PLAYER';
$activeNav = 'activation';
require_once __DIR__ . '/header.php';
$prefillId = htmlspecialchars($_GET['device-id'] ?? ($_GET['mac'] ?? ''));
$selectedPlan = htmlspecialchars($_GET['plan'] ?? 'YEAR_1');
?>

<main class="section">
  <div class="container" style="max-width: 820px;">
    <!-- Notice Banner -->
    <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-lg); padding: 16px 20px; display: flex; align-items: center; gap: 14px; margin-bottom: 28px;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" style="flex-shrink: 0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      <div style="font-size: 14px; color: #FDE68A;">
        <strong>FOX PLAYER</strong> is a pure media player. NO CHANNELS or streams are provided with device activation. You must supply your own playlists.
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-header">
        <h1 class="panel-title">Activate your Device</h1>
        <p class="panel-desc">Enter your TV MAC address or Device ID to view status and activate your license.</p>
      </div>

      <form id="activation-form" onsubmit="handleActivation(event)">
        <div class="form-group">
          <label class="form-label" for="act-mac">Your MAC Address or Device ID *</label>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="act-mac" class="form-input" placeholder="e.g. 00:1A:79:XX:XX:XX or 1PFDES0P" value="<?php echo $prefillId; ?>" required autocomplete="off">
            <button type="button" class="btn btn-secondary" onclick="checkStatus()">Check Status</button>
          </div>
          <small style="color: var(--text-muted); font-size: 12px; display: block; margin-top: 4px;">Found in FOX PLAYER Settings or Activation screen on your TV/device.</small>
        </div>

        <!-- Status Card (Dynamically displayed) -->
        <div id="status-card" style="display: none; background: var(--bg-secondary); border: 1px solid var(--border-card); border-radius: var(--radius-md); padding: 18px; margin-bottom: 24px;"></div>

        <div class="form-group">
          <label class="form-label">Choose Activation Plan</label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <!-- Plan 1 Year -->
            <label style="background: var(--bg-secondary); border: 2px solid <?php echo ($selectedPlan === 'YEAR_1') ? 'var(--brand-primary)' : 'var(--border-card)'; ?>; border-radius: var(--radius-lg); padding: 20px; cursor: pointer; display: block; position: relative;" id="plan-card-year">
              <input type="radio" name="plan" value="YEAR_1" <?php echo ($selectedPlan === 'YEAR_1') ? 'checked' : ''; ?> style="position: absolute; top: 18px; right: 18px;" onchange="updatePlanCard('YEAR_1')">
              <span class="badge badge-warning" style="margin-bottom: 8px;">1 Year Access</span>
              <div style="font-size: 24px; font-weight: 800; margin-bottom: 4px;">55.00 MAD</div>
              <div style="color: var(--brand-accent); font-size: 13px; font-weight: 600;">~ 4.99 &euro; / year</div>
              <p style="color: var(--text-muted); font-size: 12px; margin-top: 10px;">Full feature access for 12 months</p>
            </label>

            <!-- Plan Forever -->
            <label style="background: var(--bg-secondary); border: 2px solid <?php echo ($selectedPlan === 'FOREVER') ? 'var(--brand-primary)' : 'var(--border-card)'; ?>; border-radius: var(--radius-lg); padding: 20px; cursor: pointer; display: block; position: relative;" id="plan-card-forever">
              <input type="radio" name="plan" value="FOREVER" <?php echo ($selectedPlan === 'FOREVER') ? 'checked' : ''; ?> style="position: absolute; top: 18px; right: 18px;" onchange="updatePlanCard('FOREVER')">
              <span class="badge badge-success" style="margin-bottom: 8px;">Lifetime Permanent</span>
              <div style="font-size: 24px; font-weight: 800; margin-bottom: 4px;">137.00 MAD</div>
              <div style="color: var(--brand-accent); font-size: 13px; font-weight: 600;">~ 11.00 &euro; / one-time</div>
              <p style="color: var(--text-muted); font-size: 12px; margin-top: 10px;">Forever access with zero future renewals</p>
            </label>
          </div>
        </div>

        <div class="form-group" style="margin-top: 24px;">
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: 14px; margin-bottom: 12px;">
            <input type="checkbox" id="chk-no-content" required style="margin-top: 4px; accent-color: var(--brand-primary);">
            <span>I acknowledge and agree that <strong>FOX PLAYER is a pure media player application</strong> and no channels or audiovisual streams are included with activation.</span>
          </label>
          <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: 14px;">
            <input type="checkbox" id="chk-terms" required style="margin-top: 4px; accent-color: var(--brand-primary);">
            <span>I agree to the <a href="/terms" target="_blank" style="color: var(--brand-primary); text-decoration: underline;">Terms of online sale</a> and <a href="/privacy" target="_blank" style="color: var(--brand-primary); text-decoration: underline;">Privacy Policy</a>.</span>
          </label>
        </div>

        <button type="submit" id="btn-activate" class="btn btn-primary btn-block" style="padding: 16px; font-size: 16px; margin-top: 16px;">
          Complete Activation
        </button>
      </form>
    </div>
  </div>
</main>

<script>
  function updatePlanCard(plan) {
    document.getElementById('plan-card-year').style.borderColor = (plan === 'YEAR_1') ? 'var(--brand-primary)' : 'var(--border-card)';
    document.getElementById('plan-card-forever').style.borderColor = (plan === 'FOREVER') ? 'var(--brand-primary)' : 'var(--border-card)';
  }

  async function checkStatus() {
    const mac = document.getElementById('act-mac').value.trim().toUpperCase();
    const box = document.getElementById('status-card');
    const btn = document.getElementById('btn-activate');

    if (!mac) {
      showToast('Please enter MAC address or Device ID.', 'error');
      return;
    }

    box.style.display = 'block';
    box.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Verifying Device ID with FOX PLAYER server...</p>';

    // First validate that device is genuinely registered by app
    try {
      const valRes = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(mac)}/validate`);
      const valData = await valRes.json();

      if (!valRes.ok || !valData.success || !valData.registered) {
        box.innerHTML = `
          <div class="validation-alert validation-alert-error" style="margin: 0;">
            <div class="alert-icon">❌</div>
            <div>
              <strong>Device ID Not Registered</strong>
              <p>This Device ID has not been opened or registered by FOX PLAYER app yet. Please open the FOX PLAYER app on your TV or mobile screen first to generate and register your official Device ID before activating.</p>
            </div>
          </div>
        `;
        if (btn) btn.disabled = true;
        return;
      }

      // If registered, query subscription details
      const subRes = await fetch(`${window.API_BASE}/api/subscription/status?device_id=${encodeURIComponent(mac)}`);
      const data = await subRes.json();

      if (!data.success) {
        box.innerHTML = `<p style="color: var(--error);">Error retrieving subscription: ${data.error?.message || 'Unknown error'}</p>`;
        return;
      }

      const isSubActive = Boolean(data.is_active);
      const typeLabel = (data.subscription_type === 'forever') ? 'Lifetime Forever' : (data.subscription_type === 'year_1' ? '1 Year Pass' : 'Free Trial');
      const badgeClass = isSubActive ? 'badge-success' : 'badge-error';

      box.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="font-size: 15px; font-weight: 700;">
            ${data.device_id} &mdash; <span style="color: var(--brand-accent);">${typeLabel}</span>
          </div>
          <span class="badge ${badgeClass}">${data.status.toUpperCase()}</span>
        </div>
        <div style="font-size: 13px; color: var(--text-secondary); display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>Remaining Days: <strong>${data.days_left} days</strong></div>
          <div>Expiration: <strong>${data.expires_at ? new Date(data.expires_at).toLocaleDateString() : 'N/A'}</strong></div>
        </div>
      `;
      if (btn) btn.disabled = false;
    } catch (e) {
      box.innerHTML = `<p style="color: var(--error);">Error retrieving status: ${e.message}</p>`;
    }
  }

  async function handleActivation(e) {
    e.preventDefault();
    const mac = document.getElementById('act-mac').value.trim().toUpperCase();
    const plan = document.querySelector('input[name="plan"]:checked').value;
    const btn = document.getElementById('btn-activate');

    if (!mac) {
      showToast('Please enter your Device ID or MAC.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Verifying Device...';

    // Verify device registered by app
    try {
      const valRes = await fetch(`${window.API_BASE}/api/device/${encodeURIComponent(mac)}/validate`);
      const valData = await valRes.json();
      if (!valRes.ok || !valData.success || !valData.registered) {
        showToast('Device not registered! Launch FOX PLAYER app on your TV/device first.', 'error');
        btn.disabled = false;
        btn.textContent = 'Complete Activation';
        checkStatus();
        return;
      }
    } catch (err) {
      showToast('Network error verifying device: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Complete Activation';
      return;
    }

    btn.textContent = 'Processing Activation...';

    try {
      const res = await fetch(`${window.API_BASE}/api/subscription/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac: mac, plan: plan })
      });
      const data = await res.json();

      if (data.success) {
        showToast('Activation confirmed! Please restart your FOX PLAYER app.', 'success');
        checkStatus();
      } else {
        showToast(data.error?.message || 'Activation failed.', 'error');
      }
    } catch (err) {
      showToast('Network error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Complete Activation';
    }
  }

  // Auto-check if prefilled
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('act-mac').value) {
      checkStatus();
    }
  });
</script>

<?php require_once __DIR__ . '/footer.php'; ?>
