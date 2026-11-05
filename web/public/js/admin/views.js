import {
  api, escapeHtml, openModal, toast, mountLoading,
} from './core.js';

let planCatalog = [];
let replaceValidated = { ok: false, count: 0 };

async function loadPlans() {
  const res = await api('/api/admin/subscription-plans');
  planCatalog = res.plans || [];
  return planCatalog;
}

function planOptions(activeOnly = true, selectedCode = '') {
  const sel = String(selectedCode || '').toLowerCase();
  let html = planCatalog
    .filter((p) => !activeOnly || p.is_active)
    .map((p) => {
      const code = String(p.code || '').toLowerCase();
      const selected = sel && code === sel ? ' selected' : '';
      return `<option value="${escapeHtml(p.code)}"${selected}>${escapeHtml(p.label)}</option>`;
    })
    .join('');
  if (sel && !planCatalog.some((p) => String(p.code).toLowerCase() === sel)) {
    html = `<option value="${escapeHtml(selectedCode)}" selected>${escapeHtml(planDisplayLabel(selectedCode))}</option>${html}`;
  }
  return html;
}

function planDisplayLabel(subscriptionType) {
  const code = String(subscriptionType || '').trim();
  if (!code) return '—';
  const match = planCatalog.find((p) => String(p.code).toLowerCase() === code.toLowerCase());
  if (match) return match.label;
  if (code.toLowerCase() === 'trial') return 'Free trial';
  if (code.toLowerCase() === 'custom') return 'Custom plan';
  return code.replace(/_/g, ' ');
}

function subStatusBadge(d) {
  const code = String(d.subscription_type || '').toLowerCase();
  const lifetime = code === 'forever' && d.sub_status === 'active';
  if (lifetime) return '<span class="badge ok">Lifetime</span>';
  if (d.sub_status === 'active' && d.is_active) return '<span class="badge ok">Active</span>';
  if (d.sub_status === 'expired' || d.is_active === false) return '<span class="badge err">Expired</span>';
  if (d.sub_status) return `<span class="badge">${escapeHtml(d.sub_status)}</span>`;
  return '<span class="badge err">None</span>';
}

function formatExpiresCell(d) {
  const code = String(d.subscription_type || '').toLowerCase();
  if (code === 'forever' && d.sub_status === 'active') {
    return '<span class="badge ok">No expiry</span>';
  }
  if (!d.expires_at) return '—';
  const days = d.days_left ?? '—';
  return `<span>${escapeHtml(String(d.expires_at).slice(0, 10))}</span><br /><span style="color:var(--text-muted);font-size:0.78rem">${escapeHtml(String(days))} days left</span>`;
}

