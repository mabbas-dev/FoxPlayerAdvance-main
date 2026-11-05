import CryptoJS from 'crypto-js';

const FOX_CIPHER_SECRET = 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE';
const FOX_CIPHER_KEY = CryptoJS.SHA256(FOX_CIPHER_SECRET);

/**
 * Encrypt arbitrary JavaScript object or string into AES-256-CBC Base64 ciphertext.
 * The output prepends the 16-byte random IV to the ciphertext.
 *
 * @param {object|string} data
 * @returns {string} Base64 ciphertext string
 */
export function encryptPayload(data) {
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

/**
 * Decrypt AES-256-CBC Base64 ciphertext (IV [16 bytes] + Ciphertext).
 * Returns the parsed JSON payload or string, or null on failure.
 *
 * @param {string} base64Payload
 * @returns {object|string|null}
 */
export function decryptPayload(base64Payload) {
  if (!base64Payload || typeof base64Payload !== 'string') return null;
  try {
    const rawData = CryptoJS.enc.Base64.parse(base64Payload);
    if (!rawData || !rawData.words || rawData.sigBytes < 17) {
      return null;
    }

    // First 16 bytes = 4 32-bit words for IV
    const iv = CryptoJS.lib.WordArray.create(rawData.words.slice(0, 4), 16);
    // Remaining bytes = ciphertext
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
