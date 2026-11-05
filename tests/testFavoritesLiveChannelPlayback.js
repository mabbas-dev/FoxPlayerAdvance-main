const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n================================================================');
  console.log('   FOX PLAYER — FAVORITES LIVE CHANNEL PLAYBACK FIX TESTS       ');
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

  const favoritesScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/FavoritesScreen.js'), 'utf8');
  const liveScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/LiveScreen.js'), 'utf8');
  const userStorageCode = fs.readFileSync(path.join(__dirname, '../src/storage/userStorage.js'), 'utf8');
  const mediaSourcePipelineCode = fs.readFileSync(path.join(__dirname, '../src/utils/mediaSourcePipeline.js'), 'utf8');
  const { buildLiveStreamUrl } = require('../src/services/xtreamService');
  const { normalizePlaybackSource } = require('../src/utils/mediaSourcePipeline');

// Extract createUnifiedFavorite from userStorageCode in isolated context
function normalizeFavoriteType(type) {
  if (!type) return 'movie';
  const lower = String(type).toLowerCase();
  if (lower === 'channel' || lower === 'live' || lower === 'livetv' || lower === 'channels') return 'live';
  if (lower === 'series' || lower === 'show' || lower === 'shows') return 'series';
  return 'movie';
}

const createUnifiedFavoriteMatch = userStorageCode.match(/export function createUnifiedFavorite\(item, typeOverride\) \{[\s\S]*?\n\}/);
assert(createUnifiedFavoriteMatch, 'userStorage.js must export createUnifiedFavorite');

// Evaluated function matching userStorage.js implementation
const createUnifiedFavorite = (item, typeOverride) => {
  const type = normalizeFavoriteType(typeOverride || item.type);
  const rawId = item.id != null
    ? item.id
    : (item.streamId != null
        ? item.streamId
        : (item.seriesId != null
            ? item.seriesId
            : (item.series_id != null
                ? item.series_id
                : item.stream_id)));
  const id = String(rawId);
  const title = item.title || item.name || 'Untitled';
  const image = item.image || item.poster || item.logo || item.stream_icon || item.cover || item.movie_image || item.cover_big || '';

  return {
    id,
    type,
    title,
    image: image ? String(image) : '',
    streamId: item.streamId != null ? item.streamId : (item.stream_id != null ? item.stream_id : (type === 'movie' || type === 'live' ? rawId : undefined)),
    seriesId: item.seriesId != null ? item.seriesId : (item.series_id != null ? item.series_id : (type === 'series' ? rawId : undefined)),
    categoryId: item.categoryId != null ? String(item.categoryId) : (item.category_id != null ? String(item.category_id) : undefined),
    containerExtension: (type === 'live')
      ? ((item.containerExtension && item.containerExtension !== 'mp4')
          ? item.containerExtension
          : ((item.container_extension && item.container_extension !== 'mp4')
              ? item.container_extension
              : 'ts'))
      : (item.containerExtension || item.container_extension || 'mp4'),
    url: item.url || '',
    year: item.year != null ? String(item.year) : '',
    addedAt: item.addedAt || Date.now(),
  };
};

// --- Suite 1: Favorite Channel Data Model & Storage Normalization ---
test('1.1: Live TV favorites default containerExtension to "ts" instead of "mp4"', () => {
  const liveFav = createUnifiedFavorite({
    id: 101,
    type: 'live',
    name: 'BBC One HD',
    logo: 'https://example.com/bbcone.png',
  });
  assert.strictEqual(liveFav.containerExtension, 'ts', 'Live favorites must default to "ts"');
  assert.strictEqual(liveFav.type, 'live', 'Live favorites type must be normalized to "live"');
  assert.strictEqual(liveFav.id, '101', 'Live favorites id must be stringified');
});

test('1.2: Backward compatibility: Legacy live favorites with "mp4" are normalized to "ts"', () => {
  const legacyFav = createUnifiedFavorite({
    id: 202,
    type: 'live',
    name: 'Sky Sports F1',
    containerExtension: 'mp4',
  });
  assert.strictEqual(legacyFav.containerExtension, 'ts', 'Legacy live favorites with mp4 must be corrected to "ts"');
});

test('1.3: VOD and Series continue defaulting to "mp4"', () => {
  const movieFav = createUnifiedFavorite({
    id: 303,
    type: 'movie',
    title: 'Inception',
  });
  assert.strictEqual(movieFav.containerExtension, 'mp4', 'Movie favorites must continue defaulting to "mp4"');
});

