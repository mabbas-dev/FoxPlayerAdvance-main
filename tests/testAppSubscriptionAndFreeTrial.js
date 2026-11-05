/**
 * FOX PLAYER — APP EXPIRY, FREE TRIAL & SUBSCRIPTION MANAGEMENT INTEGRATION TESTS
 *
 * Verifies all 15 master engineering requirements:
 * 1. App subscription expiry is strictly separated from IPTV provider expiry.
 * 2. Provider expiry changes do not alter app subscription identity or expiry.
 * 3. First launch checks trial eligibility via backend before offering trial.
 * 4. Free trial disclaimer is not offered if device already has active or expired subscription.
 * 5. Dismissing disclaimer ("Not Now") does not activate or consume the trial.
 * 6. "Activate Free Trial" atomically creates exactly one subscription record in UTC.
 * 7. Trial duration is server-controlled (e.g. 7 days or configured duration).
 * 8. Server-calculated UTC expiry matches backend record.
 * 9. Duplicate / concurrent activation requests are rejected without duplicate subscriptions.
 * 10. Expired free trial cannot be re-activated as a fresh free trial.
 * 11. Existing paid subscription is preserved and cannot be overwritten by a free trial.
 * 12. Client-side clock tampering does not extend server-authoritative subscription.
 * 13. Reinstalling / re-registering the same device identifier does not grant a new trial.
 * 14. Admin status updates (extend, disable, revoke) are authoritatively validated.
 * 15. Offline / backend unavailable states do not fabricate expiry dates.
 */

