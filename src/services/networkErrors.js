/**
 * FOX PLAYER — Network Error Classification & Diagnostics
 *
 * Strict, unambiguous classification of networking and synchronization failures.
 * Eliminates false "No internet connection" errors by separating:
 *  - Device offline vs backend server down vs DNS failure vs timeout
 *  - Backend health vs IPTV playlist source health (M3U / Xtream)
 *  - Intentional request cancellation (AbortController) vs actual errors
 *  - Stale requests vs active transactions
 */

let Network = null;
try {
  Network = require('expo-network');
  if (Network && Network.default) Network = Network.default;
} catch (_e) {
  Network = null;
}

/**
 * Authoritative Error Categories
 */
export const ERROR_CATEGORY = {
  OFFLINE: 'OFFLINE',                           // Genuine device disconnection (airplane mode / no Wi-Fi / no cell)
  DNS_ERROR: 'DNS_ERROR',                       // Hostname cannot be resolved
  CONNECTION_ERROR: 'CONNECTION_ERROR',         // Connection refused or port unreachable
  NETWORK_ERROR: 'NETWORK_ERROR',               // General network / socket error
  TIMEOUT: 'TIMEOUT',                           // Operation timed out
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',   // Fox Player backend server unreachable / down
  HTTP_ERROR: 'HTTP_ERROR',                     // HTTP 4xx or 5xx status code
  HTTP_401: 'HTTP_401',                         // HTTP 401 Unauthorized
  HTTP_403: 'HTTP_403',                         // HTTP 403 Forbidden
  HTTP_404: 'HTTP_404',                         // HTTP 404 Not Found
  HTTP_5XX: 'HTTP_5XX',                         // HTTP 5xx Server Error
  AUTH_ERROR: 'AUTH_ERROR',                     // Authentication failed
  AUTH_REQUIRED: 'AUTH_REQUIRED',               // Credentials required
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',             // Zero-byte or whitespace-only response
  INVALID_RESPONSE: 'INVALID_RESPONSE',         // Malformed response
  INVALID_M3U: 'INVALID_M3U',                   // Missing #EXTM3U or valid header
  PARSE_ERROR: 'PARSE_ERROR',                   // Syntax/parsing failure
  NO_VALID_ENTRIES: 'NO_VALID_ENTRIES',         // Valid M3U structure but 0 usable stream entries
  UNSUPPORTED_RESPONSE: 'UNSUPPORTED_RESPONSE', // HTML error page or cloudflare challenge
  REDIRECT_ERROR: 'REDIRECT_ERROR',             // Failed redirect
  REQUEST_ABORTED: 'REQUEST_ABORTED',           // Intentionally cancelled by user (e.g. switched playlists)
  STALE_REQUEST: 'STALE_REQUEST',               // Superseded by newer playlist switch transaction
  PROVIDER_EXPIRED: 'PROVIDER_EXPIRED',         // Provider account/subscription expired or invalid
  PLAYLIST_SOURCE_ERROR: 'PLAYLIST_SOURCE_ERROR',// M3U URL or Xtream server unreachable / failing (device is online)
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',               // Unclassified failure
};

/**
 * Standardized Application Network Error
 */
export class AppNetworkError extends Error {
  constructor(category, message, options = {}) {
    super(message);
    this.name = 'AppNetworkError';
    this.category = category || ERROR_CATEGORY.UNKNOWN_ERROR;
    this.statusCode = options.statusCode || 0;
    this.details = options.details || null;
    this.playlistId = options.playlistId ? String(options.playlistId) : null;
    this.operationId = options.operationId || null;
    this.endpoint = options.endpoint || null;
    this.isCancelled = (
      this.category === ERROR_CATEGORY.REQUEST_ABORTED ||
      this.category === ERROR_CATEGORY.STALE_REQUEST ||
      Boolean(options.isCancelled)
    );
    this.timestamp = Date.now();
  }
}

/**
 * Checks whether the error represents an intentionally aborted or superseded operation.
 * These must NEVER be displayed to the user or trigger error states.
 */
export function isAbortOrCancelledError(err) {
  if (!err) return false;
  if (err.isCancelled) return true;
  if (err.name === 'AbortError') return true;
  if (err.category === ERROR_CATEGORY.REQUEST_ABORTED || err.category === ERROR_CATEGORY.STALE_REQUEST) return true;
  if (err.code === 'CANCELLED' || err.code === 'ABORT_ERR' || err.code === 'ERR_CANCELED') return true;
  if (typeof err.message === 'string' && (err.message === 'CANCELLED' || err.message.includes('aborted'))) return true;
  return false;
}

/**
 * Reliably checks if the device is genuinely offline using expo-network.
 * Returns true ONLY if the network hardware confirms no connection.
 * If Network is unavailable (e.g. Node tests), defaults to false to avoid false offline claims.
 */
export async function isDeviceOffline() {
  try {
    if (Network && typeof Network.getNetworkStateAsync === 'function') {
      const state = await Network.getNetworkStateAsync();
      if (!state) return false;
      // If disconnected or explicitly unreachable
      if (state.isConnected === false || state.isInternetReachable === false) {
        return true;
      }
    }
  } catch (_e) {
    // If querying network state fails, never assume offline
  }
  return false;
}

