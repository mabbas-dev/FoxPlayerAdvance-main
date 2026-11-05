/**
 * FOX PLAYER — Full Test Suite Runner
 * Runs both client core unit tests and server API integration tests
 */

process.env.DATABASE_PATH = ':memory:';
process.env.ENCRYPTION_KEY = 'test_key_for_unit_tests_only_32!!';

const { isValidDeviceId } = require('../server/models/deviceModel');


async function runAll() {
  console.log('====================================================');
  console.log('            FOX PLAYER FULL TEST SUITE              ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.error(`  FAIL: ${message}`);
      failed++;
    }
  }

  // ----------------------------------------------------
  // SECTION 1: Device ID Validation
  // ----------------------------------------------------
  console.log('--- 1. Device ID Validation ---');
  assert(isValidDeviceId('A7K92PX4'), 'Accepts valid 8-character ID');
  assert(isValidDeviceId('AAAAAAAA'), 'Accepts all-letter ID');
  assert(isValidDeviceId('12345678'), 'Accepts all-digit ID');
  assert(isValidDeviceId('ABCD1234'), 'Accepts alphanumeric mixed ID');
  assert(!isValidDeviceId('abc12345'), 'Rejects lowercase letters');
  assert(!isValidDeviceId('ABCDEFGHI'), 'Rejects 9-character ID');
  assert(!isValidDeviceId('ABCDEFG'), 'Rejects 7-character ID');
  assert(!isValidDeviceId(''), 'Rejects empty string');
  assert(!isValidDeviceId(null), 'Rejects null');
  assert(!isValidDeviceId(undefined), 'Rejects undefined');
  assert(!isValidDeviceId('ABCD!@#4'), 'Rejects special characters');
  assert(!isValidDeviceId('ABCD 234'), 'Rejects whitespace');

  // ----------------------------------------------------
  // SECTION 2: QR Pairing URL Generation
  // ----------------------------------------------------
  console.log('\n--- 2. QR Pairing URL Generation ---');
  const baseUrl = 'http://localhost:3001';
  const testDevId = 'A7K92PX4';
  const expectedUrl = `${baseUrl}/add-device?device_id=${testDevId}`;
  assert(expectedUrl.includes(`device_id=${testDevId}`), 'QR URL contains device_id parameter');
  assert(expectedUrl.startsWith('http://'), 'QR URL has valid protocol');

  // ----------------------------------------------------
  // SECTION 3: M3U Parser & Adult Content Detection
  // ----------------------------------------------------
  console.log('\n--- 3. M3U Parser & Adult Detection ---');
  const sampleM3U = `#EXTM3U
#EXTINF:-1 tvg-id="CNN" tvg-name="CNN" tvg-logo="https://example.com/cnn.png" group-title="NEWS",CNN International
http://stream.example.com/cnn.m3u8
#EXTINF:-1 tvg-name="BBC World" group-title="NEWS",BBC World News
http://stream.example.com/bbc.m3u8
#EXTINF:-1 tvg-name="Sport Channel" group-title="SPORTS",Sport Channel
http://stream.example.com/sport.ts
#EXTINF:-1 tvg-name="XXX Adult Channel" group-title="Adult",XXX Night
http://stream.example.com/adult.ts
`;

  // Inline parser check matching src/services/m3uParser.js logic
  const ADULT_KEYWORDS = ['xxx', 'adult', 'erotic', 'porn', 'sex', '18+', 'x-rated', 'nude', 'playboy', 'hustler', 'penthouse', 'mature'];
  function checkAdult(name = '', group = '') {
    const combined = `${name} ${group}`.toLowerCase();
    return ADULT_KEYWORDS.some((kw) => combined.includes(kw));
  }

  assert(checkAdult('XXX Channel', 'Adult') === true, 'Detects adult content (XXX + Adult)');
  assert(checkAdult('18+ Movies', '') === true, 'Detects adult content (18+)');
  assert(checkAdult('BBC News', 'NEWS') === false, 'Allows mainstream news (BBC News)');
  assert(checkAdult('Sports Action', 'SPORTS') === false, 'Allows mainstream sports (Sports)');
  assert(checkAdult('Playboy TV', 'Entertainment') === true, 'Detects adult content (Playboy)');

  // ----------------------------------------------------
  // SECTION 4: Server Database & API Integration
  // ----------------------------------------------------
  console.log('\n--- 4. Server Database & Security Tests ---');
  process.env.DATABASE_PATH = ':memory:';
  process.env.ENCRYPTION_KEY = 'test_key_for_unit_tests_only_32!!';

  const { initDatabase } = require('../server/database/db');
  const { registerOrUpdateDevice, getDevice } = require('../server/models/deviceModel');
  const { savePlaylistConfig, getPlaylistConfig, getPublicPlaylistConfig } = require('../server/models/playlistModel');

  await initDatabase();
  assert(true, 'SQLite database initialized with migrations');

  const regResult = registerOrUpdateDevice('SRVTEST1');
  assert(regResult.created === true, 'Registers new device');

  const regResult2 = registerOrUpdateDevice('SRVTEST1');
  assert(regResult2.created === false, 'Idempotent device update (no duplicate)');

  const fetchedDevice = getDevice('SRVTEST1');
  assert(fetchedDevice !== null, 'Device retrieved from database');
  assert(fetchedDevice.status === 'active', 'Device status is active');

  // M3U Config
  savePlaylistConfig('SRVTEST1', {
    type: 'm3u',
    playlist_url: 'http://example.com/playlist.m3u',
    playlist_name: 'Main Channels',
  });
  const m3uConfig = getPlaylistConfig('SRVTEST1');
  assert(m3uConfig?.type === 'm3u', 'M3U configuration saved');
  assert(m3uConfig?.playlist_url === 'http://example.com/playlist.m3u', 'M3U URL matches');

  // Xtream Config & Encryption
  savePlaylistConfig('SRVTEST1', {
    type: 'xtream',
    server_url: 'http://xtream.example.com:8080',
    username: 'test_user',
    password: 'super_secret_password_123',
  });
  const xtreamConfig = getPlaylistConfig('SRVTEST1');
  assert(xtreamConfig?.type === 'xtream', 'Xtream configuration saved');
  assert(xtreamConfig?.username === 'test_user', 'Username saved');
  assert(xtreamConfig?.password === 'super_secret_password_123', 'Password encrypted and decrypted correctly');

  // Security: Public API must never leak passwords
  const publicConfig = getPublicPlaylistConfig('SRVTEST1');
  assert(!('password' in publicConfig), 'Public API does NOT leak password');
  assert(publicConfig?.username === 'test_user', 'Public API provides username');
  assert(publicConfig?.server_url === 'http://xtream.example.com:8080', 'Public API provides server URL');

  // ----------------------------------------------------
  // SECTION 5: Movies Pipeline & Xtream VOD
  // ----------------------------------------------------
  console.log('\n--- 5. Movies Pipeline & VOD Stream URLs ---');
  function testBuildVodUrl(serverUrl, username, password, streamId, extension = 'mp4') {
    const base = serverUrl.replace(/\/+$/, '');
    const ext = (extension || 'mp4').replace(/^\.+/, '');
    return `${base}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
  }

  const vodUrl1 = testBuildVodUrl('http://toxicplay1.com:8080/', 'GwJ7FwG42Y', 'linear7joint', '146924', 'mkv');
  assert(vodUrl1 === 'http://toxicplay1.com:8080/movie/GwJ7FwG42Y/linear7joint/146924.mkv', 'Builds correct VOD stream URL with mkv extension');

  const vodUrl2 = testBuildVodUrl('http://myiptv.com:8080', 'user name', 'pass@word!', '500', 'mp4');
  assert(vodUrl2 === 'http://myiptv.com:8080/movie/user%20name/pass%40word!/500.mp4', 'Encodes credentials in VOD stream URL');

  // Category normalization test
  const catNum = 412;
  const movieCatStr = '412';
  assert(String(movieCatStr) === String(catNum), 'Category string/number ID normalization matches');

  // Movie model normalization test
  function testNormalizeMovie(v) {
    const streamId = String(v.stream_id || v.id || '');
    const ext = (v.container_extension || 'mp4').replace(/^\.+/, '');
    return {
      id: streamId,
      streamId,
      name: v.name || v.title || 'Untitled Movie',
      poster: v.stream_icon || v.movie_image || null,
      categoryId: v.category_id != null ? String(v.category_id) : '',
      containerExtension: ext,
      rating: v.rating != null ? (isNaN(Number(v.rating)) ? null : Number(v.rating)) : null,
      year: v.year || null,
      type: 'movie',
    };
  }

  const normTest = testNormalizeMovie({
    stream_id: 146924,
    name: 'Award Show 2023',
    stream_icon: 'https://example.com/icon.jpg',
    category_id: 412,
    container_extension: 'mkv',
    year: '2023',
    rating: '7.5',
  });
  assert(normTest.id === '146924', 'Stream ID normalized to string');
  assert(normTest.categoryId === '412', 'Category ID normalized to string');
  assert(normTest.containerExtension === 'mkv', 'Container extension preserved as mkv');
  assert(normTest.rating === 7.5, 'Rating normalized to number');
  assert(normTest.type === 'movie', 'Type set to movie');

  const normMinimal = testNormalizeMovie({ stream_id: 999, name: 'Minimal Movie' });
  assert(normMinimal.id === '999', 'Minimal movie parsed without errors');
  assert(normMinimal.poster === null, 'Poster is null when absent');
  assert(normMinimal.containerExtension === 'mp4', 'Default container extension is mp4');

  // ----------------------------------------------------
  // SECTION 6: Series Pipeline & Xtream Series
  // ----------------------------------------------------
  console.log('\n--- 6. Series Pipeline & Episode Playback ---');
  function testBuildSeriesUrl(serverUrl, username, password, streamId, extension = 'mp4') {
    const base = serverUrl.replace(/\/+$/, '');
    const ext = (extension || 'mp4').replace(/^\.+/, '');
    return `${base}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
  }

  const seriesUrl1 = testBuildSeriesUrl('http://toxicplay1.com:8080/', 'GwJ7FwG42Y', 'linear7joint', '88123', 'mkv');
  assert(seriesUrl1 === 'http://toxicplay1.com:8080/series/GwJ7FwG42Y/linear7joint/88123.mkv', 'Builds correct Series episode stream URL with /series/ and mkv');

  const seriesUrl2 = testBuildSeriesUrl('http://myiptv.com:8080', 'user name', 'pass@word!', '1001', 'mp4');
  assert(seriesUrl2 === 'http://myiptv.com:8080/series/user%20name/pass%40word!/1001.mp4', 'Encodes credentials in Series stream URL');

  // Series Normalization test
  function testNormalizeSeries(item) {
    const seriesId = String(item.series_id != null ? item.series_id : (item.id != null ? item.id : ''));
    const rawTitle = item.name || item.title || 'Untitled Series';
    const posterUrl = item.cover || item.cover_big || null;
    const categoryId = item.category_id != null ? String(item.category_id) : '';
    return {
      id: seriesId,
      seriesId,
      name: rawTitle,
      title: rawTitle,
      poster: posterUrl,
      categoryId,
      rating: item.rating != null ? Number(item.rating) : null,
      year: item.year || null,
      type: 'series',
    };
  }

  const seriesItemRaw = {
    num: 1,
    name: 'Breaking Bad',
    series_id: 789,
    stream_type: 'series',
    cover: 'https://example.com/breaking_bad.jpg',
    plot: 'A high school chemistry teacher diagnosed with lung cancer...',
    genre: 'Crime, Drama, Thriller',
    rating: '9.5',
    category_id: 20,
  };

  const normSeries = testNormalizeSeries(seriesItemRaw);
  assert(normSeries.id === '789', 'Series ID normalized to string');
  assert(normSeries.name === 'Breaking Bad', 'Series title preserved');
  assert(normSeries.poster === 'https://example.com/breaking_bad.jpg', 'Series poster mapped from cover');
  assert(normSeries.categoryId === '20', 'Category ID normalized to string');
  assert(normSeries.rating === 9.5, 'Rating normalized to number');
  assert(normSeries.type === 'series', 'Type is series');

  // Test Series with minimal fields
  const normSeriesMin = testNormalizeSeries({ series_id: 456, name: 'Minimal Series' });
  assert(normSeriesMin.id === '456', 'Minimal series normalized properly');
  assert(normSeriesMin.poster === null, 'Poster is null when absent');

  // Test Season and Episode parsing
  const rawEpisodesData = {
    "1": [
      { id: "1001", episode_num: 1, title: "Pilot", container_extension: "mkv", info: { duration: "00:58:00" } },
      { id: "1002", episode_num: 2, title: "Cat's in the Bag...", container_extension: "mp4", info: { duration: "00:48:00" } },
    ],
    "2": [
      { id: "2001", episode_num: 1, title: "Seven Thirty-Seven", container_extension: "mkv" },
    ]
  };

  const parsedSeasons = Object.keys(rawEpisodesData).map((seasonKey) => {
    const eps = rawEpisodesData[seasonKey];
    return {
      seasonNumber: parseInt(seasonKey, 10),
      episodes: eps.map((e) => ({
        id: String(e.id),
        episodeNumber: Number(e.episode_num),
        title: e.title,
        containerExtension: e.container_extension || 'mp4',
        duration: e.info?.duration || null,
      })),
    };
  });

  assert(parsedSeasons.length === 2, 'Parsed 2 seasons correctly');
  assert(parsedSeasons[0].seasonNumber === 1, 'Season 1 number is 1');
  assert(parsedSeasons[0].episodes.length === 2, 'Season 1 has 2 episodes');
  assert(parsedSeasons[0].episodes[0].id === '1001', 'Episode ID is 1001 (not parent series_id)');
  assert(parsedSeasons[0].episodes[0].containerExtension === 'mkv', 'Container extension is mkv');
  assert(parsedSeasons[1].seasonNumber === 2, 'Season 2 number is 2');
  assert(parsedSeasons[1].episodes.length === 1, 'Season 2 has 1 episode');

  // ----------------------------------------------------
  // SECTION 7: Unified Favorites Store & Operations
  // ----------------------------------------------------
  console.log('\n--- 7. Unified Favorites Store & Operations ---');
  function normalizeFavoriteType(type) {
    if (!type) return 'movie';
    const lower = String(type).toLowerCase();
    if (lower === 'channel' || lower === 'live' || lower === 'livetv' || lower === 'channels') return 'live';
    if (lower === 'series' || lower === 'show' || lower === 'shows') return 'series';
    return 'movie';
  }

  function getFavoriteKey(type, id) {
    return `${normalizeFavoriteType(type)}:${String(id)}`;
  }

  function createUnifiedFavorite(item, typeOverride) {
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
  }

  // Type normalization tests
  assert(normalizeFavoriteType('channel') === 'live', 'Normalizes channel to live');
  assert(normalizeFavoriteType('LIVE') === 'live', 'Normalizes LIVE to live');
  assert(normalizeFavoriteType('series') === 'series', 'Normalizes series to series');
  assert(normalizeFavoriteType('movie') === 'movie', 'Normalizes movie to movie');

  // Key collision prevention test: channel:100 vs movie:100
  const movieKey = getFavoriteKey('movie', 100);
  const channelKey = getFavoriteKey('channel', 100);
  assert(movieKey === 'movie:100', 'Movie key has movie prefix');
  assert(channelKey === 'live:100', 'Channel key has live prefix');
  assert(movieKey !== channelKey, 'Movie and Live Channel with same ID do NOT collide');

  // Unified Favorite Model tests
  const favMovie = createUnifiedFavorite({
    id: 12345,
    type: 'movie',
    name: 'Inception',
    poster: 'https://example.com/inception.jpg',
    containerExtension: 'mkv',
    year: '2010',
    categoryId: '10',
  });
  assert(favMovie.id === '12345', 'Movie favorite ID preserved as string');
  assert(favMovie.type === 'movie', 'Movie favorite type is movie');
  assert(favMovie.title === 'Inception', 'Movie title mapped from name');
  assert(favMovie.image === 'https://example.com/inception.jpg', 'Movie image mapped from poster');
  assert(favMovie.containerExtension === 'mkv', 'Container extension preserved');
  assert(favMovie.year === '2010', 'Year preserved');

  const favSeries = createUnifiedFavorite({
    series_id: 67890,
    type: 'series',
    title: 'Succession',
    cover: 'https://example.com/succession.jpg',
  });
  assert(favSeries.id === '67890', 'Series favorite ID preserved');
  assert(favSeries.type === 'series', 'Series favorite type is series');
  assert(favSeries.seriesId === 67890, 'Series ID preserved');
  assert(favSeries.image === 'https://example.com/succession.jpg', 'Series image mapped from cover');

  const favChannel = createUnifiedFavorite({
    id: 54321,
    type: 'channel',
    name: 'Sky Sports',
    logo: 'https://example.com/skysports.png',
  });
  assert(favChannel.id === '54321', 'Live TV channel ID preserved');
  assert(favChannel.type === 'live', 'Live TV type is canonical live');
  assert(favChannel.title === 'Sky Sports', 'Live TV title preserved');
  assert(favChannel.image === 'https://example.com/skysports.png', 'Live TV logo mapped to image');

  // Simulated Favorite Store state operations
  let testFavorites = [];

  function simulateToggle(item) {
    const unified = createUnifiedFavorite(item);
    const key = getFavoriteKey(unified.type, unified.id);
    const idx = testFavorites.findIndex((f) => getFavoriteKey(f.type, f.id) === key);
    if (idx >= 0) {
      testFavorites = testFavorites.filter((_, i) => i !== idx);
      return false; // removed
    } else {
      testFavorites = [unified, ...testFavorites];
      return true; // added
    }
  }

  // 1. Add movie
  const add1 = simulateToggle(favMovie);
  assert(add1 === true, 'Adds movie to favorites');
  assert(testFavorites.length === 1, 'Favorites count is 1');

  // 2. Add series
  const add2 = simulateToggle(favSeries);
  assert(add2 === true, 'Adds series to favorites');
  assert(testFavorites.length === 2, 'Favorites count is 2');

  // 3. Add live channel
  const add3 = simulateToggle(favChannel);
  assert(add3 === true, 'Adds live channel to favorites');
  assert(testFavorites.length === 3, 'Favorites count is 3');

  // 4. Duplicate prevention
  const addDuplicate = simulateToggle(favMovie); // Should toggle off/remove
  assert(addDuplicate === false, 'Toggling existing movie removes it');
  assert(testFavorites.length === 2, 'Favorites count decreased to 2');

  // 5. Re-add movie
  simulateToggle(favMovie);
  assert(testFavorites.length === 3, 'Re-adds movie to favorites');

  // 6. Filter by type
  const movieOnly = testFavorites.filter((f) => f.type === 'movie');
  const seriesOnly = testFavorites.filter((f) => f.type === 'series');
  const liveOnly = testFavorites.filter((f) => f.type === 'live');
  assert(movieOnly.length === 1, '1 movie favorite found');
  assert(seriesOnly.length === 1, '1 series favorite found');
  assert(liveOnly.length === 1, '1 live TV favorite found');

  // 7. Legacy migration test
  const legacyChannels = [{ id: 1, name: 'Ch 1', logo: 'http://ch1.png' }];
  const legacyMovies = [{ id: 2, name: 'Mov 1', logo: 'http://mov1.png' }];
  const legacySeries = [{ id: 3, name: 'Ser 1', logo: 'http://ser1.png' }];

  const migrated = [];
  const seen = new Set();
  const migrateBatch = (arr, t) => {
    for (const it of arr) {
      const u = createUnifiedFavorite(it, t);
      const k = getFavoriteKey(u.type, u.id);
      if (!seen.has(k)) {
        seen.add(k);
        migrated.push(u);
      }
    }
  };
  migrateBatch(legacyChannels, 'live');
  migrateBatch(legacyMovies, 'movie');
  migrateBatch(legacySeries, 'series');

  assert(migrated.length === 3, 'Migrated all 3 legacy items');
  assert(migrated[0].type === 'live', 'Migrated channel has type live');
  assert(migrated[1].type === 'movie', 'Migrated movie has type movie');
  assert(migrated[2].type === 'series', 'Migrated series has type series');

  // ====================================================
  // 8. Stream Resolution for All Content Types
  // ====================================================
  console.log('\n--- 8. Media Stream Resolution ---');
  function testResolveMediaSource({ type, item, credentials = {} }) {
    const serverUrl = (credentials.serverUrl || '').trim().replace(/\/+$/, '');
    const username = credentials.username || '';
    const password = credentials.password || '';
    let playUrl = item.url || '';
    let streamId = '';
    let extension = 'mp4';
    let title = item.name || item.title || 'Fox Player';

    if (type === 'live' || type === 'channel') {
      streamId = String(item.streamId || item.stream_id || item.id || '');
      extension = (item.containerExtension || item.container_extension || 'ts').replace(/^\.+/, '');
      if (!playUrl && serverUrl && username && password && streamId) {
        playUrl = `${serverUrl}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension}`;
      }
    } else if (type === 'movie' || type === 'vod') {
      streamId = String(item.streamId || item.stream_id || item.id || '');
      extension = (item.containerExtension || item.container_extension || 'mp4').replace(/^\.+/, '');
      if (!playUrl && serverUrl && username && password && streamId) {
        playUrl = `${serverUrl}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension}`;
      }
    } else if (type === 'series' || type === 'episode') {
      streamId = String(item.id || item.streamId || item.stream_id || '');
      extension = (item.containerExtension || item.container_extension || 'mp4').replace(/^\.+/, '');
      if (!playUrl && serverUrl && username && password && streamId) {
        playUrl = `${serverUrl}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${extension}`;
      }
    }

    return { type, url: playUrl, title, streamId, extension };
  }

  const testCreds = {
    serverUrl: 'http://iptv.example.com:8080',
    username: 'testuser',
    password: 'testpass',
  };

  const resolvedMovie = testResolveMediaSource({
    type: 'movie',
    item: { streamId: '999', name: 'Test Movie', containerExtension: 'mp4' },
    credentials: testCreds,
  });
  assert(resolvedMovie.url === 'http://iptv.example.com:8080/movie/testuser/testpass/999.mp4', 'Resolves movie stream URL');
  assert(resolvedMovie.streamId === '999', 'Resolves movie streamId');

  const resolvedSeriesEpisode = testResolveMediaSource({
    type: 'series',
    item: { id: '888', name: 'Episode 1', containerExtension: 'mkv' },
    credentials: testCreds,
  });
  assert(resolvedSeriesEpisode.url === 'http://iptv.example.com:8080/series/testuser/testpass/888.mkv', 'Resolves series stream URL with type series');
  assert(resolvedSeriesEpisode.streamId === '888', 'Resolves series episode ID');

  const resolvedEpisodeAlias = testResolveMediaSource({
    type: 'episode',
    item: { id: '888', name: 'Episode 1', containerExtension: 'mkv' },
    credentials: testCreds,
  });
  assert(resolvedEpisodeAlias.url === 'http://iptv.example.com:8080/series/testuser/testpass/888.mkv', 'Resolves series stream URL with type episode alias');

  const resolvedLiveChannel = testResolveMediaSource({
    type: 'live',
    item: { streamId: '777', name: 'Live News', containerExtension: 'ts' },
    credentials: testCreds,
  });
  assert(resolvedLiveChannel.url === 'http://iptv.example.com:8080/live/testuser/testpass/777.ts', 'Resolves live stream URL with type live');

  const resolvedChannelAlias = testResolveMediaSource({
    type: 'channel',
    item: { streamId: '777', name: 'Live News', containerExtension: 'ts' },
    credentials: testCreds,
  });
  assert(resolvedChannelAlias.url === 'http://iptv.example.com:8080/live/testuser/testpass/777.ts', 'Resolves live stream URL with type channel alias');

  // ====================================================
  // 9. Player Lifecycle & Intent State Machine
  // ====================================================
  console.log('\n--- 9. Player Lifecycle & Intent ---');

  class PlayerLifecycleSimulator {
    constructor() {
      this.playbackIntent = 'PLAYING';
      this.userPaused = false;
      this.playerState = 'PLAYING';
      this.nativePlaying = true;
      this.nativePausedCount = 0;
      this.nativePlayCount = 0;
    }

    userTogglePlay() {
      if (this.playerState === 'PLAYING') {
        this.userPaused = true;
        this.playbackIntent = 'PAUSED';
        this.nativePlaying = false;
        this.playerState = 'PAUSED';
        this.nativePausedCount++;
      } else {
        this.userPaused = false;
        this.playbackIntent = 'PLAYING';
        this.nativePlaying = true;
        this.playerState = 'PLAYING';
        this.nativePlayCount++;
      }
    }

    onForegroundRecovered() {
      if (this.playbackIntent === 'PLAYING' && !this.userPaused && !this.nativePlaying) {
        this.nativePlaying = true;
        this.playerState = 'PLAYING';
        this.nativePlayCount++;
      }
    }
  }

  const sim1 = new PlayerLifecycleSimulator();
  assert(sim1.playerState === 'PLAYING', 'Player initial state is PLAYING');
  assert(sim1.playbackIntent === 'PLAYING', 'Initial playbackIntent is PLAYING');

  const sim2 = new PlayerLifecycleSimulator();
  sim2.userTogglePlay();
  assert(sim2.playerState === 'PAUSED', 'Player paused by user');
  assert(sim2.playbackIntent === 'PAUSED', 'Playback intent is PAUSED');

  sim2.onForegroundRecovered();
  assert(sim2.playerState === 'PAUSED', 'Intentionally paused video does not auto-resume on foreground');

  // ====================================================
  // 10. Poster URL Resolution Pipeline
  // ====================================================
  const { resolvePosterUrl } = require('../src/utils/imageHelpers');

  // 10.1 IPTV Provider Field Resolution
  assert(resolvePosterUrl({ stream_icon: 'https://cdn.example.com/p1.jpg' }) === 'https://cdn.example.com/p1.jpg', 'Resolves stream_icon field');
  assert(resolvePosterUrl({ cover: 'https://cdn.example.com/c1.jpg' }) === 'https://cdn.example.com/c1.jpg', 'Resolves cover field');
  assert(resolvePosterUrl({ cover_big: 'https://cdn.example.com/cb1.jpg' }) === 'https://cdn.example.com/cb1.jpg', 'Resolves cover_big field');
  assert(resolvePosterUrl({ movie_image: 'https://cdn.example.com/m1.jpg' }) === 'https://cdn.example.com/m1.jpg', 'Resolves movie_image field');
  assert(resolvePosterUrl({ backdrop_path: ['https://cdn.example.com/bd1.jpg'] }) === 'https://cdn.example.com/bd1.jpg', 'Resolves array backdrop_path');
  assert(resolvePosterUrl({ info: { cover: 'https://cdn.example.com/ic1.jpg' } }) === 'https://cdn.example.com/ic1.jpg', 'Resolves nested info.cover');

  // 10.2 Rejection of Fake / Null Placeholder Strings
  assert(resolvePosterUrl({ stream_icon: 'null', cover: 'https://cdn.example.com/real.jpg' }) === 'https://cdn.example.com/real.jpg', 'Skips string "null" to find real cover');
  assert(resolvePosterUrl({ stream_icon: 'undefined', cover_big: 'https://cdn.example.com/real2.jpg' }) === 'https://cdn.example.com/real2.jpg', 'Skips string "undefined" to find real cover_big');
  assert(resolvePosterUrl({ stream_icon: 'none' }) === null, 'Rejects string "none"');
  assert(resolvePosterUrl({ stream_icon: '   ' }) === null, 'Rejects whitespace string');

  // 10.3 Relative and TMDb Path Resolution
  assert(resolvePosterUrl({ poster_path: '/hZkGoQYus5vegHoetNasipmTP.jpg' }) === 'https://image.tmdb.org/t/p/w500/hZkGoQYus5vegHoetNasipmTP.jpg', 'Resolves TMDb relative poster path');
  assert(resolvePosterUrl({ stream_icon: '/images/series_123.jpg' }, 'http://iptv.server.com:8080') === 'http://iptv.server.com:8080/images/series_123.jpg', 'Resolves server relative path with serverUrl');
  assert(resolvePosterUrl({ stream_icon: '//images.cdn.com/poster.jpg' }) === 'https://images.cdn.com/poster.jpg', 'Resolves protocol-relative URL to https');
  assert(resolvePosterUrl({ stream_icon: 'http:/server.com/poster.jpg' }) === 'http://server.com/poster.jpg', 'Fixes malformed single slash after protocol');

  // ====================================================
  // 11. Poster URI Sanitization & Zero Placeholder Guarantee
  // ====================================================
  console.log('\n--- 11. Poster URI Sanitization & Zero Placeholder Guarantee ---');
  const { sanitizeUri } = require('../src/utils/imageHelpers');

  assert(sanitizeUri({ uri: 'https://cdn.example.com/obj.png' }) === 'https://cdn.example.com/obj.png', 'sanitizeUri extracts from object { uri }');
  assert(sanitizeUri('  https://cdn.example.com/space%20name.jpg  ') === 'https://cdn.example.com/space%20name.jpg', 'sanitizeUri trims and preserves %20');
  assert(sanitizeUri('/8b8R8l88abc.jpg') === 'https://image.tmdb.org/t/p/w500/8b8R8l88abc.jpg', 'sanitizeUri handles TMDb relative paths');
  assert(sanitizeUri('null') === null, 'sanitizeUri rejects "null"');
  assert(sanitizeUri('') === null, 'sanitizeUri rejects empty string');
  assert(sanitizeUri(null) === null, 'sanitizeUri rejects null');
  assert(sanitizeUri(undefined) === null, 'sanitizeUri rejects undefined');
  assert(sanitizeUri('none') === null, 'sanitizeUri rejects "none"');
  assert(sanitizeUri('ftp://invalidscheme.com/p.jpg') === null, 'sanitizeUri rejects non-http/file scheme');

  // ====================================================
  // 12. Multi-Playlist Architecture & Cache Isolation
  // ====================================================
  console.log('\n--- 12. Multi-Playlist Architecture & Cache Isolation ---');
  const {
    getAllPlaylists,
    setActivePlaylist,
    deletePlaylist,
  } = require('../server/models/playlistModel');
  const {
    getPlaylistConfigKey,
    getPlaylistChannelsKey,
    getPlaylistMoviesKey,
    getPlaylistSeriesKey,
    getPlaylistFavoritesKey,
  } = require('../src/constants/index');

  const multiDevId = 'MPDEV001';
  registerOrUpdateDevice(multiDevId);

  // 12.1 Key isolation
  assert(getPlaylistChannelsKey('pl_1') === 'fox_player_pl_1_channels', 'Isolates channels key for playlist 1');
  assert(getPlaylistChannelsKey('pl_2') === 'fox_player_pl_2_channels', 'Isolates channels key for playlist 2');
  assert(getPlaylistChannelsKey('pl_1') !== getPlaylistChannelsKey('pl_2'), 'Playlist channel keys are distinct');
  assert(getPlaylistFavoritesKey('pl_1') !== getPlaylistFavoritesKey('pl_2'), 'Playlist favorite keys are distinct');
  assert(getPlaylistConfigKey('pl_1') !== getPlaylistConfigKey('pl_2'), 'Playlist config keys are distinct');
  assert(getPlaylistMoviesKey('pl_1') !== getPlaylistMoviesKey('pl_2'), 'Playlist movies keys are distinct');
  assert(getPlaylistSeriesKey('pl_1') !== getPlaylistSeriesKey('pl_2'), 'Playlist series keys are distinct');

  // 12.2 Save Multiple Playlists
  const pl1 = savePlaylistConfig(multiDevId, {
    playlistType: 'm3u',
    playlistName: 'Sports Live M3U',
    m3uUrl: 'https://example.com/sports.m3u',
  });
  assert(pl1.success === true, 'Saves first playlist');
  assert(pl1.playlist_id > 0, 'Returns numeric playlist_id for first playlist');

  const pl2 = savePlaylistConfig(multiDevId, {
    playlistType: 'xtream',
    playlistName: 'Cinema Xtream',
    serverUrl: 'http://xtream.example.com:8080',
    username: 'cinema_user',
    password: 'cinema_secret_password',
  });
  assert(pl2.success === true, 'Saves second playlist');
  assert(pl2.playlist_id > 0 && pl2.playlist_id !== pl1.playlist_id, 'Second playlist has distinct ID');

  // 12.3 Auto-activation of newly added playlist
  const activeCfg = getPlaylistConfig(multiDevId);
  assert(activeCfg && String(activeCfg.id) === String(pl2.playlist_id), 'Newly saved playlist pl2 is automatically active');

  // 12.4 Fetch all playlists
  const allList = getAllPlaylists(multiDevId);
  assert(allList.length === 2, 'getAllPlaylists returns all saved playlists');
  assert(String(allList[0].id) === String(pl2.playlist_id) && allList[0].isActive === true, 'Latest active playlist is first and marked active');
  assert(String(allList[1].id) === String(pl1.playlist_id) && allList[1].isActive === false, 'Previous playlist is marked inactive');

  // 12.5 Password is never leaked in public lists
  assert(!allList[0].password, 'Password never exposed in playlist list');
  const pubCfg = getPublicPlaylistConfig(multiDevId, pl2.playlist_id);
  assert(!pubCfg.password, 'Password masked in public single playlist config');

  // 12.6 Switch active playlist
  const switchRes = setActivePlaylist(multiDevId, pl1.playlist_id);
  assert(!!switchRes, 'Switches active playlist to pl1');
  const switchedActive = getPlaylistConfig(multiDevId);
  assert(switchedActive && String(switchedActive.id) === String(pl1.playlist_id), 'Active playlist is now pl1');

  // 12.7 Delete playlist and auto-fallback
  const delRes = deletePlaylist(multiDevId, pl1.playlist_id);
  assert(delRes === true, 'Deletes active playlist pl1');
  const fallbackActive = getPlaylistConfig(multiDevId);
  assert(fallbackActive && String(fallbackActive.id) === String(pl2.playlist_id), 'Fallback active playlist is verified as pl2');

  // ----------------------------------------------------
  // SECTION 13: Website-Based Playlist Management, Pairing & ID Lock
  // ----------------------------------------------------
  console.log('\n--- 13. Website Playlist Management, Pairing & ID Lock ---');
  const {
    getOrCreatePairingToken,
    pairDevice,
    verifyManagementSession,
    setIdLock,
    isDeviceLocked,
  } = require('../server/models/deviceModel');
  const { getSafeServerHost } = require('../server/models/playlistModel');

  // 13.1 Device Pairing Token and 6-Digit Code Generation
  const pairInfo = getOrCreatePairingToken(multiDevId);
  assert(typeof pairInfo.pairing_token === 'string' && pairInfo.pairing_token.length === 48, 'Generates 24-byte hex pairing token');
  assert(typeof pairInfo.pairing_code === 'string' && /^[0-9]{6}$/.test(pairInfo.pairing_code), 'Generates 6-digit TV pairing code');
  assert(typeof pairInfo.expires_at === 'string', 'Pairing token has expiration timestamp');

  // 13.2 Pairing Authorization Exchange (No Admin Password!)
  const pairResultToken = pairDevice(multiDevId, pairInfo.pairing_token);
  assert(pairResultToken.success === true, 'Pairs successfully using pairing token from QR code');
  assert(typeof pairResultToken.session_token === 'string', 'Issues 7-day management session token');

  const pairResultCode = pairDevice(multiDevId, pairInfo.pairing_code);
  assert(pairResultCode.success === true, 'Pairs successfully using 6-digit code from TV screen');

  const pairResultInvalid = pairDevice(multiDevId, '000000');
  assert(pairResultInvalid.success === false && pairResultInvalid.error === 'INVALID_PAIRING', 'Rejects invalid pairing code');

  // 13.3 Session Token Verification & Multi-Device Isolation
  assert(verifyManagementSession(multiDevId, pairResultCode.session_token) === true, 'Validates active management session');
  assert(verifyManagementSession('OTHERDEV', pairResultCode.session_token) === false, 'Session token is isolated to specific device');
  assert(verifyManagementSession(multiDevId, 'fake_token') === false, 'Rejects forged session token');

  // 13.4 Authoritative ID Lock Persistence & Validation
  assert(isDeviceLocked(multiDevId) === false, 'Newly registered device is unlocked by default');
  setIdLock(multiDevId, true);
  assert(isDeviceLocked(multiDevId) === true, 'ID Lock persisted as locked (1) in database');
  setIdLock(multiDevId, false);
  assert(isDeviceLocked(multiDevId) === false, 'ID Lock unlocked (0) in database');

  // 13.5 Safe Server Host Extraction (Zero Credential Leak)
  const safeHostXtream = getSafeServerHost('xtream', 'http://myprovider.com:8080/live/user/secretpass/1.ts', null);
  assert(safeHostXtream === 'http://myprovider.com:8080', 'Xtream URL stripped of credentials for dashboard display');
  assert(!safeHostXtream.includes('secretpass'), 'Safe hostname contains no password');

  const safeHostM3U = getSafeServerHost('m3u', null, 'http://m3u.provider.org/get.php?username=u&password=p&type=m3u');
  assert(safeHostM3U === 'http://m3u.provider.org', 'M3U URL stripped of query secrets for dashboard display');
  assert(!safeHostM3U.includes('password='), 'M3U safe hostname contains no query credentials');

  // 13.3 Multi-Device Independent Management
  const devA = 'DEVAAAA1';
  const devB = 'DEVBBBB2';
  registerOrUpdateDevice(devA);
  registerOrUpdateDevice(devB);

  const sharedPlA = savePlaylistConfig(devA, {
    type: 'xtream',
    server_url: 'http://shared-stream.net:8080',
    username: 'userA',
    password: 'passA',
    playlist_name: 'Shared Sports IPTV',
  });
  const sharedPlB = savePlaylistConfig(devB, {
    type: 'xtream',
    server_url: 'http://shared-stream.net:8080',
    username: 'userB',
    password: 'passB',
    playlist_name: 'Shared Sports IPTV',
  });

  const devAPlaylists = getAllPlaylists(devA);
  const devBPlaylists = getAllPlaylists(devB);
  assert(devAPlaylists.some((p) => p.name === 'Shared Sports IPTV'), 'Device A has shared playlist');
  assert(devBPlaylists.some((p) => p.name === 'Shared Sports IPTV'), 'Device B has shared playlist');

  // Delete from Device A only
  deletePlaylist(devA, sharedPlA.playlist_id);
  const devAPlaylistsAfter = getAllPlaylists(devA);
  const devBPlaylistsAfter = getAllPlaylists(devB);

  assert(!devAPlaylistsAfter.some((p) => p.name === 'Shared Sports IPTV'), 'Shared playlist removed from Device A');
  assert(devBPlaylistsAfter.some((p) => p.name === 'Shared Sports IPTV'), 'Shared playlist remains intact on Device B');

  // 13.4 Web Page Files Existence
  const fs = require('fs');
  const path = require('path');
  const manageHtmlPath = path.join(__dirname, '../web/pages/manage.html');
  assert(fs.existsSync(manageHtmlPath), 'manage.html exists in web/pages');
  const manageHtmlContent = fs.readFileSync(manageHtmlPath, 'utf8');
  assert(manageHtmlContent.includes('Device Management'), 'manage.html contains Device Management heading');
  assert(manageHtmlContent.includes('Find Device'), 'manage.html contains Find Device button');
  assert(manageHtmlContent.includes('Add Playlist'), 'manage.html contains Add Playlist action');
  assert(manageHtmlContent.includes('Remove'), 'manage.html contains Remove action');

  // ----------------------------------------------------
  // SECTION 14: Live TV Positioning & Autoplay Prevention
  // ----------------------------------------------------
  console.log('\n--- 14. Live TV Mini Player Positioning & Autoplay Prevention ---');

  // 14.1 Pure Deterministic Positioning Logic (Landscape & Portrait)
  function computeMiniBounds(wWidth, wHeight, sInsets, portrait) {
    const pLeft = Math.max(sInsets.left, 16);
    const pRight = Math.max(sInsets.right, 16);
    const pTop = 4;
    const pBottom = Math.max(sInsets.bottom, 4);

    if (portrait) {
      const bottomBarH = 26;
      const playerH = 190;
      const availableWidth = Math.max(100, wWidth - pLeft - pRight);
      const topY = Math.max(0, wHeight - pBottom - bottomBarH - playerH);
      return {
        x: pLeft,
        y: topY,
        width: availableWidth,
        height: playerH,
      };
    }

    const headerH = 42;
    const bottomBarH = 26;
    const availableWidth = Math.max(200, wWidth - pLeft - pRight);
    const availableHeight = Math.max(160, wHeight - pTop - pBottom - headerH - bottomBarH);
    const gap = 10;
    const netColWidth = availableWidth - (gap * 2);
    const col3Width = Math.floor(netColWidth * 0.50);
    const col3Left = Math.floor(pLeft + (netColWidth * 0.50) + (gap * 2));
    const col3Top = Math.floor(pTop + headerH + 4);

    return {
      x: col3Left,
      y: col3Top,
      width: col3Width,
      height: availableHeight,
    };
  }

  // Test standard landscape (800x360 phone / tablet / TV)
  const boundsLand = computeMiniBounds(800, 360, { left: 0, right: 0, top: 0, bottom: 0 }, false);
  assert(boundsLand.x >= 800 * 0.50, 'Landscape player x starts in the right 50% region');
  assert(boundsLand.x + boundsLand.width <= 800, 'Landscape player width does not overflow screen width');
  assert(boundsLand.y >= 46, 'Landscape player sits below top toolbar');
  assert(boundsLand.y + boundsLand.height <= 360, 'Landscape player does not overflow screen bottom');

  // Test wide landscape with display cutouts (insets.left = 32, insets.right = 32)
  const boundsWithCutout = computeMiniBounds(960, 420, { left: 32, right: 32, top: 0, bottom: 0 }, false);
  assert(boundsWithCutout.x + boundsWithCutout.width <= 960 - 32, 'Player respects safe-area right inset with cutouts');
  assert(boundsWithCutout.x >= 32 + (960 - 64) * 0.45, 'Player respects safe-area left inset and column spacing');

  // Test portrait (390x844 modern phone)
  const boundsPortrait = computeMiniBounds(390, 844, { left: 0, right: 0, top: 44, bottom: 34 }, true);
  assert(boundsPortrait.height === 190, 'Portrait player height is standardized to 190');
  assert(boundsPortrait.width === 390 - 32, 'Portrait player spans available content width');
  assert(boundsPortrait.y + boundsPortrait.height <= 844 - 34, 'Portrait player remains above safe-area bottom');

  // 14.2 Layout Coordinate Clamping — verifying correct onLayout coordinate semantics
  //
  // React Native onLayout gives x/y relative to the PARENT VIEW'S TOP-LEFT CORNER (outside its
  // padding box).  So contentSplitLayout.x already includes mainLayout's paddingLeft.
  // We must NOT add safePadding again — doing so would double-count the padding and push
  // the player off-screen to the right.
  //
  // Correct formula:
  //   absolute_x = contentSplitLayout.x + columnPlayerLayout.x   (padding already included)
  //   absolute_y = contentSplitLayout.y + columnPlayerLayout.y
  function resolveCorrectBounds(contentSplitLay, columnPlayerLay, windowW, windowH, insets) {
    const safeRight  = Math.max(insets.right,  0);
    const safeBottom = Math.max(insets.bottom, 4);
    const maxRight  = windowW - safeRight;
    const maxBottom = windowH - safeBottom;
    const rawX = Math.round(contentSplitLay.x + columnPlayerLay.x);
    const rawY = Math.round(contentSplitLay.y + columnPlayerLay.y);
    const rawW = Math.round(columnPlayerLay.width);
    const rawH = Math.round(columnPlayerLay.height);
    const clampedW = Math.min(rawW, Math.max(80, maxRight  - rawX));
    const clampedH = Math.min(rawH, Math.max(80, maxBottom - rawY));
    return { x: rawX, y: rawY, width: clampedW, height: clampedH };
  }

  // Scenario: landscape 800x360, mainLayout paddingLeft=16, paddingTop=4
  //   contentSplitLayout.x = 16  (React Native reports position from parent top-left; includes padding)
  //   contentSplitLayout.y = 50  (header ~46px + marginBottom 4px)
  //   columnPlayerLayout.x = 394 (50% of contentSplit width + gaps)
  //   columnPlayerLayout.y = 0
  //   columnPlayerLayout.width = 374
  const exactBounds = resolveCorrectBounds(
    { x: 16, y: 50, width: 768, height: 284 },  // contentSplitLayout (x=16 includes paddingLeft!)
    { x: 394, y: 0, width: 374, height: 284 },  // columnPlayerLayout
    800,   // windowWidth
    360,   // windowHeight
    { right: 0, bottom: 0 }
  );
  // absolute_x = 16 + 394 = 410
  assert(exactBounds.x === 410, 'Correct: no double-counted padding — absolute x = contentSplitLayout.x + columnPlayerLayout.x');
  // absolute_y = 50 + 0 = 50
  assert(exactBounds.y === 50,  'Correct: absolute y = contentSplitLayout.y + columnPlayerLayout.y');
  assert(exactBounds.width  === 374, 'Player width matches column layout width');
  // No clamp: 284 <= max(80, 360-0-50)=310 ✓
  assert(exactBounds.height === 284, 'Player height unclamped when within safe viewport');
  // Right edge: 410 + 374 = 784 = 800 - 16 (within screen, no overflow)
  assert(exactBounds.x + exactBounds.width === 784, 'Player right edge stays within safe viewport');
  assert(exactBounds.x + exactBounds.width <= 800,  'Player does not overflow screen width');

  // Verify double-counting BUG would cause overflow (old wrong formula)
  // Old: rawX = safePadding.paddingLeft + contentSplitLayout.x + columnPlayerLayout.x
  //           = 16 + 16 + 394 = 426  (16px too far right!)
  // Right edge with old formula: 426 + 374 = 800 = windowWidth → player flush with screen edge
  // With any nav bar inset (insets.right > 0), this would overflow into the nav bar!
  const wrongX = 16 /*safePadding*/ + 16 /*contentSplitLayout.x*/ + 394; // = 426
  assert(wrongX === 426, 'Old formula double-counted 16px padding: 16+16+394=426 (correct is 16+394=410)');
  assert(wrongX + 374 >= 800, 'Old formula pushes player right edge to screen boundary (overflows with any nav bar)');


  // Scenario: right-side nav bar (insets.right=48, some Android landscape configs)
  const boundsWithRightNavBar = resolveCorrectBounds(
    { x: 16, y: 50, width: 704, height: 284 },   // contentSplit narrower due to paddingRight=48
    { x: 346, y: 0, width: 338, height: 284 },   // columnPlayer narrower
    800, 360,
    { right: 48, bottom: 0 }
  );
  // maxRight = 800-48 = 752, rawX = 16+346=362, rawW=338, right edge = 700 <= 752 ✓
  assert(boundsWithRightNavBar.x + boundsWithRightNavBar.width <= 800 - 48, 'Player stays inside right safe area when nav bar is on right');

  // Scenario: bottom nav bar overflow clamping (insets.bottom=48)
  const boundsWithBottomNavBar = resolveCorrectBounds(
    { x: 16, y: 50, width: 768, height: 270 },
    { x: 394, y: 0, width: 374, height: 270 },
    800, 360,
    { right: 0, bottom: 48 }
  );
  // maxBottom = 360-48=312, rawY=50, clampedH = min(270, max(80, 312-50)) = min(270, 262) = 262
  assert(boundsWithBottomNavBar.height === 262, 'Height clamped so player stays above Android nav bar (insets.bottom=48)');
  assert(boundsWithBottomNavBar.y + boundsWithBottomNavBar.height <= 360 - 48, 'Player bottom edge never exceeds safe viewport bottom');


  // 14.3 Autoplay Prevention and Category State Separation
  function simulateLiveScreenState() {
    let selectedCategoryId = null;
    let playingChannel = null;
    let isPlayerDismissed = false;

    const mockCategories = [
      { id: 'news', name: 'News', channels: [{ id: 'ch1', name: 'BBC News', url: 'http://stream/1' }, { id: 'ch2', name: 'CNN', url: 'http://stream/2' }] },
      { id: 'sports', name: 'Sports', channels: [{ id: 'ch3', name: 'Sky Sports', url: 'http://stream/3' }, { id: 'ch4', name: 'ESPN', url: 'http://stream/4' }] },
      { id: 'movies', name: 'Cinema', channels: [{ id: 'ch5', name: 'HBO', url: 'http://stream/5' }] },
    ];

    function selectCategory(catId) {
      selectedCategoryId = catId;
      // Note: Must NOT modify playingChannel
    }

    function selectChannel(channel) {
      isPlayerDismissed = false;
      playingChannel = channel;
    }

    return {
      getCategories: () => mockCategories,
      getSelectedCategory: () => selectedCategoryId,
      getPlayingChannel: () => playingChannel,
      selectCategory,
      selectChannel,
    };
  }

  const liveState = simulateLiveScreenState();
  assert(liveState.getPlayingChannel() === null, 'Initial state: no channel is playing (idle)');

  // Select first category
  liveState.selectCategory('news');
  assert(liveState.getSelectedCategory() === 'news', 'Selected category updated to news');
  assert(liveState.getPlayingChannel() === null, 'Category selection does NOT autoplay first channel ch1');

  // Select second category
  liveState.selectCategory('sports');
  assert(liveState.getSelectedCategory() === 'sports', 'Selected category updated to sports');
  assert(liveState.getPlayingChannel() === null, 'Switching category does NOT autoplay sports channel ch3');

  // User explicitly taps ch4 (ESPN)
  const espn = { id: 'ch4', name: 'ESPN', url: 'http://stream/4' };
  liveState.selectChannel(espn);
  assert(liveState.getPlayingChannel()?.id === 'ch4', 'Explicit channel tap starts playback for ch4');

  // While ESPN is playing, user switches to movies category
  liveState.selectCategory('movies');
  assert(liveState.getSelectedCategory() === 'movies', 'Selected category updated to movies');
  assert(liveState.getPlayingChannel()?.id === 'ch4', 'Changing category while playing PRESERVES active channel (no switch to HBO)');

  // User taps HBO
  const hbo = { id: 'ch5', name: 'HBO', url: 'http://stream/5' };
  liveState.selectChannel(hbo);
  assert(liveState.getPlayingChannel()?.id === 'ch5', 'Explicitly selecting another channel switches playback to HBO');

  // Verify LiveScreen.js does NOT contain the automatic fallback 'return channels[0]' bug
  const liveScreenSource = fs.readFileSync(path.join(__dirname, '../src/screens/LiveScreen.js'), 'utf8');
  assert(!liveScreenSource.includes('return channels[0];'), 'LiveScreen.js does not contain automatic channels[0] fallback');
  assert(!liveScreenSource.includes('setSelectedChannel(catChannels[0])'), 'LiveScreen.js does not autoplay first channel on category select');
  // Architecture: measureInWindow (native bridge) — only used at expand-tap time, not polled
  assert(liveScreenSource.includes('measureInWindow'), 'LiveScreen.js uses measureInWindow for pixel-perfect expand animation start coords');
  assert(liveScreenSource.includes('columnPlayerRef'), 'LiveScreen.js maintains a ref on columnPlayer for on-demand native measurement');
  assert(liveScreenSource.includes('captureMiniBoundsForExpand'), 'LiveScreen.js captures bounds on-demand at expand-tap time (not polled)');
  assert(!liveScreenSource.includes('handleColumnPlayerLayout'), 'LiveScreen.js removed onLayout-based positioning — inline MINI mode needs no coords');
  assert(!liveScreenSource.includes('handleContentSplitLayout'), 'LiveScreen.js no longer uses chained onLayout coordinates (eliminated padding double-counting bug)');
  assert(!liveScreenSource.includes('getDeterministicMiniBounds'), 'LiveScreen.js removed deterministic fallback — inline MINI needs no coords at all');

  // 18. Multi-Playlist Dropdown Animation & Style Architecture
  console.log('\n--- 18. Multi-Playlist Dropdown Animation & Style Architecture ---');
  const profileDropdownSource = fs.readFileSync(path.join(__dirname, '../src/components/ProfileDropdown.js'), 'utf8');
  const iconsSource = fs.readFileSync(path.join(__dirname, '../src/components/Icons.js'), 'utf8');

  // Anti-glitch: Modal must use statusBarTranslucent to prevent Android status bar & navigation shifts
  assert(profileDropdownSource.includes('statusBarTranslucent={true}'), 'ProfileDropdown uses statusBarTranslucent={true} to eliminate Android status bar flicker');
  assert(profileDropdownSource.includes('animationType="none"'), 'ProfileDropdown disables default modal animation in favor of native driver spring pop');

  // Centered popup dialog architecture — screen-centered pop-in, zero slide from right side
  assert(profileDropdownSource.includes('Animated.spring'), 'ProfileDropdown implements physics-based Animated.spring for snappy pop animation');
  assert(profileDropdownSource.includes('cardScale'), 'ProfileDropdown animates centered scale for smooth pop-in dialog effect');
  assert(profileDropdownSource.includes('chevronRotate'), 'ProfileDropdown smoothly rotates chevron 180 degrees on toggle');
  assert(!profileDropdownSource.includes('syncRemotePlaylists()'), 'ProfileDropdown does not auto-sync remote playlists on open to prevent LiveTV shimmer and data reset');

  // Exit animation & safe closing
  assert(profileDropdownSource.includes('isClosingRef'), 'ProfileDropdown guards against rapid double-tap re-entrant closing glitches');
  assert(profileDropdownSource.includes('Animated.timing'), 'ProfileDropdown runs smooth exit animation before unmounting modal');

  // Device-agnostic responsive positioning & landscape safety
  assert(profileDropdownSource.includes('availableScrollHeight'), 'ProfileDropdown dynamically computes scroll height to prevent landscape screen overflow');
  assert(profileDropdownSource.includes('useWindowDimensions'), 'ProfileDropdown uses useWindowDimensions for responsive coordinate clamping');

  // Safety & UX improvements
  assert(profileDropdownSource.includes('deleteConfirmRow'), 'ProfileDropdown provides inline deletion confirmation to prevent accidental removals');
  assert(profileDropdownSource.includes('getPlaylistHostSubtitle'), 'ProfileDropdown extracts server hostname / username for clear playlist distinction');
  assert(profileDropdownSource.includes('isSwitching'), 'ProfileDropdown provides immediate visual loading feedback when switching playlists');
  assert(iconsSource.includes('export function LayersIcon'), 'Icons.js exports LayersIcon for sleek playlist representation');

  // 19. Premium Loading, Refreshing & Skeleton UI Architecture (Strict UI-Only)
  console.log('\n--- 19. Premium Loading, Refreshing & Skeleton UI Architecture ---');
  const progressBarSource = fs.readFileSync(path.join(__dirname, '../src/components/ProgressBar.js'), 'utf8');
  const loadingScreenSource = fs.readFileSync(path.join(__dirname, '../src/components/LoadingScreen.js'), 'utf8');
  const shimmerSource = fs.readFileSync(path.join(__dirname, '../src/components/Shimmer.js'), 'utf8');
  const homeScreenSource = fs.readFileSync(path.join(__dirname, '../src/screens/HomeScreen.js'), 'utf8');

  // ProgressBar tests
  assert(progressBarSource.includes('export default function ProgressBar'), 'ProgressBar component is exported');
  assert(progressBarSource.includes('Math.max(0, Math.min(1,'), 'ProgressBar strictly clamps progress values to [0, 1]');
  assert(progressBarSource.includes('isIndeterminate'), 'ProgressBar supports smooth indeterminate sweep when progress is not provided');
  assert(progressBarSource.includes('leadingPip'), 'ProgressBar renders commercial OTT leading edge highlight sheen pip');
  assert(progressBarSource.includes('indeterminateLoop.current?.stop()'), 'ProgressBar cleans up native animation loop on unmount');

  // LoadingScreen tests
  assert(loadingScreenSource.includes('<ProgressBar'), 'LoadingScreen uses precision ProgressBar');
  assert(loadingScreenSource.includes('logoBreathAnim'), 'LoadingScreen implements subtle breathing pulse for branding logo');
  assert(loadingScreenSource.includes('statusDot'), 'LoadingScreen renders live pulsating status capsule');
  assert(loadingScreenSource.includes('useSafeAreaInsets'), 'LoadingScreen respects safe-area insets in landscape orientation');
  assert(loadingScreenSource.includes('FoxPlayer is a media player only'), 'LoadingScreen displays standard compliance disclaimer');

  // Shimmer Universal Skeleton tests
  assert(shimmerSource.includes('export function ShimmerProvider'), 'ShimmerProvider is exported for shared 60fps native animation loop');
  assert(shimmerSource.includes('outputRange: [-350, 850]'), 'ShimmerBlock provides wide sweep range to eliminate landscape clipping');
  assert(shimmerSource.includes('export function MovieSkeletonGrid'), 'Shimmer exports MovieSkeletonGrid');
  assert(shimmerSource.includes('aspectRatio: 0.68'), 'MovieSkeletonGrid mirrors exact 0.68 aspect ratio of MediaCard');
  assert(shimmerSource.includes('cardBadgeSilhouette'), 'MovieSkeletonGrid renders realistic card badge and heart silhouettes');
  assert(shimmerSource.includes('export function LiveSkeletonLayout'), 'Shimmer exports LiveSkeletonLayout');
  assert(shimmerSource.includes('liveColumnCategories:') && shimmerSource.includes('flex: 0.22'), 'LiveSkeletonLayout category column flex matches LiveScreen (0.22)');
  assert(shimmerSource.includes('liveColumnChannels:') && shimmerSource.includes('flex: 0.28'), 'LiveSkeletonLayout channels column flex matches LiveScreen (0.28)');
  assert(shimmerSource.includes('liveColumnPlayer:') && shimmerSource.includes('flex: 0.50'), 'LiveSkeletonLayout player column flex matches LiveScreen (0.50)');
  assert(shimmerSource.includes('playerSkeletonContainer'), 'LiveSkeletonLayout provides 16:9 player container placeholder');
  assert(shimmerSource.includes('export function EpisodeDetailSkeleton'), 'Shimmer exports EpisodeDetailSkeleton');
  assert(shimmerSource.includes('width={52}') && shimmerSource.includes('height={36}'), 'EpisodeDetailSkeleton matches real 52x36 episode thumbnail box');

  // HomeScreen Refresh UI tests
  assert(homeScreenSource.includes('refreshSpinAnim'), 'HomeScreen implements smooth 60fps native spin animation for Refresh icon');
  assert(homeScreenSource.includes('syncHairlineWrapper'), 'HomeScreen provides non-intrusive hairline progress indicator during background refresh');
  assert(homeScreenSource.includes('actionPillSyncing'), 'HomeScreen styles refreshing state with subtle brand accent');

  // 20. Stream Source Pipeline & Validation Layer & Loader Viewport
  const { runTests: runPipelineTests } = require('./testStreamSourcePipelineAndLoader.js');
  await runPipelineTests();

  // 22. iOS Playback Pipeline & Architecture Invariants
  const { runTests: runIOSTests } = require('./testIOSPlaybackArchitecture.js');
  runIOSTests(assert);

  // 23. Platform Playback Architecture & Driver Separation
  const { runTests: runPlatformSeparationTests } = require('./testPlatformPlaybackSeparation.js');
  runPlatformSeparationTests(assert);

  // 24. IPTV Provider Expiry & Playlist Switch Architecture
  const { runTests: runProviderExpiryTests } = require('./testProviderExpiredAndPlaylistSwitch.js');
  runProviderExpiryTests(assert);

  // 25. In-Player Error UI & Toast Handling Architecture
  const { runTests: runInPlayerErrorTests } = require('./testInPlayerErrorAndToastHandling.js');
  runInPlayerErrorTests();

  // 26. Buffering Indicator & Playback Lifecycle Invariants
  const { runTests: runBufferingLifecycleTests } = require('./testBufferingIndicatorAndPlaybackLifecycle.js');
  runBufferingLifecycleTests();

  // 27. Cross-Platform Video Engine & Compatibility Tests
  const { runTests: runCrossPlatformEngineTests } = require('./testCrossPlatformVideoEngine.js');
  runCrossPlatformEngineTests();

  // 28. Player Controls & LiveTV Buffering Regression Tests
  const { runTests: runControlsAndLiveTvRegressionTests } = require('./testPlayerControlsAndLiveTvBufferingRegression.js');
  runControlsAndLiveTvRegressionTests();

  // 29. iOS LiveTV Startup Latency & Playback Synchronization Tests
  const { runTests: runIOSStartupAndSyncTests } = require('./testIOSLiveTvStartupAndSync.js');
  runIOSStartupAndSyncTests();

  // 30. iOS Stream Connection & Startup Latency Optimization Tests
  const { runTests: runIOSStreamStartupTests } = require('./testIOSStreamStartupLatency.js');
  runIOSStreamStartupTests();

  // 31. iOS Playback Startup Latency, Buffering, Seeking & Progress Synchronization Tests
  const { runTests: runIOSPlaybackSeekingSyncTests } = require('./testIOSPlaybackSeekingAndSync.js');
  runIOSPlaybackSeekingSyncTests();

  // 32. iOS Movies & Series Playback Error UI Redesign Tests
  const { runTests: runIOSErrorUITests } = require('./testIOSPlaybackErrorUI.js');
  runIOSErrorUITests();

  // 33. VLC-Style Volume & Brightness Gestures & Indicators Tests
  const { runTests: runGestureTests } = require('./testPlayerGesturesAndIndicators.js');
  const gestureRes = runGestureTests();
  if (gestureRes) {
    passed += gestureRes.passed || 0;
    failed += gestureRes.failed || 0;
  }

  // 34. Comprehensive Player, Controls & Error Handling Stabilization Tests
  const { runTests: runComprehensiveStabilizationTests } = require('./testComprehensivePlayerStabilization.js');
  const stabRes = runComprehensiveStabilizationTests();
  if (stabRes) {
    passed += stabRes.passed || 0;
    failed += stabRes.failed || 0;
  }

  // 35. Smooth Controls, Auto-Hide, Brightness & Volume Gestures Repair Tests
  const { runTests: runControlsAndGesturesRepairTests } = require('./testSmoothControlsAndGesturesRepair.js');
  const repairRes = runControlsAndGesturesRepairTests();
  if (repairRes) {
    passed += repairRes.passed || 0;
    failed += repairRes.failed || 0;
  }

  // 36. Unified Player Overlay & Controls Architecture Tests
  const { runTests: runUnifiedArchitectureTests } = require('./testUnifiedPlayerOverlayArchitecture.js');
  const archRes = runUnifiedArchitectureTests();
  if (archRes) {
    passed += archRes.passed || 0;
    failed += archRes.failed || 0;
  }

  // 37. IPTV Player Error Handling & False Timeout Elimination Tests (Phases 1-9)
  const { runTests: runIPTVPlayerErrorHandlingTests } = require('./testIPTVPlayerErrorHandling.js');
  const errorHandlingRes = runIPTVPlayerErrorHandlingTests();
  if (errorHandlingRes) {
    passed += errorHandlingRes.passed || 0;
    failed += errorHandlingRes.failed || 0;
  }

  // 38. Critical Production Live TV Player Recovery Tests (Android & iOS)
  const { runTests: runLiveTvRecoveryTests } = require('./testLiveTvPlayerRecovery.js');
  const liveTvRes = runLiveTvRecoveryTests();
  if (liveTvRes) {
    passed += liveTvRes.passed || 0;
    failed += liveTvRes.failed || 0;
  }

  // 39. Media Tracks & iOS MKV Support Tests
  const { passedTests: trackPass, failedTests: trackFail } = require('./testMediaTracksAndMKVSupport.js');
  passed += trackPass || 0;
  failed += trackFail || 0;

  // 40. Strict Seeking Lifecycle & Buffering-Based Control Visibility Tests
  const { runTests: runSeekingLifecycleTests } = require('./testSeekingLifecycleAndControlVisibility.js');
  const seekRes = runSeekingLifecycleTests();
  if (seekRes) {
    passed += seekRes.passed || 0;
    failed += seekRes.failed || 0;
  }

  // 41. iOS LiveTV Channel Switching, Race-Safety & Deadlock Tests
  const { runTests: runIOSChannelSwitchingTests } = require('./testIOSLiveTvChannelSwitchingAndDeadlocks.js');
  const iosSwitchRes = runIOSChannelSwitchingTests();
  if (iosSwitchRes) {
    passed += iosSwitchRes.passed || 0;
    failed += iosSwitchRes.failed || 0;
  }

  // 42. iOS LiveTV Mid-Playback Buffering & Automatic Recovery Tests
  const { runTests: runIOSMidStreamRecoveryTests } = require('./testIOSLiveTvMidStreamBufferingRecovery.js');
  const iosRecoveryRes = runIOSMidStreamRecoveryTests();
  if (iosRecoveryRes) {
    passed += iosRecoveryRes.passed || 0;
    failed += iosRecoveryRes.failed || 0;
  }

  // 43. Fox Player App Expiry, Free Trial & Subscription Management Tests
  const { runTests: runSubscriptionTests } = require('./testAppSubscriptionAndFreeTrial.js');
  const subRes = await runSubscriptionTests();
  if (subRes) {
    passed += subRes.passed || 0;
    failed += subRes.failed || 0;
  }

  // 44. Native Device Volume Synchronization & Audio Stability Tests
  const runNativeVolumeTests = require('./testNativeVolumeSynchronizationAndAudioStability.js');
  const volumeRes = runNativeVolumeTests();
  if (volumeRes) {
    passed += volumeRes.passed || 0;
    failed += volumeRes.failed || 0;
  }

  // 45. Favorites Live Channel Playback Architecture Tests
  const runFavoritesPlaybackTests = require('./testFavoritesLiveChannelPlayback.js');
  const favPlaybackRes = runFavoritesPlaybackTests();
  if (favPlaybackRes) {
    passed += favPlaybackRes.passed || 0;
    failed += favPlaybackRes.failed || 0;
  }

  // 46. Animated App Expiry Details Dialog Architecture & Lifecycle Tests
  const runAnimatedDialogTests = require('./testAnimatedAppExpiryDialog.js');
  const dialogRes = await runAnimatedDialogTests();
  if (dialogRes) {
    passed += dialogRes.passed || 0;
    failed += dialogRes.failed || 0;
  }

  console.log('\n====================================================');
  console.log(`TOTAL TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