export const views = {
  overview: {
    title: 'Overview',
    sub: 'Platform health and activity',
    async render(root) {
      const res = await api('/api/admin/stats');
      const s = res.stats || res;
      root.innerHTML = `
        <div class="fox-kpi-row">
          <div class="fox-kpi"><div class="fox-kpi__label">Registered devices</div><div class="fox-kpi__value">${escapeHtml(s.total_devices ?? '0')}</div><div class="fox-kpi__hint">${escapeHtml(s.active_devices_7d ?? 0)} active last 7 days</div></div>
          <div class="fox-kpi"><div class="fox-kpi__label">IPTV playlists</div><div class="fox-kpi__value">${escapeHtml(s.total_playlists ?? '0')}</div><div class="fox-kpi__hint">${escapeHtml(s.xtream_playlists ?? 0)} Xtream</div></div>
          <div class="fox-kpi"><div class="fox-kpi__label">Paid subscribers</div><div class="fox-kpi__value">${escapeHtml(s.paid_users ?? '0')}</div><div class="fox-kpi__hint">${escapeHtml(s.trial_users ?? 0)} on trial</div></div>
        </div>
        <div class="fox-panel"><div class="fox-panel__body padded"><p class="lead" style="margin:0">Use <strong>Devices</strong> to assign subscription plans, <strong>IPTV Playlists</strong> to edit provider records, and <strong>URL Replace</strong> when a host changes.</p></div></div>`;
    },
  },

  devices: {
    title: 'Devices',
    sub: 'Registered app devices and subscription status',
    async render(root) {
      await loadPlans();
      const res = await api('/api/admin/devices?limit=200');
      const rows = res.devices || [];
      root.innerHTML = `
        <div class="fox-panel">
          <div class="fox-panel__head">
            <h2>All devices (${rows.length})</h2>
            <div class="fox-toolbar">
              <input type="search" class="fox-search" id="device-search" placeholder="Search device ID…" />
            </div>
          </div>
          <div class="fox-panel__body">
            <div class="table-wrap fox-table">
              <table>
                <thead><tr>
                  <th>Device ID</th><th>Status</th><th>Plan</th><th>Expires</th><th>Lists</th>
                </tr></thead>
                <tbody id="device-tbody">${deviceRowsHtml(rows)}</tbody>
              </table>
            </div>
            ${rows.length ? '' : '<div class="fox-empty">No devices yet — users must open the app first.</div>'}
          </div>
        </div>`;
      bindDevices(root, rows);
    },
  },

  plans: {
    title: 'Subscription plans',
    sub: 'Plans for devices and reseller credit pricing',
    async render(root) {
      await loadPlans();
      root.innerHTML = `
        <div class="fox-panel">
          <div class="fox-panel__head">
            <h2>Plan catalog</h2>
            <button type="button" class="btn btn-primary" id="btn-new-plan">New plan</button>
          </div>
          <div class="fox-panel__body">
            <div class="table-wrap fox-table">
              <table>
                <thead><tr><th>Code</th><th>Name</th><th>Duration</th><th>Reseller credits</th><th>Status</th><th></th></tr></thead>
                <tbody>${planCatalog.map((p) => `
                  <tr>
                    <td class="mono">${escapeHtml(p.code)}</td>
                    <td>${escapeHtml(p.label)}</td>
                    <td>${p.duration_days} days</td>
                    <td>${p.credits_cost}</td>
                    <td>${p.is_active ? '<span class="badge ok">Active</span>' : '<span class="badge err">Off</span>'}</td>
                    <td class="actions"><button type="button" class="btn btn-ghost" data-edit-plan="${p.id}">Edit</button></td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      root.querySelector('#btn-new-plan')?.addEventListener('click', () => openPlanModal(null));
      root.querySelectorAll('[data-edit-plan]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const p = planCatalog.find((x) => String(x.id) === btn.dataset.editPlan);
          openPlanModal(p);
        });
      });
    },
  },

  playlists: {
    title: 'IPTV playlists',
    sub: 'Global playlist catalog linked to devices',
    async render(root) {
      const res = await api('/api/admin/playlists?limit=250');
      const rows = res.playlists || [];
      root.innerHTML = `
        <div class="fox-panel">
          <div class="fox-panel__head"><h2>Playlist records (${rows.length})</h2></div>
          <div class="fox-panel__body">
            <div class="table-wrap fox-table">
              <table>
                <thead><tr><th>ID</th><th>Type</th><th>Server / URL</th><th>User</th><th>Devices</th><th></th></tr></thead>
                <tbody>${rows.map((p) => `
                  <tr>
                    <td>${p.id}</td>
                    <td>${escapeHtml(p.type)}</td>
                    <td style="max-width:320px;word-break:break-all">${escapeHtml(p.server_url || p.playlist_url || '—')}</td>
                    <td>${escapeHtml(p.username || '—')}</td>
                    <td>${p.device_count ?? 0}</td>
                    <td class="actions">
                      <button class="btn btn-ghost" data-edit-pl="${p.id}">Edit</button>
                      <button class="btn btn-danger" data-del-pl="${p.id}">Delete</button>
                    </td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      root.querySelectorAll('[data-edit-pl]').forEach((b) => {
        b.addEventListener('click', async () => {
          const detail = await api(`/api/admin/playlists/${b.dataset.editPl}`);
          const p = detail.playlist || detail;
          openModal({
            title: `Edit playlist #${p.id}`,
            html: `
              <label>Server URL</label><input name="server_url" value="${escapeHtml(p.server_url || '')}" />
              <label>Username</label><input name="username" value="${escapeHtml(p.username || '')}" />
              <label>Password</label><input name="password" type="password" placeholder="Leave blank to keep" />`,
            onSubmit: async (form) => {
              const fd = new FormData(form);
              const body = {
                server_url: fd.get('server_url'),
                username: fd.get('username'),
              };
              if (fd.get('password')) body.password = fd.get('password');
              await api(`/api/admin/playlists/${p.id}`, { method: 'PUT', body });
              toast('Playlist updated', 'success');
              views.playlists.render(root);
            },
          });
        });
      });
      root.querySelectorAll('[data-del-pl]').forEach((b) => {
        b.addEventListener('click', async () => {
          if (!confirm('Remove this playlist from the catalog?')) return;
          await api(`/api/admin/playlists/${b.dataset.delPl}`, { method: 'DELETE' });
          toast('Playlist removed', 'success');
          views.playlists.render(root);
        });
      });
    },
  },

  replace: {
    title: 'Bulk URL replace',
    sub: 'Migrate provider hostname across all matching playlists',
    async render(root) {
      replaceValidated = { ok: false, count: 0 };
      root.innerHTML = `
        <div class="fox-wizard">
          <div class="fox-panel fox-wizard__step is-active" id="wiz-step-1">
            <div class="fox-panel__head"><h2><span class="fox-wizard__badge">1</span>Validate current URL</h2></div>
            <div class="fox-panel__body padded">
              <label for="rep-from">Current server URL</label>
              <input id="rep-from" placeholder="http://provider.example.com:8080" />
              <button type="button" class="btn btn-primary" id="rep-validate">Validate &amp; count playlists</button>
              <div id="rep-validate-out" class="alert alert-info hidden" style="margin-top:14px;margin-bottom:0"></div>
            </div>
          </div>
          <div class="fox-panel fox-wizard__step" id="wiz-step-2">
            <div class="fox-panel__head"><h2><span class="fox-wizard__badge">2</span>Apply new URL</h2></div>
            <div class="fox-panel__body padded">
              <label for="rep-to">New server URL</label>
              <input id="rep-to" disabled placeholder="Enabled after step 1 succeeds" />
              <button type="button" class="btn btn-primary" id="rep-apply" disabled>Replace all matches</button>
              <p id="rep-result" class="lead" style="margin-top:14px;margin-bottom:0"></p>
            </div>
          </div>
        </div>`;
      const fromInput = root.querySelector('#rep-from');
      const toInput = root.querySelector('#rep-to');
      const applyBtn = root.querySelector('#rep-apply');
      const out = root.querySelector('#rep-validate-out');
      root.querySelector('#rep-validate')?.addEventListener('click', async () => {
        const from = fromInput?.value?.trim();
        if (!from) {
          toast('Enter the current server URL', 'error');
          return;
        }
        const res = await api(`/api/admin/tools/replace-server-url/preview?from_url=${encodeURIComponent(from)}`);
        replaceValidated.ok = (res.match_count ?? 0) > 0;
        replaceValidated.count = res.match_count ?? 0;
        if (!replaceValidated.ok) {
          out.className = 'alert alert-error';
          out.textContent = 'No playlists match that URL. Check protocol, port, and trailing slashes.';
          out.classList.remove('hidden');
          toInput.disabled = true;
          applyBtn.disabled = true;
          root.querySelector('#wiz-step-2')?.classList.remove('is-active');
          return;
        }
        out.className = 'alert alert-success';
        out.textContent = `${replaceValidated.count} playlist(s) will be updated. Enter the new URL below.`;
        out.classList.remove('hidden');
        root.querySelector('#wiz-step-1')?.classList.add('is-done');
        root.querySelector('#wiz-step-2')?.classList.add('is-active');
        toInput.disabled = false;
        applyBtn.disabled = false;
        toInput.focus();
      });
      applyBtn?.addEventListener('click', async () => {
        if (!replaceValidated.ok) return;
        const from = fromInput?.value?.trim();
        const to = toInput?.value?.trim();
        if (!to) { toast('Enter the new URL', 'error'); return; }
        if (!confirm(`Update ${replaceValidated.count} playlist(s)?`)) return;
        const res = await api('/api/admin/tools/replace-server-url', {
          method: 'POST',
          body: { from_url: from, to_url: to, confirm: true },
        });
        root.querySelector('#rep-result').textContent = `Successfully updated ${res.updated ?? 0} playlist(s).`;
        toast('Bulk replace complete', 'success');
      });
    },
  },

  resellers: {
    title: 'Resellers',
    sub: 'Partner accounts, credits, and activation pricing',
    async render(root) {
      const [resellersRes, ledgerRes] = await Promise.all([
        api('/api/admin/resellers'),
        api('/api/admin/credit-ledger?limit=40'),
        loadPlans(),
      ]);
      const rows = resellersRes.resellers || [];
      const stats = resellersRes.stats || {};
      const ledger = ledgerRes.entries || [];
      const fmtCredits = (n) => Number(n ?? 0).toLocaleString();
      root.innerHTML = `
        <div class="fox-kpi-row">
          <div class="fox-kpi"><div class="fox-kpi__label">Resellers</div><div class="fox-kpi__value">${fmtCredits(stats.count ?? rows.length)}</div><div class="fox-kpi__hint">${fmtCredits(stats.active_count ?? 0)} active</div></div>
          <div class="fox-kpi"><div class="fox-kpi__label">Credits in circulation</div><div class="fox-kpi__value">${fmtCredits(stats.total_credits ?? 0)}</div><div class="fox-kpi__hint">Sum of all balances</div></div>
          <div class="fox-kpi"><div class="fox-kpi__label">Active plans</div><div class="fox-kpi__value">${planCatalog.filter((p) => p.is_active).length}</div><div class="fox-kpi__hint">Reseller pricing catalog</div></div>
        </div>
        <div class="fox-panel">
          <div class="fox-panel__head">
            <h2>Reseller accounts</h2>
            <button type="button" class="btn btn-primary" id="btn-new-reseller">Add reseller</button>
          </div>
          <div class="fox-panel__body">
            <div class="table-wrap fox-table">
              <table>
                <thead><tr><th>Partner</th><th>Credits balance</th><th>Status</th><th>Created</th><th></th></tr></thead>
                <tbody>${rows.length ? rows.map((r) => `
                  <tr>
                    <td><strong>${escapeHtml(r.display_name || r.username)}</strong><div class="fox-cell-muted mono">${escapeHtml(r.username)}</div></td>
                    <td><span class="fox-credits-pill">${fmtCredits(r.credits_balance)}</span></td>
                    <td>${r.is_active ? '<span class="badge ok">Active</span>' : '<span class="badge err">Off</span>'}</td>
                    <td style="font-size:0.82rem;color:var(--text-muted)">${escapeHtml(String(r.created_at || '').slice(0, 10))}</td>
                    <td class="actions"><button class="btn btn-ghost" data-topup="${r.id}" data-name="${escapeHtml(r.username)}">Adjust credits</button></td>
                  </tr>`).join('') : '<tr><td colspan="5"><div class="fox-empty">No resellers — add a partner account.</div></td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="fox-panel">
          <div class="fox-panel__head"><h2>Reseller plan pricing</h2></div>
          <div class="fox-panel__body padded">
            <div class="fox-plan-pricing-grid">${planCatalog.filter((p) => p.is_active).map((p) => `
              <div class="fox-plan-price-card">
                <div class="fox-plan-price-card__name">${escapeHtml(p.label)}</div>
                <div class="fox-plan-price-card__meta"><span class="mono">${escapeHtml(p.code)}</span> · ${p.duration_days} days</div>
                <div class="fox-plan-price-card__cost">${fmtCredits(p.credits_cost)} credits</div>
              </div>`).join('') || '<p class="lead" style="margin:0">No active plans — configure under Subscription plans.</p>'}
            </div>
          </div>
        </div>
        <div class="fox-panel">
          <div class="fox-panel__head"><h2>Credit ledger</h2></div>
          <div class="fox-panel__body">
            <div class="table-wrap fox-table">
              <table>
                <thead><tr><th>When</th><th>Partner</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>${ledger.length ? ledger.map((e) => `
                  <tr>
                    <td style="font-size:0.82rem;white-space:nowrap">${escapeHtml(String(e.created_at || '').replace('T', ' ').slice(0, 19))}</td>
                    <td>${escapeHtml(e.display_name || e.username || '—')}</td>
                    <td><span class="${Number(e.delta) >= 0 ? 'fox-credit-plus' : 'fox-credit-minus'}">${Number(e.delta) >= 0 ? '+' : ''}${fmtCredits(e.delta)}</span></td>
                    <td style="font-size:0.85rem">${escapeHtml(e.reason || '—')}</td>
                    <td style="font-size:0.82rem;color:var(--text-muted)">${escapeHtml(e.actor || '—')}</td>
                  </tr>`).join('') : '<tr><td colspan="5"><div class="fox-empty">No credit movements yet.</div></td></tr>'}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      root.querySelector('#btn-new-reseller')?.addEventListener('click', () => {
        openModal({
          title: 'Create reseller',
          submitLabel: 'Create',
          html: `
            <label>Username</label><input name="username" required />
            <label>Password</label><input name="password" type="password" required />
            <label>Initial credits</label><input name="credits" type="number" value="10" />`,
          onSubmit: async (form) => {
            const fd = new FormData(form);
            await api('/api/admin/resellers', {
              method: 'POST',
              body: {
                username: fd.get('username'),
                password: fd.get('password'),
                initial_credits: Number(fd.get('credits') || 0),
              },
            });
            toast('Reseller created', 'success');
            views.resellers.render(root);
          },
        });
      });
      root.querySelectorAll('[data-topup]').forEach((b) => {
        b.addEventListener('click', () => {
          openModal({
            title: `Adjust credits — ${b.dataset.name || 'reseller'}`,
            html: `
              <label>Amount (use negative to deduct)</label>
              <input name="amount" type="number" required placeholder="e.g. 50" />
              <label>Reason</label><input name="reason" value="Admin adjustment" />`,
            onSubmit: async (form) => {
              const fd = new FormData(form);
              const out = await api(`/api/admin/resellers/${b.dataset.topup}/credits`, {
                method: 'POST',
                body: { amount: Number(fd.get('amount')), reason: fd.get('reason') },
              });
              toast(`Balance now ${Number(out.credits_balance ?? 0).toLocaleString()} credits`, 'success');
              views.resellers.render(root);
            },
          });
        });
      });
    },
  },

  versions: {
    title: 'App versions',
    sub: 'In-app update prompts and force-update rules',
    async render(root) {
      const res = await api('/api/admin/app-versions');
      const rows = res.versions || [];
      const shipped = res.shipped_app || {};
      const shippedCode = Number(shipped.version_code ?? 1);
      const shippedName = shipped.version_name || '1.0.0';

      root.innerHTML = `
        <div class="fox-panel fox-versions-panel">
          <div class="fox-panel__head"><h2>Published builds</h2></div>
          <div class="fox-panel__body padded fox-versions-form-wrap">
            <div class="fox-shipped-ref">
              <div class="fox-shipped-ref__title">Current shipped app (for comparison)</div>
              <div class="fox-shipped-ref__row">
                <span><strong>Version</strong> ${escapeHtml(shippedName)}</span>
                <span><strong>Build code</strong> ${shippedCode}</span>
              </div>
              <p class="fox-shipped-ref__hint">Users on this build see an update only if you publish a row with build code <strong>greater than ${shippedCode}</strong>.</p>
            </div>
            <p class="lead fox-versions-help">
              <strong>Version name</strong> = display string (e.g. 1.0.2). <strong>Build code</strong> = number the app sends (not the version name).
            </p>
            <form id="ver-form" class="fox-versions-form">
              <label for="ver-name">Version name</label>
              <input id="ver-name" name="version_name" required placeholder="1.0.2" autocomplete="off" />
              <label for="ver-code">Build code (integer, must be &gt; ${shippedCode})</label>
              <input id="ver-code" name="version_code" type="number" min="${shippedCode + 1}" required placeholder="${shippedCode + 1}" />
              <label for="ver-platform">Platform</label>
              <select id="ver-platform" name="platform">
                <option value="all">All platforms</option>
                <option value="ios">iOS only</option>
                <option value="android">Android only</option>
              </select>
              <label for="ver-store">Store URL</label>
              <input id="ver-store" name="store_url" placeholder="https://… App Store or Play link" />
              <label for="ver-notes">Release notes</label>
              <textarea id="ver-notes" name="release_notes" rows="3" placeholder="What is new in this build"></textarea>
              <div class="fox-check-row">
                <input type="checkbox" name="is_required" id="ver-force" />
                <label for="ver-force" class="fox-check-row__text">Force update — block the app until the user updates</label>
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;max-width:320px">Publish version</button>
            </form>
          </div>
          <div class="fox-panel__body padded">
            <h3 class="fox-versions-list-title">Published on server (${rows.length})</h3>
            ${rows.length ? rows.map((v) => `
              <article class="fox-version-card" data-version-id="${v.id}">
                <div class="fox-version-card__head">
                  <div>
                    <div class="fox-version-card__name">${escapeHtml(v.version_name)}</div>
                    <div class="fox-version-card__meta">Build ${v.version_code} · ${escapeHtml(v.platform)}</div>
                  </div>
                  <div class="fox-version-card__badges">
                    ${Number(v.is_required) ? '<span class="badge err">Force</span>' : '<span class="badge">Optional</span>'}
                  </div>
                </div>
                ${v.release_notes ? `<p class="fox-version-card__notes">${escapeHtml(v.release_notes)}</p>` : ''}
                ${v.store_url ? `<p class="fox-version-card__url"><a href="${escapeHtml(v.store_url)}" target="_blank" rel="noopener">Store link</a></p>` : ''}
                <button type="button" class="btn btn-danger btn-del-version" data-id="${v.id}">Delete</button>
              </article>`).join('') : '<div class="fox-empty">No published builds yet.</div>'}
            <div class="table-wrap fox-table fox-versions-table-desktop">
              <table>
                <thead><tr><th>Version</th><th>Build</th><th>Platform</th><th>Update</th><th>Notes</th><th></th></tr></thead>
                <tbody>${rows.map((v) => `
                  <tr>
                    <td><strong>${escapeHtml(v.version_name)}</strong></td>
                    <td class="mono">${v.version_code}</td>
                    <td>${escapeHtml(v.platform)}</td>
                    <td>${Number(v.is_required) ? '<span class="badge err">Force</span>' : '<span class="badge ok">Optional</span>'}</td>
                    <td class="fox-version-notes-cell">${escapeHtml(v.release_notes || '—')}</td>
                    <td class="actions"><button type="button" class="btn btn-danger btn-del-version" data-id="${v.id}">Delete</button></td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>
        </div>`;

      root.querySelector('#ver-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const versionName = String(fd.get('version_name') || '').trim();
        const versionCode = Number(fd.get('version_code'));
        if (/^\d+$/.test(versionName)) {
          toast('Version name should look like 1.0.2 — build code goes in the other field.', 'error');
          return;
        }
        if (!Number.isFinite(versionCode) || versionCode <= shippedCode) {
          toast(`Build code must be greater than ${shippedCode} (current shipped app).`, 'error');
          return;
        }
        await api('/api/admin/app-versions', {
          method: 'POST',
          body: {
            version_name: versionName,
            version_code: versionCode,
            platform: fd.get('platform'),
            store_url: fd.get('store_url'),
            release_notes: fd.get('release_notes'),
            is_required: fd.get('is_required') === 'on',
          },
        });
        toast('Version published', 'success');
        views.versions.render(root);
      });

      root.querySelectorAll('.btn-del-version').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this published build? Installed apps will no longer see this update offer.')) return;
          await api(`/api/admin/app-versions/${btn.dataset.id}`, { method: 'DELETE' });
          toast('Build removed', 'success');
          views.versions.render(root);
        });
      });
    },
  },

  trial: {
    title: 'Trial settings',
    sub: 'Default free trial for new devices',
    async render(root) {
      const res = await api('/api/admin/trial-settings');
      const days = res.default_trial_days ?? res.trial_days ?? 7;
      root.innerHTML = `
        <div class="fox-panel" style="max-width:420px">
          <div class="fox-panel__head"><h2>Default trial duration</h2></div>
          <div class="fox-panel__body padded">
            <label>Days</label>
            <input id="trial-days" type="number" min="0" value="${days}" />
            <button type="button" class="btn btn-primary" id="trial-save">Save settings</button>
          </div>
        </div>`;
      root.querySelector('#trial-save')?.addEventListener('click', async () => {
        await api('/api/admin/trial-settings', {
          method: 'POST',
          body: { default_trial_days: Number(root.querySelector('#trial-days')?.value) },
        });
        toast('Trial settings saved', 'success');
      });
    },
  },

  audit: {
    title: 'Audit log',
    sub: 'Subscription and operator actions',
    async render(root) {
      const res = await api('/api/admin/audit-logs?limit=60');
      const rows = res.logs || [];
      root.innerHTML = `
        <div class="fox-panel">
          <div class="fox-panel__head">
            <h2>Recent events (${rows.length})</h2>
            <button type="button" class="btn btn-danger" id="audit-clear" ${rows.length ? '' : 'disabled'}>Clear log</button>
          </div>
          <div class="fox-panel__body padded" id="audit-list">
            ${rows.length ? rows.map((l) => `
              <div style="padding:12px 0;border-bottom:1px solid var(--border)">
                <span class="badge">${escapeHtml(l.action)}</span>
                <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px">${escapeHtml(l.created_at || '')}</span>
                <pre style="margin:8px 0 0;font-size:0.75rem;color:var(--text-muted);white-space:pre-wrap">${escapeHtml(l.details || '')}</pre>
              </div>`).join('') : '<div class="fox-empty">No audit entries yet.</div>'}
          </div>
        </div>`;
      root.querySelector('#audit-clear')?.addEventListener('click', async () => {
        if (!confirm('Clear all audit log entries? This cannot be undone.')) return;
        await api('/api/admin/audit-logs', { method: 'DELETE', body: { confirm: true } });
        toast('Audit log cleared', 'success');
        views.audit.render(root);
      });
    },
  },
};

