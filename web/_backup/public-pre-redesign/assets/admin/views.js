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

function planOptions(activeOnly = true) {
  return planCatalog
    .filter((p) => !activeOnly || p.is_active)
    .map((p) => `<option value="${escapeHtml(p.code)}">${escapeHtml(p.label)} · ${p.duration_days}d</option>`)
    .join('');
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
                  <th>Device ID</th><th>Sub status</th><th>Plan</th><th>Expires</th><th>Lists</th><th>Assign plan</th>
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
    sub: 'Partner accounts and credit balances',
    async render(root) {
      const res = await api('/api/admin/resellers');
      const rows = res.resellers || [];
      root.innerHTML = `
        <div class="fox-panel">
          <div class="fox-panel__head">
            <h2>Reseller accounts</h2>
            <button type="button" class="btn btn-primary" id="btn-new-reseller">Add reseller</button>
          </div>
          <div class="fox-panel__body">
            <div class="table-wrap fox-table">
              <table>
                <thead><tr><th>Username</th><th>Display name</th><th>Credits</th><th>Status</th><th></th></tr></thead>
                <tbody>${rows.map((r) => `
                  <tr>
                    <td class="mono">${escapeHtml(r.username)}</td>
                    <td>${escapeHtml(r.display_name || '—')}</td>
                    <td><strong>${r.credits_balance}</strong></td>
                    <td>${r.is_active ? '<span class="badge ok">Active</span>' : 'Inactive'}</td>
                    <td><button class="btn btn-ghost" data-topup="${r.id}">Adjust credits</button></td>
                  </tr>`).join('')}</tbody>
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
            title: 'Adjust credits',
            html: `
              <label>Amount (negative to deduct)</label>
              <input name="amount" type="number" required placeholder="e.g. 50" />
              <label>Reason</label><input name="reason" value="Admin adjustment" />`,
            onSubmit: async (form) => {
              const fd = new FormData(form);
              await api(`/api/admin/resellers/${b.dataset.topup}/credits`, {
                method: 'POST',
                body: { amount: Number(fd.get('amount')), reason: fd.get('reason') },
              });
              toast('Credits updated', 'success');
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
      root.innerHTML = `
        <div class="fox-panel">
          <div class="fox-panel__head"><h2>Published builds</h2></div>
          <div class="fox-panel__body padded" style="border-bottom:1px solid var(--border)">
            <form id="ver-form">
              <div class="fox-form-row">
                <div><label>Version name</label><input name="version_name" required placeholder="1.0.2" /></div>
                <div><label>Build code</label><input name="version_code" type="number" required placeholder="3" /></div>
              </div>
              <label>Platform</label>
              <select name="platform"><option value="all">All platforms</option><option value="ios">iOS</option><option value="android">Android</option></select>
              <label>Store URL</label><input name="store_url" placeholder="App Store / Play link" />
              <label>Release notes</label><textarea name="release_notes" rows="2"></textarea>
              <label style="text-transform:none;display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_required" /> Force update (block app until updated)</label>
              <button type="submit" class="btn btn-primary">Publish version</button>
            </form>
          </div>
          <div class="fox-panel__body">
            <div class="table-wrap fox-table">
              <table>
                <thead><tr><th>Platform</th><th>Name</th><th>Code</th><th>Force</th><th>Notes</th></tr></thead>
                <tbody>${rows.map((v) => `
                  <tr>
                    <td>${escapeHtml(v.platform)}</td>
                    <td>${escapeHtml(v.version_name)}</td>
                    <td>${v.version_code}</td>
                    <td>${v.is_required ? 'Yes' : 'No'}</td>
                    <td style="max-width:240px">${escapeHtml(v.release_notes || '')}</td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      root.querySelector('#ver-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        await api('/api/admin/app-versions', {
          method: 'POST',
          body: {
            version_name: fd.get('version_name'),
            version_code: Number(fd.get('version_code')),
            platform: fd.get('platform'),
            store_url: fd.get('store_url'),
            release_notes: fd.get('release_notes'),
            is_required: fd.get('is_required') === 'on',
          },
        });
        toast('Version published', 'success');
        views.versions.render(root);
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
          <div class="fox-panel__head"><h2>Recent events</h2></div>
          <div class="fox-panel__body padded">
            ${rows.length ? rows.map((l) => `
              <div style="padding:12px 0;border-bottom:1px solid var(--border)">
                <span class="badge">${escapeHtml(l.action)}</span>
                <span style="color:var(--text-muted);font-size:0.8rem;margin-left:8px">${escapeHtml(l.created_at || '')}</span>
                <pre style="margin:8px 0 0;font-size:0.75rem;color:var(--text-muted);white-space:pre-wrap">${escapeHtml(l.details || '')}</pre>
              </div>`).join('') : '<div class="fox-empty">No audit entries yet.</div>'}
          </div>
        </div>`;
    },
  },
};

function deviceRowsHtml(rows) {
  return rows.map((d) => `
    <tr data-device-row="${escapeHtml(d.device_id)}">
      <td class="mono">${escapeHtml(d.device_id)}</td>
      <td>${escapeHtml(d.sub_status || '—')}</td>
      <td>${escapeHtml(d.subscription_type || '—')}</td>
      <td><span style="color:var(--text-muted);font-size:0.8rem">${escapeHtml(d.expires_at || '—')}<br />${d.days_left ?? '—'}d left</span></td>
      <td>${d.playlists_count ?? 0}</td>
      <td class="actions">
        <select class="fox-input-inline plan-pick" data-device="${escapeHtml(d.device_id)}">
          <option value="">Plan…</option>${planOptions()}
        </select>
        <button type="button" class="btn btn-primary btn-apply" data-device="${escapeHtml(d.device_id)}">Apply</button>
      </td>
    </tr>`).join('');
}

function bindDevices(root, rows) {
  root.querySelectorAll('.btn-apply').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.device;
      const sel = root.querySelector(`.plan-pick[data-device="${CSS.escape(id)}"]`);
      const code = sel?.value;
      if (!code) { toast('Select a plan first', 'error'); return; }
      await api(`/api/admin/devices/${encodeURIComponent(id)}/apply-plan`, {
        method: 'POST',
        body: { plan_code: code },
      });
      toast(`Plan applied to ${id}`, 'success');
      views.devices.render(root);
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