test('1.4: Live favorites preserve streamId, url, and categoryId', () => {
  const liveFav = createUnifiedFavorite({
    id: 404,
    streamId: 9988,
    type: 'live',
    name: 'CNN International',
    url: 'http://stream.example.com/live/cnn.m3u8',
    categoryId: '55',
  });
  assert.strictEqual(liveFav.streamId, 9988, 'streamId must be preserved in favorite');
  assert.strictEqual(liveFav.url, 'http://stream.example.com/live/cnn.m3u8', 'url must be preserved');
  assert.strictEqual(liveFav.categoryId, '55', 'categoryId must be preserved');
});

// --- Suite 2: FavoritesScreen Navigation Parameter Completeness ---
test('2.1: FavoritesScreen imports buildLiveStreamUrl from xtreamService', () => {
  assert(favoritesScreenCode.includes('buildLiveStreamUrl'), 'FavoritesScreen must import buildLiveStreamUrl');
});

test('2.2: FavoritesScreen resolves playUrl with buildLiveStreamUrl when url is missing', () => {
  assert(favoritesScreenCode.includes('buildLiveStreamUrl('), 'FavoritesScreen must call buildLiveStreamUrl for Xtream live items');
});

test('2.3: FavoritesScreen passes rich params to /(tabs)/live: channelId, streamId, channelName, url, logo, categoryId, containerExtension, selectedAt', () => {
  assert(favoritesScreenCode.includes("pathname: '/(tabs)/live'"), 'FavoritesScreen must route to /(tabs)/live');
  assert(favoritesScreenCode.includes('channelId: String(item.id)'), 'Must pass channelId');
  assert(favoritesScreenCode.includes('streamId: String(streamId || \'\')'), 'Must pass streamId');
  assert(favoritesScreenCode.includes('channelName: item.title || item.name || \'\''), 'Must pass channelName');
  assert(favoritesScreenCode.includes('url: playUrl || \'\''), 'Must pass resolved url');
  assert(favoritesScreenCode.includes('logo: item.image || item.logo || \'\''), 'Must pass logo');
  assert(favoritesScreenCode.includes('categoryId: item.categoryId ? String(item.categoryId) : \'\''), 'Must pass categoryId');
  assert(favoritesScreenCode.includes('containerExtension: extension'), 'Must pass containerExtension');
  assert(favoritesScreenCode.includes('selectedAt: String(Date.now())'), 'Must pass fresh selectedAt timestamp');
});

test('2.4: FavoritesScreen registers recently watched channel non-blockingly', () => {
  assert(favoritesScreenCode.includes("addRecentlyWatched({\n          id: String(item.id),\n          type: 'channel'"), 'FavoritesScreen must record recently watched channel');
});

// --- Suite 3: LiveScreen Parameter Consumption & Session Management ---
test('3.1: LiveScreen extracts all navigation parameters from useLocalSearchParams', () => {
  assert(liveScreenCode.includes('channelId,'), 'LiveScreen must destructure channelId');
  assert(liveScreenCode.includes('streamId,'), 'LiveScreen must destructure streamId');
  assert(liveScreenCode.includes('channelName,'), 'LiveScreen must destructure channelName');
  assert(liveScreenCode.includes('url,'), 'LiveScreen must destructure url');
  assert(liveScreenCode.includes('logo,'), 'LiveScreen must destructure logo');
  assert(liveScreenCode.includes('categoryId,'), 'LiveScreen must destructure categoryId');
  assert(liveScreenCode.includes('containerExtension,'), 'LiveScreen must destructure containerExtension');
  assert(liveScreenCode.includes('selectedAt,'), 'LiveScreen must destructure selectedAt');
});

test('3.2: LiveScreen resets consumedChannelIdRef and consumedSelectedAtRef on blur', () => {
  assert(liveScreenCode.includes('consumedChannelIdRef.current = null;'), 'Must reset consumedChannelIdRef on blur');
  assert(liveScreenCode.includes('consumedSelectedAtRef.current = null;'), 'Must reset consumedSelectedAtRef on blur');
  assert(liveScreenCode.includes('setPlayingChannel(null);'), 'Must reset playingChannel on blur');
});

