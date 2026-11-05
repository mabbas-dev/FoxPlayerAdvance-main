// Safe Constants resolution across Expo runtime and Node test environments
let Constants = null;
let Application = null;
try {
  Constants = require('expo-constants');
  if (Constants && Constants.default) Constants = Constants.default;
} catch (_e) {
  Constants = {};
}
try {
  Application = require('expo-application');
  if (Application && Application.default) Application = Application.default;
} catch (_e) {
  Application = null;
}

const { Platform } = require('react-native');

// FOX PLAYER — Application Constants

export const APP_NAME = 'FOX PLAYER';
export const APP_VERSION =
  (Constants?.expoConfig?.extra?.appVersion && String(Constants.expoConfig.extra.appVersion)) ||
  (Constants?.expoConfig?.version && String(Constants.expoConfig.version)) ||
  (Application?.nativeApplicationVersion && String(Application.nativeApplicationVersion)) ||
  '1.0.0';

function parseBuildNumber(raw) {
  if (raw == null || raw === '') return NaN;
  const n = parseInt(String(raw).replace(/[^\d].*$/, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function resolveAppBuild() {
  const ec = Constants?.expoConfig;
  const candidates = [];
  const nativeBuild = parseBuildNumber(Application?.nativeBuildVersion);
  if (Number.isFinite(nativeBuild)) candidates.push(nativeBuild);
  if (Platform.OS === 'android') {
    const code = ec?.android?.versionCode;
    if (typeof code === 'number' && code > 0) candidates.push(code);
  }
  if (Platform.OS === 'ios') {
    const n = parseBuildNumber(ec?.ios?.buildNumber);
    if (Number.isFinite(n)) candidates.push(n);
  }
  const fromExtra = parseBuildNumber(ec?.extra?.appBuild);
  if (Number.isFinite(fromExtra)) candidates.push(fromExtra);
  if (candidates.length === 0) return 1;
  return Math.max(...candidates);
}

export const APP_BUILD = resolveAppBuild();

export const PRODUCTION_API_URL = 'https://api.foxplayer.app';
export const PRODUCTION_PAIRING_URL = 'https://foxplayer.app';

// API Configuration — authoritatively points to production https://api.foxplayer.app
function resolveHostUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (
    envUrl &&
    typeof envUrl === 'string' &&
    (envUrl.startsWith('https://') || envUrl.startsWith('http://'))
  ) {
    return envUrl.replace(/\/+$/, '');
  }
  return PRODUCTION_API_URL;
}

function resolvePairingUrl() {
  const envUrl = process.env.EXPO_PUBLIC_PAIRING_URL || process.env.EXPO_PUBLIC_PAIRING_BASE_URL;
  if (
    envUrl &&
    typeof envUrl === 'string' &&
    (envUrl.startsWith('https://') || envUrl.startsWith('http://'))
  ) {
    return envUrl.replace(/\/+$/, '');
  }
  return PRODUCTION_PAIRING_URL;
}

export const API_BASE_URL = resolveHostUrl();
export const PAIRING_BASE_URL = resolvePairingUrl();

// Device ID
export const DEVICE_ID_LENGTH = 8;
export const DEVICE_ID_REGEX = /^[A-Z0-9]{8}$/;

// Storage Keys
export const STORAGE_KEYS = {
  DEVICE_ID: 'fox_player_device_id',
  ANDROID_ID: 'fox_player_android_id',
  CONFIG_CACHE: 'fox_player_config',
  CHANNELS_CACHE: 'fox_player_channels',
  MOVIES_CACHE: 'fox_player_movies',
  SERIES_CACHE: 'fox_player_series',
  CATEGORIES_CACHE: 'fox_player_categories',
  FAVORITES_CHANNELS: 'fox_player_fav_channels',
  FAVORITES_MOVIES: 'fox_player_fav_movies',
  FAVORITES_SERIES: 'fox_player_fav_series',
  FAVORITES_ALL: 'fox_player_fav_all',
  RECENTLY_WATCHED: 'fox_player_recent',
  ADULT_PIN_HASH: 'fox_player_adult_pin',
  ADULT_LOCKED: 'fox_player_adult_locked',
  LAST_SYNC: 'fox_player_last_sync',
  PLAYLIST_CONFIG: 'fox_player_playlist_config',
  SAVED_PLAYLISTS: 'fox_player_saved_playlists',
  ACTIVE_PLAYLIST_ID: 'fox_player_active_playlist_id',
};

// Playlist-scoped cache key builders
export function getPlaylistConfigKey(playlistId) {
  return playlistId ? `fox_player_${playlistId}_config` : STORAGE_KEYS.PLAYLIST_CONFIG;
}
export function getPlaylistChannelsKey(playlistId) {
  return playlistId ? `fox_player_${playlistId}_channels` : STORAGE_KEYS.CHANNELS_CACHE;
}
export function getPlaylistMoviesKey(playlistId) {
  return playlistId ? `fox_player_${playlistId}_movies` : STORAGE_KEYS.MOVIES_CACHE;
}
export function getPlaylistSeriesKey(playlistId) {
  return playlistId ? `fox_player_${playlistId}_series` : STORAGE_KEYS.SERIES_CACHE;
}
export function getPlaylistMovieCatKey(playlistId, catId) {
  return playlistId ? `fox_player_${playlistId}_movies_cat_${catId}` : `fox_player_movies_cat_${catId}`;
}
export function getPlaylistSeriesCatKey(playlistId, catId) {
  return playlistId ? `fox_player_${playlistId}_series_cat_${catId}` : `fox_player_series_cat_${catId}`;
}
export function getPlaylistFavoritesKey(playlistId) {
  return playlistId ? `fox_player_${playlistId}_fav_all` : STORAGE_KEYS.FAVORITES_ALL;
}

export function getPlaylistRecentlyWatchedKey(playlistId) {
  return playlistId ? `fox_player_${playlistId}_recent` : STORAGE_KEYS.RECENTLY_WATCHED;
}

// Config Types
export const CONFIG_TYPES = {
  M3U: 'm3u',
  XTREAM: 'xtream',
};

// Device Status
export const DEVICE_STATUS = {
  UNREGISTERED: 'UNREGISTERED',
  REGISTERED: 'REGISTERED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONFIGURED: 'CONFIGURED',
  SYNCING: 'SYNCING',
  READY: 'READY',
  ERROR: 'ERROR',
};

// Explicit Application Refresh & Switch Lifecycle States
export const REFRESH_STATE = {
  IDLE: 'IDLE',
  REFRESHING: 'REFRESHING',
  SWITCHING: 'SWITCHING',
  SYNCHRONIZING: 'SYNCHRONIZING',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  ERROR: 'ERROR',
  EXPIRED: 'EXPIRED',
};

// Explicit Central Synchronization States
export const SYNC_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  SYNCING: 'syncing',
  REFRESHING: 'refreshing',
  READY: 'ready',
  OFFLINE: 'offline',
  ERROR: 'error',
  EMPTY: 'empty',
};

// Cache duration: 24 hours max retention
export const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;

// Cache freshness window: 30 minutes (fresh cache requires no background refresh)
export const CACHE_FRESHNESS_MS = 30 * 60 * 1000;

// Scoped Dataset Statuses
export const DATASET_STATUS = {
  NEVER_DOWNLOADED: 'never_downloaded',
  DOWNLOADING: 'downloading',
  CACHED: 'cached',
  STALE: 'stale',
  ERROR: 'error',
};

// Adult content detection keywords
export const ADULT_KEYWORDS = [
  'xxx', 'adult', 'adults', 'erotic', 'porn', 'sex', '18+', '+18', 'x-rated',
  'nude', 'playboy', 'hustler', 'penthouse', 'mature', 'nsfw',
];

// Recently watched limit
export const MAX_RECENTLY_WATCHED = 30;

// Pagination
export const PAGE_SIZE = 50;

// Timeouts (ms)
export const TIMEOUTS = {
  API: 15000,
  IPTV: 30000,
  STREAM_LOAD: 20000,
};

// Centralized Design System Tokens
export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const BorderRadius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  xxl: 20,
  full: 9999,
};

export const IconSize = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
  xxl: 36,
  display: 48,
};

export const TouchTarget = {
  min: 44,
  comfortable: 48,
};

export const CardDimensions = {
  posterAspectRatio: 0.68,
  gridColumnsLandscape: 5,
};

export const Animation = {
  duration: {
    instant: 100,
    fast: 180,
    normal: 250,
    slow: 350,
  },
};
