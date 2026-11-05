/**
 * FOX PLAYER — End-to-End System Overhaul Verification Test Suite
 *
 * Tests the complete workflow:
 * 1. Device registration & initial setup state
 * 2. Pairing token & 6-digit code generation
 * 3. Website device lookup & empty state check
 * 4. Pairing exchange via token and 6-digit code (no admin password)
 * 5. First playlist addition & database persistence
 * 6. App discovery and synchronization
 * 7. Multiple playlist management & isolation
 * 8. ID Lock ON -> Backend strictly rejects Add & Remove mutations with HTTP 403 DEVICE_LOCKED
 * 9. ID Lock OFF -> Mutations permitted
 * 10. Security: unauthorized sessions rejected, cross-device isolation verified, credentials never leaked
 */

const express = require('../server/node_modules/express');
const http = require('http');
const path = require('path');

// Configure test environment with in-memory SQLite DB
process.env.DATABASE_PATH = ':memory:';
process.env.ENCRYPTION_KEY = 'test_secret_key_32_bytes_length!!';

const { initDatabase, getDb } = require('../server/database/db');
const {
  isValidDeviceId,
  registerOrUpdateDevice,
  getDevice,
  setIdLock,
  isDeviceLocked,
  getOrCreatePairingToken,
  pairDevice,
  verifyManagementSession,
} = require('../server/models/deviceModel');
const {
  savePlaylistConfig,
  getPlaylistConfig,
  getAllPlaylists,
  deletePlaylist,
  getPublicPlaylistConfig,
  getSafeServerHost,
} = require('../server/models/playlistModel');
const apiRoutes = require('../server/routes/api');

let server;
let baseUrl;

async function startServer() {
  await initDatabase();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api', apiRoutes);

  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(resolve);
    } else {
      resolve();
    }
  });
}

