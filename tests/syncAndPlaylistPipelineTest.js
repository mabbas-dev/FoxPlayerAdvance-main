/**
 * FOX PLAYER — AUTOMATIC SYNCHRONIZATION, PLAYLIST PIPELINE & SQLITE REMOVAL TEST
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Legacy better-sqlite3 completely removed in favor of remote MySQL REST API
const db = null;

console.log('===========================================================');
console.log('   FOX PLAYER — SYNC, PLAYLIST PIPELINE & SQLITE AUDIT     ');
console.log('===========================================================');

let testCount = 0;
let passCount = 0;

function it(desc, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  [PASS] ${desc}`);
  } catch (e) {
    console.error(`  [FAIL] ${desc}`);
    console.error(`         ${e.message}`);
  }
}

async function itAsync(desc, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  [PASS] ${desc}`);
  } catch (e) {
    console.error(`  [FAIL] ${desc}`);
    console.error(`         ${e.message}`);
  }
}

const { initDatabase } = require('../server/database/db');
const {
  savePlaylistConfig,
  getAllPlaylists,
  getPlaylistConfig,
  setActivePlaylist,
  deletePlaylist,
} = require('../server/models/playlistModel');
const { registerOrUpdateDevice } = require('../server/models/deviceModel');

async function runTests() {
  await initDatabase();

  const testDevId = 'SYNCTEST';
  registerOrUpdateDevice(testDevId);

  // Clean test device
  db.prepare('DELETE FROM playlist_configs WHERE device_id = ?').run(testDevId);
  db.prepare('DELETE FROM device_playlists WHERE device_id = ?').run(testDevId);

  console.log('\n--- 1. Backend Pipeline & Multi-Playlist Integrity ---');

  it('New device starts with zero playlists', () => {
    const list = getAllPlaylists(testDevId);
    assert(Array.isArray(list) && list.length === 0, 'Initial list is empty');
  });

  let p1, p2, p3, p4, p5;

  it('Adds first Xtream playlist (News)', () => {
    const res = savePlaylistConfig(testDevId, {
      type: 'xtream',
      playlist_name: 'World News',
      server_url: 'http://stream.net:8080',
      username: 'news_user',
      password: 'secret_pw_1',
    });
    assert(res.success && res.playlist_id, 'First playlist created');
    p1 = String(res.playlist_id);
  });

  it('Adds second Xtream playlist on SAME server without overwriting first playlist', () => {
    const res = savePlaylistConfig(testDevId, {
      type: 'xtream',
      playlist_name: 'Sports HD',
      server_url: 'http://stream.net:8080',
      username: 'news_user', // Same credentials, different playlist entry!
      password: 'secret_pw_1',
    });
    assert(res.success && res.playlist_id, 'Second playlist created');
    p2 = String(res.playlist_id);
    assert(p1 !== p2, 'IDs must be distinct');

    const all = getAllPlaylists(testDevId);
    assert(all.length === 2, `Expected 2 playlists, found ${all.length}`);
    assert(all.some(p => p.name === 'World News'), 'World News preserved');
    assert(all.some(p => p.name === 'Sports HD'), 'Sports HD preserved');
  });

  it('Adds third playlist (M3U Source 1)', () => {
    const res = savePlaylistConfig(testDevId, {
      type: 'm3u',
      playlist_name: 'Documentary M3U',
      playlist_url: 'http://docu.provider.com/playlist.m3u8',
    });
    assert(res.success && res.playlist_id);
    p3 = String(res.playlist_id);
  });

  it('Adds fourth playlist (M3U Source 2) without overwriting', () => {
    const res = savePlaylistConfig(testDevId, {
      type: 'm3u',
      playlist_name: 'Kids Channels M3U',
      playlist_url: 'http://docu.provider.com/playlist.m3u8', // Same URL, different playlist entry!
    });
    assert(res.success && res.playlist_id);
    p4 = String(res.playlist_id);
    assert(p3 !== p4, 'M3U playlists have distinct IDs');
  });

  it('Adds fifth playlist (Movies 4K Xtream)', () => {
    const res = savePlaylistConfig(testDevId, {
      type: 'xtream',
      playlist_name: 'Cinema 4K',
      server_url: 'http://cinema.net:8000',
      username: 'cine_vip',
      password: 'cinema_password',
    });
    assert(res.success && res.playlist_id);
    p5 = String(res.playlist_id);
  });

  it('getAllPlaylists returns EVERY associated playlist (all 5 present)', () => {
    const all = getAllPlaylists(testDevId);
    assert.strictEqual(all.length, 5, 'Must return all 5 playlists');
    const ids = all.map(p => p.id);
    assert(ids.includes(p1), 'Contains p1');
    assert(ids.includes(p2), 'Contains p2');
    assert(ids.includes(p3), 'Contains p3');
    assert(ids.includes(p4), 'Contains p4');
    assert(ids.includes(p5), 'Contains p5');
  });

  it('Passwords are strictly omitted from getAllPlaylists', () => {
    const all = getAllPlaylists(testDevId);
    for (const pl of all) {
      assert(pl.password === undefined, 'No password field in public list');
    }
  });

  console.log('\n--- 2. Client Normalization & Storage Reconciliation ---');

  const playlistStorageSrc = fs.readFileSync(path.join(__dirname, '../src/storage/playlistStorage.js'), 'utf8');

  it('playlistStorage.js normalizes playlist with stable ID and fields', () => {
    assert(playlistStorageSrc.includes('export function normalizePlaylist'), 'Exports normalizePlaylist');
    assert(playlistStorageSrc.includes('raw.id || raw.playlist_id'), 'Resolves raw.id or raw.playlist_id');
  });

  it('savePlaylist matches strictly by unique ID (never drops items by URL/host)', () => {
    assert(playlistStorageSrc.includes('String(p.id) === strId'), 'Strict ID equality in savePlaylist');
    assert(!playlistStorageSrc.includes('p.serverUrl?.toLowerCase() === normalized.serverUrl?.toLowerCase()'), 'Eliminated loose URL deduplication that caused playlist drops');
  });

  it('syncSavedPlaylistsWithRemote exports and reconciles authoritative remote playlists', () => {
    assert(playlistStorageSrc.includes('export async function syncSavedPlaylistsWithRemote'), 'Exports syncSavedPlaylistsWithRemote');
    assert(playlistStorageSrc.includes('remoteIds.add(strId)'), 'Tracks all remote IDs');
    assert(playlistStorageSrc.includes('STORAGE_KEYS.SAVED_PLAYLISTS, reconciled'), 'Persists reconciled list to cache');
  });

  console.log('\n--- 3. Playlist Removal & Fallback Safety ---');

  it('Deletes one playlist from backend while keeping remaining intact', () => {
    const delSuccess = deletePlaylist(testDevId, p3);
    assert.strictEqual(delSuccess, true);

    const remaining = getAllPlaylists(testDevId);
    assert.strictEqual(remaining.length, 4, 'Remaining count is 4');
    const remainingIds = remaining.map(p => p.id);
    assert(!remainingIds.includes(p3), 'Deleted p3 is gone');
    assert(remainingIds.includes(p1), 'p1 remains');
    assert(remainingIds.includes(p2), 'p2 remains');
    assert(remainingIds.includes(p4), 'p4 remains');
    assert(remainingIds.includes(p5), 'p5 remains');
  });

  it('playlistStorage.js syncSavedPlaylistsWithRemote purges deleted remote playlists from cache', () => {
    assert(playlistStorageSrc.includes('!remoteIds.has(String(localPl.id))'), 'Identifies deleted remote playlists');
    assert(playlistStorageSrc.includes('deleteCache(`fox_player_${localPl.id}_config`)'), 'Purges cached config for deleted playlist');
    assert(playlistStorageSrc.includes('deleteCache(`fox_player_${localPl.id}_channels`)'), 'Purges cached channels for deleted playlist');
  });

  console.log('\n--- 4. Client SQLite Removal & Idempotent Cleanup Audit ---');

  it('Client package.json contains zero SQLite dependencies', () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const allDeps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
    for (const dep of Object.keys(allDeps)) {
      assert(!dep.toLowerCase().includes('sqlite'), `Found unexpected SQLite package in client: ${dep}`);
    }
  });

  it('Client src/ directory contains zero imports of sqlite', () => {
    function walkDir(dir) {
      let results = [];
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          results = results.concat(walkDir(full));
        } else if (/\.(js|jsx|ts|tsx)$/.test(file)) {
          const content = fs.readFileSync(full, 'utf8');
          if (/from ['"][^'"]*sqlite[^'"]*['"]/i.test(content) || /require\(['"][^'"]*sqlite[^'"]*['"]\)/i.test(content)) {
            results.push(full);
          }
        }
      }
      return results;
    }

    const sqliteImports = walkDir(path.join(__dirname, '../src'));
    assert.strictEqual(sqliteImports.length, 0, `Found sqlite imports in: ${sqliteImports.join(', ')}`);
  });

  it('legacyDbCleanup.js exists and exports cleanupLegacySqlite', () => {
    const cleanupSrc = fs.readFileSync(path.join(__dirname, '../src/storage/legacyDbCleanup.js'), 'utf8');
    assert(cleanupSrc.includes('export async function cleanupLegacySqlite'), 'Exports cleanupLegacySqlite');
    assert(cleanupSrc.includes('fox_legacy_sqlite_cleaned_v2'), 'Uses persistent flag for idempotency');
    assert(cleanupSrc.includes('FileSystem.deleteAsync'), 'Deletes legacy database files safely');
  });

  it('AppContext.js calls cleanupLegacySqlite during initialization', () => {
    const appCtxSrc = fs.readFileSync(path.join(__dirname, '../src/state/AppContext.js'), 'utf8');
    assert(appCtxSrc.includes('cleanupLegacySqlite()'), 'AppContext invokes cleanupLegacySqlite');
  });

  console.log('\n--- 5. Automatic Synchronization Architecture ---');

  it('AppContext.js uses monotonic sequence ref for stale response protection', () => {
    const appCtxSrc = fs.readFileSync(path.join(__dirname, '../src/state/AppContext.js'), 'utf8');
    assert(appCtxSrc.includes('syncSequenceRef'), 'Uses syncSequenceRef');
    assert(appCtxSrc.includes('STALE_RESPONSE'), 'Discards stale responses');
  });

  it('AppContext.js uses in-flight guard to prevent duplicate overlapping requests', () => {
    const appCtxSrc = fs.readFileSync(path.join(__dirname, '../src/state/AppContext.js'), 'utf8');
    assert(appCtxSrc.includes('syncInFlightRef'), 'Uses syncInFlightRef');
  });

  it('AppContext.js auto-initializes and loads playlist content on first addition', () => {
    const appCtxSrc = fs.readFileSync(path.join(__dirname, '../src/state/AppContext.js'), 'utf8');
    assert(appCtxSrc.includes('reloadPlaylist(newActiveId)'), 'Calls reloadPlaylist on first playlist addition');
    assert(appCtxSrc.includes('initialized: true'), 'Flags initialized on first addition');
  });

  it('AppContext.js implements network reconnection and AppState foreground listeners', () => {
    const appCtxSrc = fs.readFileSync(path.join(__dirname, '../src/state/AppContext.js'), 'utf8');
    assert(appCtxSrc.includes('Network.getNetworkStateAsync'), 'Monitors network connectivity for reconnection');
    assert(appCtxSrc.includes("nextAppState === 'active'"), 'Listens to AppState active for foreground sync');
  });

  // Clean up test device
  db.prepare('DELETE FROM playlist_configs WHERE device_id = ?').run(testDevId);
  db.prepare('DELETE FROM device_playlists WHERE device_id = ?').run(testDevId);
  db.prepare('DELETE FROM devices WHERE device_id = ?').run(testDevId);

  console.log('\n===========================================================');
  console.log(`TOTAL TESTS: ${testCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${testCount - passCount}`);
  console.log('===========================================================');

  if (testCount - passCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner caught unexpected error:', err);
  process.exit(1);
});
