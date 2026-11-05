const assert = require('assert');
const CryptoJS = require('crypto-js');

// Test the exact algorithm and key matching between server PHP and React Native
const FOX_CIPHER_SECRET = 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE';
const FOX_CIPHER_KEY = CryptoJS.SHA256(FOX_CIPHER_SECRET);

function encryptPayload(data) {
  if (data === null || data === undefined) return '';
  const plainText = typeof data === 'string' ? data : JSON.stringify(data);
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(plainText, FOX_CIPHER_KEY, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const combined = iv.clone().concat(encrypted.ciphertext);
  return CryptoJS.enc.Base64.stringify(combined);
}

function decryptPayload(base64Payload) {
  if (!base64Payload || typeof base64Payload !== 'string') return null;
  try {
    const rawData = CryptoJS.enc.Base64.parse(base64Payload);
    if (!rawData || !rawData.words || rawData.sigBytes < 17) {
      return null;
    }
    const iv = CryptoJS.lib.WordArray.create(rawData.words.slice(0, 4), 16);
    const ciphertext = CryptoJS.lib.WordArray.create(
      rawData.words.slice(4),
      rawData.sigBytes - 16
    );
    const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext });
    const decrypted = CryptoJS.AES.decrypt(cipherParams, FOX_CIPHER_KEY, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
    if (!decryptedStr) return null;
    try {
      return JSON.parse(decryptedStr);
    } catch (_e) {
      return decryptedStr;
    }
  } catch (err) {
    console.error('[payloadCrypto] Decryption error:', err);
    return null;
  }
}

async function runTests() {
  console.log('--- Testing Payload Encryption & Decryption ---');

  // Test 1: Xtream playlist payload encryption & decryption
  const mockXtreamConfig = {
    id: 5,
    playlist_id: 5,
    type: 'xtream',
    playlist_name: 'My Playlist',
    name: 'My Playlist',
    playlist_url: null,
    server_url: 'http://formup.site:8080',
    serverUrl: 'http://formup.site:8080',
    username: 'Vp8zRdxHev',
    password: 'present9radio',
    is_active: true,
    enabled: true
  };

  const encryptedData = encryptPayload(mockXtreamConfig);
  console.log('1. Encrypted ciphertext preview:', encryptedData.substring(0, 50) + '...');
  assert(typeof encryptedData === 'string' && encryptedData.length > 50, 'Ciphertext should be valid Base64 string');
  assert(!encryptedData.includes('present9radio'), 'Password must NOT be present in plaintext!');
  assert(!encryptedData.includes('formup.site'), 'Server URL must NOT be present in plaintext!');
  assert(!encryptedData.includes('Vp8zRdxHev'), 'Username must NOT be present in plaintext!');

  const decryptedConfig = decryptPayload(encryptedData);
  assert.strictEqual(decryptedConfig.username, 'Vp8zRdxHev');
  assert.strictEqual(decryptedConfig.password, 'present9radio');
  assert.strictEqual(decryptedConfig.server_url, 'http://formup.site:8080');
  console.log('2. Decryption verified successfully: credentials match original.');

  // Test 2: Playlist list encryption & decryption
  const mockPlaylists = [
    mockXtreamConfig,
    {
      id: 6,
      playlist_id: 6,
      type: 'm3u',
      playlist_name: 'M3U Streams',
      playlist_url: 'https://example.com/playlist.m3u8',
      is_active: false,
      enabled: true
    }
  ];

  const encryptedList = encryptPayload(mockPlaylists);
  const decryptedList = decryptPayload(encryptedList);
  assert(Array.isArray(decryptedList), 'Decrypted list must be array');
  assert.strictEqual(decryptedList.length, 2);
  assert.strictEqual(decryptedList[0].password, 'present9radio');
  console.log('3. Playlist array encryption & decryption verified successfully.');

  console.log('\nAll crypto tests PASSED successfully!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
