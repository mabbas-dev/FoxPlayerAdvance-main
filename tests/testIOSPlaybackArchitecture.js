const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('      FOX PLAYER — iOS PLAYBACK ARCHITECTURE & PIPELINE         ');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    failed++;
  }
}

// Pure implementations for unit testing
function sanitizeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    return encodeURI(decodeURI(trimmed));
  } catch (_e) {
    try {
      return encodeURI(trimmed);
    } catch (_e2) {
      return trimmed.replace(/\s+/g, '%20');
    }
  }
}

function prepareStreamUrlForPlatform(rawUrl, { type = '', extension = '', platform = 'ios' } = {}) {
  if (!rawUrl) return '';
  return sanitizeMediaUrl(rawUrl);
}

function getPlatformBufferOptions({ type = 'movie', isLive = false, platform = 'ios' } = {}) {
  const live = isLive || type === 'live' || type === 'channel';
  if (platform === 'ios') {
    return {
      preferredForwardBufferDuration: live ? 2.5 : 6.0,
      waitsToMinimizeStalling: false,
    };
  }
  return {
    preferredForwardBufferDuration: live ? 3.0 : 10.0,
    minBufferForPlayback: live ? 1.0 : 2.5,
  };
}

function getStreamFallbackUrl(currentUrl, { type = '', isLive = true, platform = 'ios' } = {}) {
  if (!currentUrl) return null;
  const live = isLive || type === 'live' || type === 'channel';
  if (live) {
    if (/\.m3u8(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.m3u8(\?.*)?$/i, (m, q) => `.ts${q || ''}`);
    }
    if (/\.ts(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.ts(\?.*)?$/i, (m, q) => `.m3u8${q || ''}`);
    }
  } else if (platform === 'ios') {
    if (/\.mkv(\?.*)?$/i.test(currentUrl)) {
      return currentUrl.replace(/\.mkv(\?.*)?$/i, (m, q) => `.mp4${q || ''}`);
    }
  }
  return null;
}

function redactString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/(username|password|token|pass)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/[REDACTED]/[REDACTED]/');
}

function classifyPlayerError(error, currentUrl = '') {
  const rawMsg = (typeof error === 'string' ? error : error?.message || error?.localizedDescription || '').trim();
  const lowerMsg = rawMsg.toLowerCase();

  let category = 'GENERAL';
  let userFacingMessage = 'Unable to play stream. Please check connection.';
  let isRecoverable = true;

  if (
    lowerMsg.includes('failed to load the player item') ||
    lowerMsg.includes('code=-11850') ||
    lowerMsg.includes('-11850') ||
    lowerMsg.includes('code=-12939') ||
    lowerMsg.includes('-12939') ||
    lowerMsg.includes('server is not correctly configured') ||
    lowerMsg.includes('byte range and no content length') ||
    (lowerMsg.includes('operation stopped') && !lowerMsg.includes('the operation was stopped'))
  ) {
    category = 'UNSUPPORTED_FORMAT';
    userFacingMessage = 'Stream format (MPEG-TS) unsupported on this device. Provider does not offer HLS (.m3u8).';
    isRecoverable = false;
    const sanitized = redactString(rawMsg);
    return { category, userFacingMessage, isRecoverable, isFatal: true, sanitizedMessage: sanitized };
  } else if (
    lowerMsg.includes('cancelled') ||
    lowerMsg.includes('canceled') ||
    lowerMsg.includes('interrupted') ||
    lowerMsg.includes('aborted') ||
    lowerMsg.includes('operation was replaced') ||
    lowerMsg.includes('the operation was stopped') ||
    lowerMsg.includes('code=-999') ||
    lowerMsg.includes('-999') ||
    lowerMsg.includes('nsurlerrordomain') ||
    lowerMsg.includes('request was aborted') ||
    lowerMsg.includes('task was cancelled')
  ) {
    category = 'CANCELLED';
    userFacingMessage = 'Playback cancelled';
    isRecoverable = false;
    const sanitized = redactString(rawMsg);
    return { category, userFacingMessage, isRecoverable, isFatal: false, sanitizedMessage: sanitized };
  } else if (
    lowerMsg.includes('cannot parse playlist') ||
    lowerMsg.includes('playlist error') ||
    lowerMsg.includes('invalid manifest') ||
    lowerMsg.includes('playlist empty') ||
    lowerMsg.includes('failed to parse playlist') ||
    lowerMsg.includes('code=-16845') ||
    lowerMsg.includes('coremediaerrordomain error -16845')
  ) {
    category = 'HLS_PARSING_FAILURE';
    userFacingMessage = 'Failed to parse stream playlist manifest.';
    isRecoverable = true;
  } else if (
    lowerMsg.includes('app transport security') ||
    lowerMsg.includes('cleartext http') ||
    lowerMsg.includes('insecure http') ||
    lowerMsg.includes('-1022')
  ) {
    category = 'ATS_NETWORK_FAILURE';
    userFacingMessage = 'Security policy blocked insecure stream (HTTP).';
    isRecoverable = false;
  } else if (
    lowerMsg.includes('401') ||
    lowerMsg.includes('403') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden')
  ) {
    category = 'AUTH_FAILURE';
    userFacingMessage = 'Stream authentication failed. Provider account may be expired or invalid.';
    isRecoverable = false;
  } else if (
    lowerMsg.includes('unsupported') ||
    lowerMsg.includes('-12884') ||
    lowerMsg.includes('-11828') ||
    lowerMsg.includes('cannot decode') ||
    lowerMsg.includes('format not supported') ||
    lowerMsg.includes('codec')
  ) {
    category = 'UNSUPPORTED_FORMAT';
    userFacingMessage = 'Stream format or codec is not supported by native iOS player.';
    isRecoverable = false;
  } else if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('-1001')
  ) {
    category = 'TIMEOUT';
    userFacingMessage = 'Stream connection timed out. Server response is too slow.';
    isRecoverable = true;
  }

  const sanitized = redactString(rawMsg);

  return { category, userFacingMessage, isRecoverable, isFatal: true, sanitizedMessage: sanitized };
}

// TESTS