async function api(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runE2ETests() {
  console.log('===========================================================');
  console.log('    FOX PLAYER — END-TO-END SYSTEM OVERHAUL TEST SUITE     ');
  console.log('===========================================================\n');

  await startServer();

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // ----------------------------------------------------
    // STAGE 1: First App Launch & Setup State
    // ----------------------------------------------------
    console.log('--- 1. First App Launch & Registration ---');
    const testDeviceId = 'FOXTEST1';

    // 1.1 Register device via backend API
    const regRes = await api('/api/devices/register', {
      method: 'POST',
      body: { device_id: testDeviceId },
    });

    assert(regRes.status === 200 && regRes.data.success, 'App registers device ID successfully');
    assert(regRes.data.device.id_lock === false, 'New device has ID Lock OFF (0) by default');
    assert(typeof regRes.data.device.pairing_token === 'string', 'Server returns pairing token on registration');
    assert(typeof regRes.data.device.pairing_code === 'string' && regRes.data.device.pairing_code.length === 6, 'Server returns 6-digit TV pairing code');

    const pairingToken = regRes.data.device.pairing_token;
    const pairingCode = regRes.data.device.pairing_code;

    // 1.2 Fetch playlists for empty device
    const initialList = await api(`/api/device/${testDeviceId}/playlists`);
    assert(initialList.status === 200, 'Device lookup returns 200');
    assert(Array.isArray(initialList.data.playlists) && initialList.data.playlists.length === 0, 'No playlists found initially (empty state)');
    assert(initialList.data.id_lock === false, 'Public lookup reports ID Lock status as unlocked');

    // ----------------------------------------------------
    // STAGE 2: Website Device Lookup & Pairing Flow
    // ----------------------------------------------------
    console.log('\n--- 2. Website Pairing & Authorization (No Admin Password) ---');

    // 2.1 Attempt mutation WITHOUT authorization -> Rejected with 401
    const unauthAdd = await api(`/api/device/${testDeviceId}/playlists`, {
      method: 'POST',
      body: {
        type: 'xtream',
        server_url: 'http://test-server.tv:8080',
        username: 'alice',
        password: 'alice_password',
        playlist_name: 'Alice Live TV',
      },
    });
    assert(unauthAdd.status === 401 && unauthAdd.data.error.code === 'UNAUTHORIZED', 'Unauthorized mutation rejected without pairing');

    // 2.2 Complete pairing via QR URL token
    const pairByTokenRes = await api('/api/auth/pair', {
      method: 'POST',
      body: { device_id: testDeviceId, token: pairingToken },
    });
    assert(pairByTokenRes.status === 200 && pairByTokenRes.data.success, 'Pairing exchange via token succeeds');
    assert(typeof pairByTokenRes.data.session_token === 'string', 'Session token issued');
    let websiteSessionToken = pairByTokenRes.data.session_token;

    // 2.3 Also verify pairing via 6-digit TV code
    const pairByCodeRes = await api('/api/auth/pair', {
      method: 'POST',
      body: { device_id: testDeviceId, code: pairingCode },
    });
    assert(pairByCodeRes.status === 200 && pairByCodeRes.data.success, 'Pairing exchange via 6-digit TV code succeeds');
    websiteSessionToken = pairByCodeRes.data.session_token;

    // 2.4 Verify invalid code is rejected
    const badCodeRes = await api('/api/auth/pair', {
      method: 'POST',
      body: { device_id: testDeviceId, code: '000000' },
    });
    assert(badCodeRes.status === 401 && badCodeRes.data.error.code === 'INVALID_PAIRING', 'Invalid 6-digit pairing code rejected');

    // ----------------------------------------------------
    // STAGE 3: First Playlist Addition & App Auto-Transition
    // ----------------------------------------------------
    console.log('\n--- 3. First Playlist Addition & Persistence ---');

    // 3.1 Add first playlist through website session
    const addFirstRes = await api(`/api/device/${testDeviceId}/playlists`, {
      method: 'POST',
      headers: { 'x-session-token': websiteSessionToken },
      body: {
        type: 'xtream',
        server_url: 'http://first-iptv.net:8080',
        username: 'user1',
        password: 'pass1_secret',
        playlist_name: 'Primary Xtream',
      },
    });
    assert(addFirstRes.status === 200 && addFirstRes.data.success, 'First playlist added through website session (no admin password)');
    const pl1Id = addFirstRes.data.playlist.id;
    assert(typeof pl1Id === 'string' && pl1Id.length > 0, 'First playlist has stable ID');

    // 3.2 Verify database persistence
    const appLookupRes = await api(`/api/device/${testDeviceId}/playlists`);
    assert(appLookupRes.data.playlists.length === 1, 'App polling discovers 1 playlist in database');
    assert(appLookupRes.data.playlists[0].name === 'Primary Xtream', 'Playlist name matches Primary Xtream');
    assert(appLookupRes.data.active_playlist_id === pl1Id, 'First playlist is automatically active');

    // 3.3 Verify playlist config retrieval for app
    const appConfigRes = await api(`/api/device/${testDeviceId}/playlist?playlist_id=${pl1Id}`);
    assert(appConfigRes.data.configured === true, 'App retrieves valid playlist configuration');
    assert(appConfigRes.data.configuration.username === 'user1', 'Configuration contains correct username');
    assert(appConfigRes.data.configuration.password === 'pass1_secret', 'Configuration contains decrypted password for player');

    // ----------------------------------------------------
    // STAGE 4: Multiple Playlists Management & Switching
    // ----------------------------------------------------
    console.log('\n--- 4. Multiple Playlists Management ---');

    // 4.1 Add second playlist (M3U)
    const addSecondRes = await api(`/api/device/${testDeviceId}/playlists`, {
      method: 'POST',
      headers: { 'x-session-token': websiteSessionToken },
      body: {
        type: 'm3u',
        playlist_url: 'https://m3u-provider.org/stream.m3u',
        playlist_name: 'Secondary M3U',
      },
    });
    assert(addSecondRes.status === 200 && addSecondRes.data.success, 'Second playlist (M3U) added successfully');
    const pl2Id = addSecondRes.data.playlist.id;

    // 4.2 Verify both playlists coexist independently
    const twoPlaylists = await api(`/api/device/${testDeviceId}/playlists`);
    assert(twoPlaylists.data.playlists.length === 2, 'Device now has 2 distinct playlists');
    assert(twoPlaylists.data.playlists.some((p) => p.name === 'Primary Xtream'), 'Primary Xtream preserved intact');
    assert(twoPlaylists.data.playlists.some((p) => p.name === 'Secondary M3U'), 'Secondary M3U present');

    // 4.3 Switch active playlist to pl1
    const switchRes = await api(`/api/device/${testDeviceId}/active-playlist`, {
      method: 'POST',
      headers: { 'x-session-token': websiteSessionToken },
      body: { playlist_id: pl1Id },
    });
    assert(switchRes.status === 200 && switchRes.data.active_playlist_id === pl1Id, 'Switches active playlist to pl1');

    // ----------------------------------------------------
    // STAGE 5: ID Lock Enforcement
    // ----------------------------------------------------
    console.log('\n--- 5. ID Lock Setting & Backend Enforcement ---');

    // 5.1 Set ID Lock to ON from app
    const lockOnRes = await api(`/api/device/${testDeviceId}/id-lock`, {
      method: 'POST',
      headers: { 'x-device-id': testDeviceId },
      body: { id_lock: true },
    });
    assert(lockOnRes.status === 200 && lockOnRes.data.id_lock === true, 'App sets ID Lock to ON');

    // 5.2 Verify backend database reflects ID Lock is ON
    assert(isDeviceLocked(testDeviceId) === true, 'Database authoritative isDeviceLocked is true');

    const statusCheckLocked = await api(`/api/device/${testDeviceId}/id-lock`);
    assert(statusCheckLocked.data.id_lock === true, 'GET /id-lock returns id_lock: true');

    // 5.3 Attempt to ADD playlist while locked -> Must be rejected with HTTP 403 DEVICE_LOCKED
    const lockedAddAttempt = await api(`/api/device/${testDeviceId}/playlists`, {
      method: 'POST',
      headers: { 'x-session-token': websiteSessionToken },
      body: {
        type: 'm3u',
        playlist_url: 'http://illegal-stream.com/list.m3u',
        playlist_name: 'Bypassed Playlist',
      },
    });
    assert(lockedAddAttempt.status === 403, 'Add playlist mutation strictly rejected with HTTP 403');
    assert(lockedAddAttempt.data.error.code === 'DEVICE_LOCKED', 'Returns error code DEVICE_LOCKED');

    // 5.4 Attempt to REMOVE playlist while locked -> Must be rejected with HTTP 403 DEVICE_LOCKED
    const lockedDelAttempt = await api(`/api/device/${testDeviceId}/playlist/${pl2Id}`, {
      method: 'DELETE',
      headers: { 'x-session-token': websiteSessionToken },
    });
    assert(lockedDelAttempt.status === 403, 'Remove playlist mutation strictly rejected with HTTP 403');
    assert(lockedDelAttempt.data.error.code === 'DEVICE_LOCKED', 'Returns error code DEVICE_LOCKED');

    // 5.5 Attempt to bypass lock with forged client body { id_lock: false }
    const forgedAddAttempt = await api(`/api/device/${testDeviceId}/playlists`, {
      method: 'POST',
      headers: { 'x-session-token': websiteSessionToken },
      body: {
        type: 'm3u',
        playlist_url: 'http://forged.com/list.m3u',
        playlist_name: 'Forged Playlist',
        id_lock: false,
        idLock: false,
      },
    });
    assert(forgedAddAttempt.status === 403, 'Client-side forged id_lock: false flag ignored; mutation still rejected');

    // 5.6 Existing playlists still fully accessible for viewing and playback while locked
    const playbackConfigWhileLocked = await api(`/api/device/${testDeviceId}/playlist?playlist_id=${pl1Id}`);
    assert(playbackConfigWhileLocked.status === 200 && playbackConfigWhileLocked.data.configured === true, 'Existing playlists remain playable while locked');

    // 5.7 Unlock ID Lock (toggle back to OFF)
    const unlockRes = await api(`/api/device/${testDeviceId}/id-lock`, {
      method: 'POST',
      headers: { 'x-device-id': testDeviceId },
      body: { id_lock: false },
    });
    assert(unlockRes.status === 200 && unlockRes.data.id_lock === false, 'ID Lock successfully disabled');
    assert(isDeviceLocked(testDeviceId) === false, 'Database reflects id_lock is false');

    // ----------------------------------------------------
    // STAGE 6: Removal Workflow & App Sync
    // ----------------------------------------------------
    console.log('\n--- 6. Playlist Removal Workflow ---');

    // 6.1 Remove pl2 now that ID Lock is OFF
    const removeRes = await api(`/api/device/${testDeviceId}/playlist/${pl2Id}`, {
      method: 'DELETE',
      headers: { 'x-session-token': websiteSessionToken },
    });
    assert(removeRes.status === 200 && removeRes.data.success, 'Playlist pl2 successfully removed');

    // 6.2 Verify only pl1 remains
    const remainingAfterDel = await api(`/api/device/${testDeviceId}/playlists`);
    assert(remainingAfterDel.data.playlists.length === 1, 'Only 1 playlist remains');
    assert(remainingAfterDel.data.playlists[0].id === pl1Id, 'Primary playlist pl1 remains intact');

    // ----------------------------------------------------
    // STAGE 7: Security & Credential Protection
    // ----------------------------------------------------
    console.log('\n--- 7. Security, Cross-Device Isolation & Leaks ---');

    // 7.1 Cross-device isolation: session for TESTDEV1 cannot manage TESTDEV2
    const dev2Res = await api('/api/devices/register', {
      method: 'POST',
      body: { device_id: 'OTHERDEV' },
    });
    assert(dev2Res.status === 200, 'Registers secondary device OTHERDEV');

    const crossDeviceAttack = await api('/api/device/OTHERDEV/playlists', {
      method: 'POST',
      headers: { 'x-session-token': websiteSessionToken }, // TESTDEV1's session token!
      body: {
        type: 'm3u',
        playlist_url: 'http://attack.com/list.m3u',
        playlist_name: 'Hijacked Playlist',
      },
    });
    assert(crossDeviceAttack.status === 401, 'Cross-device management strictly rejected with 401');

    // 7.2 Passwords never leaked in public endpoints
    const publicList = await api(`/api/device/${testDeviceId}/playlists`);
    const publicListStr = JSON.stringify(publicList.data);
    assert(!publicListStr.includes('pass1_secret'), 'General playlist listing never leaks passwords');

    const publicStatus = await api(`/api/device/${testDeviceId}/status`);
    const publicStatusStr = JSON.stringify(publicStatus.data);
    assert(!publicStatusStr.includes('pass1_secret'), 'Device status endpoint never leaks passwords');

    // 7.3 Direct session establishment without requiring any PIN
    const directSessionRes = await api(`/api/device/${testDeviceId}/session`, { method: 'POST' });
    assert(directSessionRes.status === 200 && directSessionRes.data.success, 'Issues management session token without PIN');
    assert(typeof directSessionRes.data.session_token === 'string', 'Session token is returned directly');

    // 7.4 Public playlists endpoint provides session_token for seamless web management
    assert(typeof publicList.data.session_token === 'string', 'Playlists response provides session token for web dashboard');

    // 7.5 Obsolete verify-management PIN endpoint is completely removed
    const obsoletePinEndpoint = await api('/api/auth/verify-management', {
      method: 'POST',
      body: { key: '123456', device_id: testDeviceId },
    });
    assert(obsoletePinEndpoint.status === 404, 'Obsolete verify-management endpoint removed (returns 404)');

    // 7.6 manage.html contains zero PIN modals or PIN input fields
    const fs = require('fs');
    const manageHtmlContent = fs.readFileSync(path.join(__dirname, '../web/pages/manage.html'), 'utf8');
    assert(!manageHtmlContent.includes('id="pair-modal"'), 'manage.html has no pair-modal');
    assert(!manageHtmlContent.includes('id="pair-code-input"'), 'manage.html has no pairing code input');
    assert(!manageHtmlContent.includes('Enter PIN'), 'manage.html has no Enter PIN option');

    // 7.7 Concurrency safeguard: model level atomic lock protection
    setIdLock(testDeviceId, true);
    let modelAddBlocked = false;
    try {
      savePlaylistConfig(testDeviceId, {
        type: 'm3u',
        playlist_url: 'http://test.com/fail.m3u',
        playlist_name: 'Fail',
      });
    } catch (err) {
      if (err.code === 'DEVICE_LOCKED') modelAddBlocked = true;
    }
    assert(modelAddBlocked === true, 'Atomic transaction in savePlaylistConfig blocks writes when locked');

    let modelDelBlocked = false;
    try {
      deletePlaylist(testDeviceId, 1);
    } catch (err) {
      if (err.code === 'DEVICE_LOCKED') modelDelBlocked = true;
    }
    assert(modelDelBlocked === true, 'Atomic transaction in deletePlaylist blocks deletes when locked');
    setIdLock(testDeviceId, false);

    console.log('\n===========================================================');
    console.log(`TOTAL E2E TESTS: ${passed + failed}`);
    console.log(`PASSED: ${passed}`);
    console.log(`FAILED: ${failed}`);
    console.log('===========================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await stopServer();
  }
}

runE2ETests().catch((err) => {
  console.error('E2E Test execution failed:', err);
  process.exit(1);
});
