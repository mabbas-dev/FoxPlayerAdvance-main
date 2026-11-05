import { redactString } from './diagnostics.js';

let Platform = { OS: 'ios' };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}

/**
 * FOX PLAYER — Comprehensive Player Error Classification
 *
 * Classifies AVFoundation (iOS) and Media3 / ExoPlayer (Android) playback errors
 * into structured categories with user-friendly messages and sanitized diagnostics.
 * Never leaks credentials, passwords, or authentication tokens.
 */

export const ERROR_CLASSIFICATION = {
  INVALID_URL: 'INVALID_URL',
  AUTH_FAILURE: 'AUTH_FAILURE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  ATS_NETWORK_FAILURE: 'ATS_NETWORK_FAILURE',
  TIMEOUT: 'TIMEOUT',
  HTTP_FAILURE: 'HTTP_FAILURE',
  HTTP_CONNECTION_LIMIT: 'HTTP_CONNECTION_LIMIT',
  STREAM_OFF_AIR: 'STREAM_OFF_AIR',
  HLS_PARSING_FAILURE: 'HLS_PARSING_FAILURE',
  DECODER_FAILURE: 'DECODER_FAILURE',
  SOURCE_LOAD_FAILURE: 'SOURCE_LOAD_FAILURE',
  CANCELLED: 'CANCELLED',
  NETWORK_FAILURE: 'NETWORK_FAILURE',
  UNKNOWN: 'UNKNOWN',
};

/**
 * High-level error popup authorization categories (Phase 3).
 * An error popup (toast/modal) is strictly permitted ONLY for:
 * 1. CONFIRMED_SERVER_ERROR: Verified HTTP 500, 502, 503, 504 (actual HTTP response), 5xx, or provider API failure.
 * 2. FATAL_NATIVE_PLAYER_ERROR: Confirmed unrecoverable native player crash or engine failure.
 * All other conditions (NON_FATAL) must NEVER display an error popup.
 */
export const ERROR_POPUP_CATEGORY = {
  CONFIRMED_SERVER_ERROR: 'CONFIRMED_SERVER_ERROR',
  FATAL_NATIVE_PLAYER_ERROR: 'FATAL_NATIVE_PLAYER_ERROR',
  NON_FATAL: 'NON_FATAL',
};

/**
 * Safely extracts HTTP status code from error object or error message string.
 *
 * @param {Error|string|Object} error
 * @returns {number|null}
 */
export function extractHttpStatus(error) {
  if (!error) return null;
  if (typeof error === 'object') {
    const status = error.status ?? error.statusCode ?? error.response?.status ?? error.httpStatus;
    if (typeof status === 'number' && status >= 100 && status <= 599) {
      return status;
    }
  }
  const rawMsg = typeof error === 'string' ? error : (error.message || error.localizedDescription || String(error));
  const httpMatch = rawMsg.match(/(?:http(?:\s+response)?|status(?:\s+code)?|response\s+code[:\s]+)\s*(\d{3})/i)
    || rawMsg.match(/\b(500|502|503|504|509|401|403|404|405)\b/);
  if (httpMatch && httpMatch[1]) {
    const code = parseInt(httpMatch[1], 10);
    if (code >= 100 && code <= 599) return code;
  }
  return null;
}

/**
 * Safely extracts native player error code from error object or error message string.
 *
 * @param {Error|string|Object} error
 * @returns {string|null}
 */
export function extractNativeErrorCode(error) {
  if (!error) return null;
  if (typeof error === 'object' && error.code != null) {
    return String(error.code);
  }
  const rawMsg = typeof error === 'string' ? error : (error.message || error.localizedDescription || String(error));
  const match = rawMsg.match(/(?:code|error)[=:\s]+(-?\d+)/i);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}

/**
 * Detects whether an error reliably confirms a genuine IPTV server-side failure.
 * Specifically:
 * - HTTP 500 Internal Server Error
 * - HTTP 502 Bad Gateway
 * - HTTP 503 Service Unavailable
 * - HTTP 504 Gateway Timeout (MUST be actual HTTP response, NOT a local client timeout)
 * - Any other explicit server-side HTTP 5xx response
 * - A provider API response explicitly reporting server-side failure
 *
 * NOTE: HTTP 401, 403, 404, and 509 (bandwidth limit) are NOT server-side errors.
 * Locally generated timeouts (AbortError, Code=-1001, watchdog) are NOT server errors.
 *
 * @param {Error|string|Object} error
 * @returns {boolean}
 */
