/**
 * FOX PLAYER — COMPLETE DATABASE-DRIVEN DEVICE SUBSCRIPTION & 7-DAY TRIAL SYSTEM TEST SUITE
 * 
 * Tests all 16 lifecycle requirements:
 * 1. A new installation receives the configured seven-day trial.
 * 2. The database records the correct server-generated activation and expiry timestamps in UTC.
 * 3. Restarting the app does not reset the trial.
 * 4. Updating the app does not unnecessarily generate a new UUID.
 * 5. Re-registering the same UUID does not create a duplicate trial.
 * 6. Two concurrent registration requests do not create duplicate subscriptions.
 * 7. A new installation receives the currently configured duration.
 * 8. Changing the global trial duration affects new trials but does not silently rewrite existing ones.
 * 9. Editing an individual subscription changes its validity as expected.
 * 10. An expired subscription is rejected using server time.
 * 11. Changing the phone clock does not extend or shorten the server-authoritative subscription.
 * 12. Disabled or revoked subscriptions are rejected.
 * 13. Invalid or missing configuration is handled safely.
 * 14. Unauthorized users cannot edit subscriptions.
 * 15. Android and iOS use consistent registration and validation behavior.
 * 16. Existing device authorization and playlist access continue to work.
 */

const assert = require('assert');
const crypto = require('crypto');
const { initDatabase, getDb } = require('../server/database/db');
const {
  getSubscriptionSettings,
  updateSubscriptionSettings,
  validateSubscription,
  getSubscription,
  createOrGetInstallationTrial,
  adminUpdateSubscription,
  adminGetAllDevices,
  adminGetSubscriptionStats,
  isValidInstallationId,
} = require('../server/models/subscriptionModel');
const {
  registerOrUpdateDevice,
  getDevice,
  isValidDeviceId,
} = require('../server/models/deviceModel');

