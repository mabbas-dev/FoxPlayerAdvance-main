const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n================================================================');
  console.log('   FOX PLAYER — LIVE TV PLAYER RECOVERY TESTS (ANDROID & iOS)   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  const liveScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/LiveScreen.js'), 'utf8');
  const embeddedPlayerCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
  const gestureOverlayCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerGestureOverlay.js'), 'utf8');
  const playerControlsCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerControls.js'), 'utf8');
  const mediaSourceCode = fs.readFileSync(path.join(__dirname, '../src/utils/mediaSourcePipeline.js'), 'utf8');
  const playerConfigCode = fs.readFileSync(path.join(__dirname, '../src/utils/playerConfig.js'), 'utf8');

  function embeddedCodeContainsBlockingPlay(code, method) {
    const escapedMethod = method.replace('(', '\\(');
    const regex = new RegExp(`player\\.${escapedMethod}[\\s\\S]*?isFocusedRef\\.current[\\s\\S]*?player\\.?play\\(\\)`, 'm');
    return regex.test(code);
  }

  // --- 1. Live TV Playback & Platform Stream URL Resolution ---
  test('1.1: mediaSourcePipeline imports API_BASE_URL for platform stream resolution', () => {
    assert(mediaSourceCode.includes("import { API_BASE_URL } from '../constants/index.js'"), 'mediaSourcePipeline must import API_BASE_URL');
  });

  test('1.2: mediaSourcePipeline passes serverBaseUrl to prepareStreamUrlForPlatform', () => {
    assert(mediaSourceCode.includes('serverBaseUrl: opts.serverBaseUrl || (typeof API_BASE_URL !== \'undefined\' ? API_BASE_URL : \'\')'), 'mediaSourcePipeline must supply serverBaseUrl for iOS Live TV proxying');
  });

  test('1.3: playerConfig prepares HLS proxy URL on iOS when serverBaseUrl is provided for MPEG-TS', () => {
    const { prepareStreamUrlForPlatform } = require('../src/utils/playerConfig');
    const directTs = 'http://provider.tv:8080/live/user/pass/12345.ts';
    const iosProxied = prepareStreamUrlForPlatform(directTs, {
      type: 'live',
      extension: 'ts',
      platform: 'ios',
      streamId: '12345',
      serverBaseUrl: 'http://192.168.1.50:3001',
    });
    assert(iosProxied.includes('/api/stream/live/12345.m3u8?url='), 'iOS TS stream must route through local HLS proxy');
    assert(iosProxied.startsWith('http://192.168.1.50:3001'), 'iOS TS stream proxy must use serverBaseUrl');

    const androidUrl = prepareStreamUrlForPlatform(directTs, {
      type: 'live',
      extension: 'ts',
      platform: 'android',
      streamId: '12345',
      serverBaseUrl: 'http://192.168.1.50:3001',
    });
    assert.strictEqual(androidUrl, directTs, 'Android must preserve direct TS stream without proxy mutation');
  });

  // --- 2. Channel Switching Safety & Identity Normalization ---
  test('2.1: LiveScreen normalizes currentId and newId to handle id, streamId, and stream_id', () => {
    assert(liveScreenCode.includes('playingChannel.id ?? playingChannel.streamId ?? playingChannel.stream_id'), 'handleChannelSelect must resolve currentId using id/streamId/stream_id fallback');
    assert(liveScreenCode.includes('channel.id ?? channel.streamId ?? channel.stream_id'), 'handleChannelSelect must resolve newId using id/streamId/stream_id fallback');
  });

  test('2.2: LiveScreen prevents false equality when channel IDs are undefined or different', () => {
    assert(liveScreenCode.includes('currentId != null && newId != null && String(currentId) === String(newId)'), 'handleChannelSelect must guard against undefined===undefined channel identity match');
  });

  test('2.3: LiveScreen sets unique sessionId with counter per channel switch', () => {
    assert(liveScreenCode.includes('const sessionId = `live_${channelIdKey}_${Date.now()}_${++channelSessionRef.current}`'), 'handleChannelSelect must generate distinct session IDs per tap');
    assert(liveScreenCode.includes('livePlayer._foxSessionId = sessionId'), 'LiveScreen must associate native player with active sessionId');
  });

  test('2.4: LiveScreen does not prematurely nullify _activeUri to prevent racing replaceAsync calls', () => {
    assert(!liveScreenCode.includes('livePlayer._activeUri = null;\n      livePlayer._foxSessionId = sessionId;'), 'LiveScreen must not wipe _activeUri before source resolution');
  });

  // --- 3. Mini Player Controls & Touch Responsiveness ---
  test('3.1: PlayerGestureOverlay allows PanResponder start in mini mode to handle taps', () => {
    assert(!gestureOverlayCode.includes('onStartShouldSetPanResponder: (evt) => {\n        if (propsRef.current.disabled || propsRef.current.isMini) return false;'), 'onStartShouldSetPanResponder must not unconditionally reject mini mode touches');
    assert(gestureOverlayCode.includes('if (propsRef.current.isMini) {'), 'onStartShouldSetPanResponder must implement dedicated mini mode touch handling');
  });

  test('3.2: Mini mode protects bottom controls (maximize/mute) and center play button', () => {
    assert(gestureOverlayCode.includes('if (locationY < 44) return false;'), 'Mini mode must protect top bar');
    assert(gestureOverlayCode.includes('if (locationY > containerH - 44) return false;'), 'Mini mode must protect bottom action bar');
    assert(gestureOverlayCode.includes('Math.abs(locationY - centerY) < 32'), 'Mini mode must protect center play button');
  });

  test('3.3: Mini mode suppresses swipe gestures while preserving natural tap response', () => {
    assert(gestureOverlayCode.includes('onMoveShouldSetPanResponder: (evt, gestureState) => {\n        if (propsRef.current.disabled || propsRef.current.isMini) return false;'), 'onMoveShouldSetPanResponder must disable swipe gestures in mini mode');
    assert(gestureOverlayCode.includes('onPanResponderMove: (_evt, gestureState) => {\n        if (propsRef.current.disabled || propsRef.current.isMini) return;'), 'onPanResponderMove must ignore finger swipes in mini mode');
  });

  test('3.4: EmbeddedVideoPlayer wires onBackdropPress in both mini and expanded modes', () => {
    assert(embeddedPlayerCode.includes('onBackdropPress={toggleControls}'), 'EmbeddedVideoPlayer must provide onBackdropPress in all presentation modes');
  });

  // --- 4. Max Player Controls & Boundary Protection ---
  test('4.1: PlayerGestureOverlay calculates realistic initial layout height instead of window height', () => {
    assert(gestureOverlayCode.includes('const initialH = isMini ? 186 : (initH > initW ? Math.round(initW * (9 / 16)) : (initH || 400));'), 'PlayerGestureOverlay must initialize layout height based on aspect ratio');
    assert(gestureOverlayCode.includes('const layoutHeightRef    = useRef(initialH || 220);'), 'layoutHeightRef default must not assume full portrait screen height 844');
  });

  test('4.2: Max mode protects top zone, center zone, and bottom zone buttons from touch stealing', () => {
    assert(gestureOverlayCode.includes('const topBoundary = Math.max(70, insetsTop + 45);'), 'Top button zone must account for safe-area insets');
    assert(gestureOverlayCode.includes('const bottomBoundary = Math.max(80, insetsBottom + 45);'), 'Bottom button zone must account for bottom insets');
    assert(gestureOverlayCode.includes('if (locationY < topBoundary) return false;'), 'Touches in top zone must bypass PanResponder to reach buttons');
    assert(gestureOverlayCode.includes('if (locationY > containerH - bottomBoundary) return false;'), 'Touches in bottom zone must bypass PanResponder to reach buttons');
  });

  // --- 5. Mini <-> Max Transitions & Elevation ---
  test('5.1: captureMiniBoundsForExpand provides deterministic fallbackBounds if measurement fails', () => {
    assert(liveScreenCode.includes('const fallbackBounds = {'), 'captureMiniBoundsForExpand must define fallbackBounds');
    assert(liveScreenCode.includes('resolve(fallbackBounds);'), 'captureMiniBoundsForExpand must resolve fallbackBounds when unmeasured');
  });

  test('5.2: expandToFull guarantees valid bounds and never silently drops tap', () => {
    assert(!liveScreenCode.includes('if (!bounds) return; // view not measured yet'), 'expandToFull must not drop expand tap when bounds are null');
    assert(liveScreenCode.includes('const bounds = (await captureMiniBoundsForExpand()) || {'), 'expandToFull must ensure fallback bounds');
  });

  test('5.3: Fullscreen player containers declare elevation 9999 for Android touch dispatch', () => {
    assert(liveScreenCode.includes('elevation: 9999'), 'LiveScreen must apply elevation 9999 to fullscreen container');
  });

  // --- 6. Non-Blocking Buffering and Touch Hierarchy ---
  test('6.1: Buffering overlay has pointerEvents="none" so spinner never blocks touches', () => {
    assert(embeddedPlayerCode.includes('<View style={styles.bufferingOverlay} pointerEvents="none">'), 'Buffering overlay must pass touches through');
  });

  test('6.2: Controls container uses box-none when visible and none when hidden', () => {
    assert(embeddedPlayerCode.includes("pointerEvents={controlsVisible ? 'box-none' : 'none'}"), 'Controls container must pass touches through when hidden');
  });

  // --- 7. Live TV Automatic Playback Immediately on Ready ---
  const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');

  test('7.1: EmbeddedVideoPlayer auto-plays immediately upon statusChange readyToPlay', () => {
    assert(
      embeddedPlayerCode.includes("} else if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {\n          // Native player has loaded enough data and is ready to play — start playback immediately!"),
      'readyToPlay must auto-start playback when playbackIntent is PLAYING'
    );
    assert(
      embeddedPlayerCode.includes("playerStateRef.current = 'PLAYING';\n          setPlayerState('PLAYING');"),
      'readyToPlay must transition player state machine to PLAYING immediately'
    );
    assert(
      embeddedPlayerCode.includes("setIsBufferingUI(false);\n          setDebouncedBuffering(false);"),
      'readyToPlay must clear buffering UI immediately'
    );
  });

  test('7.2: EmbeddedVideoPlayer does not block auto-play behind isFocusedRef in replaceAsync/replace', () => {
    assert(
      !embeddedCodeContainsBlockingPlay(embeddedPlayerCode, 'replaceAsync'),
      'replaceAsync callback must not gate player.play() on isFocusedRef'
    );
    assert(
      !embeddedCodeContainsBlockingPlay(embeddedPlayerCode, 'replace('),
      'replace callback must not gate player.play() on isFocusedRef'
    );
  });

  test('7.3: EmbeddedVideoPlayer executes immediate check on mount/listener attach for ready player', () => {
    assert(
      embeddedPlayerCode.includes("// Immediate auto-play check: if player is ALREADY in readyToPlay status when listener attaches"),
      'EmbeddedVideoPlayer must immediately inspect readyToPlay status upon listener setup'
    );
    assert(
      embeddedPlayerCode.includes("if (\n      player?.status === 'readyToPlay' &&\n      playbackIntentRef.current === 'PLAYING'"),
      'EmbeddedVideoPlayer must check player.status readyToPlay and trigger immediate playback'
    );
  });

  test('7.4: EmbeddedVideoPlayer checks ready status on sourceLoad and initiates auto-play', () => {
    assert(
      embeddedPlayerCode.includes("const subSourceLoad = player.addListener?.('sourceLoad', () => {"),
      'sourceLoad listener must be registered'
    );
    assert(
      embeddedPlayerCode.includes("(player?.status === 'readyToPlay' || player?.playing) &&\n        playbackIntentRef.current === 'PLAYING'"),
      'sourceLoad must initiate playback if player is ready'
    );
  });

  test('7.5: LiveScreen supplies authoritative isSectionActive for isFocused prop to prevent false unfocus', () => {
    assert(
      liveScreenCode.includes('isFocused={isSectionActive}'),
      'LiveScreen must pass isSectionActive as authoritative focus prop'
    );
    assert(
      !liveScreenCode.includes('isFocused={isFocused && isSectionActive}'),
      'LiveScreen must not combine useIsFocused() with isSectionActive to avoid false unfocus during tab transitions'
    );
  });

  test('7.6: EmbeddedVideoPlayer transitions active stream session into PLAYING across Mini <-> Max mode handoff', () => {
    assert(
      embeddedPlayerCode.includes("// Stream session is already active on player but hasn't completed initial playback yet"),
      'EmbeddedVideoPlayer must guard active session without stalling in LOADING'
    );
    assert(
      embeddedPlayerCode.includes("if (player.status === 'readyToPlay' || player.playing) {\n            hasEverPlayedRef.current = true;\n            setHasFirstFrame(true);\n            playerStateRef.current = 'PLAYING';"),
      'Active session on mount must immediately mark PLAYING if player is ready'
    );
  });

  test('7.7: PlayerScreen mirrors immediate auto-play upon reaching readyToPlay state', () => {
    assert(
      playerScreenCode.includes("// Immediate auto-play check: if player is ALREADY in readyToPlay status when listener attaches"),
      'PlayerScreen must immediately inspect readyToPlay status on listener attach'
    );
    assert(
      playerScreenCode.includes("if (player.status === 'readyToPlay' || player.playing) {\n              hasEverPlayedRef.current = true;\n              setHasFirstFrame(true);\n              playerStateRef.current = 'PLAYING';"),
      'PlayerScreen replaceAsync must transition to PLAYING as soon as ready'
    );
  });

  console.log('\n================================================================');
  console.log(`TOTAL LIVE TV RECOVERY TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} Live TV recovery tests failed`);
  }

  return { passed, failed };
}

module.exports = { runTests };

if (require.main === module) {
  runTests();
}