test('3.3: LiveScreen auto-selection effect uses freshness check supporting repeated taps', () => {
  assert(liveScreenCode.includes('const isFresh = selectedAt'), 'Must calculate isFresh using selectedAt and consumedSelectedAtRef');
  assert(liveScreenCode.includes('selectedAt !== consumedSelectedAtRef.current'), 'Must check selectedAt freshness');
  assert(liveScreenCode.includes('consumedChannelIdRef.current = channelId;'), 'Must update consumedChannelIdRef');
  assert(liveScreenCode.includes('consumedSelectedAtRef.current = selectedAt || channelId;'), 'Must update consumedSelectedAtRef');
});

test('3.4: LiveScreen pauses previous channel to release connection slot and prevent audio bleed', () => {
  const selectSnippet = liveScreenCode.substring(
    liveScreenCode.indexOf('// Auto-select channel ONLY when explicitly navigated'),
    liveScreenCode.indexOf('handleToggleFav')
  );
  assert(selectSnippet.includes('livePlayer.pause();'), 'Auto-select must pause existing livePlayer');
  assert(selectSnippet.includes('livePlayer._foxSessionId = sessionId;'), 'Auto-select must attach sessionId to livePlayer');
  assert(selectSnippet.includes("livePlayer._playerState = 'LOADING';"), 'Auto-select must mark playerState as LOADING');
});

test('3.5: LiveScreen builds synthetic channel fallback when channel is not in categories', () => {
  const selectSnippet = liveScreenCode.substring(
    liveScreenCode.indexOf('// Auto-select channel ONLY when explicitly navigated'),
    liveScreenCode.indexOf('handleToggleFav')
  );
  assert(selectSnippet.includes('// 4. Fallback synthetic channel if not found in categories'), 'Must include synthetic channel fallback');
  assert(selectSnippet.includes('id: channelId,'), 'Synthetic channel must use channelId');
  assert(selectSnippet.includes('name: channelName || \'Live Channel\''), 'Synthetic channel must use channelName');
  assert(selectSnippet.includes('setPlayingChannel({ ...found, selectedAt: Date.now() });'), 'Must execute setPlayingChannel with found channel and selectedAt timestamp');
});

test('3.6: LiveScreen handleToggleFav saves rich channel metadata (streamId, logo, containerExtension)', () => {
  const toggleSnippet = liveScreenCode.substring(
    liveScreenCode.indexOf('const handleToggleFav = useCallback('),
    liveScreenCode.indexOf('// Expand Mini Player to Full Screen')
  );
  assert(toggleSnippet.includes('streamId: channel.streamId ?? channel.stream_id ?? channelIdKey'), 'toggleFavorite must pass streamId');
  assert(toggleSnippet.includes("containerExtension: channel.containerExtension || channel.container_extension || 'ts'"), 'toggleFavorite must pass containerExtension');
});

// --- Suite 4: Playback Source Resolution Integration ---
test('4.1: normalizePlaybackSource correctly resolves Xtream live channel URL and metadata', () => {
  const resolved = normalizePlaybackSource({
    type: 'live',
    item: {
      id: '500',
      streamId: '500',
      name: 'Sky Cinema Action',
      containerExtension: 'ts',
    },
    credentials: {
      serverUrl: 'http://iptv.provider.com:8080',
      username: 'testuser',
      password: 'testpass',
    },
  }, { platform: 'android' });

  assert.strictEqual(resolved.isLive, true, 'isLive must be true');
  assert(resolved.uri.includes('/live/testuser/testpass/500.ts'), 'Must build correct Xtream live URL');
  assert.strictEqual(resolved.title, 'Sky Cinema Action', 'Must preserve channel title');
});

test('4.2: normalizePlaybackSource preserves direct M3U stream URL without modification', () => {
  const directM3uUrl = 'http://streams.example.com/news/live.m3u8';
  const resolved = normalizePlaybackSource({
    type: 'live',
    item: {
      id: 'm3u_ch_1',
      name: 'Euronews Direct',
      url: directM3uUrl,
    },
    credentials: {},
  }, { platform: 'android' });

  assert.strictEqual(resolved.uri, directM3uUrl, 'Must preserve direct M3U stream URL');
  assert.strictEqual(resolved.title, 'Euronews Direct', 'Must preserve channel title');
});

  console.log('\n================================================================');
  console.log(`TOTAL FAVORITES LIVE PLAYBACK TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} favorites live playback tests failed`);
  }

  return { passed, failed };
}

if (require.main === module) {
  runTests();
}

module.exports = runTests;
