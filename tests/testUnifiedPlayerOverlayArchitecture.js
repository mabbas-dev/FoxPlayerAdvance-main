/**
 * FOX PLAYER — Unified Player Overlay & Controls Architecture Test Suite
 *
 * Validates:
 * 1. Bounded Video Viewport: VideoView and all overlays share bounded videoViewport.
 * 2. Unified Overlay Hierarchy: Single interactive overlay container directly aligned with the video container.
 * 3. Integrated Gesture HUD: Brightness & Volume indicators integrated into PlayerControls overlayRoot.
 * 4. Screen Bounding & Insets: Zero off-screen translateY distortion; safe top/bottom/left/right insets in portrait & landscape.
 * 5. Centered Playback Controls: Center zone vertically and horizontally centered with proper elevation.
 * 6. Clean Typography & Meter: No percentage text in HUD meters; pure vertical tracks with dynamic icons.
 * 7. Seamless Touch Routing: Coordinated gesture HUD updates and pointerEvents pass-through.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n================================================================');
  console.log('  FOX PLAYER — UNIFIED PLAYER OVERLAY & CONTROLS ARCHITECTURE   ');
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

  const playerControlsCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerControls.js'), 'utf8');
  const playerScreenCode   = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
  const embeddedPlayerCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
  const gestureOverlayCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerGestureOverlay.js'), 'utf8');
  const gestureHudCode     = fs.readFileSync(path.join(__dirname, '../src/components/PlayerGestureHUD.js'), 'utf8');

  // --- 1. Bounded Video Viewport Architecture ---
  test('1.1: PlayerScreen wraps video and overlays inside videoViewport container', () => {
    assert(playerScreenCode.includes('<View style={styles.videoViewport}>'), 'PlayerScreen must contain videoViewport');
    assert(playerScreenCode.includes('videoViewport: {'), 'PlayerScreen must define videoViewport style');
    assert(playerScreenCode.includes("overflow: 'hidden'"), 'videoViewport must have overflow hidden');
  });

  test('1.2: EmbeddedVideoPlayer wraps video and overlays inside videoViewport container', () => {
    assert(embeddedPlayerCode.includes('<View style={styles.videoViewport}>'), 'EmbeddedVideoPlayer must contain videoViewport');
    assert(embeddedPlayerCode.includes('videoViewport: {'), 'EmbeddedVideoPlayer must define videoViewport style');
    assert(embeddedPlayerCode.includes("overflow: 'hidden'"), 'videoViewport must have overflow hidden');
  });

  // --- 2. Unified Interactive Overlay Container ---
  test('2.1: PlayerScreen hosts gestures and controls within unifiedOverlay', () => {
    assert(playerScreenCode.includes('<View style={styles.unifiedOverlay} pointerEvents="box-none">'));
    assert(playerScreenCode.includes('unifiedOverlay: {'));
  });

  test('2.2: EmbeddedVideoPlayer hosts gestures and controls within unifiedOverlay', () => {
    assert(embeddedPlayerCode.includes('<View style={styles.unifiedOverlay} pointerEvents="box-none">'));
    assert(embeddedPlayerCode.includes('unifiedOverlay: {'));
  });

  // --- 3. Integrated Brightness & Volume Feedback in PlayerControls ---
  test('3.1: PlayerControls embeds PlayerGestureHUD directly inside overlayRoot', () => {
    assert(playerControlsCode.includes("import PlayerGestureHUD from './PlayerGestureHUD'"));
    assert(playerControlsCode.includes('<PlayerGestureHUD'));
    assert(playerControlsCode.includes('gestureHud?.visible && gestureHud?.type'));
  });

  test('3.2: PlayerGestureOverlay coordinates state via onHudChange callback', () => {
    assert(gestureOverlayCode.includes('onHudChange = null'));
    assert(gestureOverlayCode.includes('notifyHud(mode, startValueRef.current, true)'));
    assert(gestureOverlayCode.includes('notifyHud(mode, clamped, true)'));
    assert(gestureOverlayCode.includes('notifyHud(null, 0.5, false)'));
    assert(playerScreenCode.includes('onHudChange={setGestureHud}'));
    assert(embeddedPlayerCode.includes('onHudChange={setGestureHud}'));
  });

  // --- 4. Bounding Rules and Safe-Area Insets ---
  test('4.1: Top controls do not have negative translateY transforms pushing them off-screen', () => {
    assert(!playerControlsCode.includes('outputRange: [-16, 0]'), 'PlayerControls top entrance must not shift negative translateY off-screen');
    assert(!playerControlsCode.includes('outputRange: [16, 0]'), 'PlayerControls bottom entrance must not shift positive translateY off-screen');
  });

  test('4.2: PlayerControls respects safe padding baselines in portrait and landscape', () => {
    assert(playerControlsCode.includes('Math.max(insets?.top    || 0, isMini ? 6  : 14)'));
    assert(playerControlsCode.includes('Math.max(insets?.bottom || 0, isMini ? 6  : 14)'));
    assert(playerControlsCode.includes('Math.max(insets?.left   || 0, isMini ? 8  : 20)'));
    assert(playerControlsCode.includes('Math.max(insets?.right  || 0, isMini ? 8  : 20)'));
  });

  // --- 5. True Center Positioning & Center Zone Elevation ---
  test('5.1: Center zone stretches across full viewport and centers controls with elevation 12', () => {
    assert(playerControlsCode.includes('centerZone: {'));
    assert(playerControlsCode.includes("justifyContent: 'center'"));
    assert(playerControlsCode.includes("alignItems: 'center'"));
    assert(playerControlsCode.includes('zIndex: 12'));
    assert(playerControlsCode.includes('elevation: 12'));
  });

  // --- 6. Clean HUD Indicator Architecture (No percentage text) ---
  test('6.1: PlayerGestureHUD displays clean vertical meter without numeric percentage text', () => {
    assert(!gestureHudCode.includes('<Text style={styles.percentageText}'), 'PlayerGestureHUD must NOT render percentage text');
    assert(!gestureHudCode.includes('{`${percentage}%`}'), 'PlayerGestureHUD must NOT display visible percentage string');
    assert(gestureHudCode.includes('styles.meterTrack'));
    assert(gestureHudCode.includes('styles.meterFill'));
  });

  // --- 7. Non-Interfering Touch Routing ---
  test('7.1: Controls container passes touches through when hidden and buttons receive clicks when visible', () => {
    assert(playerScreenCode.includes("pointerEvents={controlsVisible ? 'box-none' : 'none'}"));
    assert(embeddedPlayerCode.includes("pointerEvents={controlsVisible ? 'box-none' : 'none'}"));
    assert(playerControlsCode.includes('<View style={styles.dimOverlay} pointerEvents="none" />'));
  });

  console.log('\n================================================================');
  console.log(`TOTAL UNIFIED ARCHITECTURE TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} architecture tests failed`);
  }

  return { passed, failed };
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
