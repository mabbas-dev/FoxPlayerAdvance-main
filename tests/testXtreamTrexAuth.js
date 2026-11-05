/**
 * Trex / XUI Xtream auth compatibility (HTTP 513, empty body, auth field variants).
 */
const assert = require('assert');
const {
  isXtreamAuthHttpStatus,
  isXtreamAuthSuccess,
  parseXtreamAuthPayload,
} = require('../src/utils/xtreamAuthHelpers.js');

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (e) {
    failed++;
    console.error(`  [FAIL] ${name}: ${e.message}`);
  }
}

console.log('--- Xtream Trex auth helpers ---');

it('513 is treated as auth HTTP status', () => {
  assert.strictEqual(isXtreamAuthHttpStatus(513), true);
  assert.strictEqual(isXtreamAuthHttpStatus(520), false);
});

it('accepts auth=1 and status Active', () => {
  const sample = {
    username: '0af6aedab3',
    auth: 1,
    status: 'Active',
  };
  assert.strictEqual(isXtreamAuthSuccess(sample), true);
});

it('accepts auth string "1"', () => {
  assert.strictEqual(isXtreamAuthSuccess({ auth: '1', status: 'Active' }), true);
});

it('rejects auth 0', () => {
  assert.strictEqual(isXtreamAuthSuccess({ auth: 0, status: 'Active' }), false);
});

it('parses live Trex-style JSON payload', () => {
  const json = JSON.stringify({
    user_info: { username: 'u', auth: 1, status: 'Active' },
    server_info: { url: 'line.example.com', port: '80', server_protocol: 'http' },
  });
  const r = parseXtreamAuthPayload(json);
  assert.strictEqual(r.ok, true);
  assert.ok(r.data.user_info);
});

it('empty body is auth failure', () => {
  const r = parseXtreamAuthPayload('');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'EMPTY_BODY');
});

console.log(`\nDone: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
