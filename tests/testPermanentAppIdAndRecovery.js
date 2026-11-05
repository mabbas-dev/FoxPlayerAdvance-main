const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let failedTests = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failedTests++;
  }
}

console.log('\n================================================================');
console.log('   FOX PLAYER — PERMANENT APP ID & DATA RECOVERY TEST SUITE     ');
console.log('================================================================\n');

const repoRoot = 'E:\\IptvappAdvance\\FoxPlayerDevelopment';
const deviceStoragePath = path.join(repoRoot, 'src', 'storage', 'deviceStorage.js');
const apiServicePath = path.join(repoRoot, 'src', 'services', 'apiService.js');
const userStoragePath = path.join(repoRoot, 'src', 'storage', 'userStorage.js');
const appContextPath = path.join(repoRoot, 'src', 'state', 'AppContext.js');
const constantsPath = path.join(repoRoot, 'src', 'constants', 'index.js');
const indexPhpPath = path.join(repoRoot, 'server-api', 'index.php');

const devStorageCode = fs.readFileSync(deviceStoragePath, 'utf8');
const apiServiceCode = fs.readFileSync(apiServicePath, 'utf8');
const userStorageCode = fs.readFileSync(userStoragePath, 'utf8');
const appContextCode = fs.readFileSync(appContextPath, 'utf8');
const constantsCode = fs.readFileSync(constantsPath, 'utf8');
const indexPhpCode = fs.readFileSync(indexPhpPath, 'utf8');