function deviceRowsHtml(rows) {
  return rows.map((d) => {
    const currentCode = d.subscription_type || '';
    return `
    <tr data-device-row="${escapeHtml(d.device_id)}">
      <td class="mono device-id-cell">${escapeHtml(d.device_id)}</td>
      <td>${subStatusBadge(d)}</td>
      <td class="plan-cell">
        <select class="plan-pick" data-device="${escapeHtml(d.device_id)}" data-current="${escapeHtml(currentCode)}" aria-label="Subscription plan">
          ${planOptions(true, currentCode)}
        </select>
      </td>
      <td>${formatExpiresCell(d)}</td>
      <td>${d.playlists_count ?? 0}</td>
    </tr>`;
  }).join('');
}

function bindDevices(root, rows) {
  root.querySelectorAll('.plan-pick').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.device;
      const prev = sel.dataset.current || '';
      const code = sel.value;
      if (!code || code === prev) return;
      const label = sel.options[sel.selectedIndex]?.text || code;
      if (!confirm(`Update ${id} to “${label}”?`)) {
        sel.value = prev;
        return;
      }
      sel.disabled = true;
      try {
        await api(`/api/admin/devices/${encodeURIComponent(id)}/apply-plan`, {
          method: 'POST',
          body: { plan_code: code },
        });
        sel.dataset.current = code;
        toast(`Plan updated`, 'success');
        views.devices.render(root);
      } catch (err) {
        sel.value = prev;
        toast(err.message || 'Update failed', 'error');
      } finally {
        sel.disabled = false;
      }
    });
  });
  const search = root.querySelector('#device-search');
  search?.addEventListener('input', () => {
    const q = search.value.trim().toUpperCase();
    root.querySelectorAll('[data-device-row]').forEach((tr) => {
      const id = tr.getAttribute('data-device-row') || '';
      tr.classList.toggle('hidden', q !== '' && !id.includes(q));
    });
  });
}