export function isConfirmedServerError(error) {
  if (!error) return false;

  const rawMsg = typeof error === 'string'
    ? error
    : (error.message || error.localizedDescription || String(error));
  const msg = rawMsg.toLowerCase();

  // Explicit check: If this is purely a local client-side timeout, abort, or socket cancel:
  const isLocalTimeoutOrAbort =
    (msg.includes('timed out') || msg.includes('timeout') || msg.includes('code=-1001') || msg.includes('aborterror')) &&
    !msg.includes('504') &&
    !msg.includes('gateway timeout') &&
    !msg.includes('http 5') &&
    !msg.includes('status code 5') &&
    !msg.includes('response code 5');
  if (isLocalTimeoutOrAbort) {
    return false;
  }

  // Check structured HTTP status code
  const status = extractHttpStatus(error);
  if (status !== null) {
    // 509 is bandwidth limit / max connections, not server internal failure
    if (status >= 500 && status <= 599 && status !== 509) {
      return true;
    }
    // 4xx is authorization / client / resource missing, not server failure
    if (status >= 400 && status < 500) {
      return false;
    }
  }

  // Check explicit 5xx in text
  const has5xxText =
    msg.includes('500 internal server error') ||
    msg.includes('502 bad gateway') ||
    msg.includes('503 service unavailable') ||
    msg.includes('http 500') ||
    msg.includes('http 502') ||
    msg.includes('http 503') ||
    (msg.includes('504') && (msg.includes('gateway') || msg.includes('http') || msg.includes('server') || msg.includes('response') || msg.includes('status'))) ||
    msg.includes('server error (5') ||
    msg.includes('http 5xx') ||
    msg.includes('server returned 5') ||
    msg.includes('server returned http 5') ||
    msg.includes('server responded with 5') ||
    msg.includes('response code: 5') ||
    msg.includes('response code 5') ||
    msg.includes('status code 500') ||
    msg.includes('status code 502') ||
    msg.includes('status code 503') ||
    msg.includes('status code 504');

  if (has5xxText) {
    return true;
  }

  // Provider API server error
  if (
    (msg.includes('xtream') || msg.includes('provider') || msg.includes('iptv')) &&
    (msg.includes('server error') || msg.includes('server unavailable') || msg.includes('server failure') || msg.includes('upstream error'))
  ) {
    return true;
  }

  return false;
}

/**
 * Detects whether the error represents a confirmed fatal native player crash or unrecoverable engine failure.
 *
 * Requirements:
 * - Must NOT infer crash from mere delay, buffering, or loading.
 * - Must NOT classify harmless cancellation (-999 / operation stopped / replaced) as fatal.
 * - Confirmed fatal native conditions include:
 *   - Hardware decoder malfunction / unsupported profile (-12909, -12911, -12906, MediaCodecRenderer init exception, NO_SUPPORTED_FORMAT)
 *   - Fatal container / byte-range rejection (-11850, -12939, -11828)
 *   - Unrecoverable native player crash / engine fault
 *
 * @param {Error|string|Object} error
 * @param {Object} [context={}]
 * @returns {boolean}
 */
