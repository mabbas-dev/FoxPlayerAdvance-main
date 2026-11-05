import { API_BASE_URL, APP_BUILD, APP_VERSION, TIMEOUTS } from '../constants/index.js';
import {
  ERROR_CATEGORY,
  AppNetworkError,
  isDeviceOffline,
  isAbortOrCancelledError,
} from './networkErrors.js';
import { trackRequestStart, trackRequestEnd } from '../utils/requestDiagnostics.js';
import { decryptPayload } from '../utils/payloadCrypto.js';
import { Platform } from 'react-native';
import { getAndroidDeviceId } from '../storage/deviceStorage.js';

export { ERROR_CATEGORY, AppNetworkError, isAbortOrCancelledError, isDeviceOffline };

/**
 * Base API error class (backwards-compatible with AppNetworkError)
 */
export class ApiError extends AppNetworkError {
  constructor(code, message, statusCode = 0) {
    super(code, message, { statusCode });
    this.code = code;
    this.name = 'ApiError';
  }
}

/**
 * Make an authenticated request to the FOX PLAYER backend
 */
async function request(method, path, body = null, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeout || TIMEOUTS.API;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const externalSignal = options.signal || null;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener?.('abort', onExternalAbort);
    }
  }

  const reqId = trackRequestStart({
    endpoint: path,
    playlistId: options.playlistId,
    operationId: options.operationId,
    category: 'BACKEND_API',
  });

  try {
    const fetchOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-app-client': 'foxplayer-app-v2',
        ...(options.deviceId ? { 'x-device-id': options.deviceId } : {}),
        ...(options.installationId ? { 'x-installation-id': options.installationId } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const url = `${API_BASE_URL}${path}`;
    const response = await fetch(url, fetchOptions);

    const rawText = await response.text();
    const text = rawText ? rawText.replace(/^\uFEFF/, '').trim() : '';
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_parseErr) {
      // If output contained PHP warning or leading HTML, attempt substring extraction of JSON object/array
      const firstBrace = text.indexOf('{');
      const firstBracket = text.indexOf('[');
      const startIdx = (firstBrace !== -1 && firstBracket !== -1)
        ? Math.min(firstBrace, firstBracket)
        : (firstBrace !== -1 ? firstBrace : firstBracket);

      if (startIdx !== -1) {
        const lastBrace = text.lastIndexOf('}');
        const lastBracket = text.lastIndexOf(']');
        const endIdx = Math.max(lastBrace, lastBracket);
        if (endIdx > startIdx) {
          try {
            json = JSON.parse(text.slice(startIdx, endIdx + 1));
          } catch (_sliceErr) {}
        }
      }

      if (!json) {
        console.warn(`[API_PARSE_ERROR] ${url} status=${response.status} err=${_parseErr.message} textPreview=${text.slice(0, 160)}`);
        const status = response.status;
        const cat = status >= 500 ? ERROR_CATEGORY.HTTP_ERROR : (status === 404 ? ERROR_CATEGORY.HTTP_ERROR : ERROR_CATEGORY.INVALID_RESPONSE);
        const errMsg = status >= 500
          ? 'Server is temporarily unavailable. Please try again.'
          : (status === 404 ? 'Resource not found on server.' : 'Server returned an invalid response.');

        trackRequestEnd(reqId, {
          completionState: 'ERROR',
          httpStatus: status,
          errorCategory: cat,
          errorMessage: errMsg,
        });

        throw new AppNetworkError(cat, errMsg, { statusCode: status, endpoint: path });
      }
    }

    if (!response.ok || !json?.success) {
      const status = response.status;
      let cat = ERROR_CATEGORY.HTTP_ERROR;
      if (status === 401 || status === 403) {
        cat = ERROR_CATEGORY.AUTH_ERROR;
      } else if (status >= 500) {
        cat = ERROR_CATEGORY.HTTP_ERROR;
      }
      const errMsg = json?.error?.message || json?.message || (status >= 500 ? 'Server error. Please try again.' : 'An unexpected error occurred.');

      trackRequestEnd(reqId, {
        completionState: 'ERROR',
        httpStatus: status,
        errorCategory: cat,
        errorMessage: errMsg,
      });

      throw new ApiError(cat, errMsg, status);
    }

    trackRequestEnd(reqId, {
      completionState: 'SUCCESS',
      httpStatus: response.status,
    });

    return json;
  } catch (e) {
    console.warn(`[API_ERROR] ${method} ${path} error: ${e.message} (cat: ${e.category || e.name})`);

    // 1. User-initiated cancellation / playlist switch
    if (externalSignal?.aborted) {
      trackRequestEnd(reqId, {
        completionState: 'ABORTED',
        errorCategory: ERROR_CATEGORY.REQUEST_ABORTED,
        errorMessage: 'Request cancelled',
      });
      throw new AppNetworkError(
        ERROR_CATEGORY.REQUEST_ABORTED,
        'Request was cancelled.',
        { endpoint: path, isCancelled: true }
      );
    }

    // 2. Request timeout
    if (e.name === 'AbortError') {
      trackRequestEnd(reqId, {
        completionState: 'ERROR',
        errorCategory: ERROR_CATEGORY.TIMEOUT,
        errorMessage: 'Request timed out',
      });
      throw new ApiError('TIMEOUT', 'Server request timed out. Please check your connection.');
    }

    if (e instanceof AppNetworkError) throw e;

    // 3. Network layer failures: separate true offline from backend down / connection refused
    if (e.message === 'Network request failed' || e.message?.includes('fetch') || e.message?.includes('Failed to fetch')) {
      const offline = await isDeviceOffline();
      if (offline) {
        trackRequestEnd(reqId, {
          completionState: 'ERROR',
          errorCategory: ERROR_CATEGORY.OFFLINE,
          errorMessage: 'Device offline',
        });
        throw new ApiError('OFFLINE', 'No internet connection.');
      }

      trackRequestEnd(reqId, {
        completionState: 'ERROR',
        errorCategory: ERROR_CATEGORY.BACKEND_UNAVAILABLE,
        errorMessage: 'Backend unavailable / connection refused',
      });
      throw new ApiError('BACKEND_UNAVAILABLE', 'Unable to connect to server.');
    }

    // 4. Default unknown network error
    trackRequestEnd(reqId, {
      completionState: 'ERROR',
      errorCategory: ERROR_CATEGORY.UNKNOWN_ERROR,
      errorMessage: e.message,
    });
    throw new ApiError('UNKNOWN_ERROR', e.message || 'Unable to reach the server.');
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener?.('abort', onExternalAbort);
    }
  }
}

