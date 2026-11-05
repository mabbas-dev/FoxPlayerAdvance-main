import CryptoJS from 'https://esm.sh/crypto-js@4.2.0';

const FOX_CIPHER_SECRET = 'FOX_PLAYER_CIPHER_KEY_2026_PRODUCTION_SECURE';
const FOX_CIPHER_KEY = CryptoJS.SHA256(FOX_CIPHER_SECRET);

export function decryptPayload(base64Payload) {
  if (base64Payload == null) return null;
  const normalizedInput =
    typeof base64Payload === 'string'
      ? base64Payload.trim().replace(/\s/g, '')
      : '';
  if (!normalizedInput) return null;
  try {
    const rawData = CryptoJS.enc.Base64.parse(normalizedInput);
    if (!rawData?.words || rawData.sigBytes < 17) return null;
    const iv = CryptoJS.lib.WordArray.create(rawData.words.slice(0, 4), 16);
    const ciphertext = CryptoJS.lib.WordArray.create(
      rawData.words.slice(4),
      rawData.sigBytes - 16,
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
  } catch (_err) {
    return null;
  }
}
