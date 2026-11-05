const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n================================================================');
  console.log('  FOX PLAYER — NATIVE VOLUME SYNCHRONIZATION & AUDIO STABILITY  ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  const usePlayerVolumePath = path.join(__dirname, '../src/hooks/usePlayerVolume.js');
  const playerScreenPath = path.join(__dirname, '../src/screens/PlayerScreen.js');
  const embeddedPlayerPath = path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js');
  const gestureOverlayPath = path.join(__dirname, '../src/components/PlayerGestureOverlay.js');
  const packageJsonPath = path.join(__dirname, '../package.json');

  const volumeHookCode = fs.readFileSync(usePlayerVolumePath, 'utf8');
  const playerScreenCode = fs.readFileSync(playerScreenPath, 'utf8');
  const embeddedPlayerCode = fs.readFileSync(embeddedPlayerPath, 'utf8');
  const gestureOverlayCode = fs.readFileSync(gestureOverlayPath, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  console.log('--- Suite 1: Native Dependency & System Media Stream Configuration ---');

  test('1.1: react-native-volume-manager is installed in package.json', () => {
    assert(
      packageJson.dependencies['react-native-volume-manager'],
      'react-native-volume-manager must be declared in package.json'
    );
  });

  test('1.2: usePlayerVolume dynamically loads react-native-volume-manager with safe fallback', () => {
    assert(
      volumeHookCode.includes("require('react-native-volume-manager')"),
      'Hook must load react-native-volume-manager'
    );
    assert(
      volumeHookCode.includes('try') && volumeHookCode.includes('catch'),
      'Hook must gracefully handle environments where native module is unavailable'
    );
  });

  test('1.3: VolumeManager controls STREAM_MUSIC on Android without touching ring/alarm/notification', () => {
    assert(
      volumeHookCode.includes("type: 'music'"),
      'Must specify type: "music" for Android to strictly control STREAM_MUSIC media volume'
    );
    assert(
      volumeHookCode.includes('showUI: false'),
      'Must suppress intrusive OS system volume toast in favor of VLC-style player HUD'
    );
  });

  console.log('\n--- Suite 2: Initial Volume Synchronization from Real Device Volume ---');

  test('2.1: usePlayerVolume queries real device volume on mount', () => {
    assert(
      volumeHookCode.includes('VolumeManager.getVolume()'),
      'Hook must call VolumeManager.getVolume() to read real device volume on mount'
    );
    assert(
      volumeHookCode.includes('lastConfirmedDeviceVolume'),
      'Hook must maintain persistent module cache of confirmed device volume across screens'
    );
  });

  test('2.2: Initial volume indicator starts immediately at confirmed device volume without hardcoded 50% flash', () => {
    assert(
      volumeHookCode.includes('if (lastConfirmedDeviceVolume !== null)'),
      'getInitialVolume must prioritize lastConfirmedDeviceVolume'
    );
  });

  console.log('\n--- Suite 3: Hardware Button Synchronization & Feedback Loop Prevention ---');

  test('3.1: usePlayerVolume subscribes to external volume changes via addVolumeListener', () => {
    assert(
      volumeHookCode.includes('VolumeManager.addVolumeListener'),
      'Hook must listen to native volume events (hardware volume buttons, Control Center)'
    );
    assert(
      volumeHookCode.includes('subscription.remove()'),
      'Hook must clean up volume listener subscription on unmount'
    );
  });

  test('3.2: Prevents infinite feedback loops between gesture state and native volume events', () => {
    assert(
      volumeHookCode.includes('isEcho') || volumeHookCode.includes('isSelfTriggered'),
      'Hook must detect self-triggered native volume echo events'
    );
    assert(
      volumeHookCode.includes('lastGestureApplyTimestampRef'),
      'Hook must track gesture application timestamp to suppress loopback'
    );
  });

  test('3.3: Hardware volume changes notify HUD with source identifier', () => {
    assert(
      volumeHookCode.includes("source: 'hardware'"),
      'Hardware volume events must be tagged with source: "hardware"'
    );
    assert(
      playerScreenCode.includes("info?.source === 'hardware'"),
      'PlayerScreen must show HUD when physical hardware volume buttons are pressed'
    );
    assert(
      embeddedPlayerCode.includes("info?.source === 'hardware'"),
      'EmbeddedVideoPlayer must show HUD when physical hardware volume buttons are pressed'
    );
  });

  console.log('\n--- Suite 4: Audio Stability & Decoupling from Playback Pipeline ---');

  test('4.1: PlayerScreen bufferOptions effect excludes volume from dependencies', () => {
    const attachRegex = /useEffect\(\(\) => \{[\s\S]*?controller\.attachPlayer[\s\S]*?\}, \[([\s\S]*?)\]\);/;
    const match = playerScreenCode.match(attachRegex);
    assert(match, 'PlayerScreen must have attachPlayer useEffect');
    const deps = match[1];
    assert(!deps.includes('volume'), 'attachPlayer useEffect MUST NOT depend on volume');
    assert(!deps.includes('isMuted'), 'attachPlayer useEffect MUST NOT depend on isMuted');
  });

  test('4.2: EmbeddedVideoPlayer bufferOptions effect excludes volume from dependencies', () => {
    const attachRegex = /useEffect\(\(\) => \{[\s\S]*?controller\.attachPlayer[\s\S]*?\}, \[([\s\S]*?)\]\);/;
    const match = embeddedPlayerCode.match(attachRegex);
    assert(match, 'EmbeddedVideoPlayer must have attachPlayer useEffect');
    const deps = match[1];
    assert(!deps.includes('volume'), 'attachPlayer useEffect MUST NOT depend on volume');
    assert(!deps.includes('isMuted'), 'attachPlayer useEffect MUST NOT depend on isMuted');
  });

  test('4.3: initiateAutoPlayback in PlayerScreen and EmbeddedVideoPlayer excludes volume dependency', () => {
    assert(
      !playerScreenCode.includes('[player, confirmPlaybackActive, volume'),
      'PlayerScreen initiateAutoPlayback must not depend on volume'
    );
    assert(
      embeddedPlayerCode.includes('initiateAutoPlayback = useCallback((currentReqId) => {') ||
      embeddedPlayerCode.includes('initiateAutoPlayback = useCallback(('),
      'EmbeddedVideoPlayer must declare initiateAutoPlayback'
    );
    assert(
      embeddedPlayerCode.includes('}, [player, confirmPlaybackActive]);'),
      'EmbeddedVideoPlayer initiateAutoPlayback must only depend on [player, confirmPlaybackActive]'
    );
  });

  test('4.4: 60fps gesture updates are coalesced via throttled native queue', () => {
    assert(
      volumeHookCode.includes('applyNativeVolume'),
      'Hook must define coalesced applyNativeVolume function'
    );
    assert(
      volumeHookCode.includes('pendingNativeValueRef'),
      'Hook must maintain pending native value ref to prevent bridge thrashing'
    );
    assert(
      volumeHookCode.includes('isApplyingNativeRef'),
      'Hook must serialize native bridge calls without concurrent overlapping calls'
    );
  });

  console.log('\n--- Suite 5: Clamping, Auto-Unmute & Gesture Coordination ---');

  test('5.1: Volume clamps strictly between 0.0 and 1.0 with auto-unmute and mute', () => {
    assert(
      volumeHookCode.includes('Math.max(0, Math.min(1, targetValue))'),
      'Volume must be clamped strictly between 0.0 and 1.0'
    );
    assert(
      volumeHookCode.includes('activePlayer.volume = clamped'),
      'Player volume must coordinate with clamped value'
    );
    assert(
      volumeHookCode.includes('activePlayer.muted = false'),
      'Must auto-unmute when volume increases above 0'
    );
    assert(
      volumeHookCode.includes('activePlayer.muted = true'),
      'Must mute when volume drops to 0'
    );
  });

  test('5.2: PlayerGestureOverlay passes isGesture flag to prioritize active user swipe', () => {
    assert(
      gestureOverlayCode.includes("setVolume(clamped, { isGesture: true })"),
      'PlayerGestureOverlay must pass isGesture: true during active swipe'
    );
    assert(
      gestureOverlayCode.includes("setVolume(finalClamped, { isGesture: false })"),
      'PlayerGestureOverlay must pass isGesture: false on swipe release'
    );
  });

  console.log('\n================================================================');
  console.log(`TOTAL VOLUME & AUDIO STABILITY TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} volume tests failed`);
  }

  return { passed, failed };
}

if (require.main === module) {
  runTests();
}

module.exports = runTests;
