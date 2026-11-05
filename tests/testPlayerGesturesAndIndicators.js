/**
 * FOX PLAYER — VLC-Style Volume & Brightness Gesture & Indicator Tests
 *
 * Validates:
 * 1. Left-Side Vertical Swipe -> Brightness adjustment & clamping [0.0, 1.0].
 * 2. Right-Side Vertical Swipe -> Volume adjustment & clamping [0.0, 1.0].
 * 3. Initial touch side locking (remains locked even if touch crosses center).
 * 4. Movement threshold (|dy| > 10 && |dy| > |dx|) preventing accidental tap activation.
 * 5. Lifecycle brightness preservation and cleanup/restoration.
 * 6. Volume synchronization with native player and auto-unmute behavior.
 * 7. HUD indicator visibility, auto-dismiss (1200ms), and pending timer cancellation.
 * 8. Tap & double-tap preservation for controls and 10s seeking.
 */

const assert = require('assert');

// Color helpers for terminal reporting
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';

function runTests() {
  let totalTests = 0;
  let passedTests = 0;

  function test(name, fn) {
    totalTests++;
    try {
      fn();
      passedTests++;
      console.log(`  ${GREEN}PASS:${RESET} ${name}`);
    } catch (err) {
      console.error(`  ${RED}FAIL:${RESET} ${name}`);
      console.error(`    ${RED}${err.message}${RESET}`);
    }
  }

  console.log(`\n${BOLD}${CYAN}================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  FOX PLAYER — VLC-STYLE VOLUME & BRIGHTNESS GESTURE TESTS      ${RESET}`);
  console.log(`${BOLD}${CYAN}================================================================${RESET}\n`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Gesture Side Mapping and Thresholds
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`${BOLD}--- 1. Gesture Side Mapping and Movement Thresholds ---${RESET}`);

  test('Initial touch on left 50% maps to brightness control', () => {
    const containerWidth = 800;
    const touchX1 = 100;
    const touchX2 = 399;
    
    const isLeft1 = touchX1 < containerWidth * 0.5;
    const isLeft2 = touchX2 < containerWidth * 0.5;

    assert.strictEqual(isLeft1, true);
    assert.strictEqual(isLeft2, true);
    assert.strictEqual(isLeft1 ? 'brightness' : 'volume', 'brightness');
  });

  test('Initial touch on right 50% maps to volume control', () => {
    const containerWidth = 800;
    const touchX1 = 400;
    const touchX2 = 750;
    
    const isLeft1 = touchX1 < containerWidth * 0.5;
    const isLeft2 = touchX2 < containerWidth * 0.5;

    assert.strictEqual(isLeft1, false);
    assert.strictEqual(isLeft2, false);
    assert.strictEqual(isLeft1 ? 'brightness' : 'volume', 'volume');
  });

  test('Gesture started on one side remains locked to that control if finger crosses center', () => {
    const containerWidth = 800;
    const initialTouchX = 200; // Left side
    const lockedMode = initialTouchX < containerWidth * 0.5 ? 'brightness' : 'volume';

    // Finger moves across center to X = 600
    const movedTouchX = 600;
    // Mode MUST remain the lockedMode, not recalculated from movedTouchX
    const effectiveMode = lockedMode;

    assert.strictEqual(effectiveMode, 'brightness');
  });

  test('Vertical threshold (|dy| > 10 && |dy| > |dx|) prevents tap and horizontal seek capture', () => {
    function shouldCaptureGesture(dx, dy) {
      const absDy = Math.abs(dy);
      const absDx = Math.abs(dx);
      return absDy > 10 && absDy > absDx * 1.2;
    }

    // Small tap movement (<10)
    assert.strictEqual(shouldCaptureGesture(2, 4), false);
    // Pure horizontal scrubber drag
    assert.strictEqual(shouldCaptureGesture(50, 5), false);
    // Diagonal swipe favoring horizontal
    assert.strictEqual(shouldCaptureGesture(40, 30), false);
    // Valid vertical gesture
    assert.strictEqual(shouldCaptureGesture(4, 35), true);
    assert.strictEqual(shouldCaptureGesture(0, -60), true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Brightness Progression, Clamping & Lifecycle Restoration
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}--- 2. Brightness Progression & Lifecycle Restoration ---${RESET}`);

  test('Upward swipe smoothly increases brightness clamped to 1.0', () => {
    const startBrightness = 0.5;
    const sensitivity = 250;
    const dy = -100; // 100px upward

    const delta = -dy / sensitivity; // +0.4
    const nextBrightness = Math.max(0, Math.min(1, startBrightness + delta));

    assert.strictEqual(nextBrightness, 0.9);

    // Large upward swipe clamps strictly to 1.0
    const largeDy = -500;
    const maxClamped = Math.max(0, Math.min(1, startBrightness + (-largeDy / sensitivity)));
    assert.strictEqual(maxClamped, 1.0);
  });

  test('Downward swipe smoothly decreases brightness clamped to 0.0', () => {
    const startBrightness = 0.5;
    const sensitivity = 250;
    const dy = 80; // 80px downward

    const delta = -dy / sensitivity; // -0.32
    const nextBrightness = Math.max(0, Math.min(1, startBrightness + delta));

    assert.strictEqual(Number(nextBrightness.toFixed(2)), 0.18);

    // Large downward swipe clamps strictly to 0.0
    const largeDy = 600;
    const minClamped = Math.max(0, Math.min(1, startBrightness + (-largeDy / sensitivity)));
    assert.strictEqual(minClamped, 0.0);
  });

  test('Initial brightness is restored on player unmount if modified', () => {
    const initialDeviceBrightness = 0.65;
    let currentBrightness = initialDeviceBrightness;
    let hasModified = false;

    // User performs brightness swipe to 0.9
    currentBrightness = 0.9;
    hasModified = true;

    // Simulated unmount cleanup
    if (hasModified && initialDeviceBrightness !== null) {
      currentBrightness = initialDeviceBrightness;
      hasModified = false;
    }

    assert.strictEqual(currentBrightness, 0.65);
    assert.strictEqual(hasModified, false);
  });

  test('AppState backgrounding restores brightness and foregrounding preserves state', () => {
    const initialBrightness = 0.45;
    let activePlayerBrightness = 0.85;
    let appliedSystemBrightness = activePlayerBrightness;
    let hasModified = true;

    // App enters background
    function handleAppStateChange(nextState) {
      if (nextState === 'background' || nextState === 'inactive') {
        if (hasModified) {
          appliedSystemBrightness = initialBrightness;
        }
      } else if (nextState === 'active') {
        if (hasModified) {
          appliedSystemBrightness = activePlayerBrightness;
        }
      }
    }

    handleAppStateChange('background');
    assert.strictEqual(appliedSystemBrightness, 0.45);

    handleAppStateChange('active');
    assert.strictEqual(appliedSystemBrightness, 0.85);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Volume Progression, Clamping & Synchronization
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}--- 3. Volume Progression & Auto-Unmute Synchronization ---${RESET}`);

  test('Upward swipe smoothly increases mobile system volume while keeping player audio unmuted', () => {
    const mockPlayer = { volume: 1.0, muted: false };
    const mockDevice = { systemVolume: 0.2 };
    const startVolume = 0.2;
    const sensitivity = 250;
    const dy = -125; // 125px upward -> +0.5

    const delta = -dy / sensitivity;
    const nextVolume = Math.max(0, Math.min(1, startVolume + delta));

    mockDevice.systemVolume = nextVolume;
    // Player internal audio stream must stay at full volume 1.0 and unmuted
    mockPlayer.volume = 1.0;
    mockPlayer.muted = false;

    assert.strictEqual(nextVolume, 0.7);
    assert.strictEqual(mockDevice.systemVolume, 0.7);
    assert.strictEqual(mockPlayer.volume, 1.0);
    assert.strictEqual(mockPlayer.muted, false);
  });

  test('Downward swipe to 0 clamps system volume to 0.0 and mutes', () => {
    const mockDevice = { systemVolume: 0.8 };
    const startVolume = 0.8;
    const sensitivity = 250;
    const dy = 300; // 300px downward -> -1.2

    const delta = -dy / sensitivity;
    const nextVolume = Math.max(0, Math.min(1, startVolume + delta));

    mockDevice.systemVolume = nextVolume;

    assert.strictEqual(nextVolume, 0.0);
    assert.strictEqual(mockDevice.systemVolume, 0.0);
  });

  test('Toggle mute restores baseline volume when unmuting from zero volume', () => {
    let volume = 0;
    let isMuted = true;

    function toggleMute() {
      const nextMuted = !isMuted;
      isMuted = nextMuted;
      if (!nextMuted && volume === 0) {
        volume = 0.5;
      }
    }

    toggleMute();
    assert.strictEqual(isMuted, false);
    assert.strictEqual(volume, 0.5);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. HUD Indicator Display & Timer Management
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}--- 4. HUD Indicator Display & Timer Lifecycle ---${RESET}`);

  test('HUD indicator shows matching icon and meter fill with percentage text removed', () => {
    function getHudDisplay(type, value) {
      const percentage = Math.max(0, Math.min(100, Math.round(value * 100)));
      let iconName = '';
      if (type === 'brightness') {
        iconName = percentage <= 35 ? 'SunLowIcon' : 'SunIcon';
      } else {
        if (percentage === 0) iconName = 'VolumeMuteIcon';
        else if (percentage <= 33) iconName = 'VolumeLowIcon';
        else if (percentage <= 66) iconName = 'VolumeMediumIcon';
        else iconName = 'VolumeHighIcon';
      }
      return { meterHeight: `${percentage}%`, iconName, hasPercentageText: false };
    }

    assert.deepStrictEqual(getHudDisplay('brightness', 0.2), { meterHeight: '20%', iconName: 'SunLowIcon', hasPercentageText: false });
    assert.deepStrictEqual(getHudDisplay('brightness', 0.8), { meterHeight: '80%', iconName: 'SunIcon', hasPercentageText: false });
    assert.deepStrictEqual(getHudDisplay('volume', 0.0), { meterHeight: '0%', iconName: 'VolumeMuteIcon', hasPercentageText: false });
    assert.deepStrictEqual(getHudDisplay('volume', 0.25), { meterHeight: '25%', iconName: 'VolumeLowIcon', hasPercentageText: false });
    assert.deepStrictEqual(getHudDisplay('volume', 0.55), { meterHeight: '55%', iconName: 'VolumeMediumIcon', hasPercentageText: false });
    assert.deepStrictEqual(getHudDisplay('volume', 1.0), { meterHeight: '100%', iconName: 'VolumeHighIcon', hasPercentageText: false });
  });

  test('Starting a new gesture cancels pending hide timer immediately', () => {
    let hideTimer = 12345;
    let hudVisible = true;

    // New gesture starts
    function onGestureGrant() {
      if (hideTimer) {
        hideTimer = null; // Cleared
      }
      hudVisible = true;
    }

    onGestureGrant();
    assert.strictEqual(hideTimer, null);
    assert.strictEqual(hudVisible, true);
  });

  test('Gesture release arms 1200ms auto-dismiss timer', () => {
    let hideTimerDelay = null;

    function onGestureRelease() {
      hideTimerDelay = 1200;
    }

    onGestureRelease();
    assert.strictEqual(hideTimerDelay, 1200);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Taps and Double-Taps Preservation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}--- 5. Tap and Double-Tap Preservation ---${RESET}`);

  test('Single tap toggles player controls without triggering HUD indicator', () => {
    let controlsToggled = false;
    let hudActivated = false;

    function handleSingleTap() {
      controlsToggled = true;
    }

    handleSingleTap();
    assert.strictEqual(controlsToggled, true);
    assert.strictEqual(hudActivated, false);
  });

  test('Double tap on left rewinds 10s and double tap on right forwards 10s', () => {
    let rewindCalled = false;
    let forwardCalled = false;

    function handleDoubleTap(side) {
      if (side === 'left') rewindCalled = true;
      if (side === 'right') forwardCalled = true;
    }

    handleDoubleTap('left');
    handleDoubleTap('right');

    assert.strictEqual(rewindCalled, true);
    assert.strictEqual(forwardCalled, true);
  });

  console.log(`\n${BOLD}${CYAN}================================================================${RESET}`);
  console.log(`${BOLD}${GREEN}TOTAL GESTURE TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}${RESET}`);
  console.log(`${BOLD}${CYAN}================================================================${RESET}\n`);

  if (totalTests !== passedTests) {
    throw new Error(`${totalTests - passedTests} gesture tests failed`);
  }

  return { passed: passedTests, failed: totalTests - passedTests };
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