function openPlanModal(plan) {
  const isEdit = !!plan;
  openModal({
    title: isEdit ? 'Edit plan' : 'New subscription plan',
    submitLabel: isEdit ? 'Update' : 'Create',
    html: isEdit ? `
      <label>Display name</label><input name="label" required value="${escapeHtml(plan.label)}" />
      <div class="fox-form-row">
        <div><label>Duration (days)</label><input name="duration_days" type="number" required value="${plan.duration_days}" /></div>
        <div><label>Reseller credits</label><input name="credits_cost" type="number" required value="${plan.credits_cost}" /></div>
      </div>
      <label style="text-transform:none"><input type="checkbox" name="is_active" ${plan.is_active ? 'checked' : ''} /> Active</label>`
      : `
      <label>Plan code (unique)</label><input name="code" required placeholder="forever" />
      <p class="lead" style="margin:-8px 0 12px;font-size:0.8rem">Examples: <code>month_1</code>, <code>year_1</code>, <code>forever</code> (lifetime)</p>
      <label>Display name</label><input name="label" required placeholder="Lifetime / Forever" />
      <div class="fox-form-row">
        <div><label>Duration (days)</label><input name="duration_days" type="number" required value="365" /></div>
        <div><label>Reseller credits</label><input name="credits_cost" type="number" required value="2" /></div>
      </div>`,
    onSubmit: async (form) => {
      const fd = new FormData(form);
      if (isEdit) {
        await api('/api/admin/credit-plans', {
          method: 'PUT',
          body: {
            id: plan.id,
            label: fd.get('label'),
            duration_days: Number(fd.get('duration_days')),
            credits_cost: Number(fd.get('credits_cost')),
            is_active: fd.get('is_active') === 'on',
            sort_order: plan.sort_order,
          },
        });
      } else {
        await api('/api/admin/credit-plans', {
          method: 'POST',
          body: {
            code: fd.get('code'),
            label: fd.get('label'),
            duration_days: Number(fd.get('duration_days')),
            credits_cost: Number(fd.get('credits_cost')),
            sort_order: 50,
          },
        });
      }
      planCatalog = [];
      toast('Plan saved', 'success');
      const root = document.getElementById('fox-content');
      if (root) views.plans.render(root);
    },
  });
}

export async function navigate(viewId) {
  const view = views[viewId];
  const root = document.getElementById('fox-content');
  if (!view || !root) return;
  mountLoading();
  try {
    await view.render(root);
  } catch (err) {
    root.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    toast(err.message, 'error');
  }
}

export { setPageHeader } from './core.js';
