import * as Application from 'expo-application';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { STORAGE_KEYS, DEVICE_ID_LENGTH } from '../constants/index';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const IDENTITY_FILE_PATH = `${FileSystem.documentDirectory}fox_installation_identity.json`;
const INSTALLATION_UUID_KEY = 'fox_player_installation_uuid';
const ANDROID_ID_KEY = STORAGE_KEYS.ANDROID_ID || 'fox_player_android_id';

/**
 * Access Android's hardware-backed Settings.Secure.ANDROID_ID safely.
 * Strict Platform.OS === 'android' condition guarantees zero iOS impact.
 * Requires zero extra Android permissions (no restricted phone state, IMEI, MAC address, or phone number).
 *
 * @returns {string|null} Hexadecimal 16-character string, or null on non-Android/unsupported platforms
 */
export function getAndroidDeviceId() {
  if (Platform.OS !== 'android') {
    return null;
  }
  try {
    if (typeof Application.getAndroidId === 'function') {
      const id = Application.getAndroidId();
      return id && typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
    }
  } catch (_e) {}
  return null;
}

/**
 * Access iOS identifierForVendor safely.
 * Strict Platform.OS === 'ios' condition guarantees zero Android impact.
 *
 * @returns {Promise<string|null>}
 */
export async function getIosDeviceId() {
  if (Platform.OS === 'ios') {
    try {
      if (typeof Application.getIosIdForVendorAsync === 'function') {
        const id = await Application.getIosIdForVendorAsync();
        return id && typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
      }
    } catch (_e) {}
  }
  return null;
}

/**
 * Generate a cryptographically secure UUID v4 string
 */
export function generateInstallationUuid() {
  if (Crypto.randomUUID) {
    try {
      return Crypto.randomUUID();
    } catch (_e) {}
  }
  // Cryptographically random RFC 4122 v4 UUID generator fallback
  const randomBytes = Crypto.getRandomBytes(16);
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40; // Version 4
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80; // Variant 10xx
  const hex = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generate a cryptographically secure 8-character pairing device ID
 */
export function generateSecureDeviceId() {
  const randomBytes = Crypto.getRandomBytes(DEVICE_ID_LENGTH * 4);
  let result = '';
  for (let i = 0; i < DEVICE_ID_LENGTH; i++) {
    const randomValue =
      (randomBytes[i * 4] << 24) |
      (randomBytes[i * 4 + 1] << 16) |
      (randomBytes[i * 4 + 2] << 8) |
      randomBytes[i * 4 + 3];
    result += CHARSET[Math.abs(randomValue) % CHARSET.length];
  }
  return result;
}

/**
 * Validate installation UUID format
 */
export function isValidInstallationId(uuid) {
  if (typeof uuid !== 'string') return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid.trim());
}

/**
 * Validate device ID format
 */
export function isValidDeviceId(id) {
  return typeof id === 'string' && /^[A-Z0-9]{8}$/.test(id.trim());
}

/**
 * Persist identity to both DocumentDirectory sandbox and SecureStore
 */
export async function saveIdentity(identity) {
  try {
    await FileSystem.writeAsStringAsync(
      IDENTITY_FILE_PATH,
      JSON.stringify(identity),
      { encoding: FileSystem.EncodingType.UTF8 }
    );
  } catch (_e) {}

  try {
    if (identity.deviceId) {
      await SecureStore.setItemAsync(STORAGE_KEYS.DEVICE_ID, identity.deviceId, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    }
    if (identity.installationId) {
      await SecureStore.setItemAsync(INSTALLATION_UUID_KEY, identity.installationId, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    }
    if (identity.androidId) {
      await SecureStore.setItemAsync(ANDROID_ID_KEY, identity.androidId, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    }
  } catch (_e) {}
}

/**
 * Retrieve saved identity from DocumentDirectory sandbox or SecureStore
 */
export async function getSavedIdentity() {
  try {
    // Directly read without getInfoAsync() round-trip — catch not-found errors below
    const content = await FileSystem.readAsStringAsync(IDENTITY_FILE_PATH);
    const parsed = JSON.parse(content);
    if (parsed && isValidInstallationId(parsed.installationId) && isValidDeviceId(parsed.deviceId)) {
      return {
        installationId: parsed.installationId,
        deviceId: parsed.deviceId,
        androidId: parsed.androidId || null,
        source: parsed.source || 'file',
        isFreshInstall: false,
        isRecovered: parsed.isRecovered === true,
      };
    }
  } catch (_e) {
    // File not found on first install — expected, fall through to SecureStore
  }

  // Fallback check in SecureStore if sandbox file was missing but SecureStore retained it
  try {
    const secDeviceId = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID);
    const secUuid = await SecureStore.getItemAsync(INSTALLATION_UUID_KEY);
    const secAndroidId = await SecureStore.getItemAsync(ANDROID_ID_KEY);
    if (secDeviceId && isValidDeviceId(secDeviceId) && secUuid && isValidInstallationId(secUuid)) {
      const recoveredFromStore = {
        installationId: secUuid,
        deviceId: secDeviceId,
        androidId: secAndroidId || null,
        source: 'secure_store',
        isFreshInstall: false,
        isRecovered: false,
      };
      // Resynchronize back to sandbox file (non-blocking)
      saveIdentity(recoveredFromStore).catch(() => {});
      return recoveredFromStore;
    }
  } catch (_e) {}

  return null;
}

/**
 * Restore an authoritative identity recovered from the backend
 */
export async function restoreIdentity(deviceId, installationId, androidId = null) {
  const identity = {
    installationId: (installationId && isValidInstallationId(installationId))
      ? installationId
      : generateInstallationUuid(),
    deviceId: deviceId,
    androidId: androidId || (Platform.OS === 'android' ? getAndroidDeviceId() : null),
    createdAt: Date.now(),
    recoveredAt: Date.now(),
    source: 'backend_android_recovery',
    isRecovered: true,
  };

  await saveIdentity(identity);
  return {
    ...identity,
    isFreshInstall: false,
    isRecovered: true,
  };
}

/**
 * Create and persist a fresh internal App ID (UUID) and pairing Device ID
 */
export async function createFreshIdentity(androidId = null) {
  const freshInstallationId = generateInstallationUuid();
  const freshDeviceId = generateSecureDeviceId();
  const effectiveAndroidId = androidId || (Platform.OS === 'android' ? getAndroidDeviceId() : null);

  const freshIdentity = {
    installationId: freshInstallationId,
    deviceId: freshDeviceId,
    androidId: effectiveAndroidId,
    createdAt: Date.now(),
    source: 'fresh_install',
  };

  await saveIdentity(freshIdentity);

  return {
    ...freshIdentity,
    isFreshInstall: true,
    isRecovered: false,
  };
}

/**
 * Get or create the unique installation identity (UUID + Device ID).
 * 
 * Storage & Lifecycle Strategy:
 * 1. DocumentDirectory sandbox check:
 *    - DocumentDirectory is preserved across ordinary app restarts and app updates.
 *    - If identity exists: ordinary app restart or update. Return existing identity immediately.
 * 
 * 2. Automatic Data Recovery (Android Only):
 *    - If sandbox marker does not exist (e.g. fresh installation or reinstall after uninstall):
 *    - If on Android and a recoveryCallback is provided in options or caller handles it,
 *      or fallback to fresh creation.
 */
export async function getInstallationIdentity(options = {}) {
  // 1. Check if identity marker already exists locally
  const saved = await getSavedIdentity();
  if (saved) {
    return saved;
  }

  // 2. Check for existing device ID from previous version upgrade with cache data
  let existingDeviceId = null;
  let existingUuid = null;
  try {
    existingDeviceId = await SecureStore.getItemAsync(STORAGE_KEYS.DEVICE_ID);
    existingUuid = await SecureStore.getItemAsync(INSTALLATION_UUID_KEY);
  } catch (_e) {}

  let hasExistingCache = false;
  try {
    const cacheDir = `${FileSystem.documentDirectory}fox_player_cache/`;
    const cacheInfo = await FileSystem.getInfoAsync(cacheDir);
    hasExistingCache = Boolean(cacheInfo.exists);
  } catch (_e) {}

  if (existingDeviceId && isValidDeviceId(existingDeviceId) && hasExistingCache) {
    const effectiveUuid = (existingUuid && isValidInstallationId(existingUuid))
      ? existingUuid
      : generateInstallationUuid();

    const identity = {
      installationId: effectiveUuid,
      deviceId: existingDeviceId,
      androidId: Platform.OS === 'android' ? getAndroidDeviceId() : null,
      createdAt: Date.now(),
      source: 'update_migration',
    };

    await saveIdentity(identity);

    return {
      installationId: identity.installationId,
      deviceId: identity.deviceId,
      androidId: identity.androidId,
      isFreshInstall: false,
      isRecovered: false,
    };
  }

  // 3. Optional inline recovery callback if passed (e.g. from AppContext bootstrap)
  if (typeof options.recoveryCallback === 'function' && Platform.OS === 'android') {
    try {
      const androidId = getAndroidDeviceId();
      if (androidId) {
        const recoveryResult = await options.recoveryCallback(androidId);
        if (recoveryResult && recoveryResult.recovered && recoveryResult.device_id) {
          return await restoreIdentity(
            recoveryResult.device_id,
            recoveryResult.installation_id,
            androidId
          );
        }
      }
    } catch (_recErr) {
      // Safe fallback on recovery network failure
    }
  }

  // 4. Wipe any stale Keychain leftovers from prior uninstalled apps on iOS
  if (Platform.OS === 'ios') {
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.DEVICE_ID);
      await SecureStore.deleteItemAsync(INSTALLATION_UUID_KEY);
    } catch (_e) {}
  }

  // 5. Genuinely fresh installation
  return await createFreshIdentity(Platform.OS === 'android' ? getAndroidDeviceId() : null);
}

/**
 * Get or create the persistent device ID (backward compatible with all existing callers)
 */
export async function getOrCreateDeviceId() {
  const identity = await getInstallationIdentity();
  return identity.deviceId;
}

/**
 * Get the current installation UUID
 */
export async function getInstallationId() {
  const identity = await getInstallationIdentity();
  return identity.installationId;
}

/**
 * Store a value in SecureStore
 */
export async function secureSet(key, value) {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

/**
 * Get a value from SecureStore
 */
export async function secureGet(key) {
  return await SecureStore.getItemAsync(key);
}

/**
 * Delete a value from SecureStore
 */
export async function secureDelete(key) {
  await SecureStore.deleteItemAsync(key);
}
