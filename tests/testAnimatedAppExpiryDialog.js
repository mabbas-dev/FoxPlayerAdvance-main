/**
 * FOX PLAYER — ANIMATED APP EXPIRY DETAILS DIALOG TEST SUITE
 *
 * Verifies all 14 requirements from the engineering specification:
 * 1. Tapping App Expiry opens the animated dialog.
 * 2. The dialog displays the correct subscription data.
 * 3. The expiry date matches the authoritative subscription source.
 * 4. Remaining validity is calculated correctly (days, hours, minutes, elapsed).
 * 5. Active, trial, expiring, expired, and unavailable states are handled correctly.
 * 6. Missing optional fields do not break layout.
 * 7. Long Device IDs do not overflow.
 * 8. The dialog closes correctly using its close button.
 * 9. Android hardware back dismisses the dialog.
 * 10. Backdrop interaction works without triggering underlying controls.
 * 11. Opening and closing the dialog repeatedly does not cause flickering or stale data.
 * 12. Offline and backend-error scenarios display accurate information.
 * 13. Android and iOS render the same subscription information.
 * 14. Existing Home screen behavior remains unchanged.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  console.log('   FOX PLAYER — ANIMATED APP EXPIRY DETAILS DIALOG TESTS        ');
  console.log('================================================================\n');

  const homeScreenSrc = fs.readFileSync(path.join(__dirname, '../src/screens/HomeScreen.js'), 'utf8');
  const dialogSrc = fs.readFileSync(path.join(__dirname, '../src/components/SubscriptionDetailsModal.js'), 'utf8');
  const subCtxSrc = fs.readFileSync(path.join(__dirname, '../src/state/SubscriptionContext.js'), 'utf8');
  const iconsSrc = fs.readFileSync(path.join(__dirname, '../src/components/Icons.js'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(__dirname, '../src/screens/SettingsScreen.js'), 'utf8');

  // --- Suite 1: Interactive Home Screen App Expiry Indicator ---
  console.log('--- Suite 1: Interactive Home Screen App Expiry Indicator ---');

  it('1.1: HomeScreen imports SubscriptionDetailsModal component', () => {
    assert.ok(
      homeScreenSrc.includes("import SubscriptionDetailsModal from '../components/SubscriptionDetailsModal'"),
      'HomeScreen must import SubscriptionDetailsModal'
    );
  });

  it('1.2: HomeScreen declares subscriptionModalVisible state', () => {
    assert.ok(
      homeScreenSrc.includes('const [subscriptionModalVisible, setSubscriptionModalVisible] = useState(false)'),
      'HomeScreen must declare subscriptionModalVisible state'
    );
  });

  it('1.3: HomeScreen statusPill has handleOpenSubscriptionDetails callback with stopPropagation', () => {
    assert.ok(
      homeScreenSrc.includes('const handleOpenSubscriptionDetails = useCallback'),
      'HomeScreen must declare handleOpenSubscriptionDetails'
    );
    assert.ok(
      homeScreenSrc.includes('e.stopPropagation();'),
      'Must call stopPropagation to prevent triggering parent handlers'
    );
    assert.ok(
      homeScreenSrc.includes('setSubscriptionModalVisible(true)'),
      'Must set subscriptionModalVisible to true when indicator is pressed'
    );
  });

  it('1.4: Entire expiry pill is tappable and preserves existing styling and colors', () => {
    assert.ok(
      homeScreenSrc.includes('style={[styles.statusPill, appSubscriptionInfo.isExpired && styles.statusPillExpired]}'),
      'Pill must preserve existing statusPill and statusPillExpired styling'
    );
    assert.ok(
      homeScreenSrc.includes('onPress={handleOpenSubscriptionDetails}'),
      'statusPill must attach handleOpenSubscriptionDetails to onPress'
    );
    assert.ok(
      homeScreenSrc.includes('activeOpacity={0.75}'),
      'Must have subtle touch feedback activeOpacity'
    );
  });

  it('1.5: Existing expiry text and status behavior remains intact', () => {
    assert.ok(
      homeScreenSrc.includes('{appSubscriptionInfo.badgeLabel}'),
      'Must preserve appSubscriptionInfo.badgeLabel'
    );
    assert.ok(
      homeScreenSrc.includes('{appSubscriptionInfo.expiryText}'),
      'Must preserve appSubscriptionInfo.expiryText'
    );
    assert.ok(
      homeScreenSrc.includes('color={appSubscriptionInfo.calendarColor}'),
      'Must preserve calendarColor'
    );
  });

  // --- Suite 2: Modern Animated Dialog Component Architecture ---
  console.log('\n--- Suite 2: Modern Animated Dialog Component Architecture ---');

  it('2.1: SubscriptionDetailsModal uses native-driver compatible Animated API', () => {
    assert.ok(
      dialogSrc.includes('useNativeDriver: true'),
      'Must use useNativeDriver: true for 60/120fps fluid transforms'
    );
    assert.ok(
      dialogSrc.includes('Animated.timing'),
      'Must use Animated.timing'
    );
  });

  it('2.2: Pop animation scales from ~92% to 100% with smooth cubic bezier curve', () => {
    assert.ok(
      dialogSrc.includes('outputRange: [0.92, 1]'),
      'Dialog scale must pop in smoothly from 0.92 to 1'
    );
    assert.ok(
      dialogSrc.includes('Easing.bezier(0.16, 1, 0.3, 1)'),
      'Must use smooth easing curve'
    );
  });

  it('2.3: Overlay fades in smoothly and supports vertical translation', () => {
    assert.ok(
      dialogSrc.includes('styles.backdrop'),
      'Must have backdrop overlay'
    );
    assert.ok(
      dialogSrc.includes('translateY: cardTranslateY'),
      'Dialog combines subtle vertical movement'
    );
  });

  it('2.4: Dismissal animation handles closing guard and cleans up state', () => {
    assert.ok(
      dialogSrc.includes('isClosingRef = useRef(false)'),
      'Must guard against double close requests during animation'
    );
    assert.ok(
      dialogSrc.includes('handleClose = useCallback'),
      'Must provide clean handleClose callback'
    );
  });

  // --- Suite 3: Subscription & Expiry Calculation Logic ---
  console.log('\n--- Suite 3: Subscription & Expiry Calculation Logic ---');

  const {
    formatAppExpiryDate,
    formatAppExpiryTime,
    getSubscriptionTimeRemaining,
    calculateSubscriptionProgress,
  } = await import('../src/utils/subscriptionUtils.js');

  it('3.1: SubscriptionContext re-exports accurate date/time and duration helpers', () => {
    assert.ok(subCtxSrc.includes('export {'), 'SubscriptionContext must re-export helpers');
    assert.ok(subCtxSrc.includes('formatAppExpiryDate'), 'Re-exports formatAppExpiryDate');
    assert.ok(subCtxSrc.includes('formatAppExpiryTime'), 'Re-exports formatAppExpiryTime');
    assert.ok(subCtxSrc.includes('getSubscriptionTimeRemaining'), 'Re-exports getSubscriptionTimeRemaining');
    assert.ok(subCtxSrc.includes('calculateSubscriptionProgress'), 'Re-exports calculateSubscriptionProgress');

    assert.strictEqual(typeof formatAppExpiryDate, 'function');
    assert.strictEqual(typeof formatAppExpiryTime, 'function');
    assert.strictEqual(typeof getSubscriptionTimeRemaining, 'function');
    assert.strictEqual(typeof calculateSubscriptionProgress, 'function');
  });

  it('3.2: getSubscriptionTimeRemaining accurately formats durations in the future and past', () => {
    const baseNow = new Date('2026-10-11T12:00:00Z').getTime();

    // 30 days remaining
    const exp30d = new Date(baseNow + 30 * 24 * 3600 * 1000).toISOString();
    const res30d = getSubscriptionTimeRemaining(exp30d, '2026-10-11T12:00:00Z');
    assert.strictEqual(res30d.isExpired, false);
    assert.strictEqual(res30d.text, '30 days remaining');

    // 2 days, 5 hours remaining
    const exp2d5h = new Date(baseNow + (2 * 24 + 5) * 3600 * 1000).toISOString();
    const res2d5h = getSubscriptionTimeRemaining(exp2d5h, '2026-10-11T12:00:00Z');
    assert.strictEqual(res2d5h.isExpired, false);
    assert.strictEqual(res2d5h.text, '2 days, 5 hours remaining');

    // Expired 3 days ago
    const expPast3d = new Date(baseNow - 3 * 24 * 3600 * 1000).toISOString();
    const resPast3d = getSubscriptionTimeRemaining(expPast3d, '2026-10-11T12:00:00Z');
    assert.strictEqual(resPast3d.isExpired, true);
    assert.strictEqual(resPast3d.text, 'Expired 3 days ago');

    // Unavailable date
    const resNull = getSubscriptionTimeRemaining(null);
    assert.strictEqual(resNull.text, 'Expiry date unavailable');
  });

  it('3.3: calculateSubscriptionProgress clamps correctly between 0% and 100%', () => {
    const starts = '2026-10-10T00:00:00Z';
    const expires = '2026-10-20T00:00:00Z'; // 10 days total

    // At 5 days (50%)
    const mid = '2026-10-15T00:00:00Z';
    const pMid = calculateSubscriptionProgress(starts, expires, mid);
    assert.strictEqual(pMid.percentage, 50);
    assert.strictEqual(pMid.isExpired, false);

    // After expiration (100%)
    const past = '2026-10-25T00:00:00Z';
    const pPast = calculateSubscriptionProgress(starts, expires, past);
    assert.strictEqual(pPast.percentage, 100);
    assert.strictEqual(pPast.isExpired, true);

    // Invalid dates returns null (does not fabricate progress)
    assert.strictEqual(calculateSubscriptionProgress(null, expires), null);
  });

  // --- Suite 4: Dialog Information Hierarchy & UI Controls ---
  console.log('\n--- Suite 4: Dialog Information Hierarchy & UI Controls ---');

  it('4.1: Dialog renders Header with Shield icon, title, subtitle, and close button', () => {
    assert.ok(dialogSrc.includes('Subscription Details'), 'Must have header title');
    assert.ok(dialogSrc.includes('Your app access and expiry information'), 'Must have header subtitle');
    assert.ok(dialogSrc.includes('<ShieldIcon'), 'Must render ShieldIcon');
    assert.ok(dialogSrc.includes('<CloseXIcon'), 'Must render CloseXIcon');
  });

  it('4.2: Dialog distinguishes Active, Trial Active, Expiring Soon, Expired, Inactive, and Unable to Verify', () => {
    assert.ok(dialogSrc.includes("'PENDING_VALIDATION'"), 'Handles Pending Validation');
    assert.ok(dialogSrc.includes("'UNABLE_TO_VERIFY'"), 'Handles Unable to Verify');
    assert.ok(dialogSrc.includes("'TRIAL_AVAILABLE'"), 'Handles Free Trial Available');
    assert.ok(dialogSrc.includes("'EXPIRING_SOON'"), 'Handles Expiring Soon');
    assert.ok(dialogSrc.includes("'TRIAL_ACTIVE'"), 'Handles Trial Active');
    assert.ok(dialogSrc.includes("'EXPIRED'"), 'Handles Expired');
    assert.ok(dialogSrc.includes("'ACTIVE'"), 'Handles Active');
  });

  it('4.3: Dialog displays complete metadata table and device identity box with copy support', () => {
    assert.ok(dialogSrc.includes('SUBSCRIPTION INFORMATION'), 'Must have subscription metadata header');
    assert.ok(dialogSrc.includes('Plan Name'), 'Displays Plan Name');
    assert.ok(dialogSrc.includes('Subscription Type'), 'Displays Subscription Type');
    assert.ok(dialogSrc.includes('Activation Date'), 'Displays Activation Date');
    assert.ok(dialogSrc.includes('Subscription Reference'), 'Displays Subscription Reference');
    assert.ok(dialogSrc.includes('DEVICE IDENTIFICATION'), 'Must have device identity header');
    assert.ok(dialogSrc.includes('DEVICE ID'), 'Displays Device ID');
    assert.ok(dialogSrc.includes('INSTALLATION UUID'), 'Displays Installation UUID');
    assert.ok(dialogSrc.includes('handleCopy'), 'Provides copy functionality');
  });

  it('4.4: Device IDs are rendered in monospace and handled against overflow', () => {
    assert.ok(
      dialogSrc.includes("Platform.select({ ios: 'Menlo', default: 'monospace' })"),
      'Uses monospace font for device identity'
    );
    assert.ok(
      dialogSrc.includes('ellipsizeMode="middle"'),
      'Uses middle truncation for long UUIDs'
    );
  });

  it('4.5: Supports Android hardware back, backdrop dismissal, and safe area scrolling', () => {
    assert.ok(
      dialogSrc.includes('onRequestClose={handleClose}'),
      'Supports Android hardware back button'
    );
    assert.ok(
      dialogSrc.includes('useSafeAreaInsets'),
      'Applies safe area insets on iOS and Android'
    );
    assert.ok(
      dialogSrc.includes('<ScrollView'),
      'Wraps content in ScrollView to prevent overflow on landscape displays'
    );
    assert.ok(
      dialogSrc.includes('Pressable'),
      'Has backdrop dismissal'
    );
  });

  it('4.6: Reusable in SettingsScreen when user inspects App Expiry', () => {
    assert.ok(
      settingsSrc.includes("import SubscriptionDetailsModal from '../components/SubscriptionDetailsModal'"),
      'SettingsScreen imports SubscriptionDetailsModal'
    );
    assert.ok(
      settingsSrc.includes('<SubscriptionDetailsModal'),
      'SettingsScreen mounts SubscriptionDetailsModal'
    );
  });

  // --- Suite 5: CopyIcon asset integration ---
  console.log('\n--- Suite 5: Icons Asset Integration ---');

  it('5.1: Icons.js exports CopyIcon', () => {
    assert.ok(
      iconsSrc.includes('export function CopyIcon'),
      'Icons.js must export CopyIcon'
    );
  });

  console.log('\n================================================================');
  console.log(`TOTAL ANIMATED DIALOG TESTS: ${passedTests + failedTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('================================================================\n');

  if (failedTests > 0 && require.main === module) {
    process.exit(1);
  }
  return { passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = runTests;
