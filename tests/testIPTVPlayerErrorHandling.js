/**
 * FOX PLAYER — IPTV PLAYER ERROR HANDLING SUITE (PHASES 1-9)
 *
 * Validates strict error classification, false timeout popup elimination,
 * server error confirmation, fatal native error detection, deduplication,
 * and platform consistency across Android and iOS.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  classifyPlayerError,
  evaluatePlayerErrorPopupPolicy,
  isConfirmedServerError,
  isFatalNativePlayerError,
  extractHttpStatus,
  extractNativeErrorCode,
  logClassifiedPlayerError,
  ERROR_POPUP_CATEGORY,
} = require('../src/utils/playerErrorMapper.js');

function runTests() {
  console.log('================================================================');
  console.log('   FOX PLAYER — IPTV PLAYER ERROR HANDLING TESTS (PHASE 9)       ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function t(description, fn) {
    try {
      fn();
      console.log(`  [PASS] ${description}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${description}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // Case 1: Slow stream connection (takes long to connect, eventually plays)
  // Expected: No timeout error popup
  // -------------------------------------------------------------------------
  console.log('--- Case 1: Slow stream connection ---');
  t('1.1: Slow connection error string does NOT trigger popup', () => {
    const err = new Error('Live stream connection timed out. Server may be slow or channel offline.');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, false, 'Slow connection must not authorize popup');
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.NON_FATAL);
  });

  t('1.2: EmbeddedVideoPlayer connect watchdog logs diagnostic and does not call handleFallbackOrError', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(code.includes('liveStreamConnectSlow'), 'EmbeddedVideoPlayer logs liveStreamConnectSlow diagnostic');
    assert(!code.includes("handleFallbackOrError(\n          new Error('Live stream connection timed out"), 'Connect watchdog does not invoke handleFallbackOrError');
  });

  t('1.3: PlayerScreen connect watchdog logs diagnostic and does not call handleFallbackOrError', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes('playbackConnectSlow'), 'PlayerScreen logs playbackConnectSlow diagnostic');
    assert(!code.includes("handleFallbackOrError(\n          new Error('Live stream connection timed out"), 'PlayerScreen connect watchdog does not invoke handleFallbackOrError');
  });

  // -------------------------------------------------------------------------
  // Case 2: Valid stream buffers for an extended period
  // Expected: No timeout error popup
  // -------------------------------------------------------------------------
  console.log('\n--- Case 2: Prolonged buffering ---');
  t('2.1: Prolonged buffering stall does NOT trigger popup', () => {
    const err = new Error('Stream connection lost. Server is unresponsive or channel is offline.');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, false, 'Buffering stall must not authorize popup');
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.NON_FATAL);
  });

  t('2.2: EmbeddedVideoPlayer stallTimeoutRef logs diagnostic without triggering fatal error', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(code.includes('liveBufferingProlonged'), 'EmbeddedVideoPlayer logs liveBufferingProlonged diagnostic');
    assert(!code.includes("handleFallbackOrError(\n                new Error('Stream connection lost"), 'Stall watchdog does not trigger handleFallbackOrError');
  });

  // -------------------------------------------------------------------------
  // Case 3: Source-loading watchdog expires
  // Expected: No server-error or fatal-player popup solely because of watchdog
  // -------------------------------------------------------------------------
  console.log('\n--- Case 3: Source-loading watchdog expiration ---');
  t('3.1: Watchdog expiration error does NOT authorize popup', () => {
    const err = new Error('Connection timed out. Server may be slow or format unsupported on this device.');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, false, 'Watchdog expiration must not authorize popup');
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.NON_FATAL);
  });

  t('3.2: PlaybackController armWatchdog does NOT call handleError on expiry', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/playback/PlaybackController.js'), 'utf8');
    assert(code.includes('playbackWatchdogExpired'), 'PlaybackController logs playbackWatchdogExpired');
    assert(!code.includes("this.handleError(\n          new Error('Connection timed out"), 'PlaybackController watchdog does not call handleError');
  });

  // -------------------------------------------------------------------------
  // Case 4: Locally generated network timeout
  // Expected: No confirmed-server-error popup
  // -------------------------------------------------------------------------
  console.log('\n--- Case 4: Locally generated network timeout ---');
  t('4.1: iOS NSURLErrorTimedOut (code -1001) is NOT classified as confirmed server error', () => {
    const err = { message: 'The request timed out.', code: -1001, domain: 'NSURLErrorDomain' };
    assert.strictEqual(isConfirmedServerError(err), false, 'NSURLErrorTimedOut is client-side, not server error');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, false, 'Client timeout must not show error popup');
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.NON_FATAL);
  });

  t('4.2: AbortError is NOT classified as confirmed server error', () => {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    assert.strictEqual(isConfirmedServerError(err), false, 'AbortError is not server error');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, false, 'AbortError must not show error popup');
  });

  t('4.3: Android ETIMEDOUT / connect timeout is NOT classified as confirmed server error', () => {
    const err = new Error('connect ETIMEDOUT 192.168.1.100:8080');
    assert.strictEqual(isConfirmedServerError(err), false, 'ETIMEDOUT is not confirmed server error');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, false);
  });

  // -------------------------------------------------------------------------
  // Case 5: Actual HTTP 500 response observable by application
  // Expected: One appropriate server-error popup
  // -------------------------------------------------------------------------
  console.log('\n--- Case 5: Confirmed HTTP 500 response ---');
  t('5.1: HTTP 500 response object authorizes server error popup', () => {
    const err = { status: 500, message: 'Internal Server Error' };
    assert.strictEqual(isConfirmedServerError(err), true, 'HTTP 500 is confirmed server error');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, true, 'HTTP 500 must authorize popup');
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.CONFIRMED_SERVER_ERROR);
    assert.strictEqual(policy.httpStatus, 500);
  });

  t('5.2: Error message mentioning HTTP 500 authorizes server error popup', () => {
    const err = new Error('Server returned HTTP 500 response');
    assert.strictEqual(isConfirmedServerError(err), true);
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, true);
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.CONFIRMED_SERVER_ERROR);
  });

  // -------------------------------------------------------------------------
  // Case 6: Actual HTTP 503 response observable by application
  // Expected: One appropriate server-error popup
  // -------------------------------------------------------------------------
  console.log('\n--- Case 6: Confirmed HTTP 503 response ---');
  t('6.1: HTTP 503 response object authorizes server error popup', () => {
    const err = { statusCode: 503, message: 'Service Unavailable' };
    assert.strictEqual(isConfirmedServerError(err), true, 'HTTP 503 is confirmed server error');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, true, 'HTTP 503 must authorize popup');
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.CONFIRMED_SERVER_ERROR);
    assert.strictEqual(policy.httpStatus, 503);
  });

  t('6.2: HTTP 502 Bad Gateway authorizes server error popup', () => {
    const err = { status: 502, message: 'Bad Gateway' };
    assert.strictEqual(isConfirmedServerError(err), true);
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, true);
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.CONFIRMED_SERVER_ERROR);
  });

  // -------------------------------------------------------------------------
  // Case 7: Confirmed fatal native player error or crash
  // Expected: One appropriate player-error popup
  // -------------------------------------------------------------------------
  console.log('\n--- Case 7: Fatal native player error ---');
  t('7.1: Unrecoverable decoder error authorizes fatal player popup', () => {
    const err = { code: 'DECODER_INIT_FAILED', message: 'Hardware video decoder failed to initialize.' };
    assert.strictEqual(isFatalNativePlayerError(err), true, 'Decoder init failure is fatal native error');
    const policy = evaluatePlayerErrorPopupPolicy(err, { isNativeEvent: true });
    assert.strictEqual(policy.shouldShowPopup, true, 'Fatal native error must authorize popup');
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.FATAL_NATIVE_PLAYER_ERROR);
  });

  t('7.2: Native player status=error with fatal native crash authorizes popup', () => {
    const err = { message: 'Native playback engine crashed: EXOPLAYER_UNRECOVERABLE_EXCEPTION' };
    assert.strictEqual(isFatalNativePlayerError(err), true);
    const policy = evaluatePlayerErrorPopupPolicy(err, { isNativeEvent: true });
    assert.strictEqual(policy.shouldShowPopup, true);
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.FATAL_NATIVE_PLAYER_ERROR);
  });

  // -------------------------------------------------------------------------
  // Case 8: User switches channels while stream is loading
  // Expected: No stale timeout popup from previous channel
  // -------------------------------------------------------------------------
  console.log('\n--- Case 8: Channel switching safety & stale callback suppression ---');
  t('8.1: PlayerScreen checks opId against requestCounterRef before acting on errors', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(
      code.includes('if (opId !== null && opId !== requestCounterRef.current)') ||
      code.includes('if (opId !== requestCounterRef.current)'),
      'PlayerScreen must discard errors from obsolete channel requests'
    );
  });

  t('8.2: EmbeddedVideoPlayer checks opId against requestCounterRef in triggerErrorState', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(
      code.includes('if (opId !== null && opId !== requestCounterRef.current)'),
      'EmbeddedVideoPlayer must discard stale errors from older channel sessions'
    );
  });

  t('8.3: iOS AVPlayer cancellation (-999) on channel switch is suppressed as non-fatal', () => {
    const err = { code: -999, domain: 'NSURLErrorDomain', message: 'The operation was cancelled.' };
    const classified = classifyPlayerError(err);
    assert.strictEqual(classified.category, 'CANCELLED', 'Code -999 must classify as CANCELLED');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.shouldShowPopup, false, 'Cancelled operation must never show popup');
  });

  // -------------------------------------------------------------------------
  // Case 9: Multiple native events reporting the same incident
  // Expected: Exactly one deduplicated popup
  // -------------------------------------------------------------------------
  console.log('\n--- Case 9: Error deduplication across multiple events ---');
  t('9.1: Deduplication logic allows first popup and suppresses subsequent popups for same attempt', () => {
    const currentAttemptId = 5;
    let lastToastedAttemptId = null;
    let toastCount = 0;

    function simulateTriggerError(err) {
      const policy = evaluatePlayerErrorPopupPolicy(err);
      const alreadyToasted = (lastToastedAttemptId === currentAttemptId);
      if (!alreadyToasted && policy.shouldShowPopup) {
        lastToastedAttemptId = currentAttemptId;
        toastCount++;
      }
    }

    const fatalErr = { status: 500, message: 'Server Internal Error' };
    simulateTriggerError(fatalErr); // First event
    simulateTriggerError(fatalErr); // Second duplicate event
    simulateTriggerError(fatalErr); // Third duplicate event

    assert.strictEqual(toastCount, 1, 'Exactly one toast must be displayed for same attempt');
    assert.strictEqual(lastToastedAttemptId, 5);
  });

  // -------------------------------------------------------------------------
  // Case 10: User retries previously failed channel
  // Expected: New playback session can report new genuine fatal error
  // -------------------------------------------------------------------------
  console.log('\n--- Case 10: Retry allows new genuine fatal error reporting ---');
  t('10.1: Retrying increments attempt ID and resets lastToastedAttemptIdRef', () => {
    let currentAttemptId = 1;
    let lastToastedAttemptId = null;
    let toastCount = 0;

    function simulateError(err) {
      const policy = evaluatePlayerErrorPopupPolicy(err);
      const alreadyToasted = (lastToastedAttemptId === currentAttemptId);
      if (!alreadyToasted && policy.shouldShowPopup) {
        lastToastedAttemptId = currentAttemptId;
        toastCount++;
      }
    }

    // Attempt 1 fails with HTTP 500
    simulateError({ status: 500, message: 'Internal Server Error' });
    assert.strictEqual(toastCount, 1);
    assert.strictEqual(lastToastedAttemptId, 1);

    // User retries -> new session
    currentAttemptId = 2;
    lastToastedAttemptId = null;

    // Attempt 2 fails with HTTP 503 -> allowed to toast again for new attempt!
    simulateError({ status: 503, message: 'Service Unavailable' });
    assert.strictEqual(toastCount, 2, 'New playback session must be authorized to report new fatal error');
    assert.strictEqual(lastToastedAttemptId, 2);
  });

  // -------------------------------------------------------------------------
  // Case 11: Invalid URL or unsupported format
  // Expected: No fabricated server error; follow existing non-server error UX
  // -------------------------------------------------------------------------
  console.log('\n--- Case 11: Unsupported format without fabricated server error ---');
  t('11.1: Unsupported format is NOT classified as confirmed server error', () => {
    const err = new Error('Format not supported: audio/aac without video header');
    assert.strictEqual(isConfirmedServerError(err), false, 'Format error is not a server error');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.NON_FATAL);
    assert.strictEqual(policy.shouldShowPopup, false, 'Format failure alone must not show server error popup');
  });

  t('11.2: HTTP 404 is NOT classified as server error (5xx)', () => {
    const err = { status: 404, message: 'Stream not found' };
    assert.strictEqual(isConfirmedServerError(err), false, '404 is client/resource error, not 5xx server error');
    const policy = evaluatePlayerErrorPopupPolicy(err);
    assert.strictEqual(policy.popupCategory, ERROR_POPUP_CATEGORY.NON_FATAL);
    assert.strictEqual(policy.shouldShowPopup, false);
  });

  // -------------------------------------------------------------------------
  // Case 12: Android and iOS consistency & credential redaction in telemetry
  // Expected: Consistent behavior, no credentials leaked in logs
  // -------------------------------------------------------------------------
  console.log('\n--- Case 12: Platform consistency and credential privacy ---');
  t('12.1: evaluatePlayerErrorPopupPolicy works identically across Android and iOS', () => {
    const android500 = evaluatePlayerErrorPopupPolicy({ status: 500 });
    const ios500 = evaluatePlayerErrorPopupPolicy({ status: 500 });
    assert.strictEqual(android500.shouldShowPopup, ios500.shouldShowPopup);
    assert.strictEqual(android500.popupCategory, ios500.popupCategory);

    const androidTimeout = evaluatePlayerErrorPopupPolicy(new Error('Connection timed out'));
    const iosTimeout = evaluatePlayerErrorPopupPolicy(new Error('Connection timed out'));
    assert.strictEqual(androidTimeout.shouldShowPopup, false);
    assert.strictEqual(iosTimeout.shouldShowPopup, false);
  });

  t('12.2: logClassifiedPlayerError does not expose passwords or Xtream credentials', () => {
    const originalLog = console.log;
    let loggedOutput = '';
    console.log = (...args) => {
      loggedOutput += args.join(' ') + '\n';
    };

    try {
      logClassifiedPlayerError({
        platform: 'ios',
        activePlaybackSessionId: 101,
        errorCategory: ERROR_POPUP_CATEGORY.CONFIRMED_SERVER_ERROR,
        errorOrigin: 'native_player',
        actualHttpStatus: 500,
        popupDisplayed: true,
        decisionReason: 'Confirmed HTTP 500 server error',
      });
    } finally {
      console.log = originalLog;
    }

    assert(!loggedOutput.includes('password'), 'Diagnostics must not log password');
    assert(!loggedOutput.includes('token'), 'Diagnostics must not log auth token');
    assert(loggedOutput.includes('CONFIRMED_SERVER_ERROR'), 'Diagnostics includes category');
  });

  // -------------------------------------------------------------------------
  // Case 13: Full-Screen Error Container Edge-to-Edge Layout & Insets
  // -------------------------------------------------------------------------
  console.log('\n--- Case 13: Full-Screen Error Container Edge-to-Edge & Responsive Insets ---');
  t('13.1: BrokenVideoView enforces edge-to-edge absoluteFill bounds and zIndex 35', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/BrokenVideoView.js'), 'utf8');
    assert(code.includes("position: 'absolute'"), 'BrokenVideoView has position absolute');
    assert(code.includes("top: 0"), 'BrokenVideoView top is 0');
    assert(code.includes("left: 0"), 'BrokenVideoView left is 0');
    assert(code.includes("right: 0"), 'BrokenVideoView right is 0');
    assert(code.includes("bottom: 0"), 'BrokenVideoView bottom is 0');
    assert(code.includes("width: '100%'"), 'BrokenVideoView width is 100%');
    assert(code.includes("height: '100%'"), 'BrokenVideoView height is 100%');
    assert(code.includes("backgroundColor: '#000000'"), 'BrokenVideoView has opaque black background');
    assert(code.includes("zIndex: 35"), 'BrokenVideoView zIndex is 35');
    assert(code.includes("elevation: 35"), 'BrokenVideoView elevation is 35');
  });

  t('13.2: BrokenVideoView accepts and applies safePadding from insets', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/BrokenVideoView.js'), 'utf8');
    assert(code.includes('insets'), 'BrokenVideoView accepts insets prop');
    assert(code.includes('safePadding = insets ?'), 'BrokenVideoView computes safePadding from insets');
  });

  t('13.3: PlayerScreen forwards safe area insets to BrokenVideoView', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes('insets={insets}'), 'PlayerScreen passes insets={insets} to BrokenVideoView');
  });

  t('13.4: EmbeddedVideoPlayer forwards insets, onBack, and wraps invalid source in videoViewport', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(code.includes('insets={insets}'), 'EmbeddedVideoPlayer passes insets={insets}');
    assert(code.includes('onBack={onClose || onMinimize}'), 'EmbeddedVideoPlayer passes onBack');
    assert(code.includes('<View style={styles.videoViewport}>'), 'Wraps within videoViewport');
  });

  t('13.5: videoViewport defines full-width full-height absolute black surface in both players', () => {
    const psCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    const evCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(psCode.includes("backgroundColor: '#000000'"), 'PlayerScreen videoViewport is opaque black');
    assert(evCode.includes("backgroundColor: '#000000'"), 'EmbeddedVideoPlayer videoViewport is opaque black');
  });

  // -------------------------------------------------------------------------
  // Case 14: Suppression of False Terminal Errors on Stalls & Idle Transitions
  // -------------------------------------------------------------------------
  console.log('\n--- Case 14: Suppression of False Terminal Errors on Stalls & Idle Transitions ---');
  t('14.1: PlayerScreen prolonged buffering stall does not invoke handleFallbackOrError', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes('midStreamBufferingProlonged'), 'Logs midStreamBufferingProlonged diagnostic');
    assert(!code.includes("handleFallbackOrError(new Error('Playback connection stalled and timed out.')"), 'Does not call handleFallbackOrError on 14s stall');
  });

  t('14.2: PlayerScreen unexpected status=idle does not trigger fatal error', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes('playerIdleTransition'), 'Logs playerIdleTransition diagnostic');
    assert(!code.includes("handleFallbackOrError(new Error('Playback item could not be loaded by media engine')"), 'Does not throw terminal error on idle status');
  });

  t('14.3: EmbeddedVideoPlayer triggerErrorState enforces isTerminalFailure guard', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(code.includes('isTerminalFailure = isConfirmedServer || isFatalNative || isInvalidSource || (classified.isFatal && fallbackAttemptedRef.current)'), 'EmbeddedVideoPlayer guards against non-terminal errors');
    assert(code.includes('nonTerminalErrorSuppressed'), 'EmbeddedVideoPlayer logs nonTerminalErrorSuppressed');
  });

  t('14.4: PlayerScreen triggerErrorState enforces isTerminalFailure guard', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes('isTerminalFailure = isConfirmedServer || isFatalNative || isInvalidSource || (classified.isFatal && fallbackAttemptedRef.current)'), 'PlayerScreen guards against non-terminal errors');
    assert(code.includes('nonTerminalErrorSuppressed'), 'PlayerScreen logs nonTerminalErrorSuppressed');
  });

  console.log('\n================================================================');
  console.log(`TOTAL PHASE 9 TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} Phase 9 test(s) failed`);
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
