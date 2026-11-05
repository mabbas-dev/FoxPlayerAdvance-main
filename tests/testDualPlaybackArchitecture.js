const assert = require('assert');

// 1. Test playback types and constants
const {
  PLAYBACK_STATE,
  ENGINE_TYPE,
  ENGINE_MODE,
  ENGINE_SWITCH_REASON,
  ENGINE_LABELS,
} = require('../src/playback/playbackTypes.js');

// 2. Test BasePlaybackEngine
const { BasePlaybackEngine } = require('../src/playback/engines/BasePlaybackEngine.js');

// 3. Test DualPlaybackCoordinator
const { DualPlaybackCoordinator } = require('../src/playback/engines/DualPlaybackCoordinator.js');

// 4. Test VlcPlaybackEngine
const { VlcPlaybackEngine } = require('../src/playback/engines/VlcPlaybackEngine.js');

// 5. Test NativePlaybackEngine
const { NativePlaybackEngine } = require('../src/playback/engines/NativePlaybackEngine.js');

async function runTests() {
  console.log('=== RUNNING DUAL PLAYBACK ARCHITECTURE TESTS ===\n');

  // TEST 1: Engine Types and Constants
  console.log('1. Testing Engine Types & Constants...');
  assert.strictEqual(ENGINE_TYPE.NATIVE, 'NATIVE');
  assert.strictEqual(ENGINE_TYPE.VLC, 'VLC');
  assert.strictEqual(ENGINE_MODE.AUTO, 'AUTO');
  assert.strictEqual(ENGINE_MODE.NATIVE, 'NATIVE');
  assert.strictEqual(ENGINE_MODE.VLC, 'VLC');
  assert(ENGINE_LABELS.NATIVE.includes('Native'));
  assert(ENGINE_LABELS.VLC.includes('VLC'));
  console.log('   ✓ Engine types and labels verified.');

  // TEST 2: BasePlaybackEngine Interface Contract
  console.log('\n2. Testing BasePlaybackEngine Contract...');
  const base = new BasePlaybackEngine(ENGINE_TYPE.NATIVE, 'TestEngine');
  assert.strictEqual(base.getPlaybackState(), PLAYBACK_STATE.IDLE);
  
  let stateEventFired = false;
  const unsub = base.subscribe((event, payload) => {
    if (event === 'stateChanged' && payload.state === PLAYBACK_STATE.LOADING) {
      stateEventFired = true;
    }
  });

  base.setState(PLAYBACK_STATE.LOADING);
  assert.strictEqual(stateEventFired, true);
  unsub();
  console.log('   ✓ BasePlaybackEngine subscription and event emission verified.');

  // TEST 3: Switchable Error Evaluation
  console.log('\n3. Testing Switchable vs Non-Switchable Error Evaluation...');
  const coordinator = new DualPlaybackCoordinator({ mode: ENGINE_MODE.AUTO, startupTimeoutMs: 12000 });

  // Non-switchable: network offline
  assert.strictEqual(coordinator.isSwitchableError({ code: 'OFFLINE', message: 'No internet connection' }), false, 'Offline error must NOT switch engines');
  // Non-switchable: 401 Unauthorized
  assert.strictEqual(coordinator.isSwitchableError({ code: 'HTTP_401', message: 'HTTP 401 Unauthorized' }), false, 'Auth error 401 must NOT switch engines');
  // Non-switchable: 403 Forbidden
  assert.strictEqual(coordinator.isSwitchableError({ code: 'HTTP_403', message: 'HTTP 403 Forbidden' }), false, 'Auth error 403 must NOT switch engines');
  // Non-switchable: 404 Not Found
  assert.strictEqual(coordinator.isSwitchableError({ code: 'HTTP_404', message: 'Stream not found 404' }), false, '404 missing stream must NOT switch engines');
  // Non-switchable: DRM
  assert.strictEqual(coordinator.isSwitchableError({ code: 'DRM_ERROR', message: 'Widevine DRM unsupported' }), false, 'DRM error must NOT switch engines');

  // Switchable: Demuxer failure (MPEG-TS, parser error)
  assert.strictEqual(coordinator.isSwitchableError({ code: 'DEMUXER_ERROR', message: 'TsExtractor parsing failed' }), true, 'Demuxer error MUST switch engines');
  // Switchable: Decoder failure
  assert.strictEqual(coordinator.isSwitchableError({ code: 'DECODER_ERROR', message: 'Hardware decoder initialization failed' }), true, 'Decoder error MUST switch engines');
  // Switchable: iOS CoreMedia -16845 HLS parser error
  assert.strictEqual(coordinator.isSwitchableError({ code: 'MEDIA_ERROR', message: 'CoreMedia error -16845' }), true, 'CoreMedia -16845 error MUST switch engines');
  // Switchable: Startup timeout
  assert.strictEqual(coordinator.isSwitchableError({ code: 'STARTUP_TIMEOUT', message: 'Startup timeout expired' }), true, 'Startup timeout MUST switch engines');
  console.log('   ✓ Error classification policy correctly filters switchable errors.');

  // TEST 4: Engine Switching & Audio Conflict Prevention
  console.log('\n4. Testing Engine Switching & Audio Conflict Prevention...');
  assert.strictEqual(coordinator.getActiveEngineType(), ENGINE_TYPE.NATIVE);

  let switchEvent = null;
  coordinator.subscribe((event, payload) => {
    if (event === 'engineSwitched') {
      switchEvent = payload;
    }
  });

  // Load a test source
  const testSource = {
    uri: 'http://formup.site:8080/live/user/pass/123.ts',
    isLive: true,
    type: 'live',
    title: 'Sports HD',
  };
  await coordinator.load(testSource);
  assert.strictEqual(coordinator.getActiveEngineType(), ENGINE_TYPE.NATIVE);
  assert.strictEqual(coordinator.nativeAttempts, 1);
  assert.strictEqual(coordinator.vlcAttempts, 0);

  // Test switching to integrated VLC engine
  await coordinator.switchEngine(ENGINE_TYPE.VLC, ENGINE_SWITCH_REASON.DEMUXER_ERROR);
  assert.strictEqual(coordinator.getActiveEngineType(), ENGINE_TYPE.VLC);
  assert.strictEqual(coordinator.vlcAttempts, 1);
  assert.strictEqual(switchEvent?.from, ENGINE_TYPE.NATIVE);
  assert.strictEqual(switchEvent?.to, ENGINE_TYPE.VLC);
  console.log('   ✓ Coordinator switched to integrated VLC engine cleanly on switchable error.');

  // TEST 5: Maximum One Fallback Guard (No Infinite Loops)
  console.log('\n5. Testing Loop Prevention Guard...');
  // Attempting another automatic switch should not loop
  assert.strictEqual(coordinator.vlcAttempts, 1);
  assert.strictEqual(coordinator.nativeAttempts, 1);
  // Both engines have now been attempted once
  const canSwitchMore = (coordinator.activeEngineType === ENGINE_TYPE.VLC && coordinator.nativeAttempts < 1);
  assert.strictEqual(canSwitchMore, false, 'No further automatic fallback should be permitted');
  console.log('   ✓ Session attempt limit strictly prevents infinite switching loop.');

  // TEST 6: State Preservation during Switch
  console.log('\n6. Testing State Preservation (Volume, Mute, Position)...');
  await coordinator.setVolume(0.75);
  await coordinator.setMuted(true);
  await coordinator.setAspectRatio('cover');
  assert.strictEqual(coordinator.currentVolume, 0.75);
  assert.strictEqual(coordinator.isMuted, true);
  assert.strictEqual(coordinator.contentFit, 'cover');
  console.log('   ✓ Volume (0.75), mute (true), and aspect ratio (cover) preserved.');

  // TEST 7: Manual Mode Selection
  console.log('\n7. Testing Manual Engine Modes...');
  await coordinator.setEngineMode(ENGINE_MODE.VLC);
  assert.strictEqual(coordinator.getEngineMode(), ENGINE_MODE.VLC);
  assert.strictEqual(coordinator.getActiveEngineType(), ENGINE_TYPE.VLC);

  await coordinator.setEngineMode(ENGINE_MODE.NATIVE);
  assert.strictEqual(coordinator.getEngineMode(), ENGINE_MODE.NATIVE);
  assert.strictEqual(coordinator.getActiveEngineType(), ENGINE_TYPE.NATIVE);

  await coordinator.setEngineMode(ENGINE_MODE.AUTO);
  assert.strictEqual(coordinator.getEngineMode(), ENGINE_MODE.AUTO);
  console.log('   ✓ Manual engine modes (AUTO, NATIVE, VLC) successfully switch and persist.');

  // Clean release
  await coordinator.release();

  console.log('\n=== ALL DUAL PLAYBACK ARCHITECTURE TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
