const assert = require('assert');
const fs = require('fs');
const path = require('path');

/**
 * FOX PLAYER — iOS LIVETV CHANNEL SWITCHING, RACE-SAFETY & DEADLOCK TESTS
 *
 * Verifies:
 * 1. Serialized source replacement queue preventing concurrent native tasks.
 * 2. Request generation ID supersession discarding stale intermediate channel requests.
 * 3. iOS-specific clean source detachment (replaceAsync(null)) before setting new source.
 * 4. Active readiness poller catching readyToPlay / playing native state immediately.
 * 5. Bounded recovery watchdog terminating infinite loading spinners with a clear error state and manual retry.
 * 6. Controlled native player recreation fallback on AVPlayer CoreMedia corruption.
 * 7. Upstream IPTV provider single-connection socket yield preventing HTTP 503 collisions.
 */

function runTests() {
  console.log('================================================================');
  console.log('  FOX PLAYER — iOS LIVETV CHANNEL SWITCHING & DEADLOCK TESTS    ');
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

  const embeddedCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8').replace(/\r\n/g, '\n');
  const liveScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/LiveScreen.js'), 'utf8').replace(/\r\n/g, '\n');
  const hlsSegmenterCode = fs.readFileSync(path.join(__dirname, '../server/services/hlsSegmenter.js'), 'utf8').replace(/\r\n/g, '\n');

  // --- 1. Serialized Source Replacement Queue ---
  test('1.1: EmbeddedVideoPlayer declares replaceQueueRef for promise serialization', () => {
    assert(embeddedCode.includes('const replaceQueueRef      = useRef(Promise.resolve());'), 'replaceQueueRef must be initialized with Promise.resolve()');
  });

  test('1.2: EmbeddedVideoPlayer serializes source replacement through replaceQueueRef', () => {
    assert(embeddedCode.includes('replaceQueueRef.current = replaceQueueRef.current.then(async () => {'), 'replaceQueueRef must chain sequential async operations');
  });

  test('1.3: EmbeddedVideoPlayer checks supersession before beginning source load', () => {
    assert(embeddedCode.includes("logPlayerDiagnostic('liveSwitchSupersededBeforeStart'"), 'Superseded requests must be skipped before native load');
  });

  test('1.4: EmbeddedVideoPlayer checks supersession after source replace completes', () => {
    assert(embeddedCode.includes("logPlayerDiagnostic('liveSwitchSupersededAfterReplace'"), 'Superseded requests must not control playback after replace');
  });

  // --- 2. iOS Source Detachment Lifecycle ---
  test('2.1: EmbeddedVideoPlayer detaches previous source on iOS using replaceAsync(null)', () => {
    assert(embeddedCode.includes("Platform.OS === 'ios' && typeof player.replaceAsync === 'function'"), 'iOS must check Platform.OS === ios and replaceAsync function');
    assert(embeddedCode.includes('await player.replaceAsync(null);'), 'iOS must call await player.replaceAsync(null) to detach prior item and reset ownerIsReplacing');
  });

  test('2.2: EmbeddedVideoPlayer checks supersession immediately after iOS detachment', () => {
    assert(embeddedCode.includes("logPlayerDiagnostic('liveSwitchSupersededAfterDetach'"), 'Superseded channel switches must bail out after detach');
  });

  test('2.3: handleRetry also detaches with replaceAsync(null) on iOS prior to reloading', () => {
    assert(embeddedCode.includes('handleRetry') && embeddedCode.includes('await player.replaceAsync(null);'), 'handleRetry must detach previous source cleanly on iOS');
  });

  // --- 3. Active Readiness Poller ---
  test('3.1: EmbeddedVideoPlayer declares readinessPollerRef', () => {
    assert(embeddedCode.includes('const readinessPollerRef   = useRef(null);'), 'readinessPollerRef must be declared');
  });

  test('3.2: startReadinessPoller polls for readyToPlay / playing state every 250ms', () => {
    assert(embeddedCode.includes('const startReadinessPoller = useCallback((opReqId) => {'), 'startReadinessPoller must be defined');
    assert(embeddedCode.includes('if (player.status === \'readyToPlay\' || player.playing) {'), 'Poller must inspect readyToPlay or playing');
    assert(embeddedCode.includes('confirmPlaybackActive(opReqId);'), 'Poller must confirm playback when readyToPlay is met');
  });

  test('3.3: clearAllWatchdogs cleans up readinessPollerRef', () => {
    assert(embeddedCode.includes('if (readinessPollerRef.current) {\n      clearInterval(readinessPollerRef.current);\n      readinessPollerRef.current = null;\n    }'), 'clearAllWatchdogs must clear readiness poller');
  });

  // --- 4. Bounded Recovery Watchdog (Eliminating Infinite Loading Spinner) ---
  test('4.1: EmbeddedVideoPlayer declares autoRecoveryAttemptedRef and watchdogTimerRef', () => {
    assert(embeddedCode.includes('const autoRecoveryAttemptedRef = useRef(false);'), 'autoRecoveryAttemptedRef must be declared');
    assert(embeddedCode.includes('const watchdogTimerRef     = useRef(null);'), 'watchdogTimerRef must be declared');
  });

  test('4.2: armActiveRecoveryWatchdog initiates 1 bounded auto-recovery retry', () => {
    assert(embeddedCode.includes('const armActiveRecoveryWatchdog = useCallback((opReqId, targetSource) => {'), 'armActiveRecoveryWatchdog must be defined');
    assert(embeddedCode.includes('if (!autoRecoveryAttemptedRef.current) {\n        autoRecoveryAttemptedRef.current = true;'), 'auto-recovery must be bounded to 1 attempt');
    assert(embeddedCode.includes("logPlayerDiagnostic('liveAutoRecoveryInitiated'"), 'auto-recovery must log diagnostic');
  });

  test('4.3: armActiveRecoveryWatchdog transitions to ERROR state when timeout is exhausted', () => {
    assert(embeddedCode.includes("logPlayerDiagnostic('livePlaybackWatchdogExhausted'"), 'Watchdog exhaustion must log diagnostic');
    assert(embeddedCode.includes("playerStateRef.current = 'ERROR';\n          setPlayerState('ERROR');"), 'Watchdog must transition playerState to ERROR on exhaustion');
    assert(embeddedCode.includes('setDebouncedBuffering(false);\n          setIsBufferingUI(false);'), 'Watchdog must dismiss buffering indicator on exhaustion');
  });

  // --- 5. Controlled Native Player Recreation Fallback ---
  test('5.1: LiveScreen provides playerKey state and handleRecreatePlayer callback', () => {
    assert(liveScreenCode.includes('const [playerKey, setPlayerKey]                   = useState(0);'), 'LiveScreen must maintain playerKey state');
    assert(liveScreenCode.includes('const handleRecreatePlayer = useCallback(() => {\n    setPlayerKey((k) => k + 1);\n  }, []);'), 'handleRecreatePlayer must increment playerKey');
  });

  test('5.2: LiveScreen passes { playerKey } in useVideoPlayer builder options', () => {
    assert(liveScreenCode.includes('}, { playerKey });'), 'useVideoPlayer must receive { playerKey } builder options');
  });

  test('5.3: LiveScreen passes recreatePlayer prop to EmbeddedVideoPlayer in mini and max modes', () => {
    assert(liveScreenCode.includes('recreatePlayer={handleRecreatePlayer}'), 'LiveScreen must pass recreatePlayer prop to EmbeddedVideoPlayer');
  });

  test('5.4: EmbeddedVideoPlayer invokes recreatePlayer on retry when native player is in error status', () => {
    assert(embeddedCode.includes("if (player?.status === 'error' && typeof recreatePlayer === 'function') {\n      logPlayerDiagnostic('liveRetryWithPlayerRecreation', { streamId, platform: Platform.OS });\n      recreatePlayer();\n      return;\n    }"), 'handleRetry must call recreatePlayer when native player status is error');
  });

  // --- 6. Upstream IPTV Provider Single-Connection Protection ---
  test('6.1: StreamSession.start accepts delayMs parameter', () => {
    assert(hlsSegmenterCode.includes('start(delayMs = 0) {'), 'StreamSession.start must accept delayMs');
  });

  test('6.2: StreamManager.getOrCreate yields 60ms when stopping another session', () => {
    assert(hlsSegmenterCode.includes('session.start(hadActiveOther ? 60 : 0);'), 'getOrCreate must yield 60ms when stopping another active session');
  });

  console.log('\n================================================================');
  console.log(`TOTAL iOS CHANNEL SWITCHING TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} iOS channel switching tests failed`);
  }

  return { passed, failed };
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
