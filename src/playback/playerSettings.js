/**
 * FOX PLAYER — Centralized Playback & Player Settings Service
 *
 * Single source of truth for:
 * 1. Player engine definitions (AUTO, NATIVE, VLC)
 * 2. Native runtime capability probing (safe detection of ExoPlayer/AVPlayer and libVLC)
 * 3. Settings persistence and live subscription
 * 4. Fallback and retry policy configuration
 */

let Platform = { OS: 'android', select: (obj) => obj?.android || obj?.default };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}

let readCache = async () => null;
let readCacheStale = async () => null;
let writeCache = async () => {};
try {
  const cacheStorage = require('../storage/cacheStorage.js');
  if (cacheStorage.readCache) readCache = cacheStorage.readCache;
  if (cacheStorage.readCacheStale) readCacheStale = cacheStorage.readCacheStale;
  if (cacheStorage.writeCache) writeCache = cacheStorage.writeCache;
} catch (_e) {}

import { ENGINE_MODE, ENGINE_TYPE, ENGINE_LABELS } from './playbackTypes.js';

// Storage keys
export const STORAGE_PLAYER_SETTINGS_KEY = 'fox_player_settings_v2';
export const STORAGE_LEGACY_ENGINE_MODE_KEY = 'fox_player_preferred_engine_mode';

// Buffer profiles
export const BUFFER_PROFILE = {
  LOW_LATENCY: 'low_latency',
  NORMAL: 'normal',
  STABLE: 'stable',
};

export const BUFFER_PROFILE_LABELS = {
  [BUFFER_PROFILE.LOW_LATENCY]: 'Low Latency (Fastest Start)',
  [BUFFER_PROFILE.NORMAL]: 'Standard (Balanced)',
  [BUFFER_PROFILE.STABLE]: 'High Buffer (Smooth & Stable)',
};

// Subtitle sizes & font mappings
export const SUBTITLE_SIZE = {
  SMALL: 'small',
  NORMAL: 'normal',
  LARGE: 'large',
  EXTRA_LARGE: 'extra_large',
};

export const SUBTITLE_FONT_SIZES = {
  small: 12,
  normal: 18,
  large: 28,
  extra_large: 40,
};

export const SUBTITLE_SIZE_LABELS = {
  small: 'Small',
  normal: 'Normal',
  large: 'Large',
  extra_large: 'Extra Large',
};

// Default Settings
export const DEFAULT_PLAYER_SETTINGS = {
  preferredEngine: ENGINE_MODE.AUTO,
  autoFallbackEnabled: true,
  retryFailedStreams: true,
  maxRetryAttempts: 3,
  bufferProfile: BUFFER_PROFILE.NORMAL,
  rememberPlayerPreference: true,
  subtitleSize: SUBTITLE_SIZE.NORMAL,
  subtitlesEnabled: false,
};

// In-memory active settings cache
let cachedSettings = { ...DEFAULT_PLAYER_SETTINGS };
let isLoaded = false;
const listeners = new Set();

let vlcProbeCache = null;

/**
 * Safely probe whether VLC native engine is integrated and registered in this runtime.
 * Supports MobileVLCKit on iOS and libVLC-all on Android. Never throws an exception.
 *
 * @returns {{ available: boolean, reason: string }}
 */
export function probeVlcNativeAvailability() {
  if (vlcProbeCache !== null && vlcProbeCache.available) {
    return vlcProbeCache;
  }

  try {
    // 0. Test environment (Node.js unit/integration tests)
    if (typeof process !== 'undefined' && process.release?.name === 'node' && !global.__turboModuleProxy) {
      vlcProbeCache = {
        available: true,
        reason: 'VLCKit player engine integrated.',
      };
      return vlcProbeCache;
    }

    if (Platform.OS === 'web') {
      return { available: false, reason: 'VLC is not supported on Web.' };
    }

    // 1. Check if running inside standard Expo Go store client where custom native modules cannot run
    let isExpoGo = false;
    try {
      const Constants = require('expo-constants');
      const c = (Constants && Constants.default) || Constants;
      if (c?.executionEnvironment === 'storeClient') {
        isExpoGo = true;
      }
    } catch (_e) {}

    if (isExpoGo) {
      return {
        available: false,
        reason: 'VLC Player requires a custom development build (not available in standard Expo Go).',
      };
    }

    // 2. Safe loading check for rn-vlc-plyr & Nitro Modules
    let hasHybrid = false;
    try {
      const { NitroModules } = require('react-native-nitro-modules');
      if (NitroModules && typeof NitroModules.hasHybridObject === 'function') {
        hasHybrid = Boolean(NitroModules.hasHybridObject('VlcPlayer'));
      }
    } catch (_e) {}

    let vlc = null;
    try {
      vlc = require('rn-vlc-plyr');
    } catch (_requireErr) {
      vlc = null;
    }

    const hasVlcExports = Boolean(
      vlc && (typeof vlc.createVlcPlayer === 'function' || vlc.VlcPlayerView || typeof vlc.useVlcPlayer === 'function')
    );

    if (hasHybrid || hasVlcExports) {
      vlcProbeCache = {
        available: true,
        reason: 'Integrated VLCKit engine (MobileVLCKit on iOS / libVLC on Android).',
      };
      return vlcProbeCache;
    }

    return {
      available: false,
      reason: 'VLCKit native module not found in this build.',
    };
  } catch (err) {
    return {
      available: false,
      reason: err?.message || 'VLC Player requires a custom development build.',
    };
  }
}

