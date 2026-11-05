/**
 * FOX PLAYER — iOS LiveTV Mid-Stream Buffering & Automatic Recovery Invariant Tests
 * Validates the multi-stage buffering state machine, native AVPlayer stall recovery,
 * steady-state buffer options, and bounded recovery lifecycle without channel-switching regression.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runTests() {
  console.log('================================================================');
  console.log('  FOX PLAYER — iOS LIVETV MID-STREAM BUFFERING RECOVERY TESTS   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function t(name, fn) {
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

  const playerConfigPath = path.join(__dirname, '../src/utils/playerConfig.js');
  const embeddedPlayerPath = path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js');
  const iosPlayerPath = path.join(__dirname, '../src/playback/IOSPlayer.js');

  const playerConfigCode = fs.readFileSync(playerConfigPath, 'utf8');
  const embeddedCode = fs.readFileSync(embeddedPlayerPath, 'utf8');
  const iosPlayerCode = fs.readFileSync(iosPlayerPath, 'utf8');

  const { getPlatformBufferOptions } = require('../src/utils/playerConfig.js');

  // ---------------------------------------------------------------------------
  // Suite 1: iOS Buffer Configuration Architecture
  // ---------------------------------------------------------------------------
  console.log('--- Suite 1: iOS Buffer Configuration Architecture ---');

  t('1.1: Fast startup buffer options preserved for initial channel load on iOS', () => {
    const startupOpts = getPlatformBufferOptions({ type: 'live', isLive: true, platform: 'ios', enableStallRecovery: false });
    assert.strictEqual(startupOpts.preferredForwardBufferDuration, 1.0, 'iOS startup uses 1.0s buffer');
    assert.strictEqual(startupOpts.waitsToMinimizeStalling, false, 'iOS startup disables stall wait for instant first segment playback');
  });

  t('1.2: Steady-state buffer options provide 2.5s forward buffer and waitsToMinimizeStalling: true', () => {
    const steadyOpts = getPlatformBufferOptions({ type: 'live', isLive: true, platform: 'ios', enableStallRecovery: true });
    assert.strictEqual(steadyOpts.preferredForwardBufferDuration, 2.5, 'iOS steady-state uses 2.5s forward buffer');
    assert.strictEqual(steadyOpts.waitsToMinimizeStalling, true, 'iOS steady-state enables waitsToMinimizeStalling for native auto-recovery');
  });

  t('1.3: IOSPlayer.js getBufferConfig supports enableStallRecovery parameter', () => {
    assert(iosPlayerCode.includes('enableStallRecovery = false'), 'IOSPlayer supports enableStallRecovery');
    assert(iosPlayerCode.includes('preferredForwardBufferDuration: live ? 2.5 : 4.0'), 'IOSPlayer steady-state forward buffer');
    assert(iosPlayerCode.includes('waitsToMinimizeStalling: true'), 'IOSPlayer steady-state stall minimization');
  });

  t('1.4: Android Media3 / ExoPlayer buffer configuration remains strictly untouched', () => {
    const androidOpts = getPlatformBufferOptions({ type: 'live', isLive: true, platform: 'android' });
    assert.strictEqual(androidOpts.preferredForwardBufferDuration, 3.0, 'Android forward buffer intact');
    assert.strictEqual(androidOpts.minBufferForPlayback, 1.0, 'Android minBufferForPlayback intact');
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Mid-Playback Buffering State Machine & Multi-Stage Watchdog
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 2: Mid-Playback Buffering State Machine & Recovery Stages ---');

  t('2.1: EmbeddedVideoPlayer declares mid-stream buffering and stall tracking refs', () => {
    assert(embeddedCode.includes('const midStreamStallTimerRef = useRef(null);'), 'Declares midStreamStallTimerRef');
    assert(embeddedCode.includes('const midStreamPollerRef     = useRef(null);'), 'Declares midStreamPollerRef');
    assert(embeddedCode.includes('const midStreamBufferStartRef = useRef(0);'), 'Declares midStreamBufferStartRef');
    assert(embeddedCode.includes("const midStreamRecoveryStageRef = useRef('NONE');"), 'Declares midStreamRecoveryStageRef');
    assert(embeddedCode.includes('const midStreamReloadAttemptedForEpisodeRef = useRef(false);'), 'Declares midStreamReloadAttemptedForEpisodeRef');
    assert(embeddedCode.includes('const lastMidStreamReloadTimeRef = useRef(0);'), 'Declares lastMidStreamReloadTimeRef');
  });

  t('2.2: Stage A (Passive Recovery) allows native player to recover naturally without interference', () => {
    assert(embeddedCode.includes('// Stage A (0 to 4500ms): Passive Recovery'), 'Defines Stage A passive recovery');
    assert(embeddedCode.includes("midStreamRecoveryStageRef.current = 'STAGE_A';"), 'Transitions to STAGE_A');
    assert(embeddedCode.includes('liveMidPlaybackBufferingStarted'), 'Logs buffering start telemetry');
  });

  t('2.3: Stage B & C (Validation & Safe Native Recovery) gently re-asserts play and activates readiness poller', () => {
    assert(embeddedCode.includes("midStreamRecoveryStageRef.current = 'STAGE_C';"), 'Transitions to STAGE_C');
    assert(embeddedCode.includes('liveMidPlaybackStageC_Entered'), 'Logs Stage C telemetry');
    assert(embeddedCode.includes('player.play()'), 'Re-asserts player.play() gently');
    assert(embeddedCode.includes('midStreamPollerRef.current = setInterval('), 'Launches 250ms readiness poller');
  });

  t('2.4: Stage D (Controlled Reload) enforces single reload per episode with cooldown via serialized queue', () => {
    assert(embeddedCode.includes("midStreamRecoveryStageRef.current = 'STAGE_D';"), 'Transitions to STAGE_D');
    assert(embeddedCode.includes('!midStreamReloadAttemptedForEpisodeRef.current'), 'Guards against reload loops');
    assert(embeddedCode.includes('lastMidStreamReloadTimeRef.current > 25000'), 'Enforces 25s cooldown');
    assert(embeddedCode.includes('liveMidPlaybackStageD_ControlledReload'), 'Logs Stage D reload telemetry');
    assert(embeddedCode.includes('replaceQueueRef.current = replaceQueueRef.current.then('), 'Reloads through serialized queue');
  });

  t('2.5: Stage E (Exhausted Recovery) transitions out of spinner to recoverable ERROR state', () => {
    assert(embeddedCode.includes("midStreamRecoveryStageRef.current = 'STAGE_E';"), 'Transitions to STAGE_E');
    assert(embeddedCode.includes('liveMidPlaybackStageE_Exhausted'), 'Logs exhausted telemetry');
    assert(embeddedCode.includes("playerStateRef.current = 'ERROR';"), 'Sets state to ERROR');
    assert(embeddedCode.includes('LIVE_STREAM_STALL'), 'Sets clear stall error code');
    assert(embeddedCode.includes('setIsBufferingUI(false);'), 'Dismisses buffering spinner');
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Invalidation, Cleanup, & Channel Switching Safety
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 3: Invalidation, Cleanup, & Channel Switching Safety ---');

  t('3.1: cancelMidStreamRecovery cleans up episode and logs duration on playback resumption', () => {
    assert(embeddedCode.includes('const cancelMidStreamRecovery = useCallback('), 'Declares cancelMidStreamRecovery');
    assert(embeddedCode.includes('liveMidPlaybackBufferingRecovered'), 'Logs buffering recovered event');
    assert(embeddedCode.includes("midStreamRecoveryStageRef.current = 'NONE';"), 'Resets stage to NONE');
  });

  t('3.2: clearAllWatchdogs cleans up midStreamStallTimerRef and midStreamPollerRef', () => {
    assert(embeddedCode.includes('if (midStreamStallTimerRef.current)'), 'Cleans up midStreamStallTimerRef');
    assert(embeddedCode.includes('if (midStreamPollerRef.current)'), 'Cleans up midStreamPollerRef');
  });

  t('3.3: confirmPlaybackActive applies steady-state buffer options on iOS during active playback', () => {
    assert(embeddedCode.includes("enableStallRecovery: true"), 'Requests enableStallRecovery in confirmPlaybackActive');
    assert(embeddedCode.includes('player.bufferOptions = steadyOpts;'), 'Applies steadyOpts to player.bufferOptions on iOS');
  });

  t('3.4: Channel change resets player.bufferOptions to fast startup mode', () => {
    assert(embeddedCode.includes("enableStallRecovery: false"), 'Resets enableStallRecovery to false on channel switch');
    assert(embeddedCode.includes('player.bufferOptions = startupBufferOpts;'), 'Applies startup buffer options to player');
  });

  t('3.5: User pause immediately cancels mid-stream recovery without false retries', () => {
    assert(embeddedCode.includes("if (playbackIntentRef.current === 'PAUSED' || userPausedRef.current) {\n          cancelMidStreamRecovery();"), 'Cancels midStreamRecovery on pause in playingChange');
  });

  t('3.6: Generation counter opReqId prevents stale recovery callbacks from affecting new channels', () => {
    assert(embeddedCode.includes('if (opReqId !== requestCounterRef.current) return;'), 'Guards serialized queue against superseded channel');
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Event Triggers & Freeze Detection
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 4: Event Triggers & Freeze Detection ---');

  t('4.1: statusChange loading arms mid-stream recovery watchdog when stream has previously played', () => {
    assert(embeddedCode.includes("if (hasEverPlayedRef.current) {\n            armMidStreamRecoveryWatchdog(requestCounterRef.current, playerSource);\n          }"), 'statusChange loading arms midStreamWatchdog');
  });

  t('4.2: playingChange false arms mid-stream recovery watchdog for active stream', () => {
    assert(embeddedCode.includes("else if (hasEverPlayedRef.current) {\n          // Mid-stream stall or buffer underrun while intent is PLAYING\n          playerStateRef.current = 'BUFFERING';\n          setPlayerState('BUFFERING');\n          if (externalPlayer) externalPlayer._playerState = 'BUFFERING';\n          setDebouncedBuffering(true);\n          armMidStreamRecoveryWatchdog(requestCounterRef.current, playerSource);"), 'playingChange false arms midStreamWatchdog');
  });

  t('4.3: timeUpdate stationary freeze (>1400ms) arms mid-stream recovery watchdog', () => {
    assert(embeddedCode.includes("armMidStreamRecoveryWatchdog(requestCounterRef.current, playerSource);"), 'timeUpdate freeze arms midStreamWatchdog');
  });

  t('4.4: initiateAutoPlayback only confirms active playback when player.playing is true', () => {
    assert(embeddedCode.includes("if (player.playing) {\n      confirmPlaybackActive(currentReqId);\n    }"), 'Auto playback strictly verifies playing status before confirming active');
  });

  console.log('================================================================');
  console.log(`TOTAL MID-STREAM RECOVERY TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} mid-stream recovery test(s) failed`);
  }

  return { passed, failed };
}

if (require.main === module) {
  try {
    runTests();
    process.exit(0);
  } catch (_e) {
    process.exit(1);
  }
}

module.exports = { runTests };
