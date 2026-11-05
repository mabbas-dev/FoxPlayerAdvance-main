const assert = require('assert');
const http = require('http');
const app = require('../server/index');

let server;
const PORT = 3991;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(raw);
          } catch (_e) {
            data = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log('\n================================================================');
  console.log('  FOX PLAYER — HTTP API & ADMIN AUTH TEST SUITE                 ');
  console.log('================================================================\n');

  server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => setTimeout(resolve, 500));

  let passed = 0;

  try {
    // 1. Device registration with installation UUID
    const testInstUuid = '98765432-1234-4321-abcd-0123456789ab';
    const testDevId = 'HTTPDEV1';

    const regRes = await makeRequest('POST', '/api/devices/register', {
      device_id: testDevId,
      installation_id: testInstUuid,
    });

    assert.strictEqual(regRes.status, 200, 'Registration status 200');
    assert.strictEqual(regRes.data.success, true);
    assert.strictEqual(regRes.data.device.device_id, testDevId);
    assert.strictEqual(regRes.data.device.installation_id, testInstUuid);
    assert.ok(regRes.data.subscription, 'Subscription returned in response');
    assert.strictEqual(regRes.data.subscription.is_valid, true);
    assert.strictEqual(regRes.data.subscription.status, 'active');
    console.log('  [PASS] 1. POST /api/devices/register creates device with trial subscription');
    passed++;

    // 2. Query subscription status
    const statusRes = await makeRequest('GET', `/api/subscription/status?installation_id=${testInstUuid}`);
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.success, true);
    assert.strictEqual(statusRes.data.subscription.is_valid, true);
    console.log('  [PASS] 2. GET /api/subscription/status returns authoritative server validation');
    passed++;

    // 3. Admin login
    const loginRes = await makeRequest('POST', '/api/admin/login', { password: 'fox_admin_2026' });
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.data.token, 'Token returned');
    const adminToken = loginRes.data.token;
    console.log('  [PASS] 3. POST /api/admin/login authenticates admin and issues session token');
    passed++;

    // 4. Admin rejection without token
    const unauthRes = await makeRequest('GET', '/api/admin/trial-settings');
    assert.strictEqual(unauthRes.status, 401, 'Must reject unauthenticated request with 401');
    console.log('  [PASS] 4. Admin endpoints strictly reject unauthenticated clients');
    passed++;

    // 5. Admin trial settings with token
    const settingsRes = await makeRequest('GET', '/api/admin/trial-settings', null, {
      Authorization: `Bearer ${adminToken}`,
    });
    assert.strictEqual(settingsRes.status, 200);
    assert.strictEqual(settingsRes.data.settings.trial_duration_days, 7);
    console.log('  [PASS] 5. GET /api/admin/trial-settings retrieves database configuration');
    passed++;

    // 6. Admin edit individual subscription
    const editRes = await makeRequest(
      'PUT',
      `/api/admin/devices/${testInstUuid}/subscription`,
      { status: 'disabled', notes: 'API test disable' },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.data.subscription.status, 'disabled');
    assert.strictEqual(editRes.data.validation.is_valid, false);
    console.log('  [PASS] 6. PUT /api/admin/devices/:id/subscription updates status and immediately validates');
    passed++;

    // 7. Verify device now receives invalid status from public validation
    const recheckStatus = await makeRequest('GET', `/api/subscription/status?installation_id=${testInstUuid}`);
    assert.strictEqual(recheckStatus.data.subscription.is_valid, false);
    assert.strictEqual(recheckStatus.data.subscription.status, 'disabled');
    console.log('  [PASS] 7. Client immediately observes administrator subscription changes');
    passed++;

    // 8. Re-activate subscription
    const reactivateRes = await makeRequest(
      'PUT',
      `/api/admin/devices/${testInstUuid}/subscription`,
      { status: 'active', notes: 'Re-activated in API test' },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(reactivateRes.status, 200);
    assert.strictEqual(reactivateRes.data.validation.is_valid, true);
    console.log('  [PASS] 8. Administrator re-activation restores active subscription status');
    passed++;

    // 9. Admin validate endpoint with simulated test time
    const futureTime = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const simRes = await makeRequest(
      'POST',
      `/api/admin/devices/${testInstUuid}/validate`,
      { test_server_time: futureTime },
      { Authorization: `Bearer ${adminToken}` }
    );
    assert.strictEqual(simRes.status, 200);
    assert.strictEqual(simRes.data.validation.is_valid, false, 'Simulated future date must show expired');
    assert.strictEqual(simRes.data.validation.status, 'expired');
    console.log('  [PASS] 9. POST /api/admin/devices/:id/validate tests expiry with simulated server time');
    passed++;

    console.log(`\nALL ${passed} HTTP API TESTS PASSED!`);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('[API Test Error]', err);
  if (server) server.close();
  process.exit(1);
});