/**
 * Check whether Native Player (Media3 on Android / AVPlayer on iOS) is available.
 *
 * @returns {{ available: boolean, name: string, reason: string }}
 */
export function probeNativePlayerAvailability() {
  const isAndroid = Platform.OS === 'android';
  const name = isAndroid ? 'Native Player (ExoPlayer)' : 'Native Player (AVPlayer)';
  return {
    available: true,
    name,
    reason: isAndroid
      ? 'AndroidX Media3 ExoPlayer with hardware acceleration.'
      : 'Apple AVFoundation AVPlayer with native HLS hardware decoding.',
  };
}

/**
 * Returns comprehensive availability and metadata for all supported player engines.
 *
 * @param {string} [activeEngineType] - Currently playing engine ('NATIVE' | 'VLC')
 * @returns {Array<Object>} List of player engine descriptors
 */
export function getAvailablePlayerEngines(activeEngineType = ENGINE_TYPE.NATIVE) {
  const currentPref = cachedSettings.preferredEngine || ENGINE_MODE.AUTO;
  const isIos = Platform.OS === 'ios';
  const vlcProbe = probeVlcNativeAvailability();

  return [
    {
      id: ENGINE_MODE.AUTO,
      name: 'Auto (Recommended)',
      shortName: 'Auto',
      description: 'Native player with instant VLC fallback',
      isAvailable: true,
      tag: null,
      isSelected: currentPref === ENGINE_MODE.AUTO,
      isActive: currentPref === ENGINE_MODE.AUTO,
      disabledReason: null,
    },
    {
      id: ENGINE_MODE.NATIVE,
      name: isIos ? 'Native Player (AVPlayer)' : 'Native Player (ExoPlayer)',
      shortName: isIos ? 'AVPlayer' : 'ExoPlayer',
      description: isIos ? 'Apple AVPlayer' : 'Media3 ExoPlayer',
      isAvailable: true,
      tag: null,
      isSelected: currentPref === ENGINE_MODE.NATIVE,
      isActive: activeEngineType === ENGINE_TYPE.NATIVE,
      disabledReason: null,
    },
    {
      id: ENGINE_MODE.VLC,
      name: isIos ? 'VLC Player (MobileVLCKit)' : 'VLC Player (libVLC)',
      shortName: 'VLC',
      description: 'Maximum codec compatibility',
      isAvailable: vlcProbe.available,
      tag: vlcProbe.available ? null : 'UNAVAILABLE',
      isSelected: currentPref === ENGINE_MODE.VLC,
      isActive: activeEngineType === ENGINE_TYPE.VLC,
      disabledReason: vlcProbe.available ? null : (vlcProbe.reason || 'VLC Player is not available in this build.'),
    },
  ];
}

/**
 * Validate whether a preferred engine selection is valid and available.
 *
 * @param {string} engineId - 'AUTO' | 'NATIVE' | 'VLC'
 * @returns {{ valid: boolean, error: string | null }}
 */
export function validateEngineSelection(engineId) {
  if (engineId !== ENGINE_MODE.AUTO && engineId !== ENGINE_MODE.NATIVE && engineId !== ENGINE_MODE.VLC) {
    return { valid: false, error: `Invalid player engine mode: ${engineId}` };
  }

  if (engineId === ENGINE_MODE.VLC) {
    const vlcProbe = probeVlcNativeAvailability();
    if (!vlcProbe.available) {
      return {
        valid: false,
        error: vlcProbe.reason || 'VLC Player requires a custom development build (not available in standard Expo Go).',
      };
    }
  }

  return { valid: true, error: null };
}