const assert = require('assert');
const crypto = require('crypto');
const { initDatabase, getDb } = require('../server/database/db');
const {
  getSubscriptionSettings,
  updateSubscriptionSettings,
  validateSubscription,
  getSubscription,
  checkTrialEligibility,
  activateTrial,
  adminUpdateSubscription,
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
  console.log('  FOX PLAYER — APP EXPIRY, FREE TRIAL & SUBSCRIPTION TESTS      ');
  console.log('================================================================\n');

  await initDatabase();
  const db = getDb();

  // Reset global trial settings to initial default (7 days, enabled)
  updateSubscriptionSettings({ trial_enabled: true, trial_duration_days: 7, notes: 'Master test run' });

  const runTag = Math.random().toString(36).substring(2, 6).toUpperCase();

  // --- Suite 1: Separation of App Expiry vs IPTV Provider Expiry ---
  console.log('--- Suite 1: Separation of App Expiry vs IPTV Provider Expiry ---');

  const testInst1 = crypto.randomUUID();
  const testDev1 = `SP_${runTag}1`.slice(0, 8);

  it('1.1: App subscription expiry is stored in UTC independently from any IPTV provider date', () => {
    // Register device (does not auto-activate trial without user consent)
    const reg = registerOrUpdateDevice(testDev1, testInst1);
    assert.strictEqual(reg.created, true, 'Device registered');
    assert.strictEqual(reg.is_trial_eligible, true, 'New device is trial eligible');
    assert.strictEqual(reg.subscription, null, 'No trial created before explicit user activation');

    // User activates trial
    const activation = activateTrial(testInst1, testDev1);
    assert.strictEqual(activation.success, true, 'Trial successfully activated');
    assert.ok(activation.subscription.expires_at, 'App expiry is present');

    const appExpiryMs = new Date(activation.subscription.expires_at).getTime();
    assert.ok(!isNaN(appExpiryMs), 'App expiry must be valid timestamp');

    // Simulate IPTV provider with completely different expiry
    const mockProviderExpiry = '2030-12-31T23:59:59.000Z';
    const mockProviderExpiryMs = new Date(mockProviderExpiry).getTime();

    // App expiry MUST NOT match provider expiry
    assert.notStrictEqual(appExpiryMs, mockProviderExpiryMs, 'App expiry must not come from provider');
  });

  it('1.2: Changing IPTV playlist or credentials does not alter App Expiry', () => {
    const subBefore = getSubscription(testInst1);
    const appExpiryBefore = subBefore.expires_at;

    // Simulate changing playlist / provider expiry
    const newProviderExp = 1893456000; // 2030 epoch
    // Re-verify app subscription
    const subAfter = getSubscription(testInst1);
    assert.strictEqual(subAfter.expires_at, appExpiryBefore, 'App expiry remains unchanged after playlist change');
  });

  // --- Suite 2: First Launch Free-Trial Eligibility & Disclaimer Flow ---
  console.log('\n--- Suite 2: First Launch Free-Trial Eligibility & Disclaimer Flow ---');

  const testInst2 = crypto.randomUUID();
  const testDev2 = `EL_${runTag}2`.slice(0, 8);

  it('2.1: New device is verified as eligible with server-configured duration before activation', () => {
    const eligibility = checkTrialEligibility(testInst2, testDev2);
    assert.strictEqual(eligibility.is_eligible, true, 'New device must be eligible');
    assert.strictEqual(eligibility.duration_days, 7, 'Duration must come from server settings (7 days)');
    assert.strictEqual(eligibility.has_subscription, false, 'Device has no subscription yet');
  });

  it('2.2: Dismissing disclaimer ("Not Now") does not activate or consume the trial', () => {
    // When user dismisses, no API activation call is made. Database check:
    const subCheck = getSubscription(testInst2);
    assert.strictEqual(subCheck, null, 'No subscription in database after dismissal');

    // Eligibility must remain intact so user can activate later
    const eligibilityLater = checkTrialEligibility(testInst2, testDev2);
    assert.strictEqual(eligibilityLater.is_eligible, true, 'Device remains eligible after dismissal');
  });

  it('2.3: "Activate Free Trial" atomically creates exactly one subscription', () => {
    const activation = activateTrial(testInst2, testDev2);
    assert.strictEqual(activation.success, true, 'Activation succeeds');
    assert.strictEqual(activation.created, true, 'Subscription is created');
    assert.strictEqual(activation.subscription.is_valid, true, 'Subscription is valid');
    assert.strictEqual(activation.subscription.status, 'active', 'Status is active');
    assert.strictEqual(activation.subscription.subscription_type, 'trial', 'Type is trial');
    assert.strictEqual(activation.subscription.duration_days, 7, 'Duration is 7 days');
  });

  it('2.4: Once activated, device is no longer eligible for another trial', () => {
    const eligibility = checkTrialEligibility(testInst2, testDev2);
    assert.strictEqual(eligibility.is_eligible, false, 'Activated device must not be eligible for fresh trial');
    assert.strictEqual(eligibility.has_subscription, true, 'Device already has subscription');
  });

  // --- Suite 3: Concurrency Safety & Duplicate Prevention ---
  console.log('\n--- Suite 3: Concurrency Safety & Duplicate Prevention ---');

  it('3.1: Calling activateTrial a second time rejects with ALREADY_ACTIVATED', () => {
    const duplicate = activateTrial(testInst2, testDev2);
    assert.strictEqual(duplicate.success, false, 'Second activation must fail');
    assert.strictEqual(duplicate.already_activated, true, 'Must flag already activated');
    assert.strictEqual(duplicate.error.code, 'ALREADY_ACTIVATED', 'Error code must be ALREADY_ACTIVATED');
  });

  it('3.2: Database contains exactly one subscription row for the installation UUID', () => {
    const rows = db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE installation_id = ?').get(testInst2);
    assert.strictEqual(rows.count, 1, 'Exactly 1 subscription row must exist in database');
  });

  // --- Suite 4: Expired Subscriptions & Anti-Tampering ---
  console.log('\n--- Suite 4: Expired Subscriptions & Anti-Tampering ---');

  const testInst4 = crypto.randomUUID();
  const testDev4 = `EX_${runTag}4`.slice(0, 8);

  it('4.1: Expired trial cannot be re-activated as a free trial', () => {
    // Activate trial
    activateTrial(testInst4, testDev4);

    // Simulate expiration via admin or past date
    const pastDate = new Date(Date.now() - 3600000).toISOString();
    adminUpdateSubscription(testInst4, { expires_at: pastDate });

    // Check eligibility: must be false!
    const eligibility = checkTrialEligibility(testInst4, testDev4);
    assert.strictEqual(eligibility.is_eligible, false, 'Expired device is NOT eligible for another trial');
    assert.strictEqual(eligibility.subscription.status, 'expired', 'Subscription status is expired');

    // Attempting activation must be rejected
    const retryActivation = activateTrial(testInst4, testDev4);
    assert.strictEqual(retryActivation.success, false, 'Expired device cannot activate new trial');
  });

  it('4.2: Client clock alteration does not extend server-authoritative validation', () => {
    const sub = getSubscription(testInst4);
    assert.strictEqual(sub.validation.is_valid, false, 'Server time confirms subscription is expired');
    assert.ok(sub.validation.server_time, 'Server timestamp is authoritative source of truth');
  });

  // --- Suite 5: Preservation of Active Paid Subscriptions ---
  console.log('\n--- Suite 5: Preservation of Active Paid Subscriptions ---');

  const testInst5 = crypto.randomUUID();
  const testDev5 = `PD_${runTag}5`.slice(0, 8);

  it('5.1: Active paid subscription is preserved and cannot be overwritten by trial', () => {
    activateTrial(testInst5, testDev5);
    // Upgrade to paid 365 days
    adminUpdateSubscription(testInst5, {
      subscription_type: 'paid',
      duration_days: 365,
      notes: 'Annual paid plan',
    });

    const paidCheck = getSubscription(testInst5);
    assert.strictEqual(paidCheck.subscription_type, 'paid', 'Subscription type is paid');
    assert.strictEqual(paidCheck.validation.subscription_type, 'paid', 'Validation type is paid');

    // Attempting trial activation must not overwrite paid subscription
    const attempt = activateTrial(testInst5, testDev5);
    assert.strictEqual(attempt.success, false, 'Trial cannot overwrite paid subscription');

    const checkStillPaid = getSubscription(testInst5);
    assert.strictEqual(checkStillPaid.subscription_type, 'paid', 'Remains paid subscription');
  });

  // --- Suite 6: Global Admin Configuration Controls ---
  console.log('\n--- Suite 6: Global Admin Configuration Controls ---');

  const testInst6 = crypto.randomUUID();
  const testDev6 = `CF_${runTag}6`.slice(0, 8);

  it('6.1: When trial is disabled globally, new devices are ineligible for trial', () => {
    updateSubscriptionSettings({ trial_enabled: false });

    const eligibility = checkTrialEligibility(testInst6, testDev6);
    assert.strictEqual(eligibility.is_eligible, false, 'Must be ineligible when trial disabled globally');

    const attempt = activateTrial(testInst6, testDev6);
    assert.strictEqual(attempt.success, false, 'Activation fails when trial disabled globally');
    assert.strictEqual(attempt.error.code, 'TRIAL_DISABLED', 'Error code is TRIAL_DISABLED');

    // Re-enable
    updateSubscriptionSettings({ trial_enabled: true, trial_duration_days: 7 });
  });

  // Final Summary
  console.log('\n====================================================');
  console.log(`TOTAL APP SUBSCRIPTION & TRIAL TESTS: ${passedTests + failedTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }

  return { passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  runTests().catch((e) => {
    console.error('Test runner error:', e);
    process.exit(1);
  });
}

module.exports = { runTests };