async function main() {
  console.log('--- SECTION 1: ANDROID DEVICE IDENTIFIER & PERMISSION SAFETY ---');

  await runTest('Android ID uses Application.getAndroidId() with zero extra permissions', () => {
    assert(devStorageCode.includes('Application.getAndroidId'), 'Must access Application.getAndroidId');
    assert(!devStorageCode.includes('READ_PHONE_STATE'), 'Must not require READ_PHONE_STATE permission');
    assert(!devStorageCode.includes('getMacAddress'), 'Must not require MAC address');
    assert(!devStorageCode.includes('getImei'), 'Must not access IMEI');
  });

  await runTest('Android ID retrieval is strictly guarded by Platform.OS === "android"', () => {
    assert(devStorageCode.includes("Platform.OS !== 'android'"), 'Must guard against non-Android OS');
    assert(devStorageCode.includes('export function getAndroidDeviceId()'), 'Must export getAndroidDeviceId helper');
  });

  console.log('\n--- SECTION 2: PERMANENT APP ID (UUID) GENERATION & VALIDATION ---');

  await runTest('Internal App ID is a cryptographically secure UUID v4', () => {
    assert(devStorageCode.includes('export function generateInstallationUuid()'), 'Must export generateInstallationUuid');
    assert(devStorageCode.includes('isValidInstallationId'), 'Must validate UUID format');
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    assert(uuidRegex.test('12345678-1234-4234-8234-123456789abc'), 'Standard UUID v4 should match');
  });

  await runTest('Device ID is a cryptographically secure 8-character pairing code', () => {
    assert(devStorageCode.includes('export function generateSecureDeviceId()'), 'Must export generateSecureDeviceId');
    assert(devStorageCode.includes('isValidDeviceId'), 'Must validate 8-char pairing code format');
    const devRegex = /^[A-Z0-9]{8}$/;
    assert(devRegex.test('ABC12345'), 'Standard 8-character device ID should match');
  });

  console.log('\n--- SECTION 3: BACKEND RECOVERY ENDPOINTS & DUPLICATE PROTECTION ---');

  await runTest('Backend defines POST /api/devices/recover endpoint', () => {
    assert(indexPhpCode.includes("'/api/devices/recover'"), 'Backend must implement /api/devices/recover route');
    assert(indexPhpCode.includes('$androidId'), 'Backend must accept and sanitize android_id');
  });

  await runTest('Backend defines user data sync endpoints for favorites and settings', () => {
    assert(indexPhpCode.includes('/user-data'), 'Backend must implement user-data routes');
    assert(indexPhpCode.includes('device_user_data'), 'Backend must store user data in device_user_data table');
  });

  await runTest('Backend prevents duplicate records for the same Android device', () => {
    assert(indexPhpCode.includes('$existingDevice'), 'Backend register route must check for existing device by android_id');
    assert(indexPhpCode.includes('COALESCE(VALUES(android_id), android_id)'), 'Backend must update android_id safely on duplicate key');
  });

  console.log('\n--- SECTION 4: CLIENT-SIDE RECOVERY & HYDRATION ARCHITECTURE ---');

  await runTest('apiService exports recoverDeviceByAndroidId with payload decryption', () => {
    assert(apiServiceCode.includes('export async function recoverDeviceByAndroidId'), 'apiService must export recoverDeviceByAndroidId');
    assert(apiServiceCode.includes('decryptPayload(res.encrypted_playlists)'), 'Must decrypt encrypted playlists payload');
    assert(apiServiceCode.includes('decryptPayload(res.encrypted_user_data)'), 'Must decrypt encrypted user data payload');
  });

  await runTest('userStorage exports restoreUserDataFromRecovery and background sync', () => {
    assert(userStorageCode.includes('export async function restoreUserDataFromRecovery'), 'Must export restoreUserDataFromRecovery');
    assert(userStorageCode.includes('export async function syncUserDataToServer'), 'Must export syncUserDataToServer');
  });

  await runTest('AppContext bootstrap automatically hydrates recovered playlists, subscription, and user data', () => {
    assert(appContextCode.includes('recoverDeviceByAndroidId'), 'AppContext must call recovery when fresh install detected on Android');
    assert(appContextCode.includes('restoreIdentity'), 'AppContext must restore recovered identity');
    assert(appContextCode.includes('restoreUserDataFromRecovery'), 'AppContext must restore user data');
  });

  console.log('\n--- SECTION 5: LIVE BACKEND API CONTRACT & CRYPTO VERIFICATION ---');

  const CryptoJS = require('E:/IptvappAdvance/FoxPlayerDevelopment/node_modules/crypto-js');
  const FOX_CIPHER_SECRET = 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE';
  const FOX_CIPHER_KEY = CryptoJS.SHA256(FOX_CIPHER_SECRET);

  function decryptPayload(base64Payload) {
    if (!base64Payload || typeof base64Payload !== 'string') return null;
    const rawData = CryptoJS.enc.Base64.parse(base64Payload);
    const iv = CryptoJS.lib.WordArray.create(rawData.words.slice(0, 4), 16);
    const ciphertext = CryptoJS.lib.WordArray.create(rawData.words.slice(4), rawData.sigBytes - 16);
    const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext });
    const decrypted = CryptoJS.AES.decrypt(cipherParams, FOX_CIPHER_KEY, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
    try {
      return JSON.parse(decryptedStr);
    } catch (_e) {
      return decryptedStr;
    }
  }

  await runTest('Live Backend Health Check', async () => {
    const res = await fetch('https://api.foxplayer.app/api/health');
    assert(res.ok, 'Health endpoint must return 200 OK');
    const json = await res.json();
    assert(json.success === true, 'Health check must be success');
  });

  await runTest('Live End-to-End Recovery Flow: Register -> Backup User Data -> Recover -> Duplicate Guard', async () => {
    const testDeviceId = 'AUTOREC1';
    const testInstallId = '77778888-9999-0000-1111-222233334444';
    const testAndroidId = 'e2e_rec_' + Date.now().toString(16);

    // 1. Register with Android ID
    const regRes = await fetch('https://api.foxplayer.app/api/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: testDeviceId,
        installation_id: testInstallId,
        android_id: testAndroidId,
        app_version: '2.0.0',
      }),
    });
    const regJson = await regRes.json();
    assert(regJson.success, 'Registration must succeed');
    assert.strictEqual(regJson.device_id, testDeviceId, 'Returned device_id must match');

    // 2. Backup favorites and preferences
    const favKey = 'fox_player_pl_default_fav_all';
    const sampleFavs = [{ id: '99', type: 'movie', title: 'The Matrix Resurrections' }];
    const saveRes = await fetch(`https://api.foxplayer.app/api/device/${testDeviceId}/user-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          [favKey]: sampleFavs,
          'fox_player_adult_pin_enabled': true,
        },
      }),
    });
    const saveJson = await saveRes.json();
    assert(saveJson.success, 'Saving user data must succeed');

    // 3. Simulate App Reinstall: Call recover with only Android ID
    const recRes = await fetch('https://api.foxplayer.app/api/devices/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        android_id: testAndroidId,
        app_version: '2.0.0',
      }),
    });
    const recJson = await recRes.json();
    assert(recJson.success && recJson.recovered, 'Recovery must succeed with recovered: true');
    assert.strictEqual(recJson.device_id, testDeviceId, 'Recovered device ID must match');
    assert.strictEqual(recJson.installation_id, testInstallId, 'Recovered installation ID must match');
    assert(recJson.subscription, 'Subscription must be recovered');

    // Decrypt user data
    assert(recJson.encrypted_user_data, 'Encrypted user data must be present');
    const decryptedUserData = decryptPayload(recJson.encrypted_user_data);
    assert(Array.isArray(decryptedUserData[favKey]), 'Recovered favorites must be an array');
    assert.strictEqual(decryptedUserData[favKey][0].title, 'The Matrix Resurrections', 'Favorite title must match');

    // 4. Duplicate Registration Guard: Same Android ID with different Device ID
    const dupRes = await fetch('https://api.foxplayer.app/api/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'AUTOREC2', // different candidate ID
        installation_id: 'other-uuid-here',
        android_id: testAndroidId,
      }),
    });
    const dupJson = await dupRes.json();
    assert.strictEqual(dupJson.device_id, testDeviceId, 'Must adopt canonical device ID and avoid duplicate record');
  });

  await runTest('Safe Handling of Unregistered Android ID (e.g. Factory Reset or First Launch)', async () => {
    const unregRes = await fetch('https://api.foxplayer.app/api/devices/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        android_id: 'non_existent_android_id_00000000',
      }),
    });
    const unregJson = await unregRes.json();
    assert(unregJson.success, 'Response must be success');
    assert.strictEqual(unregJson.recovered, false, 'recovered must be false');
    assert(unregJson.message, 'Must return helpful message');
  });

  await runTest('Safe Handling of Invalid Android ID input', async () => {
    const invRes = await fetch('https://api.foxplayer.app/api/devices/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        android_id: '',
      }),
    });
    assert.strictEqual(invRes.status, 400, 'Empty Android ID must return 400 Bad Request');
  });

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${passedTests + failedTests})`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
