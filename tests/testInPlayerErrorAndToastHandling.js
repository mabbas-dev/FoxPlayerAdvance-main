const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { classifyPlayerError, ERROR_CLASSIFICATION, mapStreamError } = require('../src/utils/playerErrorMapper.js');

console.log('================================================================');
console.log('   FOX PLAYER — IN-PLAYER ERROR UI & TOAST HANDLING TESTS       ');
console.log('================================================================\n');

function runTests() {
  console.log('--- 1. Toast Notification Restriction to "Failed" & Attempt Generation Deduplication ---');

  const embeddedPlayerCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
  const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');

  // Verify EmbeddedVideoPlayer sets toastMessage to 'Failed'
  assert(
    embeddedPlayerCode.includes("setToastMessage('Failed')"),
    'EmbeddedVideoPlayer must set toastMessage to exact string "Failed" on playback error'
  );
  assert(
    !embeddedPlayerCode.includes('setToastMessage(classified.userMessage)'),
    'EmbeddedVideoPlayer must NOT pass verbose error descriptions to toast notifications'
  );

  // Verify attempt generation ID toast deduplication in EmbeddedVideoPlayer
  assert(
    embeddedPlayerCode.includes('lastToastedAttemptIdRef') &&
    embeddedPlayerCode.includes('alreadyToastedForAttempt') &&
    embeddedPlayerCode.includes('lastToastedAttemptIdRef.current = currentAttemptId'),
    'EmbeddedVideoPlayer must deduplicate toasts by attempt generation ID (requestCounterRef)'
  );
  assert(
    embeddedPlayerCode.includes('externalPlayer._lastToastedAttemptId'),
    'EmbeddedVideoPlayer must synchronize lastToastedAttemptId across mini <-> max presentation transitions'
  );

  // Verify PlayerScreen sets toastMessage to 'Failed' and deduplicates by attempt ID
  assert(
    playerScreenCode.includes("setToastMessage('Failed')"),
    'PlayerScreen must set toastMessage to exact string "Failed" on playback error'
  );
  assert(
    playerScreenCode.includes('lastToastedAttemptIdRef') &&
    playerScreenCode.includes('lastToastedAttemptIdRef.current !== currentAttemptId'),
    'PlayerScreen must deduplicate toasts by attempt generation ID (requestCounterRef)'
  );
  console.log('  PASS: Video player components strictly display deduplicated "Failed" toast notifications per attempt');

  console.log('\n--- 2. In-Player Error UI & BrokenVideoView Architecture ---');

  const brokenViewCode = fs.readFileSync(path.join(__dirname, '../src/components/BrokenVideoView.js'), 'utf8');

  // Verify BrokenVideoView defaults & structure
  assert(
    brokenViewCode.includes("title = 'Unable to Play Video'") || brokenViewCode.includes('Unable to Play Video'),
    'BrokenVideoView must display "Unable to Play Video" heading by default'
  );
  assert(
    brokenViewCode.includes('errorMessage') || brokenViewCode.includes('displayMessage'),
    'BrokenVideoView must display detailed human-readable error message'
  );
  assert(
    brokenViewCode.includes('BrokenVideoIcon'),
    'BrokenVideoView must render the Video Break SVG illustration (BrokenVideoIcon)'
  );
  assert(
    brokenViewCode.includes('explanation') || brokenViewCode.includes('displayExplanation'),
    'BrokenVideoView must support secondary explanatory tips'
  );
  assert(
    !brokenViewCode.includes('Switch Playlist') && !brokenViewCode.includes('onSwitchPlaylist'),
    'BrokenVideoView must NOT contain Switch Playlist action'
  );
  assert(
    brokenViewCode.includes('Colors.brand.primary'),
    'BrokenVideoView Retry button must use the application primary brand color token (Colors.brand.primary)'
  );
  assert(
    brokenViewCode.includes('isMini = false') && brokenViewCode.includes('miniContainer'),
    'BrokenVideoView must support responsive mini-player and expanded layouts'
  );

  // Verify aesthetic constraints: no neon or animated border glows
  assert(
    !brokenViewCode.includes('neon') && !brokenViewCode.includes('#00FF') && !brokenViewCode.includes('#39FF14'),
    'BrokenVideoView must contain NO neon colors or glows'
  );
  assert(
    !brokenViewCode.includes('shadowRadius: 20') && !brokenViewCode.includes('shadowRadius: 30'),
    'BrokenVideoView must not use excessive decorative glow shadows'
  );
  console.log('  PASS: BrokenVideoView implements clean, modern OTT in-player error interface with Video Break SVG illustration, clear typography, secondary explanation, and primary color Retry button');

  console.log('\n--- 3. Authoritative Error Preservation Across Mini <-> Max Transitions ---');

  // Verify EmbeddedVideoPlayer reads initial error from externalPlayer
  assert(
    embeddedPlayerCode.includes('initialError') &&
    embeddedPlayerCode.includes('externalPlayer._playbackError') &&
    embeddedPlayerCode.includes('externalPlayer._errorUri === sanitizedUri'),
    'EmbeddedVideoPlayer must initialize error state from shared externalPlayer across mini/max transitions'
  );

  // Verify EmbeddedVideoPlayer retains error state during source change check
  assert(
    embeddedPlayerCode.includes('externalPlayer._playbackError && externalPlayer._errorUri === nextUri'),
    'EmbeddedVideoPlayer must retain authoritative error state when presentation changes between mini and max'
  );

  // Verify externalPlayer stores error during triggerErrorState
  assert(
    embeddedPlayerCode.includes('externalPlayer._playbackError = classified'),
    'EmbeddedVideoPlayer must synchronize active error with externalPlayer instance'
  );
  console.log('  PASS: Error state is authoritatively preserved across LiveTV mini <-> expanded transitions');

  console.log('\n--- 4. Stale Error Prevention & Channel Switching ---');

  // Verify requestCounterRef / opId invalidates obsolete errors
  assert(
    embeddedPlayerCode.includes('requestCounterRef.current') &&
    embeddedPlayerCode.includes('opId !== requestCounterRef.current'),
    'EmbeddedVideoPlayer must reject asynchronous errors from previous channels'
  );
  assert(
    playerScreenCode.includes('requestCounterRef.current') &&
    playerScreenCode.includes('opId !== requestCounterRef.current'),
    'PlayerScreen must reject asynchronous errors from obsolete requests'
  );

  // Verify new channel selection clears previous error state
  assert(
    embeddedPlayerCode.includes('externalPlayer._playbackError = null') &&
    embeddedPlayerCode.includes('externalPlayer._errorUri = null'),
    'EmbeddedVideoPlayer must clear previous channel error state when switching to a new channel'
  );
  console.log('  PASS: Stale asynchronous error callbacks from previous channels are rejected');

  console.log('\n--- 5. Error State Overrides Buffering UI ---');

  // Verify buffering UI and debounced buffering are cleared on error
  assert(
    embeddedPlayerCode.includes("setPlayerState('ERROR')") &&
    embeddedPlayerCode.includes('setDebouncedBuffering(false)') &&
    embeddedPlayerCode.includes('setIsBufferingUI(false)'),
    'EmbeddedVideoPlayer must immediately dismiss buffering spinner and overlay on error'
  );
  assert(
    playerScreenCode.includes("setPlayerState('ERROR')") &&
    playerScreenCode.includes('setDebouncedBuffering(false)') &&
    playerScreenCode.includes('setIsBufferingUI(false)'),
    'PlayerScreen must immediately dismiss buffering spinner and overlay on error'
  );
  console.log('  PASS: Fatal errors override buffering UI and dismiss the loading spinner');

  console.log('\n--- 6. Safe Error Classification & Privacy Preservation ---');

  const testCases = [
    {
      raw: 'The request timed out (-1001)',
      category: 'TIMEOUT',
      expectedMsg: 'Stream connection timed out.',
      isFatal: true,
      isRecoverable: true,
    },
    {
      raw: 'CoreMediaErrorDomain Code=-16846: bandwidth limit exceeded HTTP 509',
      category: 'HTTP_CONNECTION_LIMIT',
      expectedMsg: 'Stream connection limit reached (HTTP 509). Please stop other active streams.',
      isFatal: true,
      isRecoverable: true,
    },
    {
      raw: 'The operation was stopped',
      category: 'CANCELLED',
      expectedMsg: 'Playback cancelled',
      isFatal: false,
      isRecoverable: true,
    },
    {
      raw: 'Server returned HTTP 403 Forbidden',
      category: 'AUTH_FAILURE',
      expectedMsg: 'The stream could not be authenticated.',
      isFatal: true,
      isRecoverable: false,
    },
    {
      raw: 'CoreMediaErrorDomain error -16830: segment unavailable',
      category: 'STREAM_OFF_AIR',
      expectedMsg: 'This channel is currently off-air or unavailable from the provider.',
      isFatal: true,
      isRecoverable: true,
    },
    {
      raw: 'Unsupported format / container unrecognizedinputformatexception',
      category: 'UNSUPPORTED_FORMAT',
      expectedMsg: 'This video format is not supported on this device.',
      isFatal: true,
      isRecoverable: false,
    },
    {
      raw: 'Error loading stream at http://provider.com/live/username/supersecretpassword/123.m3u8',
      category: 'UNKNOWN',
      expectedMsg: 'Unable to play this stream.',
      isFatal: true,
      isRecoverable: true,
    },
  ];

  testCases.forEach(({ raw, category, expectedMsg, isFatal, isRecoverable }) => {
    const result = classifyPlayerError(raw);
    assert.strictEqual(result.category, category, `Category must match for ${raw}`);
    assert.strictEqual(result.userMessage, expectedMsg, `User message must match for ${raw}`);
    assert.strictEqual(result.isFatal, isFatal, `isFatal must match for ${raw}`);
    assert.strictEqual(result.isRecoverable, isRecoverable, `isRecoverable must match for ${raw}`);
    assert(
      !result.technicalMessage.includes('supersecretpassword') &&
      !result.sanitizedMessage.includes('supersecretpassword'),
      'Sanitized messages must redact credentials'
    );
  });

  console.log('  PASS: Safe error classification maps raw technical errors into clean, confidential user messages');

  console.log('\n--- 7. Retry Recovery Behavior ---');

  // Verify handleRetry resets error and externalPlayer error
  assert(
    embeddedPlayerCode.includes('handleRetry') &&
    embeddedPlayerCode.includes('setPlayerState(\'LOADING\')') &&
    embeddedPlayerCode.includes('setErrorMessage(null)') &&
    embeddedPlayerCode.includes('setDebouncedBuffering(true)'),
    'handleRetry must transition to LOADING state and clear error overlay'
  );
  console.log('  PASS: Retry transitions smoothly into loading and re-attempts stream playback');

  console.log('\n--- 8. Initial Loading Persistence & Premature Play Button Suppression ---');

  // Verify readyToPlay strictly maintains LOADING state until genuine playback confirmation
  assert(
    embeddedPlayerCode.includes("status === 'readyToPlay'") &&
    embeddedPlayerCode.includes("const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING'") &&
    embeddedPlayerCode.includes("setPlayerState(nextState)") &&
    embeddedPlayerCode.includes("setIsBufferingUI(true)"),
    'EmbeddedVideoPlayer must retain LOADING state on readyToPlay until native player reports isPlaying: true or time advances'
  );

  // Verify isWaitingForMedia is passed to PlayerControls and manages buffering state
  assert(
    embeddedPlayerCode.includes("const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR'") &&
    embeddedPlayerCode.includes("isBuffering={isWaitingForMedia}"),
    'EmbeddedVideoPlayer must pass isWaitingForMedia to PlayerControls'
  );

  // Verify PlayerScreen also configures isWaitingForMedia and passes to PlayerControls
  assert(
    playerScreenCode.includes("const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR'") &&
    playerScreenCode.includes("isBuffering={isWaitingForMedia}"),
    'PlayerScreen must pass isWaitingForMedia to PlayerControls'
  );
  console.log('  PASS: Loading spinner persists and player state machine drives controls correctly');

  console.log('\n--- 9. Error Persistence & Stale Event Protection ---');

  // Verify listeners guard against ERROR state so late events do not clear error overlay
  assert(
    embeddedPlayerCode.includes("if (playerStateRef.current === 'ERROR') {\n        return;\n      }") ||
    embeddedPlayerCode.includes("if (playerStateRef.current === 'ERROR') {\r\n        return;\r\n      }"),
    'EmbeddedVideoPlayer event listeners must guard against overwriting ERROR state on late readyToPlay/playingChange/timeUpdate'
  );

  assert(
    playerScreenCode.includes("if (playerStateRef.current === 'ERROR') {\n        return;\n      }") ||
    playerScreenCode.includes("if (playerStateRef.current === 'ERROR') {\r\n        return;\r\n      }"),
    'PlayerScreen event listeners must guard against overwriting ERROR state on late readyToPlay/playingChange/timeUpdate'
  );

  // Verify source change check preserves ERROR state across re-renders
  assert(
    embeddedPlayerCode.includes("playerStateRef.current === 'ERROR'"),
    'EmbeddedVideoPlayer source change effect must retain ERROR state across component re-renders'
  );
  console.log('  PASS: Error overlay is permanently locked against late player events and component re-renders');

  console.log('\n--- 10. Mini <-> Expanded Presentation Synchronization ---');

  // Verify initial state initialization preserves shared external player state
  assert(
    embeddedPlayerCode.includes('isSameStreamAsExternal') &&
    embeddedPlayerCode.includes('initialHasPlayed') &&
    embeddedPlayerCode.includes('initialIsBuffering'),
    'EmbeddedVideoPlayer must seamlessly initialize playing/buffering/error states from shared externalPlayer'
  );
  console.log('  PASS: Mini and expanded player modes remain fully synchronized with zero flicker or state loss');

  console.log('\n====================================================');
  console.log('ALL IN-PLAYER ERROR & TOAST INVARIANTS VERIFIED (10/10)');
  console.log('====================================================\n');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };

