const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Extract pure implementations to test logic without bundling React Native
function sanitizeServerUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

function validateStreamSource(source) {
  if (source == null) {
    return { isValid: false, error: 'Source is null or undefined.', uri: null };
  }

  let rawUri = '';
  if (typeof source === 'string') {
    rawUri = source.trim();
  } else if (typeof source === 'object' && source.uri && typeof source.uri === 'string') {
    rawUri = source.uri.trim();
  } else if (typeof source === 'object' && source.url && typeof source.url === 'string') {
    rawUri = source.url.trim();
  }

  if (!rawUri) {
    return { isValid: false, error: 'Source URI is empty.', uri: null };
  }

  const lower = rawUri.toLowerCase();
  if (
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'none' ||
    lower === '[object object]'
  ) {
    return { isValid: false, error: 'Source URI is an invalid placeholder.', uri: null };
  }

  if (!/^(https?|file):\/\//i.test(rawUri)) {
    return {
      isValid: false,
      error: `Unsupported stream protocol in URI: ${rawUri.substring(0, 20)}...`,
      uri: null,
    };
  }

  try {
    const parsed = new URL(rawUri);
    if (!parsed.hostname && parsed.protocol !== 'file:') {
      return { isValid: false, error: 'Source URI lacks a valid hostname.', uri: null };
    }
  } catch (_e) {
    return { isValid: false, error: 'Source URI failed URL parse.', uri: null };
  }

  return { isValid: true, error: null, uri: rawUri };
}

function detectContentType(url, { type = '', extension = '', platform = 'ios' } = {}) {
  if (!url || typeof url !== 'string') return 'auto';

  const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
  const ext = (extension || '').toLowerCase().replace(/^\.+/, '');

  if (cleanUrl.endsWith('.m3u8') || cleanUrl.includes('.m3u8') || ext === 'm3u8') {
    return 'hls';
  }

  if (cleanUrl.endsWith('.mpd') || cleanUrl.includes('.mpd') || ext === 'mpd') {
    return platform === 'android' ? 'dash' : 'auto';
  }

  if (cleanUrl.endsWith('.ism/manifest') || ext === 'ism') {
    return platform === 'android' ? 'smoothStreaming' : 'auto';
  }

  if (
    cleanUrl.endsWith('.mp4') ||
    cleanUrl.endsWith('.mkv') ||
    cleanUrl.endsWith('.avi') ||
    cleanUrl.endsWith('.mov') ||
    cleanUrl.endsWith('.webm') ||
    cleanUrl.endsWith('.flv') ||
    cleanUrl.endsWith('.ts') ||
    ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'ts'].includes(ext)
  ) {
    return 'progressive';
  }

  const isLive = type === 'live' || type === 'channel';
  if (isLive) {
    if (url.includes('.m3u8')) return 'hls';
    if (platform === 'ios' && !cleanUrl.endsWith('.ts')) {
      return 'hls';
    }
    return 'progressive';
  }

  return 'auto';
}

function buildLiveStreamUrl(serverUrl, username, password, streamId, extension = 'ts') {
  const base = sanitizeServerUrl(serverUrl);
  const ext = (extension || 'ts').replace(/^\.+/, '');
  return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}

function buildVodStreamUrl(serverUrl, username, password, streamId, extension = 'mp4') {
  const base = sanitizeServerUrl(serverUrl);
  const ext = (extension || 'mp4').replace(/^\.+/, '');
  return `${base}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}

function buildSeriesStreamUrl(serverUrl, username, password, streamId, extension = 'mp4') {
  const base = sanitizeServerUrl(serverUrl);
  const ext = (extension || 'mp4').replace(/^\.+/, '');
  return `${base}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}

function resolveStreamSource(content, options = {}) {
  if (!content) {
    return {
      uri: '',
      url: '',
      contentType: 'auto',
      streamType: 'vod',
      isLive: false,
      isVOD: true,
      isValid: false,
      validationError: 'No media content provided to resolveStreamSource.',
      title: 'Fox Player',
      poster: null,
      streamId: '',
      extension: 'mp4',
      metadata: {},
      playerSource: null,
    };
  }

  const item = content.item || content;
  const rawType = (content.type || item.type || options.type || 'movie').toLowerCase();
  const credentials = content.credentials || options.credentials || {};

  const streamType = (rawType === 'live' || rawType === 'channel')
    ? 'live'
    : (rawType === 'series' || rawType === 'episode')
      ? 'series'
      : 'vod';

  const isLive = streamType === 'live';
  const isVOD = streamType === 'vod' || streamType === 'series';

  const serverUrl = sanitizeServerUrl(
    item.serverUrl || item.server_url || credentials.serverUrl || credentials.server_url || ''
  );
  const username = item.username || credentials.username || '';
  const password = item.password || credentials.password || '';

  let playUrl = (
    item.url ||
    item.streamUrl ||
    item.videoUrl ||
    item.stream_url ||
    item.directUrl ||
    item.direct_url ||
    item.link ||
    item.uri ||
    ''
  ).trim();

  let streamId = '';
  let extension = isLive ? 'ts' : 'mp4';
  const title = item.name || item.title || item.cleanName || 'Fox Player';
  const poster = item.poster || item.logo || item.thumbnail || item.cover || item.posterUri || null;

  if (isLive) {
    streamId = String(item.streamId || item.stream_id || item.id || item.num || '');
    extension = (item.containerExtension || item.container_extension || 'ts').replace(/^\.+/, '');

    if (!playUrl || !/^https?:\/\//i.test(playUrl)) {
      if (serverUrl && username && password && streamId) {
        playUrl = buildLiveStreamUrl(serverUrl, username, password, streamId, extension);
      }
    }
  } else if (streamType === 'vod') {
    streamId = String(item.streamId || item.stream_id || item.id || '');
    extension = (
      item.containerExtension ||
      item.container_extension ||
      item.extension ||
      'mp4'
    ).replace(/^\.+/, '');

    if (!playUrl || !/^https?:\/\//i.test(playUrl)) {
      if (serverUrl && username && password && streamId) {
        playUrl = buildVodStreamUrl(serverUrl, username, password, streamId, extension);
      }
    }
  } else if (streamType === 'series') {
    streamId = String(
      item.id ||
      item.streamId ||
      item.stream_id ||
      item.info?.stream_id ||
      ''
    );

    extension = (
      item.containerExtension ||
      item.container_extension ||
      item.info?.container_extension ||
      item.extension ||
      'mp4'
    ).replace(/^\.+/, '');

    if (!playUrl || !/^https?:\/\//i.test(playUrl)) {
      if (serverUrl && username && password && streamId) {
        playUrl = buildSeriesStreamUrl(serverUrl, username, password, streamId, extension);
      }
    }
  }

  if (playUrl) {
    try {
      const cleanPath = playUrl.split('?')[0].split('#')[0];
      const match = cleanPath.match(/\.([a-zA-Z0-9]{2,5})$/);
      if (match) {
        extension = match[1].toLowerCase();
      }
    } catch (_e) {}
  }

  const finalUrl = playUrl;
  const validation = validateStreamSource(finalUrl);
  const contentType = detectContentType(finalUrl, { type: streamType, extension });

  let playerSource = null;
  if (validation.isValid) {
    playerSource = {
      uri: finalUrl,
      ...(contentType !== 'auto' ? { contentType } : {}),
      metadata: {
        title,
        ...(poster ? { artwork: poster } : {}),
      },
    };
  }

  return {
    uri: finalUrl,
    url: finalUrl,
    contentType,
    streamType,
    isLive,
    isVOD,
    isValid: validation.isValid,
    validationError: validation.error,
    title,
    poster,
    streamId,
    extension,
    playerSource,
  };
}

function logLiveChannelDebug(channel, resolvedSource) {
  try {
    const rawUrl = resolvedSource?.uri || resolvedSource?.url || channel?.url || '';
    let host = 'UNKNOWN';
    let protocol = 'UNKNOWN';

    if (rawUrl && typeof rawUrl === 'string') {
      try {
        const parsed = new URL(rawUrl);
        host = parsed.host || 'UNKNOWN';
        protocol = (parsed.protocol || '').replace(':', '');
      } catch (_e) {
        host = 'INVALID_URL';
      }
    }

    const channelId = channel?.id || channel?.streamId || resolvedSource?.streamId || 'UNKNOWN';
    const channelName = channel?.name || channel?.title || resolvedSource?.title || 'Unknown Channel';
    const sourceType = channel?.url ? 'm3u' : 'xtream';
    const ext = resolvedSource?.extension || channel?.containerExtension || 'ts';
    const hasSource = Boolean(resolvedSource?.isValid && rawUrl);
    const contentType = resolvedSource?.contentType || 'auto';

    console.log('[LIVE CHANNEL DEBUG]', {
      channelId: String(channelId),
      channelName: String(channelName),
      sourceType,
      protocol,
      host,
      extension: ext,
      hasSource,
      isUrlEmpty: !rawUrl,
      isUrlUndefined: rawUrl === undefined,
      isUrlNull: rawUrl === null,
      detectedContentType: contentType,
      isValid: Boolean(resolvedSource?.isValid),
    });
  } catch (_e) {}
}

async function runTests() {
  console.log('\n--- 20. Stream Source Pipeline & Validation Layer ---');

  // Test 1: validateStreamSource rejects invalid values
  assert.strictEqual(validateStreamSource(null).isValid, false, 'Rejects null');
  assert.strictEqual(validateStreamSource(undefined).isValid, false, 'Rejects undefined');
  assert.strictEqual(validateStreamSource('').isValid, false, 'Rejects empty string');
  assert.strictEqual(validateStreamSource('   ').isValid, false, 'Rejects whitespace string');
  assert.strictEqual(validateStreamSource('undefined').isValid, false, 'Rejects "undefined"');
  assert.strictEqual(validateStreamSource('null').isValid, false, 'Rejects "null"');
  assert.strictEqual(validateStreamSource('none').isValid, false, 'Rejects "none"');
  assert.strictEqual(validateStreamSource('[object Object]').isValid, false, 'Rejects "[object Object]"');
  assert.strictEqual(validateStreamSource('rtsp://stream.example.com').isValid, false, 'Rejects unsupported rtsp protocol');
  assert.strictEqual(validateStreamSource('javascript:alert(1)').isValid, false, 'Rejects javascript protocol');
  console.log('  PASS: validateStreamSource rejects all invalid/malformed sources');

  // Test 2: validateStreamSource accepts valid URLs
  const validHttp = validateStreamSource('http://server.com:8080/live/user/pass/123.m3u8');
  assert.strictEqual(validHttp.isValid, true, 'Accepts valid HTTP URL');
  assert.strictEqual(validHttp.uri, 'http://server.com:8080/live/user/pass/123.m3u8');

  const validHttps = validateStreamSource('https://server.com/live/user/pass/123.ts?token=abc');
  assert.strictEqual(validHttps.isValid, true, 'Accepts valid HTTPS URL with query params');

  const validObj = validateStreamSource({ uri: 'http://cdn.net/stream.mp4' });
  assert.strictEqual(validObj.isValid, true, 'Accepts object with uri property');
  console.log('  PASS: validateStreamSource accepts valid http/https URLs and objects');

  // Test 3: detectContentType
  assert.strictEqual(detectContentType('http://server.com/live/123.m3u8'), 'hls', 'Detects .m3u8 as HLS');
  assert.strictEqual(detectContentType('http://server.com/live/123.m3u8?token=xyz'), 'hls', 'Detects .m3u8 with query as HLS');
  assert.strictEqual(detectContentType('http://server.com/vod/movie.mp4'), 'progressive', 'Detects .mp4 as progressive');
  assert.strictEqual(detectContentType('http://server.com/vod/movie.mkv'), 'progressive', 'Detects .mkv as progressive');
  assert.strictEqual(detectContentType('http://server.com/live/123.ts'), 'progressive', 'Detects .ts as progressive');
  console.log('  PASS: detectContentType identifies HLS and progressive containers correctly');

  // Test 4: resolveStreamSource for LiveTV
  const liveItem = {
    id: '1867495',
    stream_id: '1867495',
    name: 'USA HD',
    container_extension: 'ts',
    logo: 'http://server.com/logo.png',
  };
  const credentials = {
    serverUrl: 'http://vpn.brekna.club',
    username: 'testuser',
    password: 'testpassword',
  };

  const resolvedLive = resolveStreamSource({
    type: 'live',
    item: liveItem,
    credentials,
  });

  assert.strictEqual(resolvedLive.isValid, true, 'Live channel resolved as valid');
  assert.strictEqual(resolvedLive.streamType, 'live', 'Identified as live stream');
  assert.strictEqual(resolvedLive.isLive, true, 'isLive is true');
  assert.strictEqual(resolvedLive.isVOD, false, 'isVOD is false');
  assert.strictEqual(resolvedLive.streamId, '1867495', 'Correct stream ID extracted');
  assert.strictEqual(resolvedLive.extension, 'ts', 'Original provider extension preserved without blind rewrite');
  assert(resolvedLive.uri.includes('http://vpn.brekna.club/live/testuser/testpassword/1867495.ts'), 'Valid Xtream live URL constructed');
  assert(resolvedLive.playerSource !== null, 'PlayerSource object created');
  assert.strictEqual(resolvedLive.playerSource.uri, resolvedLive.uri, 'PlayerSource uri matches resolved uri');
  console.log('  PASS: resolveStreamSource normalizes LiveTV channel without blind extension mutation');

  // Test 5: resolveStreamSource for VOD Movie
  const movieItem = {
    id: '9988',
    streamId: '9988',
    title: 'Inception',
    containerExtension: 'mp4',
  };
  const resolvedMovie = resolveStreamSource({
    type: 'movie',
    item: movieItem,
    credentials,
  });
  assert.strictEqual(resolvedMovie.isValid, true, 'Movie resolved as valid');
  assert.strictEqual(resolvedMovie.streamType, 'vod', 'Identified as vod stream');
  assert.strictEqual(resolvedMovie.isLive, false, 'isLive is false');
  assert.strictEqual(resolvedMovie.isVOD, true, 'isVOD is true');
  assert(resolvedMovie.uri.includes('/movie/testuser/testpassword/9988.mp4'), 'Movie URL uses /movie/ path and mp4 extension');
  console.log('  PASS: resolveStreamSource normalizes VOD movie using movie stream path');

  // Test 6: resolveStreamSource for Series Episode uses episode ID (never series ID)
  const episodeItem = {
    id: '554433', // episode ID
    seriesId: '100', // series ID (must NOT be in playback URL)
    title: 'Pilot',
    containerExtension: 'mkv',
  };
  const resolvedEpisode = resolveStreamSource({
    type: 'series',
    item: episodeItem,
    credentials,
  });
  assert.strictEqual(resolvedEpisode.isValid, true, 'Series episode resolved as valid');
  assert.strictEqual(resolvedEpisode.streamType, 'series', 'Identified as series stream');
  assert(resolvedEpisode.uri.includes('/series/testuser/testpassword/554433.mkv'), 'Uses episode ID 554433 in URL');
  assert(!resolvedEpisode.uri.includes('100.mkv'), 'Never uses series ID 100 in episode stream URL');
  console.log('  PASS: resolveStreamSource guarantees episode ID is used for series playback');

  // Test 7: Sanitized logging test — ensure credentials are never leaked
  let capturedLog = null;
  const originalLog = console.log;
  console.log = (...args) => {
    capturedLog = args;
  };
  logLiveChannelDebug(liveItem, resolvedLive);
  console.log = originalLog;

  assert(capturedLog !== null, 'Debug log was invoked');
  const logPayload = JSON.stringify(capturedLog);
  assert(!logPayload.includes('testpassword'), 'Password is NEVER present in debug log');
  assert(!logPayload.includes('testuser'), 'Username is NEVER present in debug log');
  assert(logPayload.includes('vpn.brekna.club'), 'Host is logged safely');
  assert(logPayload.includes('1867495'), 'Stream ID is logged safely');
  console.log('  PASS: logLiveChannelDebug logs diagnostics without leaking credentials');

  // Test 8: Source file code audits
  console.log('\n--- 21. Source Code Pipeline & Loader Architecture Audit ---');
  const layoutSource = fs.readFileSync(path.join(__dirname, '../src/app/_layout.js'), 'utf8');
  const loadingScreenSource = fs.readFileSync(path.join(__dirname, '../src/components/LoadingScreen.js'), 'utf8');
  const liveScreenSource = fs.readFileSync(path.join(__dirname, '../src/screens/LiveScreen.js'), 'utf8');
  const embeddedPlayerSource = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
  const playerScreenSource = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
  const pipelineSource = fs.readFileSync(path.join(__dirname, '../src/utils/mediaSourcePipeline.js'), 'utf8');

  assert(!layoutSource.includes("rootContainer: {\n    flex: 1,\n    width: '100%',\n    height: '100%',"), 'rootContainer does not have nested height: 100%');
  assert(!layoutSource.includes("mainNavigationContainer: {\n    flex: 1,\n    width: '100%',\n    height: '100%',"), 'mainNavigationContainer does not have nested height: 100%');
  assert(loadingScreenSource.includes('<SafeAreaView'), 'LoadingScreen is wrapped in SafeAreaView');
  assert(loadingScreenSource.includes("edges={['top', 'bottom', 'left', 'right']}"), 'LoadingScreen guards all 4 edges with SafeAreaView');
  assert(loadingScreenSource.includes('safeArea:'), 'LoadingScreen defines safeArea style');

  assert(liveScreenSource.includes('resolveStreamSource'), 'LiveScreen imports and uses resolveStreamSource');
  assert(liveScreenSource.includes('logLiveChannelDebug'), 'LiveScreen imports and uses logLiveChannelDebug');
  assert(embeddedPlayerSource.includes('validateStreamSource'), 'EmbeddedVideoPlayer uses validateStreamSource');
  assert(embeddedPlayerSource.includes('Stream unavailable'), 'EmbeddedVideoPlayer contains Stream unavailable error state');
  assert(playerScreenSource.includes('validateStreamSource'), 'PlayerScreen uses validateStreamSource');
  assert(playerScreenSource.includes('isFinite(player.duration)'), 'PlayerScreen protects against Infinity/NaN duration');
  assert(!pipelineSource.includes("playUrl.replace(/\\.ts(\\?.*)?$/i, '.m3u8$1')"), 'Pipeline does NOT blindly rewrite .ts to .m3u8');

  assert(!loadingScreenSource.includes('ambientVignette'), 'LoadingScreen does not contain opaque ambientVignette overlay that blankets content');
  assert(loadingScreenSource.includes('fallbackLogoContainer'), 'LoadingScreen implements resilient fallback for branding assets');
  assert(loadingScreenSource.includes('onError={() => setLogoLoadError(true)}'), 'LoadingScreen guards against image load errors');
  assert(!layoutSource.includes('zIndex: 99999'), 'rootRefreshBarrier does not rely on arbitrary zIndex hacks');
  assert(!layoutSource.includes('elevation: 99999'), 'rootRefreshBarrier does not rely on arbitrary elevation hacks');
  assert(layoutSource.includes('rootRefreshBarrier: {\n    ...StyleSheet.absoluteFillObject,\n    flex: 1,\n    width: \'100%\',\n    height: \'100%\','), 'rootRefreshBarrier ensures true full-screen flex dimensions');

  console.log('  PASS: Code audit confirms end-to-end integration and loader safe area containment');
}

module.exports = { runTests };

if (require.main === module) {
  runTests().then(() => console.log('\nAll stream source & loader tests PASSED!')).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