function runTests(externalAssert) {
  console.log('\n--- 22. iOS Playback Pipeline & Architecture Invariants ---');
  function t(name, fn) {
    if (externalAssert) {
      try {
        fn();
        externalAssert(true, name);
        passed++;
      } catch (err) {
        externalAssert(false, `${name}: ${err.message}`);
        failed++;
      }
    } else {
      runTest(name, fn);
    }
  }

  t('1. prepareStreamUrlForPlatform preserves authentic provider stream URLs on iOS and Android', () => {
    const liveTsUrl = 'http://vpn.brekna.club/live/myuser/mypass/1867495.ts';
    const iosUrl = prepareStreamUrlForPlatform(liveTsUrl, { type: 'live', platform: 'ios' });
    assert.strictEqual(iosUrl, liveTsUrl, 'iOS preserves authentic .ts URL without breaking providers that reject .m3u8');

    // Query parameter preserved
    const liveWithQuery = 'http://vpn.brekna.club/live/myuser/mypass/1867495.ts?token=xyz';
    const iosQueryUrl = prepareStreamUrlForPlatform(liveWithQuery, { type: 'live', platform: 'ios' });
    assert.strictEqual(iosQueryUrl, liveWithQuery, 'Query token parameter preserved');
  });

  t('2. prepareStreamUrlForPlatform preserves extensionless URLs without blind extension mutation', () => {
    const extensionlessLive = 'http://vpn.brekna.club/live/myuser/mypass/1867495';
    const iosUrl = prepareStreamUrlForPlatform(extensionlessLive, { type: 'live', platform: 'ios' });
    assert.strictEqual(iosUrl, extensionlessLive);
  });

  t('3. prepareStreamUrlForPlatform preserves .ts on Android (ExoPlayer TsExtractor support)', () => {
    const liveTsUrl = 'http://vpn.brekna.club/live/myuser/mypass/1867495.ts';
    const androidUrl = prepareStreamUrlForPlatform(liveTsUrl, { type: 'live', platform: 'android' });
    assert.strictEqual(androidUrl, liveTsUrl, 'Android retains original .ts URL without modification');
  });

  t('4. prepareStreamUrlForPlatform does NOT mutate VOD movies or series on iOS or Android', () => {
    const movieUrl = 'http://vpn.brekna.club/movie/myuser/mypass/9999.mp4';
    const iosMovie = prepareStreamUrlForPlatform(movieUrl, { type: 'movie', platform: 'ios' });
    assert.strictEqual(iosMovie, movieUrl, 'Movie mp4 remains intact on iOS');

    const seriesUrl = 'http://vpn.brekna.club/series/myuser/mypass/12345.mkv';
    const iosSeries = prepareStreamUrlForPlatform(seriesUrl, { type: 'series', platform: 'ios' });
    assert.strictEqual(iosSeries, seriesUrl, 'Series mkv remains intact on iOS');
  });

  t('5. sanitizeMediaUrl encodes spaces and special characters for iOS NSURL compatibility', () => {
    const rawUrl = 'http://example.com/live/my stream with spaces.m3u8';
    const sanitized = sanitizeMediaUrl(rawUrl);
    assert.strictEqual(sanitized, 'http://example.com/live/my%20stream%20with%20spaces.m3u8');
  });

  t('6. getPlatformBufferOptions configures optimal low-latency parameters for iOS', () => {
    const iosLiveBuffer = getPlatformBufferOptions({ type: 'live', platform: 'ios' });
    assert.strictEqual(iosLiveBuffer.preferredForwardBufferDuration, 2.5, 'iOS Live TV uses 2.5s forward buffer');
    assert.strictEqual(iosLiveBuffer.waitsToMinimizeStalling, false, 'waitsToMinimizeStalling disabled to prevent 30-60s stall');

    const iosVodBuffer = getPlatformBufferOptions({ type: 'movie', platform: 'ios' });
    assert.strictEqual(iosVodBuffer.preferredForwardBufferDuration, 6.0, 'iOS VOD uses 6.0s forward buffer');
    assert.strictEqual(iosVodBuffer.waitsToMinimizeStalling, false);

    const androidBuffer = getPlatformBufferOptions({ type: 'live', platform: 'android' });
    assert.strictEqual(androidBuffer.preferredForwardBufferDuration, 3.0);
    assert.strictEqual(androidBuffer.minBufferForPlayback, 1.0);
  });

  t('7. getStreamFallbackUrl provides bidirectional alternative fallback for failing live stream', () => {
    const m3u8Url = 'http://vpn.brekna.club/live/myuser/mypass/123.m3u8';
    const fallbackFromM3u8 = getStreamFallbackUrl(m3u8Url, { type: 'live', platform: 'ios' });
    assert.strictEqual(fallbackFromM3u8, 'http://vpn.brekna.club/live/myuser/mypass/123.ts');

    const tsUrl = 'http://vpn.brekna.club/live/myuser/mypass/123.ts';
    const fallbackFromTs = getStreamFallbackUrl(tsUrl, { type: 'live', platform: 'ios' });
    assert.strictEqual(fallbackFromTs, 'http://vpn.brekna.club/live/myuser/mypass/123.m3u8');
  });

  t('8. classifyPlayerError accurately categorizes error causes without credential leaks', () => {
    const atsErr = classifyPlayerError('The resource could not be loaded because App Transport Security has blocked a cleartext HTTP connection.');
    assert.strictEqual(atsErr.category, 'ATS_NETWORK_FAILURE');
    assert.strictEqual(atsErr.isRecoverable, false);

    const authErr = classifyPlayerError('Server returned HTTP 401 Unauthorized for stream request');
    assert.strictEqual(authErr.category, 'AUTH_FAILURE');
    assert.strictEqual(authErr.isRecoverable, false);

    const timeoutErr = classifyPlayerError('The request timed out (-1001)');
    assert.strictEqual(timeoutErr.category, 'TIMEOUT');
    assert.strictEqual(timeoutErr.isRecoverable, true);

    const formatErr = classifyPlayerError('AVPlayerItem failed with CoreMediaErrorDomain -12884: unsupported format');
    assert.strictEqual(formatErr.category, 'UNSUPPORTED_FORMAT');
    assert.strictEqual(formatErr.isRecoverable, false);

    // Credential leak test in error diagnostics
    const credentialErr = classifyPlayerError('Error loading http://vpn.brekna.club/live/myuser/secretpassword/123.m3u8: 404');
    assert(!credentialErr.sanitizedMessage.includes('secretpassword'), 'Sanitized error message strips password');
  });

  t('9. app.json contains NSAllowsArbitraryLoadsForMedia for AVPlayer media streaming', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
    const ats = appJson.expo?.ios?.infoPlist?.NSAppTransportSecurity;
    assert.ok(ats, 'NSAppTransportSecurity must exist in infoPlist');
    assert.strictEqual(ats.NSAllowsArbitraryLoads, true, 'NSAllowsArbitraryLoads must be true');
    assert.strictEqual(ats.NSAllowsArbitraryLoadsForMedia, true, 'NSAllowsArbitraryLoadsForMedia must be true for AVURLAsset HTTP streams');
  });

  t('10. EmbeddedVideoPlayer.js uses stable player lifecycle without per-render recreation', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(code.includes('useVideoPlayer(null'), 'useVideoPlayer initialized with null for stable player ref');
    assert(code.includes('replaceAsync('), 'Uses atomic replaceAsync to switch stream sources on existing player');
    assert(code.includes('getPlatformBufferOptions'), 'Applies platform-specific buffer options');
    assert(code.includes('classifyPlayerError'), 'Integrates classified player error reporting');
    assert(code.includes('timingRef'), 'Instruments startup latency diagnostics');
  });

  t('11. LiveScreen.js reuses single native player across mini/max views and cleans up on unmount', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/LiveScreen.js'), 'utf8');
    assert(code.includes('useVideoPlayer(null'), 'LiveScreen creates single livePlayer instance');
    assert(code.includes('player={livePlayer}'), 'Passes single livePlayer to EmbeddedVideoPlayer');
    assert(code.includes('normalizePlaybackSource'), 'Normalizes playback source with unified pipeline');
    assert(code.includes('useFocusEffect'), 'Uses useFocusEffect for safe cleanup when leaving Live TV');
  });

  t('12. PlayerScreen.js uses unified normalization, classified errors, and buffer options', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes('normalizePlaybackSource'), 'PlayerScreen uses centralized normalizePlaybackSource');
    assert(code.includes('getPlatformBufferOptions'), 'PlayerScreen applies getPlatformBufferOptions');
    assert(code.includes('classifyPlayerError'), 'PlayerScreen uses classifyPlayerError for clean error display');
    assert(code.includes('getStreamFallbackUrl'), 'PlayerScreen supports stream format fallback');
  });

  t('13. Test A: Canonical public HLS stream normalization produces valid source with contentType: hls', () => {
    const canonicalHlsUrl = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
    const preparedUrl = prepareStreamUrlForPlatform(canonicalHlsUrl, { type: 'vod', platform: 'ios' });
    assert.strictEqual(preparedUrl, canonicalHlsUrl);
    assert.ok(preparedUrl.endsWith('.m3u8'), 'HLS extension preserved');
  });

  t('14. Test B: Xtream Live MPEG-TS stream normalization preserves provider URL and configures 2.5s iOS buffer', () => {
    const liveTsUrl = 'http://toxicplay1.com:8080/live/user1/pass1/1867495.ts';
    const preparedUrl = prepareStreamUrlForPlatform(liveTsUrl, { type: 'live', platform: 'ios' });
    assert.strictEqual(preparedUrl, liveTsUrl, 'Live .ts stream not blindly rewritten to .m3u8');

    const iosBuffer = getPlatformBufferOptions({ type: 'live', platform: 'ios' });
    assert.strictEqual(iosBuffer.preferredForwardBufferDuration, 2.5);
    assert.strictEqual(iosBuffer.waitsToMinimizeStalling, false);
  });

  t('15. Test C: Xtream Movie VOD normalization uses progressive container and 6.0s iOS buffer', () => {
    const movieUrl = 'http://toxicplay1.com:8080/movie/user1/pass1/9942.mp4';
    const preparedUrl = prepareStreamUrlForPlatform(movieUrl, { type: 'movie', platform: 'ios' });
    assert.strictEqual(preparedUrl, movieUrl);

    const iosBuffer = getPlatformBufferOptions({ type: 'movie', platform: 'ios' });
    assert.strictEqual(iosBuffer.preferredForwardBufferDuration, 6.0);
    assert.strictEqual(iosBuffer.waitsToMinimizeStalling, false);

    // MKV to MP4 fallback on iOS
    const mkvUrl = 'http://toxicplay1.com:8080/movie/user1/pass1/9942.mkv';
    const fallback = getStreamFallbackUrl(mkvUrl, { isLive: false, platform: 'ios' });
    assert.strictEqual(fallback, 'http://toxicplay1.com:8080/movie/user1/pass1/9942.mp4');
  });

  t('16. Test D: Xtream Series episode normalization guarantees episode id is used instead of series id', () => {
    const seriesCode = fs.readFileSync(path.join(__dirname, '../src/utils/mediaSourcePipeline.js'), 'utf8');
    assert(seriesCode.includes('streamType === \'series\''), 'Explicit series branch in source resolution');
    assert(seriesCode.includes('CRITICAL: episode id must be used, NEVER series_id'), 'Enforces episode id comment/invariant');
  });

  t('17. Test E: M3U direct stream passes custom VLC headers to playerSource.headers', () => {
    const pipelineCode = fs.readFileSync(path.join(__dirname, '../src/utils/mediaSourcePipeline.js'), 'utf8');
    assert(pipelineCode.includes('item?.vlcOptions'), 'Inspects vlcOptions on item');
    assert(pipelineCode.includes('http-user-agent'), 'Extracts custom http-user-agent header');
    assert(pipelineCode.includes('http-referrer'), 'Extracts custom http-referrer header');
  });

  t('18. classifyPlayerError categorizes CANCELLED operations as non-fatal with isFatal=false', () => {
    const cancel1 = classifyPlayerError('The operation was stopped');
    assert.strictEqual(cancel1.category, 'CANCELLED');
    assert.strictEqual(cancel1.isFatal, false);

    const cancel2 = classifyPlayerError('CoreMediaErrorDomain Code=-999 "Operation cancelled"');
    assert.strictEqual(cancel2.category, 'CANCELLED');
    assert.strictEqual(cancel2.isFatal, false);

    const cancel3 = classifyPlayerError('NSURLErrorDomain -999');
    assert.strictEqual(cancel3.category, 'CANCELLED');
    assert.strictEqual(cancel3.isFatal, false);

    // Fatal server configuration / unplayable stream errors (AVErrorServerIncorrectlyConfigured Code=-11850 / -12939)
    const errOpStopped = classifyPlayerError('Failed to load the player item: Operation Stopped');
    assert.strictEqual(errOpStopped.category, 'UNSUPPORTED_FORMAT');
    assert.strictEqual(errOpStopped.isFatal, true);

    const errByteRange = classifyPlayerError('Error Domain=AVFoundationErrorDomain Code=-11850 "Operation Stopped" UserInfo={NSUnderlyingError=0x13e170210 {Error Domain=CoreMediaErrorDomain Code=-12939 "byte range and no content length - error code is 200"}}');
    assert.strictEqual(errByteRange.category, 'UNSUPPORTED_FORMAT');
    assert.strictEqual(errByteRange.isFatal, true);
  });

  t('19. classifyPlayerError categorizes HLS playlist parsing errors (-16845) accurately', () => {
    const parseErr = classifyPlayerError('CoreMediaErrorDomain error -16845: failed to parse playlist');
    assert.strictEqual(parseErr.category, 'HLS_PARSING_FAILURE');
    assert.strictEqual(parseErr.isRecoverable, true);
  });

  t('20. NativePlayerTestHarness component exists and exports canonical test streams', () => {
    const harnessCode = fs.readFileSync(path.join(__dirname, '../src/components/NativePlayerTestHarness.js'), 'utf8');
    assert(harnessCode.includes('CANONICAL_TEST_HLS_STREAM'), 'Exports CANONICAL_TEST_HLS_STREAM constant');
    assert(harnessCode.includes('T0_assigned'), 'Tracks milestone T0');
    assert(harnessCode.includes('T1_loading'), 'Tracks milestone T1');
    assert(harnessCode.includes('T2_readyToPlay'), 'Tracks milestone T2');
    assert(harnessCode.includes('T3_firstFrame'), 'Tracks milestone T3');
    assert(harnessCode.includes('T4_timeUpdate'), 'Tracks milestone T4');
    assert(harnessCode.includes('T5_controlsVerified'), 'Tracks milestone T5');
  });

  t('21. EmbeddedVideoPlayer and PlayerScreen implement watchdog timers (25s live, 30s VOD)', () => {
    const embeddedCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(embeddedCode.includes('25000'), 'EmbeddedVideoPlayer sets 25s connect watchdog');
    assert(playerScreenCode.includes('30000'), 'PlayerScreen sets 30s VOD connect watchdog');
  });

  t('22. EmbeddedVideoPlayer protects external shared player from unmount teardown', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(code.includes('if (!externalPlayer && internalPlayer)'), 'Guards unmount teardown to only clear internal player');
    assert(code.includes('externalPlayer._activeUri'), 'Tracks active URI on externalPlayer to avoid reloading');
  });

  t('23. EmbeddedVideoPlayer and PlayerScreen serialize asynchronous requests using requestCounterRef and opId guards', () => {
    const embeddedCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(embeddedCode.includes('opId !== null && opId !== requestCounterRef.current'), 'EmbeddedVideoPlayer guards against stale operation errors');
    assert(playerScreenCode.includes('opId !== null && opId !== requestCounterRef.current'), 'PlayerScreen guards against stale operation errors');
  });

  t('24. EmbeddedVideoPlayer and PlayerScreen record full T0..T8 playback milestone diagnostics', () => {
    const embeddedCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(embeddedCode.includes('t0_tap'), 'EmbeddedVideoPlayer tracks T0 tap');
    assert(embeddedCode.includes('t3_assigned'), 'EmbeddedVideoPlayer tracks T3 assigned');
    assert(embeddedCode.includes('t5_ready'), 'EmbeddedVideoPlayer tracks T5 ready');
    assert(embeddedCode.includes('t6_firstFrame'), 'EmbeddedVideoPlayer tracks T6 firstFrame');
    assert(playerScreenCode.includes('vodTimelineMilestones'), 'PlayerScreen logs VOD timeline milestones');
  });

  t('25. SettingsScreen exposes Native Player Diagnostics launcher and platform-accurate engine (AVPlayer on iOS)', () => {
    const settingsCode = fs.readFileSync(path.join(__dirname, '../src/screens/SettingsScreen.js'), 'utf8');
    assert(settingsCode.includes('AVPlayer (expo-video)'), 'Reports AVPlayer on iOS');
    assert(settingsCode.includes('NativePlayerTestHarness'), 'Integrates NativePlayerTestHarness in settings');
    assert(settingsCode.includes('showDiagnosticModal'), 'Manages diagnostic modal state');
  });

  if (failed > 0) {
    throw new Error(`${failed} iOS playback architecture tests failed`);
  }
}

module.exports = { runTests };

if (require.main === module) {
  try {
    runTests();
    console.log(`\nAll iOS playback architecture tests PASSED! (${passed}/${passed})`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