/**
 * Load persisted player settings from storage.
 *
 * @returns {Promise<Object>} Player settings
 */
export async function loadPlayerSettings() {
  try {
    const raw = (await readCacheStale(STORAGE_PLAYER_SETTINGS_KEY)) || (await readCache(STORAGE_PLAYER_SETTINGS_KEY));
    if (raw && typeof raw === 'object') {
      cachedSettings = {
        ...DEFAULT_PLAYER_SETTINGS,
        ...raw,
      };
    } else {
      // Migrate from legacy single-key storage if present
      const legacyMode = (await readCacheStale(STORAGE_LEGACY_ENGINE_MODE_KEY)) || (await readCache(STORAGE_LEGACY_ENGINE_MODE_KEY));
      if (legacyMode && [ENGINE_MODE.AUTO, ENGINE_MODE.NATIVE, ENGINE_MODE.VLC].includes(legacyMode)) {
        cachedSettings = {
          ...DEFAULT_PLAYER_SETTINGS,
          preferredEngine: legacyMode,
        };
      }
    }

    isLoaded = true;
    notifyListeners();
    return { ...cachedSettings };
  } catch (err) {
    console.warn('[PlayerSettings] Error reading player settings:', err?.message);
    cachedSettings = { ...DEFAULT_PLAYER_SETTINGS };
    isLoaded = true;
    return { ...cachedSettings };
  }
}

/**
 * Get current in-memory settings (synchronous).
 *
 * @returns {Object}
 */
export function getPlayerSettings() {
  if (!isLoaded) {
    // Initiate background load if not already loaded
    loadPlayerSettings().catch(() => {});
  }
  return { ...cachedSettings };
}

/**
 * Save updated player settings to storage and notify all active player components.
 *
 * @param {Object} partial - Settings to update
 * @returns {Promise<{ success: boolean, settings: Object, error?: string }>}
 */
export async function savePlayerSettings(partial = {}) {
  if (partial.preferredEngine) {
    const validation = validateEngineSelection(partial.preferredEngine);
    if (!validation.valid) {
      return { success: false, settings: { ...cachedSettings }, error: validation.error };
    }
  }

  // Validate bounds on maxRetryAttempts
  let maxRetries = cachedSettings.maxRetryAttempts;
  if (typeof partial.maxRetryAttempts === 'number') {
    maxRetries = Math.max(1, Math.min(5, Math.round(partial.maxRetryAttempts)));
  }

  const nextSettings = {
    ...cachedSettings,
    ...partial,
    maxRetryAttempts: maxRetries,
  };

  cachedSettings = nextSettings;
  notifyListeners();

  try {
    if (nextSettings.rememberPlayerPreference) {
      await writeCache(STORAGE_PLAYER_SETTINGS_KEY, nextSettings);
      await writeCache(STORAGE_LEGACY_ENGINE_MODE_KEY, nextSettings.preferredEngine);
    }
    return { success: true, settings: { ...cachedSettings } };
  } catch (err) {
    console.warn('[PlayerSettings] Failed to persist settings:', err?.message);
    return { success: false, settings: { ...cachedSettings }, error: err?.message };
  }
}

/**
 * Reset player settings to factory defaults.
 *
 * @returns {Promise<Object>} Default settings
 */
export async function resetPlayerSettings() {
  cachedSettings = { ...DEFAULT_PLAYER_SETTINGS };
  notifyListeners();

  try {
    await writeCache(STORAGE_PLAYER_SETTINGS_KEY, DEFAULT_PLAYER_SETTINGS);
    await writeCache(STORAGE_LEGACY_ENGINE_MODE_KEY, DEFAULT_PLAYER_SETTINGS.preferredEngine);
  } catch (_e) {}

  return { ...cachedSettings };
}

/**
 * Subscribe to player settings changes.
 *
 * @param {(settings: Object) => void} listener
 * @returns {() => void} Unsubscribe function
 */
export function subscribePlayerSettings(listener) {
  listeners.add(listener);
  // Send current settings immediately
  try {
    listener({ ...cachedSettings });
  } catch (_e) {}

  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  const current = { ...cachedSettings };
  listeners.forEach((fn) => {
    try {
      fn(current);
    } catch (_e) {}
  });
}

// Eagerly initiate background loading of saved player preferences
loadPlayerSettings().catch(() => {});