/**
 * Translates an AppNetworkError into an appropriate, accurate user-facing message.
 */
export function getUserFriendlyErrorMessage(err) {
  if (!err) return 'An unexpected error occurred.';
  if (isAbortOrCancelledError(err)) return '';

  const category = err.category || ERROR_CATEGORY.UNKNOWN_ERROR;

  switch (category) {
    case ERROR_CATEGORY.OFFLINE:
      return 'No internet connection.';
    case ERROR_CATEGORY.BACKEND_UNAVAILABLE:
    case ERROR_CATEGORY.CONNECTION_ERROR:
      return 'Unable to connect to server.';
    case ERROR_CATEGORY.NETWORK_ERROR:
      return err.message || 'Network error: unable to reach the playlist server.';
    case ERROR_CATEGORY.TIMEOUT:
      return 'Server request timed out.';
    case ERROR_CATEGORY.HTTP_401:
    case ERROR_CATEGORY.AUTH_REQUIRED:
      return 'Playlist authentication required (HTTP 401). Please check credentials.';
    case ERROR_CATEGORY.HTTP_403:
      return 'Playlist access denied (HTTP 403). Please verify your subscription or credentials.';
    case ERROR_CATEGORY.HTTP_404:
      return 'Playlist URL not found (HTTP 404). Please verify the link.';
    case ERROR_CATEGORY.HTTP_5XX:
      return 'Playlist server error (HTTP 5xx). Please try again later.';
    case ERROR_CATEGORY.AUTH_ERROR:
      return 'Authentication failed. Please check your credentials.';
    case ERROR_CATEGORY.EMPTY_RESPONSE:
      return 'Playlist source returned an empty response.';
    case ERROR_CATEGORY.INVALID_M3U:
    case ERROR_CATEGORY.PARSE_ERROR:
      return err.message || 'Invalid playlist format. Server did not return a valid M3U playlist.';
    case ERROR_CATEGORY.NO_VALID_ENTRIES:
      return 'No valid channels or streams found in this playlist.';
    case ERROR_CATEGORY.UNSUPPORTED_RESPONSE:
      return err.message || 'Server returned an HTML or unsupported page instead of a playlist.';
    case ERROR_CATEGORY.REDIRECT_ERROR:
      return 'Failed to follow playlist redirect.';
    case ERROR_CATEGORY.HTTP_ERROR:
      if (err.statusCode >= 500) {
        return 'Server error. Please try again.';
      }
      return err.message || `Request failed (HTTP ${err.statusCode}).`;
    case ERROR_CATEGORY.INVALID_RESPONSE:
      return err.message || 'Server returned an invalid response.';
    case ERROR_CATEGORY.DNS_ERROR:
      return 'Unable to resolve server address.';
    case ERROR_CATEGORY.PLAYLIST_SOURCE_ERROR:
      return err.message || 'Playlist source is unavailable.';
    case ERROR_CATEGORY.PROVIDER_EXPIRED:
      return 'Playlist subscription has expired.';
    case ERROR_CATEGORY.UNKNOWN_ERROR:
    default:
      return err.message || 'An unexpected error occurred.';
  }
}

/**
 * Checks whether an error represents an expired or unauthorized IPTV provider subscription.
 */
export function isProviderExpiredError(err) {
  if (!err) return false;
  if (err.category === ERROR_CATEGORY.PROVIDER_EXPIRED) return true;
  if (
    err.category === ERROR_CATEGORY.AUTH_ERROR ||
    err.category === ERROR_CATEGORY.HTTP_401 ||
    err.category === ERROR_CATEGORY.HTTP_403 ||
    err.category === ERROR_CATEGORY.AUTH_REQUIRED
  ) {
    return true;
  }
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('expired') ||
    msg.includes('provider_expired') ||
    msg.includes('iptv_auth_failed') ||
    msg.includes('auth failed') ||
    msg.includes('authentication failed') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('access denied') ||
    msg.includes('subscription')
  );
}

/**
 * Reliably checks if a playlist configuration has passed its expiration date.
 */
export function isPlaylistExpired(playlistOrConfig) {
  if (!playlistOrConfig) return false;
  const cfg = playlistOrConfig.config || playlistOrConfig;
  const status = String(cfg.status || playlistOrConfig.status || '').toLowerCase().trim();
  if (status === 'expired') return true;

  const expDate = cfg.expirationDate || cfg.exp_date || playlistOrConfig.expirationDate;
  if (!expDate || expDate === 'null' || expDate === 0 || expDate === '0') return false;

  const num = Number(expDate);
  if (!isNaN(num) && num > 0) {
    // If Unix timestamp in seconds (standard Xtream) or milliseconds
    const ms = num > 1e11 ? num : num * 1000;
    return ms < Date.now();
  }

  // Handle formatted date strings safely for iOS JSC / Hermes
  try {
    let safeExpStr = String(expDate).trim();
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(safeExpStr)) {
      safeExpStr = safeExpStr.replace(/\s+/, 'T');
    }
    const parsed = Date.parse(safeExpStr);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed < Date.now();
    }
  } catch (_e) {
    // Safe fallback
  }

  return false;
}
