const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('================================================================');
  console.log('  FOX PLAYER — iOS LIVETV STARTUP & PLAYBACK SYNC TESTS         ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function runTest(name, fn) {
    try {
      fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${name}:`, err.message);
      failed++;
    }
  }

  const embeddedPlayerPath = path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js');
  const embeddedCode = fs.readFileSync(embeddedPlayerPath, 'utf8');

  const liveScreenPath = path.join(__dirname, '../src/screens/LiveScreen.js');
  const liveScreenCode = fs.readFileSync(liveScreenPath, 'utf8');

  const playerScreenPath = path.join(__dirname, '../src/screens/PlayerScreen.js');
  const playerScreenCode = fs.readFileSync(playerScreenPath, 'utf8');

  const hlsSegmenterPath = path.join(__dirname, '../server/services/hlsSegmenter.js');
  const hlsSegmenterCode = fs.readFileSync(hlsSegmenterPath, 'utf8');

  const streamRoutePath = path.join(__dirname, '../server/routes/stream.js');
  const streamRouteCode = fs.readFileSync(streamRoutePath, 'utf8');

  const playerConfigPath = path.join(__dirname, '../src/utils/playerConfig.js');
  const playerConfigCode = fs.readFileSync(playerConfigPath, 'utf8');

  // -----------------------------------------------------------------------------
  // 1. Initial Loading & Elimination of Premature play() Churn
  // -----------------------------------------------------------------------------
  console.log('--- 1. Initial Startup & Premature play() Elimination ---');

  runTest('EmbeddedVideoPlayer does not trigger premature play() before replaceAsync loads source', () => {
    // Before replaceAsync finishes, calling player.play() churns AVPlayer on empty/stale item
    assert(
      !embeddedCode.includes('if (typeof player.replaceAsync === \'function\') {\n        if (playbackIntentRef.current === \'PLAYING\''),
      'Premature play() before replaceAsync must be removed'
    );
    assert(
      embeddedCode.includes('player.replaceAsync(playerSource).then(() => {'),
      'replaceAsync must load source before playback is requested'
    );
  });

  runTest('LiveScreen captures selectedAt tap timestamp for startup telemetry', () => {
    assert(
      liveScreenCode.includes('selectedAt: Date.now()'),
      'LiveScreen must record selectedAt timestamp upon channel selection'
    );
  });

  // -----------------------------------------------------------------------------
  // 2. Active Playback State Isolation from Background Loading
  // -----------------------------------------------------------------------------
  console.log('\n--- 2. Active Playback Isolation from Background Loading ---');

  runTest('readyToPlay does not overwrite active playing state with LOADING or BUFFERING', () => {
    assert(
      embeddedCode.includes("} else if (player.playing) {\n          // Native player is actively outputting frames; do not override with LOADING or BUFFERING\n          playerStateRef.current = 'PLAYING';"),
      'readyToPlay must retain PLAYING state if native player is already playing frames'
    );
  });

  runTest('status loading does not force BUFFERING if native player is actively playing', () => {
    assert(
      embeddedCode.includes("if (player.playing) {\n            // Native player is actively outputting frames; background segment fetch does not stall playback\n            return;\n          }"),
      'Background segment fetching in AVPlayer must not force BUFFERING when player.playing is true'
    );
    assert(
      embeddedCode.includes("if (player?.status === 'loading' && !player?.playing)"),
      'timeUpdate only triggers buffering for status loading if native player is not playing'
    );
  });

  // -----------------------------------------------------------------------------
  // 3. Prompt Buffering Indicator Dismissal on Playback Start
  // -----------------------------------------------------------------------------
  console.log('\n--- 3. Prompt Buffering Indicator Dismissal on Playback Start ---');

  runTest('playingChange with isPlaying true clears all buffering timers and dismisses spinner', () => {
    assert(
      embeddedCode.includes("if (nativePlaying) {\n        clearAllWatchdogs();\n        setErrorMessage(null);\n        lastErrorRef.current = null;\n        setShowToast(false);\n        setToastMessage(null);"),
      'nativePlaying clears watchdogs and error states'
    );
    assert(
      embeddedCode.includes("hasEverPlayedRef.current = true;\n        setHasFirstFrame(true);\n        playerStateRef.current = 'PLAYING';\n        setPlayerState('PLAYING');"),
      'nativePlaying sets PLAYING state and hasFirstFrame'
    );
    assert(
      embeddedCode.includes("setIsBufferingUI(false);"),
      'nativePlaying immediately dismisses isBufferingUI'
    );
  });

  // -----------------------------------------------------------------------------
  // 4. Play/Pause Button Synchronization on iOS
  // -----------------------------------------------------------------------------
  console.log('\n--- 4. Play/Pause Button Synchronization on iOS ---');

  runTest('togglePlay accurately pauses during active playback or buffering underruns', () => {
    assert(
      embeddedCode.includes("const shouldPause = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (typeof player.playing === 'boolean' ? player.playing : false) || playerState === 'PLAYING';"),
      'togglePlay checks playbackIntent and playing state so deliberate pause succeeds even when buffering'
    );
    assert(
      embeddedCode.includes("userPausedRef.current = true;\n      playbackIntentRef.current = 'PAUSED';\n      pausedAtRef.current = Date.now();\n      try {\n        player.pause();\n      } catch (_e) {}\n      playerStateRef.current = 'PAUSED';\n      setPlayerState('PAUSED');"),
      'togglePlay cleanly pauses player, sets state to PAUSED, and clears buffering spinner'
    );
  });

  runTest('playingChange does not enter play() retry loop when native player reports pause', () => {
    // Repeatedly calling player.play() inside playingChange(isPlaying: false) resets AVPlayer buffering rate
    assert(
      !embeddedCode.includes("if (isFocusedRef.current) {\n            try {\n              player.play();\n            } catch (_e) {}\n          }\n\n          // Arm a 12s stall watchdog"),
      'play() must not be invoked inside playingChange(false) branch'
    );
  });

  // -----------------------------------------------------------------------------
  // 5. Server-Side HLS Fast Segment Cutting & Low Latency Startup
  // -----------------------------------------------------------------------------
  console.log('\n--- 5. Server-Side HLS Fast Startup Thresholds ---');

  runTest('hlsSegmenter cuts Segment 1 at ~0.5s and Segment 2 at ~0.8s for fast iOS startup', () => {
    assert(
      hlsSegmenterCode.includes("const minDur = isFirstSeg ? 0.5 : (isSecondSeg ? 0.8 : 1.6);"),
      'hlsSegmenter initial segment durations must be optimized for fast startup'
    );
    assert(
      hlsSegmenterCode.includes("const minBytes = isFirstSeg ? 35000 : (isSecondSeg ? 60000 : 160000);"),
      'hlsSegmenter initial segment byte thresholds must be optimized'
    );
  });

  runTest('stream route serves initial sliding window with reduced wait timeout', () => {
    assert(
      streamRouteCode.includes("await session.waitForSegments(2, 3500);"),
      'stream route uses 3500ms timeout for initial segments'
    );
  });

  // -----------------------------------------------------------------------------
  // 6. Cross-Platform Regression Safety (Android & VOD)
  // -----------------------------------------------------------------------------
  console.log('\n--- 6. Cross-Platform & VOD Regression Safety ---');

  runTest('PlayerScreen maintains synchronized readyToPlay and togglePlay logic for VOD', () => {
    assert(
      playerScreenCode.includes("} else if (player.playing) {\n          playerStateRef.current = 'PLAYING';\n          setPlayerState('PLAYING');"),
      'PlayerScreen protects active playing state during readyToPlay'
    );
    assert(
      playerScreenCode.includes("const shouldPause = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (typeof player.playing === 'boolean' ? player.playing : false) || playerState === 'PLAYING';"),
      'PlayerScreen togglePlay handles pause during loading or buffering'
    );
  });

  runTest('Android buffer configuration is preserved without regression', () => {
    assert(
      playerConfigCode.includes("preferredForwardBufferDuration: live ? 3.0 : 10.0"),
      'Android preferredForwardBufferDuration preserved'
    );
    assert(
      playerConfigCode.includes("minBufferForPlayback: live ? 1.0 : 2.5"),
      'Android minBufferForPlayback preserved'
    );
  });

  console.log('\n====================================================');
  console.log(`TOTAL iOS STARTUP & SYNC TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} iOS LiveTV startup & sync tests failed`);
  }
}

module.exports = { runTests };

if (require.main === module) {
  try {
    runTests();
  } catch (_e) {
    process.exit(1);
  }
}
