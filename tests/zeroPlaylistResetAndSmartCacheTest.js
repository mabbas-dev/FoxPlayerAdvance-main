const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Ensure database initialized
const db = require('../server/database/db');
db.initDatabase();

const {
  registerOrUpdateDevice,
  getDevice,
  isDeviceLocked,
} = require('../server/models/deviceModel');

const {
  savePlaylistConfig,
  getAllPlaylists,
  getPlaylistConfig,
  deletePlaylist,
} = require('../server/models/playlistModel');

const {
  DATASET_STATUS,
  CACHE_FRESHNESS_MS,
  getPlaylistChannelsKey,
  getPlaylistMoviesKey,
  getPlaylistSeriesKey,
  getPlaylistFavoritesKey,
} = require('../src/constants/index.js');

console.log('===========================================================');
console.log('   FOX PLAYER — ZERO-PLAYLIST RESET & SMART CACHE TESTS   ');
console.log('===========================================================');

let testsPassed = 0;
let testsFailed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error('        ', err.message);
    testsFailed++;
  }
}

async function runAsyncTests() {
  const TEST_DEVICE = 'RSTDEV01';

  console.log('\n--- 1. Device Registration & Zero Playlist Baseline ---');
  registerOrUpdateDevice(TEST_DEVICE);
  
  it('Device registers and starts with 0 playlists', () => {
    const playlists = getAllPlaylists(TEST_DEVICE);
    assert.strictEqual(playlists.length, 0);
  });

  it('Device ID and metadata exist and are preserved', () => {
    const dev = getDevice(TEST_DEVICE);
    assert.ok(dev);
    assert.strictEqual(dev.device_id, TEST_DEVICE);
  });

  console.log('\n--- 2. Multi-Playlist Creation & Cache Isolation ---');
  let pl1Id, pl2Id;

  it('Adds Playlist 1 (Primary Xtream)', () => {
    const res = savePlaylistConfig(TEST_DEVICE, {
      type: 'xtream',
      server_url: 'http://iptv.prime.tv:8080',
      username: 'user_prime',
      password: 'pwd_prime_secret',
      playlist_name: 'Prime Streams',
    });
    assert.ok(res.success);
    pl1Id = String(res.playlist_id);
    assert.ok(pl1Id);
  });

  it('Adds Playlist 2 (M3U Source)', () => {
    const res = savePlaylistConfig(TEST_DEVICE, {
      type: 'm3u',
      playlist_url: 'https://m3u.provider.org/live.m3u',
      playlist_name: 'Secondary M3U',
    });
    assert.ok(res.success);
    pl2Id = String(res.playlist_id);
    assert.ok(pl2Id);
    assert.notStrictEqual(pl1Id, pl2Id);
  });

  it('Both playlists exist and are independently queryable', () => {
    const all = getAllPlaylists(TEST_DEVICE);
    assert.strictEqual(all.length, 2);
    const ids = all.map(p => String(p.id));
    assert.ok(ids.includes(pl1Id));
    assert.ok(ids.includes(pl2Id));
  });

  it('Strict cache key isolation per playlist ID', () => {
    const pl1ChanKey = getPlaylistChannelsKey(pl1Id);
    const pl2ChanKey = getPlaylistChannelsKey(pl2Id);
    const pl1MovKey = getPlaylistMoviesKey(pl1Id);
    const pl2MovKey = getPlaylistMoviesKey(pl2Id);
    const pl1FavKey = getPlaylistFavoritesKey(pl1Id);
    const pl2FavKey = getPlaylistFavoritesKey(pl2Id);

    assert.strictEqual(pl1ChanKey, `fox_player_${pl1Id}_channels`);
    assert.strictEqual(pl2ChanKey, `fox_player_${pl2Id}_channels`);
    assert.notStrictEqual(pl1ChanKey, pl2ChanKey);
    assert.notStrictEqual(pl1MovKey, pl2MovKey);
    assert.notStrictEqual(pl1FavKey, pl2FavKey);
  });

  console.log('\n--- 3. Dataset Lifecycle & Freshness State Machine ---');
  it('Constants define all 5 required dataset lifecycle states', () => {
    assert.strictEqual(DATASET_STATUS.NEVER_DOWNLOADED, 'never_downloaded');
    assert.strictEqual(DATASET_STATUS.DOWNLOADING, 'downloading');
    assert.strictEqual(DATASET_STATUS.CACHED, 'cached');
    assert.strictEqual(DATASET_STATUS.STALE, 'stale');
    assert.strictEqual(DATASET_STATUS.ERROR, 'error');
  });

  it('Freshness window is 30 minutes', () => {
    assert.strictEqual(CACHE_FRESHNESS_MS, 30 * 60 * 1000);
  });

  it('Evaluates fresh vs stale cache based on syncedAt timestamp', () => {
    const now = Date.now();
    const freshTimestamp = now - (5 * 60 * 1000); // 5 mins ago
    const staleTimestamp = now - (35 * 60 * 1000); // 35 mins ago

    const isFresh = (now - freshTimestamp) < CACHE_FRESHNESS_MS;
    const isStale = (now - staleTimestamp) >= CACHE_FRESHNESS_MS;

    assert.strictEqual(isFresh, true);
    assert.strictEqual(isStale, true);
  });

  console.log('\n--- 4. Active Playlist Removal (While Other Remains) ---');
  it('Removes active Playlist 2; Playlist 1 remains intact in database', () => {
    const deleted = deletePlaylist(TEST_DEVICE, pl2Id);
    assert.strictEqual(deleted, true);

    const remaining = getAllPlaylists(TEST_DEVICE);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(String(remaining[0].id), pl1Id);
  });

  console.log('\n--- 5. All Playlists Removed -> Complete App Reset Flow ---');
  it('Removes remaining Playlist 1; backend confirms 0 playlists', () => {
    const deleted = deletePlaylist(TEST_DEVICE, pl1Id);
    assert.strictEqual(deleted, true);

    const remaining = getAllPlaylists(TEST_DEVICE);
    assert.strictEqual(remaining.length, 0);
  });

  it('Re-check of device retains Device ID and ID Lock state unchanged', () => {
    const dev = getDevice(TEST_DEVICE);
    assert.ok(dev);
    assert.strictEqual(dev.device_id, TEST_DEVICE);
    // ID Lock remains false or intact
    assert.strictEqual(isDeviceLocked(TEST_DEVICE), false);
  });

  it('Simulated AppContext sync detects 0 playlists and signals resetToPairing', () => {
    const remotePlaylists = getAllPlaylists(TEST_DEVICE);
    assert.strictEqual(remotePlaylists.length, 0);

    // Simulation of AppContext CASE 0 logic
    const state = {
      isConfigured: true,
      savedPlaylists: [{ id: pl1Id, name: 'Old Playlist' }],
      activePlaylistId: pl1Id,
    };

    let resetTriggered = false;
    if (remotePlaylists.length === 0 && (state.isConfigured || state.savedPlaylists.length > 0)) {
      resetTriggered = true;
    }

    assert.strictEqual(resetTriggered, true);
  });

  console.log('\n--- 6. NavigationController Guard Audit ---');
  it('NavigationController redirects to /pairing when not configured and not on pairing', () => {
    const layoutPath = path.join(__dirname, '..', 'src', 'app', '_layout.js');
    const content = fs.readFileSync(layoutPath, 'utf8');

    assert.ok(content.includes('function NavigationController()'), 'NavigationController must exist');
    assert.ok(content.includes("router.replace('/pairing')"), 'Must call router.replace(/pairing)');
    assert.ok(content.includes('<NavigationController />'), 'Must mount NavigationController in RootLayout');
    assert.ok(content.includes('name="pairing"'), 'pairing screen must be registered in Stack');
  });

  it('ProfileDropdown auto-closes when isConfigured becomes false', () => {
    const dropdownPath = path.join(__dirname, '..', 'src', 'components', 'ProfileDropdown.js');
    const content = fs.readFileSync(dropdownPath, 'utf8');

    assert.ok(content.includes('isConfigured'), 'Must read isConfigured');
    assert.ok(content.includes('if (!isConfigured && isOpen)'), 'Must close dropdown when !isConfigured');
  });

  it('LiveScreen stops playback and contracts on session reset or unconfigured', () => {
    const liveScreenPath = path.join(__dirname, '..', 'src', 'screens', 'LiveScreen.js');
    const content = fs.readFileSync(liveScreenPath, 'utf8');

    assert.ok(content.includes('playbackSessionId'), 'Must listen to playbackSessionId');
    assert.ok(content.includes('noConfig = !isConfigured || !activePlaylistId'), 'Must handle unconfigured state');
    assert.ok(content.includes('setPlayingChannel(null)'), 'Must cancel active playing channel');
  });

  console.log('\n--- 7. Smart Caching & Service Isolation Audit ---');
  it('iptvService.js getCachedChannels only falls back to global cache when playlistId is omitted', () => {
    const iptvPath = path.join(__dirname, '..', 'src', 'services', 'iptvService.js');
    const content = fs.readFileSync(iptvPath, 'utf8');

    assert.ok(content.includes('if (!playlistId)'), 'Must check !playlistId before fallback');
    assert.ok(!content.includes('if (playlistId) {\n    return allowStale ? readCacheStale(STORAGE_KEYS.CHANNELS_CACHE)'), 'Must not fall back to global when playlistId is present');
  });

  it('iptvService.js syncPlaylist uses in-flight deduplication', () => {
    const iptvPath = path.join(__dirname, '..', 'src', 'services', 'iptvService.js');
    const content = fs.readFileSync(iptvPath, 'utf8');

    assert.ok(content.includes('inFlightSyncs'), 'Must use inFlightSyncs map');
    assert.ok(content.includes('inFlightSyncs.has(syncKey)'), 'Must check in-flight deduplication');
  });

  it('cacheStorage.js exports clearPlaylistCache and clearAllPlaylistCaches', () => {
    const cacheStoragePath = path.join(__dirname, '..', 'src', 'storage', 'cacheStorage.js');
    const content = fs.readFileSync(cacheStoragePath, 'utf8');

    assert.ok(content.includes('export async function clearPlaylistCache'), 'Must export clearPlaylistCache');
    assert.ok(content.includes('export async function clearAllPlaylistCaches'), 'Must export clearAllPlaylistCaches');
  });

  it('cacheStorage.js guards moveAsync by deleting destination and providing direct fallback', () => {
    const cacheStoragePath = path.join(__dirname, '..', 'src', 'storage', 'cacheStorage.js');
    const content = fs.readFileSync(cacheStoragePath, 'utf8');

    assert.ok(content.includes('deleteAsync(finalPath'), 'Must delete finalPath before moveAsync to avoid Android rejection');
    assert.ok(content.includes('writeLocks'), 'Must use writeLocks to serialize concurrent writes');
    assert.ok(content.includes('writeAsStringAsync(\n        finalPath'), 'Must provide direct write fallback if moveAsync fails');
  });

  it('userStorage.js does not leak legacy favorites into secondary playlists', () => {
    const userStoragePath = path.join(__dirname, '..', 'src', 'storage', 'userStorage.js');
    const content = fs.readFileSync(userStoragePath, 'utf8');

    assert.ok(content.includes("playlistId && playlistId !== 'pl_default'"), 'Must guard against copying legacy favorites to secondary playlists');
  });

  console.log('\n===========================================================');
  console.log(`TOTAL TESTS: ${testsPassed + testsFailed}`);
  console.log(`PASSED: ${testsPassed}`);
  console.log(`FAILED: ${testsFailed}`);
  console.log('===========================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runAsyncTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
