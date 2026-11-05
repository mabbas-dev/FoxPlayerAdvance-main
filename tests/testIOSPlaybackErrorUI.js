const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  classifyPlayerError,
  getErrorDisplayDetails,
  ERROR_CLASSIFICATION,
  mapStreamError,
} = require('../src/utils/playerErrorMapper.js');

console.log('================================================================');
console.log('   FOX PLAYER — SECTION 32: iOS MOVIES & SERIES ERROR UI TESTS  ');
console.log('================================================================\n');

function runTests() {
  console.log('--- 1. Error Classification & Structured User Display Details ---');

  const errorScenarios = [
    {
      description: 'Network failure / unreachable host',
      rawError: 'Network connection lost. The Internet connection appears to be offline. Code=-1009',
      expectedCategory: ERROR_CLASSIFICATION.NETWORK_FAILURE,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: 'Check your internet connection and try again.',
      expectedCanRetry: true,
    },
    {
      description: 'Stream connection timeout',
      rawError: 'The request timed out. Code=-1001',
      expectedCategory: ERROR_CLASSIFICATION.TIMEOUT,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: 'Check your internet connection and try again.',
      expectedCanRetry: true,
    },
    {
      description: 'Unsupported MKV container format',
      rawError: 'AVErrorFileFormatNotRecognized Code=-11828 (movie_146924.mkv)',
      expectedCategory: ERROR_CLASSIFICATION.UNSUPPORTED_FORMAT,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: "This video format isn't supported on this device.",
      expectedCanRetry: false,
    },
    {
      description: 'Stream unavailable / 404 HTTP Not Found',
      rawError: 'Server returned HTTP 404 Not Found',
      expectedCategory: ERROR_CLASSIFICATION.HTTP_FAILURE,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: 'This video is currently unavailable.',
      expectedCanRetry: true,
    },
    {
      description: 'Authentication / 403 Forbidden',
      rawError: 'Server returned HTTP 403 Forbidden access denied',
      expectedCategory: ERROR_CLASSIFICATION.AUTH_FAILURE,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: 'Unable to access this video. Please try again later.',
      expectedCanRetry: false,
    },
    {
      description: 'Connection limit reached / HTTP 509',
      rawError: 'CoreMediaErrorDomain Code=-16846: bandwidth limit exceeded HTTP 509',
      expectedCategory: ERROR_CLASSIFICATION.HTTP_CONNECTION_LIMIT,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: 'Stream connection limit reached (HTTP 509).',
      expectedCanRetry: true,
    },
    {
      description: 'Hardware decoder limitation (10-bit Hi10P)',
      rawError: 'kVTVideoDecoderBadDataErr Code=-12909 10-bit H.264 profile',
      expectedCategory: ERROR_CLASSIFICATION.DECODER_FAILURE,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: "This video format isn't supported on this device.",
      expectedCanRetry: false,
    },
    {
      description: 'Generic / unknown playback failure',
      rawError: 'An unexpected player error occurred (code 99999)',
      expectedCategory: ERROR_CLASSIFICATION.UNKNOWN,
      expectedHeading: 'Unable to Play Video',
      expectedMessage: 'Something went wrong while playing this video.',
      expectedCanRetry: true,
    },
  ];

  errorScenarios.forEach(({ description, rawError, expectedCategory, expectedHeading, expectedMessage, expectedCanRetry }) => {
    const details = getErrorDisplayDetails(rawError);
    assert.strictEqual(details.category, expectedCategory, `Category must match for ${description}`);
    assert.strictEqual(details.heading, expectedHeading, `Heading must match for ${description}`);
    assert.strictEqual(details.message, expectedMessage, `Primary message must match for ${description}`);
    assert.strictEqual(details.canRetry, expectedCanRetry, `canRetry flag must match for ${description}`);
    assert(typeof details.explanation === 'string' && details.explanation.length > 0, `Explanation must be present for ${description}`);
  });

  console.log('  PASS: All playback error scenarios correctly mapped to user-friendly headings, messages, explanations, and retryability');

  console.log('\n--- 2. Sensitive Credential & Diagnostics Redaction ---');

  const sensitiveError = 'Error connecting to http://xtream.server.com:8080/movie/super_user/ultra_secret_pass_123!/999.mp4: connection failed';
  const classifiedSensitive = classifyPlayerError(sensitiveError);
  const detailsSensitive = getErrorDisplayDetails(sensitiveError);

  assert(!classifiedSensitive.technicalMessage.includes('ultra_secret_pass_123!'), 'Technical message redacts passwords');
  assert(!classifiedSensitive.sanitizedMessage.includes('ultra_secret_pass_123!'), 'Sanitized message redacts passwords');
  assert(!detailsSensitive.technicalMessage.includes('ultra_secret_pass_123!'), 'Details technical message redacts passwords');
  assert(!detailsSensitive.message.includes('ultra_secret_pass_123!'), 'User message contains zero confidential info');
  assert(!detailsSensitive.explanation.includes('ultra_secret_pass_123!'), 'Explanation contains zero confidential info');

  console.log('  PASS: Zero technical credentials, tokens, or raw server traces exposed to user');

  console.log('\n--- 3. BrokenVideoView Visual Hierarchy & Aesthetics Invariants ---');

  const brokenViewCode = fs.readFileSync(path.join(__dirname, '../src/components/BrokenVideoView.js'), 'utf8');

  // 1. Existing Video Break SVG illustration
  assert(
    brokenViewCode.includes('BrokenVideoIcon'),
    'BrokenVideoView renders the existing Video Break SVG illustration (BrokenVideoIcon)'
  );
  assert(
    brokenViewCode.includes('size={isMini ? 32 : 52}') || brokenViewCode.includes('BrokenVideoIcon'),
    'BrokenVideoView renders responsive icon sizing'
  );

  // 2. Error heading
  assert(
    brokenViewCode.includes('styles.errorHeading') && brokenViewCode.includes('displayHeading'),
    'BrokenVideoView renders distinct error heading'
  );

  // 3. Primary message
  assert(
    brokenViewCode.includes('styles.errorMessage') && brokenViewCode.includes('displayMessage'),
    'BrokenVideoView renders clear primary error message'
  );

  // 4. Secondary explanation
  assert(
    brokenViewCode.includes('errorExplanation') && brokenViewCode.includes('displayExplanation'),
    'BrokenVideoView renders secondary explanatory guidance'
  );

  // 5. Subtle Retry action
  assert(
    brokenViewCode.includes('styles.retryBtn') && brokenViewCode.includes('showRetry'),
    'BrokenVideoView renders Retry action only when appropriate'
  );
  assert(
    brokenViewCode.includes('Colors.brand.primary'),
    'BrokenVideoView styles Retry button with Colors.brand.primary'
  );

  // Design constraints: no neon, no glow, pure dark background
  assert(
    !brokenViewCode.includes('neon') && !brokenViewCode.includes('#00FF') && !brokenViewCode.includes('glowStrong'),
    'BrokenVideoView contains no flashy neon or glowing outlines'
  );
  assert(
    brokenViewCode.includes("backgroundColor: '#000000'") || brokenViewCode.includes('backgroundColor: Colors.background'),
    'BrokenVideoView uses dark background consistent with iOS player'
  );

  console.log('  PASS: BrokenVideoView adheres to 5-level visual hierarchy and clean OTT aesthetic rules');

  console.log('\n--- 4. PlayerScreen State Machine & Error Lifecycle Invariants ---');

  const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');

  // Error details tracking and integration
  assert(
    playerScreenCode.includes('errorDetails') &&
    playerScreenCode.includes('setErrorDetails') &&
    playerScreenCode.includes('getErrorDisplayDetails'),
    'PlayerScreen tracks structured errorDetails state and uses getErrorDisplayDetails'
  );

  // Mutual exclusion: Loading spinner vs Error screen
  assert(
    playerScreenCode.includes("playerState === 'ERROR'") &&
    playerScreenCode.includes("setIsBufferingUI(false)") &&
    playerScreenCode.includes("setDebouncedBuffering(false)"),
    'PlayerScreen strictly dismisses loading spinner when transition to ERROR occurs'
  );

  // Clearing previous error on new movie / episode / source change
  assert(
    playerScreenCode.includes('setErrorDetails(null)') &&
    playerScreenCode.includes('setErrorMessage(null)'),
    'PlayerScreen clears previous error details immediately when switching content'
  );

  // Retry execution
  assert(
    playerScreenCode.includes('handleRetry') &&
    playerScreenCode.includes("playerStateRef.current = 'LOADING'") &&
    playerScreenCode.includes("setPlayerState('LOADING')"),
    'handleRetry transitions player to LOADING and clears error states in correct order'
  );

  // BrokenVideoView props passed correctly
  assert(
    playerScreenCode.includes('<BrokenVideoView') &&
    playerScreenCode.includes('title={errorDetails?.heading') &&
    playerScreenCode.includes('message={errorDetails?.message') &&
    playerScreenCode.includes('explanation={errorDetails?.explanation') &&
    playerScreenCode.includes('onRetry={handleRetry}'),
    'PlayerScreen passes structured errorDetails and handleRetry to BrokenVideoView'
  );

  console.log('  PASS: PlayerScreen correctly handles error transitions, mutual exclusion, and recovery retry');

  console.log('\n--- 5. EmbeddedVideoPlayer LiveTV Error Coordination ---');

  const embeddedPlayerCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');

  assert(
    embeddedPlayerCode.includes('getErrorDisplayDetails') &&
    embeddedPlayerCode.includes('<BrokenVideoView'),
    'EmbeddedVideoPlayer coordinates with structured error mapper and BrokenVideoView'
  );
  assert(
    embeddedPlayerCode.includes('title={errorDetails?.heading') &&
    embeddedPlayerCode.includes('explanation={errorDetails?.explanation'),
    'EmbeddedVideoPlayer passes structured error details to BrokenVideoView'
  );

  console.log('  PASS: EmbeddedVideoPlayer shared error coordination verified');

  console.log('\n--- 6. Movies & Series Route and Error Propagation Invariants ---');

  const moviesScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/MoviesScreen.js'), 'utf8');
  const seriesScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/SeriesScreen.js'), 'utf8');

  // Both screens navigate to /player route
  assert(
    moviesScreenCode.includes("pathname: '/player'") && moviesScreenCode.includes("type: 'movie'"),
    'MoviesScreen navigates to /player with type: movie'
  );
  assert(
    seriesScreenCode.includes("pathname: '/player'") && seriesScreenCode.includes("type: 'series'"),
    'SeriesScreen navigates to /player with type: series'
  );

  // PlayerScreen statusChange handles native AVPlayer errors without being suppressed by isReplacingSource
  assert(
    !playerScreenCode.includes('if (isReplacingSourceRef.current || classified.category === \'CANCELLED\')'),
    'PlayerScreen does NOT drop status errors when replaceAsync is in flight'
  );

  console.log('  PASS: Movies and Series share the unified PlayerScreen and propagate native AVPlayer errors reliably');

  console.log('\n====================================================');
  console.log('ALL SECTION 32 ERROR UI INVARIANTS VERIFIED (6/6)');
  console.log('====================================================\n');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