// --- Device API ---

/**
 * Register this device and installation UUID with the backend
 */
export async function registerDevice(deviceId, options = {}) {
  const installationId = options.installationId || options.installation_id || null;
  const androidId =
    options.androidId ||
    options.android_id ||
    (Platform.OS === 'android' ? getAndroidDeviceId() : null);

  return request(
    'POST',
    '/api/devices/register',
    {
      device_id: deviceId,
      installation_id: installationId,
      android_id: androidId,
      app_version: options.appVersion || '1.0.0',
    },
    { deviceId, installationId, ...options }
  );
}

/**
 * Query authoritative subscription status from backend server clock
 */
export async function getSubscriptionStatus(deviceId, installationId = null, options = {}) {
  const params = [];
  if (installationId) params.push(`installation_id=${encodeURIComponent(installationId)}`);
  if (deviceId) params.push(`device_id=${encodeURIComponent(deviceId)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return request('GET', `/api/subscription/status${query}`, null, { deviceId, installationId, ...options });
}

/**
 * Check free-trial eligibility with backend server
 */
export async function checkTrialEligibility(deviceId, installationId = null, options = {}) {
  const params = [];
  if (installationId) params.push(`installation_id=${encodeURIComponent(installationId)}`);
  if (deviceId) params.push(`device_id=${encodeURIComponent(deviceId)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return request('GET', `/api/subscription/eligibility${query}`, null, { deviceId, installationId, ...options });
}

/**
 * Atomically activate free trial on backend
 */
export async function activateTrial(deviceId, installationId, options = {}) {
  return request(
    'POST',
    '/api/subscription/activate-trial',
    { device_id: deviceId, installation_id: installationId },
    { deviceId, installationId, ...options }
  );
}

// In-flight request deduplication maps
const inFlightDevicePlaylists = new Map();
const inFlightDevicePlaylistConfig = new Map();

/**
 * Get all playlists configured for this device (deduplicated across concurrent calls)
 */
export async function getDevicePlaylists(deviceId, options = {}) {
  if (!deviceId) return { success: false, playlists: [] };
  const key = String(deviceId);
  if (inFlightDevicePlaylists.has(key)) {
    return inFlightDevicePlaylists.get(key);
  }

  const promise = request('GET', `/api/device/${deviceId}/playlists`, null, { deviceId, ...options })
    .then((res) => {
      if (!res || !res.success) return res;
      if (res.encrypted && res.data) {
        const decrypted = decryptPayload(res.data);
        if (Array.isArray(decrypted)) {
          return {
            ...res,
            playlists: decrypted,
            count: decrypted.length,
          };
        } else if (decrypted && Array.isArray(decrypted.playlists)) {
          return {
            ...res,
            ...decrypted,
          };
        }
      }
      return res;
    })
    .finally(() => {
      inFlightDevicePlaylists.delete(key);
    });

  inFlightDevicePlaylists.set(key, promise);
  return promise;
}

/**
 * Get the playlist configuration for this device (active or specific playlist, deduplicated)
 */
export async function getDevicePlaylist(deviceId, playlistId = null, options = {}) {
  if (!deviceId) return { configured: false };
  const key = `${deviceId}:${playlistId || 'active'}`;
  if (inFlightDevicePlaylistConfig.has(key)) {
    return inFlightDevicePlaylistConfig.get(key);
  }

  const query = playlistId ? `?playlist_id=${encodeURIComponent(playlistId)}` : '';
  const promise = request('GET', `/api/device/${deviceId}/playlist${query}`, null, { deviceId, ...options })
    .then((res) => {
      if (!res || !res.success) return res;
      if (res.encrypted && res.data) {
        const decrypted = decryptPayload(res.data);
        if (decrypted && typeof decrypted === 'object') {
          return {
            ...res,
            ...decrypted,
            configuration: decrypted,
            config: decrypted,
          };
        }
      }
      return res;
    })
    .finally(() => {
      inFlightDevicePlaylistConfig.delete(key);
    });

  inFlightDevicePlaylistConfig.set(key, promise);
  return promise;
}

/**
 * Set active playlist for this device on the server
 */
export async function setActiveDevicePlaylist(deviceId, playlistId, options = {}) {
  return request('POST', `/api/device/${deviceId}/active-playlist`, { playlist_id: playlistId }, { deviceId, ...options });
}

/**
 * Delete a playlist from the server
 */
export async function deleteDevicePlaylist(deviceId, playlistId, options = {}) {
  return request('DELETE', `/api/device/${deviceId}/playlist/${encodeURIComponent(playlistId)}`, null, { deviceId, ...options });
}

/**
 * Get pairing token and 6-digit code for this device
 */
export async function getDevicePairingToken(deviceId, options = {}) {
  return request('GET', `/api/device/${deviceId}/pairing-token`, null, { deviceId, ...options });
}

/**
 * Get ID Lock status for this device
 */
export async function getDeviceIdLock(deviceId, options = {}) {
  return request('GET', `/api/device/${deviceId}/id-lock`, null, { deviceId, ...options });
}

/**
 * Set ID Lock status for this device
 */
export async function setDeviceIdLock(deviceId, isLocked, options = {}) {
  return request('POST', `/api/device/${deviceId}/id-lock`, { id_lock: isLocked }, { deviceId, ...options });
}

/**
 * Add a playlist (M3U or Xtream) for this device
 */
export async function addDevicePlaylist(deviceId, playlistData, options = {}) {
  return request('POST', `/api/device/${deviceId}/playlists`, playlistData, { deviceId, ...options });
}

/**
 * Check if server is reachable
 */
/**
 * Recover existing permanent App ID and application data via Android ID
 * Strictly conditional on Android platform.
 */
export async function recoverDeviceByAndroidId(androidId, options = {}) {
  if (!androidId || typeof androidId !== 'string') {
    return { success: false, recovered: false, error: 'INVALID_ANDROID_ID' };
  }

  const res = await request(
    'POST',
    '/api/devices/recover',
    {
      android_id: androidId.trim(),
      app_version: options.appVersion || '1.0.0',
    },
    { timeout: options.timeout || 10000, ...options }
  );

  if (res && res.success && res.recovered) {
    let playlists = [];
    if (res.encrypted_playlists) {
      try {
        playlists = decryptPayload(res.encrypted_playlists) || [];
      } catch (_e) {
        playlists = res.playlists || [];
      }
    } else if (Array.isArray(res.playlists)) {
      playlists = res.playlists;
    }

    let userData = {};
    if (res.encrypted_user_data) {
      try {
        userData = decryptPayload(res.encrypted_user_data) || {};
      } catch (_e) {
        userData = res.user_data || {};
      }
    } else if (res.user_data) {
      userData = res.user_data;
    }

    return {
      ...res,
      playlists,
      userData,
    };
  }

  return res;
}

/**
 * Retrieve user favorites and settings stored on the backend
 */
export async function getUserData(deviceId, options = {}) {
  const res = await request(
    'GET',
    `/api/device/${encodeURIComponent(deviceId)}/user-data`,
    null,
    { deviceId, ...options }
  );

  if (res && res.success) {
    let userData = {};
    if (res.encrypted_user_data) {
      try {
        userData = decryptPayload(res.encrypted_user_data) || {};
      } catch (_e) {
        userData = res.user_data || {};
      }
    } else if (res.user_data) {
      userData = res.user_data;
    }
    return { ...res, userData };
  }

  return res;
}

/**
 * Persist user favorites and settings to the backend
 */
export async function saveUserData(deviceId, keyOrData, maybeValue = null, options = {}) {
  let payload = {};
  if (typeof keyOrData === 'string') {
    payload = { key: keyOrData, value: maybeValue };
  } else if (keyOrData && typeof keyOrData === 'object') {
    payload = { data: keyOrData };
  }

  return request(
    'POST',
    `/api/device/${encodeURIComponent(deviceId)}/user-data`,
    payload,
    { deviceId, ...options }
  );
}

export async function healthCheck(options = {}) {
  return request('GET', '/api/health', null, options);
}

function normalizeUpdatePayload(res, clientBuild) {
  const build = clientBuild > 0 ? clientBuild : 1;
  if (!res || res.success === false) {
    return { success: false, update_available: false, client_version_code: build };
  }
  let fromEncrypted = null;
  if (res.encrypted && res.data) {
    const decrypted = decryptPayload(res.data);
    if (decrypted && typeof decrypted === 'object') fromEncrypted = decrypted;
  }
  return {
    success: true,
    update_available: Boolean(fromEncrypted?.update_available ?? res.update_available),
    force_update: Boolean(fromEncrypted?.force_update ?? res.force_update),
    latest: (fromEncrypted?.latest ?? res.latest) || null,
    client_version_code: fromEncrypted?.client_version_code ?? res.client_version_code ?? build,
  };
}

export async function checkAppUpdate(options = {}) {
  const platform =
    Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'all';
  const build = APP_BUILD > 0 ? APP_BUILD : 1;
  const qs = new URLSearchParams({
    platform,
    version_code: String(build),
    version_name: APP_VERSION || '',
  });
  const res = await request(
    'GET',
    `/api/app/update-check?${qs.toString()}`,
    null,
    { timeout: TIMEOUTS.API, ...options },
  );
  return normalizeUpdatePayload(res, build);
}