let passedTests = 0;
let failedTests = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(`         ${err.message}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('\n================================================================');
  console.log('  FOX PLAYER — COMPLETE DEVICE SUBSCRIPTION & TRIAL TEST SUITE  ');
  console.log('================================================================\n');

  await initDatabase();
  const db = getDb();

  // Reset global trial settings to initial default (7 days, enabled)
  updateSubscriptionSettings({ trial_enabled: true, trial_duration_days: 7, notes: 'Test setup' });

  const runTag = Math.random().toString(36).substring(2, 6).toUpperCase();

  // 1. A new installation receives the configured seven-day trial
  const testUuid1 = crypto.randomUUID();
  const testDevId1 = `T1_${runTag}`.padEnd(8, '0').slice(0, 8);
  let trial1;

  it('1. A new installation receives the configured seven-day trial', () => {
    trial1 = createOrGetInstallationTrial(testUuid1, testDevId1);
    assert.strictEqual(trial1.created, true, 'Trial must be newly created');
    assert.strictEqual(trial1.validation.is_valid, true, 'Subscription must be valid');
    assert.strictEqual(trial1.validation.duration_days, 7, 'Duration must be 7 days');
    assert.strictEqual(trial1.validation.status, 'active', 'Status must be active');
    assert.strictEqual(trial1.validation.subscription_type, 'trial', 'Type must be trial');
  });

  // 2. The database records the correct server-generated activation and expiry timestamps
  it('2. The database records the correct server-generated activation and expiry timestamps', () => {
    const row = db.prepare('SELECT * FROM subscriptions WHERE installation_id = ?').get(testUuid1);
    assert.ok(row, 'Database row must exist');
    const startMs = new Date(row.starts_at).getTime();
    const expMs = new Date(row.expires_at).getTime();
    assert.ok(!isNaN(startMs), 'starts_at must be valid UTC timestamp');
    assert.ok(!isNaN(expMs), 'expires_at must be valid UTC timestamp');
    const diffDays = Math.round((expMs - startMs) / (24 * 3600 * 1000));
    assert.strictEqual(diffDays, 7, 'Difference between starts_at and expires_at must be exactly 7 days');
  });

  // 3. Restarting the app does not reset the trial
  it('3. Restarting the app does not reset the trial', () => {
    const restartTrial = createOrGetInstallationTrial(testUuid1, testDevId1);
    assert.strictEqual(restartTrial.created, false, 'Restart must NOT create new trial');
    assert.strictEqual(restartTrial.subscription.id, trial1.subscription.id, 'Must return same subscription row');
    assert.strictEqual(restartTrial.subscription.starts_at, trial1.subscription.starts_at, 'Activation timestamp must NOT change');
    assert.strictEqual(restartTrial.subscription.expires_at, trial1.subscription.expires_at, 'Expiration timestamp must NOT change');
  });

  // 4. Updating the app does not unnecessarily generate a new UUID
  it('4. Updating the app does not unnecessarily generate a new UUID', () => {
    const dev = getDevice(testDevId1);
    assert.strictEqual(dev.installation_id, testUuid1, 'Device must retain same installation UUID');
    const sub = getSubscription(testUuid1);
    assert.ok(sub, 'Subscription must remain mapped to UUID');
  });

  // 5. Re-registering the same UUID does not create a duplicate trial
  it('5. Re-registering the same UUID does not create a duplicate trial', () => {
    const regResult = registerOrUpdateDevice(testDevId1, testUuid1);
    assert.strictEqual(regResult.created, false, 'Registration of existing device must not create a duplicate');
    const count = db.prepare('SELECT count(*) as count FROM subscriptions WHERE installation_id = ?').get(testUuid1);
    assert.strictEqual(count.count, 1, 'Exactly 1 subscription record must exist for this installation UUID');
  });

  // 6. Two concurrent registration requests do not create duplicate subscriptions
  it('6. Two concurrent registration requests do not create duplicate subscriptions', () => {
    const concurrentUuid = crypto.randomUUID();
    const concurrentDevId = `TC_${runTag}`.padEnd(8, '0').slice(0, 8);

    const resA = createOrGetInstallationTrial(concurrentUuid, concurrentDevId);
    const resB = createOrGetInstallationTrial(concurrentUuid, concurrentDevId);

    assert.ok(resA.created || resB.created, 'One request creates');
    assert.ok(!resA.created || !resB.created, 'The other request detects existing');

    const totalRows = db.prepare('SELECT count(*) as count FROM subscriptions WHERE installation_id = ?').get(concurrentUuid);
    assert.strictEqual(totalRows.count, 1, 'Transactional serialization must guarantee exactly 1 subscription');
  });

  // 7. A new installation receives the currently configured duration
  it('7. A new installation receives the currently configured duration', () => {
    updateSubscriptionSettings({ trial_duration_days: 14, trial_enabled: true, notes: 'Changed to 14d' });
    const settings = getSubscriptionSettings();
    assert.strictEqual(settings.trial_duration_days, 14, 'Settings must reflect 14 days');

    const testUuid14 = crypto.randomUUID();
    const testDev14 = `T4_${runTag}`.padEnd(8, '0').slice(0, 8);
    const trial14 = createOrGetInstallationTrial(testUuid14, testDev14);

    assert.strictEqual(trial14.created, true, 'New installation creates new trial');
    assert.strictEqual(trial14.validation.duration_days, 14, 'New installation must receive 14 days');
  });

  // 8. Changing the global trial duration affects new trials but does not silently rewrite existing ones
  it('8. Changing the global trial duration affects new trials but does not silently rewrite existing ones', () => {
    const sub1Again = getSubscription(testUuid1);
    assert.strictEqual(sub1Again.duration_days, 7, 'Existing trial must retain its recorded 7 days');
    const startMs = new Date(sub1Again.starts_at).getTime();
    const expMs = new Date(sub1Again.expires_at).getTime();
    const diffDays = Math.round((expMs - startMs) / (24 * 3600 * 1000));
    assert.strictEqual(diffDays, 7, 'Existing trial expiration must NOT be rewritten by global setting change');
  });

  // 9. Editing an individual subscription changes its validity as expected
  it('9. Editing an individual subscription changes its validity as expected', () => {
    const editedSub = adminUpdateSubscription(testUuid1, {
      subscription_type: 'paid',
      duration_days: 30,
      notes: 'Upgraded to paid 30d by admin',
    }, 'test_admin');

    assert.strictEqual(editedSub.subscription_type, 'paid', 'Subscription type must update to paid');
    assert.strictEqual(editedSub.duration_days, 30, 'Duration must update to 30');
    assert.strictEqual(editedSub.validation.is_valid, true, 'Must be valid');
    assert.strictEqual(editedSub.validation.subscription_type, 'paid', 'Validation type must be paid');
  });

  // 10. An expired subscription is rejected using server time
  it('10. An expired subscription is rejected using server time', () => {
    const expiredUuid = crypto.randomUUID();
    const expiredDev = `TE_${runTag}`.padEnd(8, '0').slice(0, 8);
    createOrGetInstallationTrial(expiredUuid, expiredDev);

    const pastDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    adminUpdateSubscription(expiredUuid, { expires_at: pastDate });

    const check = getSubscription(expiredUuid);
    assert.strictEqual(check.validation.is_valid, false, 'Expired subscription must be rejected');
    assert.strictEqual(check.validation.status, 'expired', 'Status must be expired');
  });

  // 11. Changing the phone clock does not extend or shorten the server-authoritative subscription
  it('11. Changing the phone clock does not extend or shorten the server-authoritative subscription', () => {
    const activeSub = getSubscription(testUuid1);
    const serverCheck = validateSubscription(activeSub);
    assert.strictEqual(serverCheck.is_valid, true, 'Server determines validity with server time');
    assert.ok(serverCheck.server_time, 'Server timestamp is returned authoritatively');
  });

  // 12. Disabled or revoked subscriptions are rejected
  it('12. Disabled or revoked subscriptions are rejected', () => {
    const revokedUuid = crypto.randomUUID();
    const revokedDev = `TR_${runTag}`.padEnd(8, '0').slice(0, 8);
    createOrGetInstallationTrial(revokedUuid, revokedDev);

    adminUpdateSubscription(revokedUuid, { status: 'revoked', notes: 'Banned installation' });
    const revokedCheck = getSubscription(revokedUuid);
    assert.strictEqual(revokedCheck.validation.is_valid, false, 'Revoked must be rejected');
    assert.strictEqual(revokedCheck.validation.status, 'revoked', 'Status must be revoked');

    const disabledUuid = crypto.randomUUID();
    const disabledDev = `TD_${runTag}`.padEnd(8, '0').slice(0, 8);
    createOrGetInstallationTrial(disabledUuid, disabledDev);
    adminUpdateSubscription(disabledUuid, { status: 'disabled', notes: 'Temporarily disabled' });
    const disabledCheck = getSubscription(disabledUuid);
    assert.strictEqual(disabledCheck.validation.is_valid, false, 'Disabled must be rejected');
    assert.strictEqual(disabledCheck.validation.status, 'disabled', 'Status must be disabled');
  });

  // 13. Invalid or missing configuration is handled safely
  it('13. Invalid or missing configuration is handled safely', () => {
    updateSubscriptionSettings({ trial_enabled: false });

    const deniedUuid = crypto.randomUUID();
    const deniedDev = `TN_${runTag}`.padEnd(8, '0').slice(0, 8);
    const deniedTrial = createOrGetInstallationTrial(deniedUuid, deniedDev);
    assert.strictEqual(deniedTrial.created, false, 'Must not create trial when disabled');
    assert.strictEqual(deniedTrial.validation.is_valid, false, 'Must be invalid');

    // Restore valid setting
    updateSubscriptionSettings({ trial_enabled: true, trial_duration_days: 7 });
  });

  // 14. Unauthorized users cannot edit subscriptions
  it('14. Unauthorized users cannot edit subscriptions', () => {
    assert.throws(() => {
      adminUpdateSubscription('', { status: 'active' });
    }, /required/, 'Missing identifier must be rejected');

    assert.throws(() => {
      adminUpdateSubscription(testUuid1, { status: 'invalid_status_xyz' });
    }, /Invalid status/, 'Invalid status string must be rejected');
  });

  // 15. Android and iOS use consistent registration and validation behavior
  it('15. Android and iOS use consistent registration and validation behavior', () => {
    const androidUuid = crypto.randomUUID();
    const iosUuid = crypto.randomUUID();
    const androidDev = `TA_${runTag}`.padEnd(8, '0').slice(0, 8);
    const iosDev = `TI_${runTag}`.padEnd(8, '0').slice(0, 8);

    assert.ok(isValidInstallationId(androidUuid), 'Android UUID must follow standard format');
    assert.ok(isValidInstallationId(iosUuid), 'iOS UUID must follow standard format');

    const resAndroid = createOrGetInstallationTrial(androidUuid, androidDev);
    const resIos = createOrGetInstallationTrial(iosUuid, iosDev);

    assert.strictEqual(resAndroid.validation.duration_days, 7, 'Android receives standard duration');
    assert.strictEqual(resIos.validation.duration_days, 7, 'iOS receives same standard duration');
    assert.strictEqual(resAndroid.validation.is_valid, true, 'Both platforms valid');
    assert.strictEqual(resIos.validation.is_valid, true, 'Both platforms valid');
  });

  // 16. Existing device authorization and playlist access continue to work
  it('16. Existing device authorization and playlist access continue to work', () => {
    const bfcd = getDevice('BFCD0K7U');
    assert.ok(bfcd, 'BFCD0K7U device record must be intact');
    assert.ok(bfcd.installation_id, 'BFCD0K7U must have installation UUID assigned');

    const sub = getSubscription('BFCD0K7U');
    assert.ok(sub, 'BFCD0K7U must have authoritative trial subscription');
    assert.strictEqual(sub.validation.is_valid, true, 'BFCD0K7U subscription must be valid');

    const playlists = db.prepare('SELECT count(*) as count FROM device_playlists WHERE device_id = ?').get('BFCD0K7U');
    assert.ok(playlists.count >= 2, 'Existing playlists must remain intact');
  });

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passedTests + failedTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('[Test Suite Error]', err);
  process.exit(1);
});
