import * as Crypto from 'expo-crypto';
import { secureGet, secureSet, secureDelete } from './deviceStorage';
import { STORAGE_KEYS } from '../constants';

const SALT = 'foxplayer_adult_pin_v1_';

/**
 * Hash the PIN with SHA-256
 */
async function hashPin(pin) {
  const salted = `${SALT}${pin}`;
  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salted,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
}

/**
 * Store adult PIN as a hash
 */
export async function setAdultPin(pin) {
  if (!pin || pin.length !== 4) {
    throw new Error('PIN must be exactly 4 digits.');
  }
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must contain only digits.');
  }
  const hash = await hashPin(pin);
  await secureSet(STORAGE_KEYS.ADULT_PIN_HASH, hash);
}

/**
 * Verify the PIN against stored hash
 */
export async function verifyAdultPin(pin) {
  const stored = await secureGet(STORAGE_KEYS.ADULT_PIN_HASH);
  if (!stored) return false;
  const hash = await hashPin(pin);
  return hash === stored;
}

/**
 * Check if adult PIN is enabled
 */
export async function isAdultPinEnabled() {
  const stored = await secureGet(STORAGE_KEYS.ADULT_PIN_HASH);
  return !!stored;
}

/**
 * Remove adult PIN — disables parental lock
 */
export async function removeAdultPin() {
  await secureDelete(STORAGE_KEYS.ADULT_PIN_HASH);
}

/**
 * Change the PIN: verify old, set new
 */
export async function changeAdultPin(oldPin, newPin) {
  const valid = await verifyAdultPin(oldPin);
  if (!valid) {
    throw new Error('Incorrect current PIN.');
  }
  await setAdultPin(newPin);
}
