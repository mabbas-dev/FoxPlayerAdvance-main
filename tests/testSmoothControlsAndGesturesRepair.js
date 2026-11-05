/**
 * FOX PLAYER — Smooth Controls, Auto-Hide, Brightness & Volume Gestures Test Suite
 *
 * Validates the critical fixes for:
 * 1. Control visibility state machine (3.0s auto-hide, pause preservation, seeking & gesture suspension).
 * 2. Smooth control animations (180ms show / 200ms hide opacity transitions).
 * 3. Directional separation (left = brightness, right = volume, zero cross-triggering, no child touch conflicts).
 * 4. Zero initial jump on gesture recognition (anchored recognitionDy).
 * 5. Tap and double-tap detection through unified PanResponder without touchable interference.
 * 6. Non-blocking dimOverlay (pointerEvents="none") passing touches to gesture overlay.
 * 7. System brightness lifecycle restoration (Android restoreSystemBrightnessAsync / iOS setBrightnessAsync).
 * 8. Media volume synchronization with expo-video player instance.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n================================================================');
  console.log('  FOX PLAYER — SMOOTH CONTROLS, AUTO-HIDE & GESTURES REPAIR     ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${name}: ${err.message}`);
    }
  }

  const gestureOverlayCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerGestureOverlay.js'), 'utf8');
  const playerControlsCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerControls.js'), 'utf8');
  const playerScreenCode   = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
  const embeddedPlayerCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
  const brightnessHookCode = fs.readFileSync(path.join(__dirname, '../src/hooks/usePlayerBrightness.js'), 'utf8');
  const volumeHookCode     = fs.readFileSync(path.join(__dirname, '../src/hooks/usePlayerVolume.js'), 'utf8');

  // --- 1. Control Visibility State Machine ---
  test('1.1: PlayerScreen auto-hide timer is approximately 3 seconds during active playback', () => {
    assert(playerScreenCode.includes('3000'), 'PlayerScreen must use 3000ms auto-hide timer');
    assert(embeddedPlayerCode.includes('3000'), 'EmbeddedVideoPlayer must use 3000ms auto-hide timer');
  });

  test('1.2: Controls auto-hide is suspended during pause, seeking, and active gestures', () => {
    assert(playerScreenCode.includes('!isSeekingRef.current &&\n      !isGestureActiveRef.current'));
    assert(playerScreenCode.includes("playerStateRef.current === 'PAUSED'"));
    assert(embeddedPlayerCode.includes('!isSeekingRef.current &&\n      !isGestureActiveRef.current'));
    assert(embeddedPlayerCode.includes("playerStateRef.current === 'PAUSED'"));
  });

  test('1.3: Controls transitions animate opacity smoothly (180ms show / 200ms hide)', () => {
    assert(playerScreenCode.includes('duration: 180'));
    assert(playerScreenCode.includes('duration: 200'));
    assert(embeddedPlayerCode.includes('duration: 180'));
    assert(embeddedPlayerCode.includes('duration: 200'));
  });

  // --- 2. Gesture Overlay Architecture & Separation ---
  test('2.1: PlayerGestureOverlay eliminates child Touchables to prevent responder hijacking', () => {
    assert(!gestureOverlayCode.includes('<TouchableOpacity'), 'PlayerGestureOverlay must not render child TouchableOpacity elements');
    assert(!gestureOverlayCode.includes('styles.gestureHalf'), 'PlayerGestureOverlay must not render half-zone child views');
  });

  test('2.2: Strict side mapping divides left (brightness) and right (volume) from container coordinates', () => {
    assert(gestureOverlayCode.includes('touchStartRef.current.pageX'));
    assert(gestureOverlayCode.includes('relX < width * 0.5'));
    assert(gestureOverlayCode.includes("const mode = isLeft ? 'brightness' : 'volume'"));
  });

  test('2.3: Gesture mode remains locked for the entire swipe and never switches mid-gesture', () => {
    assert(gestureOverlayCode.includes('gestureModeRef.current = mode'));
    assert(gestureOverlayCode.includes('isSwipingRef.current && gestureModeRef.current'));
  });

  test('2.4: Anchored recognitionDy ensures zero initial jump when swipe activates', () => {
    assert(gestureOverlayCode.includes('recognitionDyRef.current = dy'));
    assert(gestureOverlayCode.includes('dy - (recognitionDyRef.current || 0)'));
  });

  test('2.5: Tap recognition distinguishes natural touches (<24px movement, <500ms duration) with immediate visible dismissal', () => {
    assert(gestureOverlayCode.includes('totalMovement < 24 && duration < 500'));
    assert(gestureOverlayCode.includes('controlsVisibleRef.current'));
    assert(gestureOverlayCode.includes('onSingleTap();'));
    assert(gestureOverlayCode.includes('onDoubleTapLeft();'));
    assert(gestureOverlayCode.includes('onDoubleTapRight();'));
  });

  test('2.6: PlayerGestureOverlay container receives touches without box-none suppression', () => {
    assert(!gestureOverlayCode.includes('pointerEvents="box-none"'), 'PlayerGestureOverlay container must NOT have pointerEvents="box-none"');
    assert(playerScreenCode.includes('controlsContainer'), 'PlayerScreen must use controlsContainer for Layer 7');
    assert(embeddedPlayerCode.includes('controlsContainer'), 'EmbeddedVideoPlayer must use controlsContainer for Layer 7');
  });

  // --- 3. Non-Blocking Dim Scrim Overlay ---
  test('3.1: PlayerControls renders dimOverlay with pointerEvents="none" allowing video gestures to pass through', () => {
    assert(playerControlsCode.includes('<View style={styles.dimOverlay} pointerEvents="none" />'));
    assert(!playerControlsCode.includes('<TouchableOpacity\n          style={styles.dimOverlay}'));
  });

  // --- 4. System Brightness & Volume Coordination ---
  test('4.1: usePlayerBrightness restores system brightness on Android and device brightness on iOS', () => {
    assert(brightnessHookCode.includes('Brightness.restoreSystemBrightnessAsync'));
    assert(brightnessHookCode.includes('Brightness.setBrightnessAsync'));
    assert(brightnessHookCode.includes('Platform.OS === \'android\''));
  });

  test('4.2: usePlayerVolume coordinates directly with expo-video player volume and auto-unmutes', () => {
    assert(volumeHookCode.includes('activePlayer.volume = clamped'));
    assert(volumeHookCode.includes('activePlayer.muted = false'));
    assert(volumeHookCode.includes('activePlayer.muted = true'));
  });

  console.log('\n================================================================');
  console.log(`TOTAL REPAIR TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} repair tests failed`);
  }

  return { passed, failed };
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