export function isFatalNativePlayerError(error, context = {}) {
  if (!error) return false;

  const rawMsg = typeof error === 'string'
    ? error
    : [
        error.message || '',
        error.localizedDescription || '',
        error.code || '',
        error.errorCode || '',
        error.name || '',
        String(error),
      ].join(' ');
  const msg = rawMsg.toLowerCase();

  // Harmless cancellations or channel switching are NEVER fatal crashes
  if (
    (msg.includes('the operation was stopped') &&
      !msg.includes('code=-118') &&
      !msg.includes('code=-129') &&
      !msg.includes('code=-168') &&
      !msg.includes('failed to load') &&
      !msg.includes('avfoundationerrordomain')) ||
    msg.includes('operation was replaced') ||
    msg.includes('cancelled') ||
    msg.includes('code=-999') ||
    msg.includes('-999')
  ) {
    return false;
  }

  // Purely client-side timeouts / watchdogs are NEVER fatal crashes
  if (
    msg.includes('connection timed out') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('code=-1001') ||
    msg.includes('playback failed to start') ||
    msg.includes('stream connection lost') ||
    msg.includes('stream failed to play')
  ) {
    return false;
  }

  // Hardware decoder crash / malfunction
  const isDecoderCrash =
    msg.includes('-12909') ||
    msg.includes('kvtvideodecoderbaddataerr') ||
    msg.includes('-12911') ||
    msg.includes('kvtvideodecodermalfunctionerr') ||
    msg.includes('-12906') ||
    msg.includes('kvtvideodecoderunsupporteddataformaterr') ||
    msg.includes('mediacodecrenderer$decoderinitializationexception') ||
    msg.includes('decoder_init_failed') ||
    msg.includes('no_supported_format') ||
    msg.includes('-11833') ||
    msg.includes('-11834');

  if (isDecoderCrash) return true;

  // Fatal unrecoverable native container / format rejection
  const isFatalFormatOrConfig =
    msg.includes('-11850') ||
    msg.includes('-12939') ||
    msg.includes('server is not correctly configured') ||
    msg.includes('byte range and no content length') ||
    msg.includes('averrorfileformatnotrecognized') ||
    msg.includes('-11828') ||
    (msg.includes('mkv') && msg.includes('11828'));

  if (isFatalFormatOrConfig) return true;

  // Fatal HLS manifest syntax corruptions
  const isFatalHlsSyntax =
    msg.includes('code=-16845') ||
    msg.includes('-16845') ||
    msg.includes('<!doctype') ||
    msg.includes('<html');

  if (isFatalHlsSyntax) return true;

  // Confirmed native player crash / engine failure
  if (
    msg.includes('native player crash') ||
    msg.includes('player crashed') ||
    msg.includes('engine crash') ||
    msg.includes('unrecoverable native error') ||
    msg.includes('fatal native error')
  ) {
    return true;
  }

  // If this comes from an actual native statusChange event with status === 'error'
  // and has an AVFoundation or ExoPlaybackException fatal code
  if (context.isNativeEvent || msg.includes('avfoundationerrordomain') || msg.includes('exoplaybackexception')) {
    if (
      msg.includes('code=-11800') ||
      msg.includes('exoplaybackexception: type_renderer') ||
      msg.includes('exoplaybackexception: type_source')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Centralized error-classification policy function for popup display eligibility (Phase 3).
 *
 * Categories:
 * A. CONFIRMED SERVER ERROR (HTTP 500, 502, 503, 504 [genuine HTTP], 5xx, provider failure) -> POPUP ALLOWED
 * B. FATAL NATIVE PLAYER ERROR OR CRASH -> POPUP ALLOWED
 * C. NON-FATAL CONDITIONS (timeouts, buffering, slow connect, network blips, cancellation) -> NO POPUP
 *
 * @param {Error|string|Object} error
 * @param {Object} [context={}]
 * @returns {{
 *   shouldShowPopup: boolean,
 *   popupCategory: 'CONFIRMED_SERVER_ERROR' | 'FATAL_NATIVE_PLAYER_ERROR' | 'NON_FATAL',
 *   httpStatus: number | null,
 *   nativeErrorCode: string | null,
 *   decisionReason: string
 * }}
 */
export function evaluatePlayerErrorPopupPolicy(error, context = {}) {
  const httpStatus = extractHttpStatus(error);
  const nativeErrorCode = extractNativeErrorCode(error);

  if (isConfirmedServerError(error)) {
    return {
      shouldShowPopup: true,
      popupCategory: ERROR_POPUP_CATEGORY.CONFIRMED_SERVER_ERROR,
      httpStatus,
      nativeErrorCode,
      decisionReason: `Confirmed server error response (HTTP ${httpStatus || '5xx'}). Popup allowed.`,
    };
  }

  if (isFatalNativePlayerError(error, context)) {
    return {
      shouldShowPopup: true,
      popupCategory: ERROR_POPUP_CATEGORY.FATAL_NATIVE_PLAYER_ERROR,
      httpStatus,
      nativeErrorCode,
      decisionReason: `Confirmed fatal native player error / crash (code: ${nativeErrorCode || 'native'}). Popup allowed.`,
    };
  }

  // All other conditions: Non-fatal, locally generated timeout, slow connection, buffering, or unconfirmed
  const rawMsg = typeof error === 'string'
    ? error
    : (error?.message || error?.localizedDescription || String(error || ''));
  const isTimeout = /timeout|timed out|code=-1001/i.test(rawMsg);
  const isBufferingOrSlow = /buffer|slow|loading|stall|failed to start/i.test(rawMsg);

  let reason = 'Non-fatal / unconfirmed error condition. Popup suppressed.';
  if (isTimeout) {
    reason = 'Client-side or watchdog timeout without confirmed server 5xx. Popup suppressed.';
  } else if (isBufferingOrSlow) {
    reason = 'Buffering or preparation delay. Popup suppressed; handled by loading/buffering UI.';
  }

  return {
    shouldShowPopup: false,
    popupCategory: ERROR_POPUP_CATEGORY.NON_FATAL,
    httpStatus,
    nativeErrorCode,
    decisionReason: reason,
  };
}

/**
 * Phase 8 Diagnostics logger for classified player errors.
 * Development-only structured telemetry. Never logs passwords, tokens, credentials, or private URLs.
 */
export function logClassifiedPlayerError({
  platform = Platform.OS,
  activePlaybackSessionId = null,
  errorCategory,
  errorOrigin = 'unknown',
  actualHttpStatus = null,
  nativeErrorCode = null,
  popupDisplayed = false,
  decisionReason = '',
} = {}) {
  const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (!IS_DEV) return;

  const entry = {
    platform,
    activePlaybackSessionId: activePlaybackSessionId ? String(activePlaybackSessionId) : 'none',
    errorCategory,
    errorOrigin,
    actualHttpStatus,
    nativeErrorCode,
    popupDisplayed,
    decisionReason: redactString(decisionReason),
  };

  console.log(`[PLAYER:ERROR_CLASSIFICATION]`, JSON.stringify(entry));
}

/**
 * Internal technical error classifier preserving backward-compatibility with existing tests.
 */
function _rawClassifyPlayerError(error) {
  if (!error) {
    return {
      category: ERROR_CLASSIFICATION.UNKNOWN,
      userMessage: 'Unable to play this stream.',
      technicalMessage: 'Playback failed with an unhandled error.',
      sanitizedMessage: 'Playback failed with an unhandled error.',
      isFatal: true,
      isRecoverable: true,
    };
  }

  const rawMsg = typeof error === 'string'
    ? error
    : (error.message || error.localizedDescription || String(error));
  const msg = rawMsg.toLowerCase();
  const sanitizedMsg = redactString(rawMsg);

  // Fatal server configuration / byte range errors (AVErrorServerIncorrectlyConfigured Code=-11850 / -12939)
  // Apple AVPlayer reports localizedDescription="Operation Stopped" for Code=-11850.
  // When accompanied by "failed to load the player item", Code -11850, or CoreMedia -12939,
  // this is a fatal stream load error (e.g. progressive MPEG-TS without HLS or byte-range support).
  const isServerConfigError =
    msg.includes('failed to load the player item') ||
    msg.includes('code=-11850') ||
    msg.includes('-11850') ||
    msg.includes('code=-12939') ||
    msg.includes('-12939') ||
    msg.includes('server is not correctly configured') ||
    msg.includes('byte range and no content length') ||
    (msg.includes('operation stopped') && !msg.includes('the operation was stopped'));

  if (isServerConfigError) {
    const isVod = msg.includes('/movie/') || msg.includes('/series/') || msg.includes('.mp4') || msg.includes('.mkv');
    return {
      category: ERROR_CLASSIFICATION.UNSUPPORTED_FORMAT,
      userMessage: isVod
        ? 'Video playback failed. Server does not support byte-range streaming or container format is incompatible.'
        : 'Stream format (MPEG-TS) unsupported on this device. Provider does not offer HLS (.m3u8).',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: false,
    };
  }

  // 1. Stale / Cancelled / Replaced operations (non-fatal)
  const isHarmlessCancel =
    (msg.includes('the operation was stopped') &&
      !msg.includes('code=-118') &&
      !msg.includes('code=-129') &&
      !msg.includes('code=-168') &&
      !msg.includes('failed to load') &&
      !msg.includes('avfoundationerrordomain')) ||
    msg.includes('operation was replaced') ||
    msg.includes('the operation was cancelled') ||
    msg.includes('operation was cancelled') ||
    msg.includes('code=-999') ||
    msg.includes('-999') ||
    (typeof error === 'object' && error?.code === -999);

  if (isHarmlessCancel) {
    return {
      category: ERROR_CLASSIFICATION.CANCELLED,
      userMessage: 'Playback cancelled',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: false,
      isRecoverable: true,
    };
  }

  if (msg.includes('interrupted')) {
    return {
      category: ERROR_CLASSIFICATION.NETWORK_FAILURE,
      userMessage: 'Stream connection was interrupted.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  if (msg.includes('code=-999') || msg.includes('-999')) {
    return {
      category: ERROR_CLASSIFICATION.NETWORK_FAILURE,
      userMessage: 'Check your internet connection and try again.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // 2. App Transport Security (iOS cleartext HTTP blocked)
  if (
    msg.includes('app transport security') ||
    msg.includes('ats') ||
    msg.includes('code=-1022') ||
    msg.includes('the resource could not be loaded because the app transport security policy requires the use of a secure connection')
  ) {
    return {
      category: ERROR_CLASSIFICATION.ATS_NETWORK_FAILURE,
      userMessage: 'Security policy blocked insecure stream (HTTP).',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: false,
    };
  }

  // 3. Authentication & Authorization failures
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('forbidden') ||
    msg.includes('unauthorized') ||
    msg.includes('auth failed') ||
    msg.includes('access denied')
  ) {
    return {
      category: ERROR_CLASSIFICATION.AUTH_FAILURE,
      userMessage: 'The stream could not be authenticated.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: false,
    };
  }

  // 4. Invalid or Malformed URL
  if (
    msg.includes('invalid url') ||
    msg.includes('malformed') ||
    msg.includes('unsupported protocol') ||
    msg.includes('code=-1002') ||
    msg.includes('unsupported url') ||
    msg.includes('cannot parse')
  ) {
    return {
      category: ERROR_CLASSIFICATION.INVALID_URL,
      userMessage: 'Invalid stream address.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: false,
    };
  }

  // 5. Connection Limit / Bandwidth Exceeded (Xtream max_connections reached)
  if (
    msg.includes('509') ||
    msg.includes('code=-16846') ||
    msg.includes('bandwidth limit') ||
    msg.includes('max connections') ||
    msg.includes('connection limit')
  ) {
    return {
      category: ERROR_CLASSIFICATION.HTTP_CONNECTION_LIMIT,
      userMessage: 'Stream connection limit reached (HTTP 509). Please stop other active streams.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // 6. Channel Off-Air / Empty Manifest
  if (
    msg.includes('-16830') ||
    msg.includes('coremediaerrordomain error -16830') ||
    msg.includes('segment unavailable') ||
    msg.includes('empty manifest')
  ) {
    return {
      category: ERROR_CLASSIFICATION.STREAM_OFF_AIR,
      userMessage: 'This channel is currently off-air or unavailable from the provider.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // 7. Unsupported Media Format / Container / Codec (MKV, AC3, DTS, MediaCodec)
  if (
    msg.includes('mkv') ||
    (msg.includes('code=-11828') && (sanitizedMsg.toLowerCase().includes('.mkv') || msg.includes('mkv')))
  ) {
    return {
      category: ERROR_CLASSIFICATION.UNSUPPORTED_FORMAT,
      userMessage: "This stream is in MKV format, which is not supported by Apple's native player. Switching to software engine...",
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  if (
    msg.includes('unsupported format') ||
    msg.includes('unrecognizedinputformatexception') ||
    msg.includes('code=-11828') || // AVErrorFileFormatNotRecognized / Cannot Open
    msg.includes('code=-11850') || // AVErrorServerIncorrectlyConfigured (e.g. byte range & no content length)
    msg.includes('server is not correctly configured') ||
    msg.includes('byte range and no content length') ||
    msg.includes('format not recognized') ||
    msg.includes('cannot open') ||
    msg.includes('codec not supported') ||
    msg.includes('unsupported container') ||
    msg.includes('demuxer')
  ) {
    return {
      category: ERROR_CLASSIFICATION.UNSUPPORTED_FORMAT,
      userMessage: 'This video format is not supported on this device.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: false,
    };
  }

  // 8. Timeouts
  if (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('code=-1001') ||
    msg.includes('connection timed out')
  ) {
    return {
      category: ERROR_CLASSIFICATION.TIMEOUT,
      userMessage: 'Stream connection timed out.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // 9. General Network & Connectivity Failures (e.g. offline, DNS, connection refused)
  if (
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('connection refused') ||
    msg.includes('unreachable') ||
    msg.includes('code=-1004') ||
    msg.includes('code=-1009') ||
    msg.includes('dns') ||
    msg.includes('socket')
  ) {
    return {
      category: ERROR_CLASSIFICATION.NETWORK_FAILURE,
      userMessage: 'A network error prevented playback.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // 10. Playback Stall & Connection Loss
  if (
    msg.includes('playback stalled') ||
    msg.includes('stream connection lost') ||
    msg.includes('connection lost') ||
    msg.includes('stream stalled') ||
    msg.includes('stream failed to play')
  ) {
    return {
      category: ERROR_CLASSIFICATION.STREAM_OFF_AIR,
      userMessage: 'Stream connection lost. Server is unresponsive or channel is offline.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // 9. HTTP Server Failures
  if (
    msg.includes('404') ||
    msg.includes('405') ||
    msg.includes('method not allowed') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('not found') ||
    msg.includes('server error')
  ) {
    const is405 = msg.includes('405') || msg.includes('method not allowed');
    const is404 = msg.includes('404') || msg.includes('not found');
    let userMsg = 'The stream is temporarily unavailable.';
    if (is405) {
      userMsg = 'Stream format or method not supported by provider (HTTP 405).';
    } else if (is404) {
      userMsg = 'Stream not found on server (HTTP 404).';
    }
    return {
      category: ERROR_CLASSIFICATION.HTTP_FAILURE,
      userMessage: userMsg,
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // Resource unavailable (-1008)
  if (msg.includes('code=-1008') || msg.includes('resource unavailable')) {
    return {
      category: ERROR_CLASSIFICATION.NETWORK_FAILURE,
      userMessage: 'Stream resource is currently unavailable from provider.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  // 10. HLS Manifest & Parsing Failures (including HTML error pages returned instead of media)
  const isHlsParsingError =
    msg.includes('cannot parse playlist') ||
    msg.includes('playlist error') ||
    msg.includes('invalid manifest') ||
    msg.includes('playlist empty') ||
    msg.includes('failed to parse playlist') ||
    msg.includes('code=-16845') ||
    msg.includes('-16845') ||
    msg.includes('<!doctype') ||
    msg.includes('<html') ||
    msg.includes('doctype html') ||
    msg.includes('coremediaerrordomain error -16845');

  if (isHlsParsingError) {
    const isHtmlResponse = msg.includes('<!doctype') || msg.includes('<html') || msg.includes('doctype html');
    return {
      category: ERROR_CLASSIFICATION.HLS_PARSING_FAILURE,
      userMessage: isHtmlResponse
        ? 'Provider returned a web page instead of stream data (e.g. portal login or ISP block).'
        : 'Failed to parse stream playlist manifest.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: !isHtmlResponse,
    };
  }

  // 11. Video & Audio Decoder / Hardware Renderer Failures (iOS VideoToolbox & Android Media3)
  const isDecoderError =
    msg.includes('decoder') ||
    msg.includes('mediacodec') ||
    msg.includes('code=-11849') ||
    msg.includes('-11849') ||
    msg.includes('code=-12909') || // kVTVideoDecoderBadDataErr (e.g. 10-bit H.264 Hi10P or unsupported HEVC profile)
    msg.includes('-12909') ||
    msg.includes('code=-12911') || // kVTVideoDecoderMalfunctionErr (hardware decoder failure)
    msg.includes('-12911') ||
    msg.includes('code=-12906') || // kVTVideoDecoderUnsupportedDataFormatErr
    msg.includes('-12906') ||
    msg.includes('code=-11833') || // AVErrorDecoderNotFound
    msg.includes('-11833') ||
    msg.includes('code=-11834') || // AVErrorDecoderTemporarilyUnavailable
    msg.includes('-11834') ||
    msg.includes('no_supported_format') ||
    msg.includes('decoderinitializationexception') ||
    msg.includes('decoder_init_failed') ||
    msg.includes('audiosink') ||
    msg.includes('behindlivewindowexception') ||
    msg.includes('render error');

  if (isDecoderError) {
    const isHardwareUnsupported =
      msg.includes('-12909') ||
      msg.includes('-12906') ||
      msg.includes('-11833') ||
      msg.includes('no_supported_format') ||
      msg.includes('10-bit') ||
      msg.includes('hi10p');

    const isLiveDrift = msg.includes('behindlivewindowexception');

    let userMsg = 'Video decoder error occurred.';
    if (isHardwareUnsupported) {
      userMsg = 'Stream codec profile (e.g. 10-bit H.264 or unsupported HEVC) is not supported by device hardware decoder.';
    } else if (isLiveDrift) {
      userMsg = 'Live stream buffer drifted behind provider window. Re-syncing...';
    } else if (msg.includes('audiosink')) {
      userMsg = 'Audio format (e.g. multi-channel DTS) is unsupported on this device.';
    }

    return {
      category: ERROR_CLASSIFICATION.DECODER_FAILURE,
      userMessage: userMsg,
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: !isHardwareUnsupported, // Hardware codec limitations cannot succeed on repeated retry
    };
  }

  // 12. Source Loading Failures
  if (
    msg.includes('failed to load') ||
    msg.includes('source load error') ||
    msg.includes('load error')
  ) {
    return {
      category: ERROR_CLASSIFICATION.SOURCE_LOAD_FAILURE,
      userMessage: 'Unable to load this stream.',
      technicalMessage: sanitizedMsg,
      sanitizedMessage: sanitizedMsg,
      isFatal: true,
      isRecoverable: true,
    };
  }

  return {
    category: ERROR_CLASSIFICATION.UNKNOWN,
    userMessage: 'Unable to play this stream.',
    technicalMessage: sanitizedMsg,
    sanitizedMessage: sanitizedMsg,
    isFatal: true,
    isRecoverable: true,
  };
}

/**
 * Classifies raw technical player error into a structured diagnosis and applies
 * strict popup authorization policy (Phase 3).
 *
 * @param {Error|string|Object} error
 * @param {Object} [context={}]
 * @returns {{
 *   category: string,
 *   userMessage: string,
 *   technicalMessage: string,
 *   sanitizedMessage: string,
 *   isFatal: boolean,
 *   isRecoverable: boolean,
 *   shouldShowPopup: boolean,
 *   popupCategory: string,
 *   isConfirmedServerError: boolean,
 *   isFatalNativeError: boolean,
 *   httpStatus: number | null,
 *   nativeErrorCode: string | null,
 *   decisionReason: string
 * }}
 */
export function classifyPlayerError(error, context = {}) {
  const result = _rawClassifyPlayerError(error);
  const policy = evaluatePlayerErrorPopupPolicy(error, context);

  return {
    ...result,
    shouldShowPopup: policy.shouldShowPopup,
    popupCategory: policy.popupCategory,
    isConfirmedServerError: policy.popupCategory === ERROR_POPUP_CATEGORY.CONFIRMED_SERVER_ERROR,
    isFatalNativeError: policy.popupCategory === ERROR_POPUP_CATEGORY.FATAL_NATIVE_PLAYER_ERROR,
    httpStatus: policy.httpStatus,
    nativeErrorCode: policy.nativeErrorCode,
    decisionReason: policy.decisionReason,
  };
}

/**
 * Backward-compatible mapper returning user-facing error message string.
 *
 * @param {Error|string|Object} error
 * @param {boolean} [isNetworkOrUrl=false]
 * @returns {string} Clean user-facing error message
 */
export function mapStreamError(error, isNetworkOrUrl = false) {
  if (isNetworkOrUrl) {
    return 'A network error prevented playback.';
  }

  const classified = classifyPlayerError(error);
  return classified.userMessage || 'Unable to play this stream.';
}

/**
 * Returns structured display details for the in-player error screen.
 * Provides a clean heading, user-facing primary message, secondary explanatory tip,
 * and retryability flag while ensuring confidential details remain redacted.
 *
 * @param {Error|string|Object} error
 * @returns {{
 *   heading: string,
 *   message: string,
 *   explanation: string,
 *   canRetry: boolean,
 *   category: string,
 *   isFatal: boolean,
 *   isRecoverable: boolean,
 *   technicalMessage: string
 * }}
 */
export function getErrorDisplayDetails(error) {
  const classified = (error && typeof error === 'object' && error.category && error.userMessage)
    ? error
    : classifyPlayerError(error);

  const defaultHeading = 'Unable to Play Video';
  let heading = defaultHeading;
  let message = 'Something went wrong while playing this video.';
  let explanation = 'This video may be temporarily unavailable. Please try again.';
  let canRetry = classified.isRecoverable !== false;

  switch (classified.category) {
    case ERROR_CLASSIFICATION.NETWORK_FAILURE:
      heading = defaultHeading;
      message = 'Check your internet connection and try again.';
      explanation = 'The player was unable to establish a connection to the streaming server.';
      canRetry = true;
      break;

    case ERROR_CLASSIFICATION.ATS_NETWORK_FAILURE:
      heading = defaultHeading;
      message = 'Check your internet connection and try again.';
      explanation = 'iOS security policy blocked an unencrypted stream connection (HTTP).';
      canRetry = false;
      break;

    case ERROR_CLASSIFICATION.UNSUPPORTED_FORMAT:
      heading = defaultHeading;
      message = "This video format isn't supported on this device.";
      explanation = "Apple's native media player does not support this stream encoding.";
      canRetry = false;
      break;

    case ERROR_CLASSIFICATION.AUTH_FAILURE:
      heading = defaultHeading;
      message = 'Unable to access this video. Please try again later.';
      explanation = 'The streaming server rejected authorization credentials for this video.';
      canRetry = false;
      break;

    case ERROR_CLASSIFICATION.HTTP_CONNECTION_LIMIT:
      heading = defaultHeading;
      message = 'Stream connection limit reached (HTTP 509).';
      explanation = 'Please close other active streams on your account and try again.';
      canRetry = true;
      break;

    case ERROR_CLASSIFICATION.STREAM_OFF_AIR:
    case ERROR_CLASSIFICATION.HTTP_FAILURE:
      heading = defaultHeading;
      message = 'This video is currently unavailable.';
      explanation = 'The stream may be temporarily unavailable or removed by the provider.';
      canRetry = true;
      break;

    case ERROR_CLASSIFICATION.TIMEOUT:
      heading = defaultHeading;
      message = 'Check your internet connection and try again.';
      explanation = 'The media server took too long to respond. Please check your connection and try again.';
      canRetry = true;
      break;

    case ERROR_CLASSIFICATION.DECODER_FAILURE:
      heading = defaultHeading;
      message = classified.isRecoverable
        ? 'Something went wrong while playing this video.'
        : "This video format isn't supported on this device.";
      explanation = classified.isRecoverable
        ? 'A temporary video decoding error occurred. Please try again.'
        : "The device's hardware decoder does not support this video track.";
      canRetry = classified.isRecoverable;
      break;

    case ERROR_CLASSIFICATION.INVALID_URL:
      heading = defaultHeading;
      message = 'This video is currently unavailable.';
      explanation = 'The stream address is invalid or missing.';
      canRetry = false;
      break;

    case ERROR_CLASSIFICATION.SOURCE_LOAD_FAILURE:
    case ERROR_CLASSIFICATION.HLS_PARSING_FAILURE:
    case ERROR_CLASSIFICATION.UNKNOWN:
    default:
      heading = defaultHeading;
      message = 'Something went wrong while playing this video.';
      explanation = 'This video may be temporarily unavailable. Please try again.';
      canRetry = classified.isRecoverable !== false;
      break;
  }

  // Extract exact error and errorCode badge for transparent error display
  const rawText = (typeof error === 'string'
    ? error
    : (error?.message || error?.localizedDescription || classified.technicalMessage || '')
  ).trim();
  const lowerRaw = rawText.toLowerCase();

  let errorCode = null;
  let exactError = null;

  if (lowerRaw.includes('11828') || lowerRaw.includes('cannot open')) {
    errorCode = 'AVFoundation -11828';
    exactError = lowerRaw.includes('mkv')
      ? "MKV container format is not supported by Apple's native player."
      : "The video format cannot be opened by Apple's native player (Error -11828).";
  } else if (lowerRaw.includes('mkv')) {
    errorCode = 'Format MKV (Unsupported)';
    exactError = "This title is in MKV format, which is not supported by Apple's native player.";
  } else if (lowerRaw.includes('11850') || lowerRaw.includes('server is not correctly configured') || lowerRaw.includes('byte range')) {
    errorCode = 'AVFoundation -11850';
    exactError = 'Streaming server does not support byte-range requests for progressive playback (Error -11850).';
  } else if (lowerRaw.includes('11800') || lowerRaw.includes('the operation could not be completed')) {
    errorCode = 'AVFoundation -11800';
    exactError = "Apple's AVPlayer encountered a playback error (Error -11800).";
  } else if (lowerRaw.includes('11819')) {
    errorCode = 'AVFoundation -11819';
    exactError = 'iOS media system services were interrupted (Error -11819).';
  } else if (lowerRaw.includes('12939')) {
    errorCode = 'CoreMedia -12939';
    exactError = 'CoreMedia stream byte range error (Error -12939).';
  } else if (lowerRaw.includes('12909') || lowerRaw.includes('12911') || lowerRaw.includes('10-bit') || lowerRaw.includes('hi10p')) {
    errorCode = 'Decoder -12909';
    exactError = 'Stream codec profile (e.g. 10-bit H.264) is not supported by device hardware decoder.';
  } else if (lowerRaw.includes('16845')) {
    errorCode = 'CoreMedia -16845';
    exactError = 'Failed to parse stream playlist manifest (Error -16845).';
  } else if (lowerRaw.includes('16830')) {
    errorCode = 'CoreMedia -16830';
    exactError = 'Stream segment unavailable or channel off-air (Error -16830).';
  } else if (lowerRaw.includes('1022') || lowerRaw.includes('app transport security')) {
    errorCode = 'iOS ATS -1022';
    exactError = 'iOS App Transport Security blocked unencrypted HTTP stream connection (Error -1022).';
  } else if (lowerRaw.includes('1009') || lowerRaw.includes('offline')) {
    errorCode = 'NSURLError -1009';
    exactError = 'The Internet connection appears to be offline (Error -1009).';
  } else if (lowerRaw.includes('1004') || lowerRaw.includes('connection refused')) {
    errorCode = 'NSURLError -1004';
    exactError = 'Could not connect to the streaming server (Error -1004).';
  } else if (lowerRaw.includes('1001') || lowerRaw.includes('timed out')) {
    errorCode = 'NSURLError -1001';
    exactError = 'Connection to the media server timed out (Error -1001).';
  } else if (lowerRaw.includes('999') || lowerRaw.includes('-999')) {
    errorCode = 'NSURLError -999';
    exactError = 'Media network request was terminated by streaming host (Error -999).';
  } else if (lowerRaw.includes('404') || lowerRaw.includes('not found')) {
    errorCode = 'HTTP 404 Not Found';
    exactError = 'Stream file was not found on the media server (HTTP 404 Not Found).';
  } else if (lowerRaw.includes('403') || lowerRaw.includes('forbidden')) {
    errorCode = 'HTTP 403 Forbidden';
    exactError = 'Access denied: Stream authorization rejected (HTTP 403 Forbidden).';
  } else if (lowerRaw.includes('401') || lowerRaw.includes('unauthorized')) {
    errorCode = 'HTTP 401 Unauthorized';
    exactError = 'Stream authentication failed (HTTP 401 Unauthorized).';
  } else if (lowerRaw.includes('509') || lowerRaw.includes('16846') || lowerRaw.includes('connection limit')) {
    errorCode = 'HTTP 509 Bandwidth Limit';
    exactError = 'Stream connection limit reached on provider account (HTTP 509).';
  } else if (lowerRaw.includes('503')) {
    errorCode = 'HTTP 503 Service Unavailable';
    exactError = 'The streaming server is temporarily offline or unavailable (HTTP 503).';
  } else if (lowerRaw.includes('502')) {
    errorCode = 'HTTP 502 Bad Gateway';
    exactError = 'The upstream IPTV streaming server is unreachable (HTTP 502).';
  } else if (lowerRaw.includes('500')) {
    errorCode = 'HTTP 500 Internal Error';
    exactError = 'The IPTV provider server encountered an internal error (HTTP 500).';
  } else if (lowerRaw.includes('504')) {
    errorCode = 'HTTP 504 Gateway Timeout';
    exactError = 'The IPTV streaming server timed out waiting for upstream data (HTTP 504).';
  } else if (lowerRaw.includes('500') || lowerRaw.includes('502') || lowerRaw.includes('503') || lowerRaw.includes('504')) {
    errorCode = 'HTTP Server Error';
    exactError = 'Streaming server returned an internal error (HTTP 5xx Server Error).';
  } else if (lowerRaw.includes('playback failed to start') || lowerRaw.includes('decode failure') || lowerRaw.includes('unsupported by this device')) {
    errorCode = 'Playback Stalled';
    exactError = 'Playback failed to start. Stream format may be unsupported by this device.';
  } else if (lowerRaw.includes('unsupported format') || lowerRaw.includes('format not supported')) {
    errorCode = 'Format Unsupported';
    exactError = 'This video format is not supported on this device.';
  } else {
    const codeMatch = rawText.match(/code[=:\s]+(-?\d+)/i) || rawText.match(/error[=:\s]+(-?\d+)/i);
    if (codeMatch) {
      errorCode = `Error ${codeMatch[1]}`;
    }
    exactError = (classified.userMessage && classified.userMessage !== 'Unable to play this stream.')
      ? classified.userMessage
      : message;
  }

  return {
    heading,
    message,
    exactError,
    errorCode,
    explanation,
    canRetry,
    category: classified.category,
    isFatal: classified.isFatal,
    isRecoverable: classified.isRecoverable,
    technicalMessage: classified.technicalMessage || 'Unknown error',
    shouldShowPopup: classified.shouldShowPopup ?? false,
    popupCategory: classified.popupCategory ?? ERROR_POPUP_CATEGORY.NON_FATAL,
    isConfirmedServerError: classified.isConfirmedServerError ?? false,
    isFatalNativeError: classified.isFatalNativeError ?? false,
    httpStatus: classified.httpStatus ?? null,
    nativeErrorCode: classified.nativeErrorCode ?? errorCode,
    decisionReason: classified.decisionReason ?? '',
  };
}

