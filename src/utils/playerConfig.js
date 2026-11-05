import { logPlayer, redactString } from './diagnostics.js';

let Platform = { OS: 'ios', select: (obj) => (obj ? (obj.ios || obj.default) : undefined) };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}

let Device = null;
try {
  Device = require('expo-device');
} catch (_e) {
  Device = null;
}

/**
 * Accurately determines device performance tier based on total RAM.
 * - 'low': <= 3.2 GB RAM (2 GB and 3 GB low-end devices)
 * - 'mid': <= 4.5 GB RAM (4 GB mid-range devices)
 * - 'high': > 4.5 GB RAM (flagship and iOS devices)
 *
 * @returns {'low' | 'mid' | 'high'}
 */
export function getDeviceTier() {
  if (Platform.OS === 'ios') return 'high';
  if (!Device) return 'mid';
  const ram = Device.totalMemory;
  if (typeof ram === 'number' && ram > 0) {
    if (ram <= 3.2 * 1024 * 1024 * 1024) return 'low';
    if (ram <= 4.5 * 1024 * 1024 * 1024) return 'mid';
    return 'high';
  }
  return 'mid';
}

/**
 * FOX PLAYER — Platform-Specific Player Architecture
 *
 * Separates Android (Media3/ExoPlayer) and iOS (AVFoundation/AVPlayer)
 * configurations, buffering strategies, and native surface properties.
 */

/**
 * Returns native buffer configuration tailored to the host platform and stream type.
 *
 * For iOS (AVPlayer):
 * - Live TV: preferredForwardBufferDuration = 1.0s, waitsToMinimizeStalling = false
 *   avoids 30-60s pre-buffering stall and plays as soon as first HLS segment arrives.
 * - VOD (Movies & Series): preferredForwardBufferDuration = 2.0s, waitsToMinimizeStalling = false
 *   ensures rapid initial playback with smooth onward streaming.
 *
 * For Android (Media3 / ExoPlayer):
 * - Preserves standard buffer parameters (fast startup + stable playback).
 *
 * @param {Object} options
 * @param {'live' | 'movie' | 'series' | string} [options.type='movie']
 * @param {boolean} [options.isLive=false]
 * @param {string} [options.platform=Platform.OS]
 * @returns {Object} BufferOptions object passed to player.bufferOptions
 */
export function getPlatformBufferOptions({
  type = 'movie',
  isLive = false,
  platform = Platform.OS,
  enableStallRecovery = false,
  tier = null,
} = {}) {
  const live = isLive || type === 'live' || type === 'channel';

  if (platform === 'ios') {
    if (enableStallRecovery) {
      return {
        preferredForwardBufferDuration: live ? 2.5 : 4.0,
        waitsToMinimizeStalling: true,
      };
    }
    return {
      preferredForwardBufferDuration: live ? 1.0 : 2.0,
      waitsToMinimizeStalling: false,
    };
  }

  // Android Media3 / ExoPlayer buffer options — tuned for rock-solid stability and zero-lag IPTV streaming
  const deviceTier = tier || getDeviceTier();
  const isLowEnd = deviceTier === 'low';

  if (enableStallRecovery) {
    return {
      preferredForwardBufferDuration: live ? (isLowEnd ? 6.0 : 8.0) : (isLowEnd ? 14.0 : 20.0),
      minBufferForPlayback: live ? (isLowEnd ? 1.5 : 2.0) : (isLowEnd ? 2.5 : 3.0),
      waitsToMinimizeStalling: true,
      ...(isLowEnd ? {
        maxBufferBytes: live ? 16 * 1024 * 1024 : 32 * 1024 * 1024,
        prioritizeTimeOverSizeThreshold: true,
      } : {}),
    };
  }

  return {
    preferredForwardBufferDuration: live ? 3.0 : 10.0,
    minBufferForPlayback: live ? 1.0 : 2.5,
    waitsToMinimizeStalling: false,
    ...(isLowEnd ? {
      maxBufferBytes: live ? 12 * 1024 * 1024 : 24 * 1024 * 1024,
      prioritizeTimeOverSizeThreshold: true,
    } : {}),
  };
}

/**
 * Returns player initialization configuration tailored to the host platform.
 *
 * @param {Object} options
 * @param {'live' | 'movie' | 'series' | string} [options.type='movie']
 * @param {boolean} [options.isLive=false]
 * @param {string} [options.platform=Platform.OS]
 * @returns {Object} Setup options applied to expo-video player instance
 */
export function getPlatformPlayerOptions({ type = 'movie', isLive = false, platform = Platform.OS, tier = null } = {}) {
  const live = isLive || type === 'live' || type === 'channel';
  const bufferOptions = getPlatformBufferOptions({ type, isLive: live, platform, tier });

  if (platform === 'ios') {
    // iOS AVPlayer-specific setup:
    // - timeUpdateEventInterval: 1.0s for Live TV (avoids flooding JS bridge during live broadcast), 0.5s for VOD
    // - loop: false (live streams should never loop, preventing AVPlayer seek-to-zero stalls)
    // - staysActiveInBackground: false to prevent orphaned audio sessions
    // - bufferOptions: optimized for low latency and zero stalling wait
    // - audioMixingMode: 'doNotMix' configures AVAudioSession playback to ignore hardware silent switch
    return {
      loop: false,
      timeUpdateEventInterval: live ? 1.0 : 0.5,
      staysActiveInBackground: false,
      audioMixingMode: 'doNotMix',
      bufferOptions,
    };
  }

  // Android Media3 / ExoPlayer setup:
  // - timeUpdateEventInterval: 1.0s for Live TV, 0.5s for VOD
  return {
    loop: false,
    timeUpdateEventInterval: live ? 1.0 : 0.5,
    staysActiveInBackground: false,
    audioMixingMode: 'doNotMix',
    bufferOptions,
  };
}

/**
 * Returns native VideoView props appropriate for the host OS.
 *
 * @param {Object} options
 * @param {string} [options.contentFit='contain']
 * @param {boolean} [options.isMini=false]
 * @param {string} [options.surfaceType='surfaceView']
 * @returns {Object} Props to spread onto <VideoView />
 */
export function getPlatformVideoViewProps({ contentFit = 'contain', isMini = false, surfaceType = 'surfaceView' } = {}) {
  const baseProps = {
    contentFit,
    nativeControls: false,
    pointerEvents: 'none',
  };

  if (Platform.OS === 'android') {
    // Android ExoPlayer surface props:
    // surfaceView provides zero-copy direct hardware decoding overlay for smooth, lag-free playback
    return {
      ...baseProps,
      surfaceType,
      useExoShutter: false,
      fullscreenOptions: { enable: !isMini },
    };
  }

  // iOS AVPlayer-specific view props:
  // Do NOT pass useExoShutter to iOS (Android-only prop).
  return {
    ...baseProps,
    fullscreenOptions: { enable: !isMini },
  };
}

/**
 * Sanitizes and encodes media URLs for native player consumption.
 * Encodes unescaped characters (spaces, brackets, unicode) that cause iOS NSURL to fail.
 * Preserves already-encoded characters.
 *
 * @param {string} rawUrl
 * @returns {string} Safe encoded URL string
 */
export function sanitizeMediaUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    return encodeURI(decodeURI(trimmed));
  } catch (_e) {
    try {
      return encodeURI(trimmed);
    } catch (_e2) {
      return trimmed.replace(/\s+/g, '%20');
    }
  }
}

/**
 * Prepares a stream URL for platform-specific playback compatibility.
 * On iOS:
 * - Live streams ending in .ts are rewritten to .m3u8 (HLS) because AVPlayer
 *   cannot decode progressive raw MPEG-TS over HTTP.
 * - Encodes special characters so iOS NSURL creation does not return nil.
 * On Android:
 * - Preserves existing stream format (ExoPlayer natively decodes MPEG-TS and MKV).
 *
 * @param {string} rawUrl
 * @param {Object} options
 * @param {'live' | 'movie' | 'series' | string} [options.type]
 * @param {string} [options.extension]
 * @param {string} [options.platform=Platform.OS]
 * @returns {string} Platform-compatible stream URL
 */
export function prepareStreamUrlForPlatform(
  rawUrl,
  { type = '', extension = '', platform = Platform.OS, streamId = '', serverBaseUrl = '' } = {}
) {
  if (!rawUrl) return '';
  let sanitized = sanitizeMediaUrl(rawUrl);

  const isLive = type === 'live' || type === 'channel' || sanitized.includes('/live/');

  // On iOS, Apple AVPlayer (AVFoundation) requires HLS (.m3u8) manifests for Live TV streaming.
  // Apple AVPlayer cannot decode progressive raw MPEG-TS (.ts) over plain HTTP (Code=-11850 / -12939).
  // Request .m3u8 directly to target the IPTV server's native HLS endpoint.
  if (platform === 'ios' && isLive) {
    // 1. Raw .ts rewrite -> .m3u8 (targets IPTV server's native HLS endpoint)
    if (/\.ts(\?.*)?$/i.test(sanitized)) {
      sanitized = sanitized.replace(/\.ts(\?.*)?$/i, '.m3u8$1');
    }
    // 2. Query param output=ts -> output=m3u8
    if (sanitized.includes('output=ts')) {
      sanitized = sanitized.replace(/output=ts/gi, 'output=m3u8');
    }
    // 3. DASH .mpd on iOS live -> .m3u8
    if (/\.mpd(\?.*)?$/i.test(sanitized)) {
      sanitized = sanitized.replace(/manifest\.mpd/gi, 'manifest.m3u8').replace(/\.mpd(\?.*)?$/i, '.m3u8$1');
    }
    // 4. Extensionless live streams (e.g. /live/user/pass/123 or port-based channel without extension)
    if (sanitized.includes('/live/') && !sanitized.includes('.m3u8') && !sanitized.includes('.mp4')) {
      const queryIdx = sanitized.indexOf('?');
      if (queryIdx !== -1) {
        const pathPart = sanitized.slice(0, queryIdx);
        const queryPart = sanitized.slice(queryIdx);
        sanitized = `${pathPart.replace(/\.[a-zA-Z0-9]+$/, '')}.m3u8${queryPart}`;
      } else {
        sanitized = `${sanitized.replace(/\.[a-zA-Z0-9]+$/, '')}.m3u8`;
      }
    }
  }

  // When VLC engine is available (custom development build with MobileVLCKit / libVLC),
  // NEVER rewrite .mkv container extensions! VLCKit natively demuxes Matroska with multi-codec audio/video support.
  // Rewriting to .mp4 would break VLC playback if the IPTV server stores the file as .mkv.
  let isVlcAvailable = false;
  try {
    const { probeVlcNativeAvailability } = require('../playback/playerSettings.js');
    isVlcAvailable = Boolean(probeVlcNativeAvailability?.().available);
  } catch (_e) {
    isVlcAvailable = false;
  }

  // On iOS, AVPlayer cannot demux Matroska (.mkv) container (Code -11828).
  // Xtream Codes servers provide native transcoded .mp4 endpoints with stereo AAC for movies and series.
  // Rewrite .mkv -> .mp4 on iOS when VLC is unavailable.
  // On Android, ExoPlayer natively demuxes Matroska (.mkv) via MatroskaExtractor.
  if (platform === 'ios' && !isVlcAvailable) {
    const isVod = !isLive || type === 'movie' || type === 'series' || type === 'vod' || sanitized.includes('/movie/') || sanitized.includes('/series/');

    if (isVod) {
      if (/\.mkv(\?.*)?$/i.test(sanitized) || extension === 'mkv') {
        sanitized = sanitized.replace(/\.mkv(\?.*)?$/i, '.mp4$1');
      } else if (/\.(avi|flv|webm|wmv)(\?.*)?$/i.test(sanitized)) {
        sanitized = sanitized.replace(/\.(avi|flv|webm|wmv)(\?.*)?$/i, '.mp4$2');
      } else if (/\.mpd(\?.*)?$/i.test(sanitized)) {
        sanitized = sanitized.replace(/\.mpd(\?.*)?$/i, '.m3u8$1');
      }
    }
  }

  return sanitized;
}

/**
 * Returns alternative fallback URL if primary stream URL fails or times out.
 * Implements a multi-tier fallback cascade:
 * For Live: .m3u8 <-> .ts <-> .mpd
 * For VOD: .m3u8 <-> .mp4 <-> .mkv
 *
 * @param {string} currentUrl
 * @param {Object} [options]
 * @param {boolean} [options.isLive=true]
 * @param {string} [options.platform=Platform.OS]
 * @param {string} [options.originalExtension='']
 * @param {Array<string>} [options.attemptedUrls=[]]
 * @returns {string | null}
 */
export function getStreamFallbackUrl(currentUrl, {
  isLive = true,
  platform = Platform.OS,
  serverBaseUrl = null,
  originalExtension = '',
  attemptedUrls = [],
} = {}) {
  if (!currentUrl || typeof currentUrl !== 'string') return null;

  const attemptedSet = new Set(attemptedUrls || []);
  attemptedSet.add(currentUrl);

  if (isLive) {
    const candidates = [];
    if (/\.m3u8(\?.*)?$/i.test(currentUrl)) {
      candidates.push(currentUrl.replace(/\.m3u8(\?.*)?$/i, '.ts$1'));
    } else if (/\.ts(\?.*)?$/i.test(currentUrl)) {
      candidates.push(currentUrl.replace(/\.ts(\?.*)?$/i, '.m3u8$1'));
    } else if (/\.mpd(\?.*)?$/i.test(currentUrl)) {
      candidates.push(currentUrl.replace(/\.mpd(\?.*)?$/i, '.m3u8$1'));
    }
    return candidates.find((u) => !attemptedSet.has(u)) || null;
  }

  // VOD Content (Movies and Series)
  const isMkv = /\.mkv(\?.*)?$/i.test(currentUrl) || originalExtension === 'mkv';
  const isMp4 = /\.mp4(\?.*)?$/i.test(currentUrl) || originalExtension === 'mp4';
  const isM3u8 = /\.m3u8(\?.*)?$/i.test(currentUrl) || originalExtension === 'm3u8';

  const candidates = [];
  if (platform === 'ios') {
    // On iOS AVPlayer: prioritize HLS (.m3u8), then progressive MP4 (.mp4), then original container (.mkv)
    if (isMkv) {
      candidates.push(currentUrl.replace(/\.mkv(\?.*)?$/i, '.mp4$1'));
      candidates.push(currentUrl.replace(/\.mkv(\?.*)?$/i, '.m3u8$1'));
    } else if (isM3u8) {
      candidates.push(currentUrl.replace(/\.m3u8(\?.*)?$/i, '.mp4$1'));
      candidates.push(currentUrl.replace(/\.m3u8(\?.*)?$/i, '.mkv$1'));
    } else if (isMp4) {
      candidates.push(currentUrl.replace(/\.mp4(\?.*)?$/i, '.m3u8$1'));
      candidates.push(currentUrl.replace(/\.mp4(\?.*)?$/i, '.mkv$1'));
    } else if (/\.(avi|flv|webm|wmv)(\?.*)?$/i.test(currentUrl)) {
      candidates.push(currentUrl.replace(/\.(avi|flv|webm|wmv)(\?.*)?$/i, '.m3u8$2'));
      candidates.push(currentUrl.replace(/\.(avi|flv|webm|wmv)(\?.*)?$/i, '.mp4$2'));
    }
  } else {
    // Android ExoPlayer: .mkv -> .m3u8 -> .mp4
    if (isMkv) {
      candidates.push(currentUrl.replace(/\.mkv(\?.*)?$/i, '.mp4$1'));
      candidates.push(currentUrl.replace(/\.mkv(\?.*)?$/i, '.m3u8$1'));
    } else if (isMp4) {
      candidates.push(currentUrl.replace(/\.mp4(\?.*)?$/i, '.mkv$1'));
      candidates.push(currentUrl.replace(/\.mp4(\?.*)?$/i, '.m3u8$1'));
    } else if (isM3u8) {
      candidates.push(currentUrl.replace(/\.m3u8(\?.*)?$/i, '.mkv$1'));
      candidates.push(currentUrl.replace(/\.m3u8(\?.*)?$/i, '.mp4$1'));
    }
  }

  return candidates.find((u) => !attemptedSet.has(u)) || null;
}

/**
 * Sanitizes a media URL for safe logging.
 * Strips usernames, passwords, authorization tokens, and credentials from both path and query parameters.
 *
 * @param {string} rawUrl
 * @returns {{ sanitizedUrl: string, hasQueryParams: boolean, host: string, protocol: string }}
 */
export function sanitizePlaybackUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { sanitizedUrl: '', hasQueryParams: false, host: 'UNKNOWN', protocol: 'UNKNOWN' };
  }

  try {
    const parsed = new URL(rawUrl);
    const hasQueryParams = parsed.search.length > 1;

    // Redact sensitive path segments in standard Xtream / IPTV routes
    const safePathname = parsed.pathname
      .replace(/\/(live|movie|series)\/[^/\s]+\/[^/\s]+\//gi, '/$1/[REDACTED]/[REDACTED]/')
      .replace(/\/[^/\s]+\/[^/\s]+\/([0-9]+)\./gi, '/[REDACTED]/[REDACTED]/$1.');

    // Redact sensitive query parameters
    const safeSearchParams = new URLSearchParams();
    parsed.searchParams.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('pass') ||
        lowerKey.includes('user') ||
        lowerKey.includes('token') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('key') ||
        lowerKey.includes('secret')
      ) {
        safeSearchParams.append(key, '[REDACTED]');
      } else {
        safeSearchParams.append(key, val);
      }
    });

    const queryString = safeSearchParams.toString();
    const sanitizedUrl = `${parsed.protocol}//${parsed.host}${safePathname}${queryString ? `?${queryString}` : ''}`;

    return {
      sanitizedUrl,
      hasQueryParams,
      host: parsed.host,
      protocol: parsed.protocol.replace(':', ''),
    };
  } catch (_e) {
    return {
      sanitizedUrl: redactString(rawUrl),
      hasQueryParams: rawUrl.includes('?'),
      host: 'INVALID_URL',
      protocol: 'UNKNOWN',
    };
  }
}

/**
 * Sanitizes request headers for telemetry.
 * Strips authorization tokens, session cookies, and credentials.
 *
 * @param {Object} headers
 * @returns {Object} Safe headers object
 */
export function sanitizePlaybackHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const safe = {};
  for (const [key, val] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('auth') ||
      lowerKey.includes('cookie') ||
      lowerKey.includes('token') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('key')
    ) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = val;
    }
  }
  return safe;
}

/**
 * Comprehensive safe playback diagnostic logger.
 * Instruments the complete 17-point playback pipeline:
 * 1. contentId, 2. contentType, 3. playlistId, 4. providerType,
 * 5. platform, 6. normalized streamType, 7. sanitized final URL,
 * 8. hasQueryParams, 9. source contentType passed to expo-video,
 * 10. safe headers, 11. player status, 12. player error message,
 * 13. sourceLoad event, 14. readyToPlay event, 15. playing event,
 * 16. loadTimeMs, 17. playbackStartupMs.
 *
 * NEVER logs passwords, usernames, or auth tokens.
 *
 * @param {string} event - Lifecycle event name
 * @param {Object} meta - Diagnostic metadata
 */
export function logPlayerDiagnostic(event, meta = {}) {
  const safeMeta = { ...meta };

  if (safeMeta.url && typeof safeMeta.url === 'string') {
    const urlInfo = sanitizePlaybackUrl(safeMeta.url);
    safeMeta.sanitizedUrl = urlInfo.sanitizedUrl;
    safeMeta.hasQueryParams = urlInfo.hasQueryParams;
    safeMeta.host = urlInfo.host;
    safeMeta.protocol = urlInfo.protocol;
    delete safeMeta.url;
  }

  if (safeMeta.fallbackUrl && typeof safeMeta.fallbackUrl === 'string') {
    const urlInfo = sanitizePlaybackUrl(safeMeta.fallbackUrl);
    safeMeta.sanitizedFallbackUrl = urlInfo.sanitizedUrl;
    delete safeMeta.fallbackUrl;
  }

  if (safeMeta.headers) {
    safeMeta.headers = sanitizePlaybackHeaders(safeMeta.headers);
  }

  if (!safeMeta.platform) {
    safeMeta.platform = Platform.OS;
  }

  if (!safeMeta.engine) {
    if (safeMeta.playbackEngine === 'vlc') {
      safeMeta.engine = 'libVLC / rn-vlc-plyr';
      safeMeta.playerLibrary = 'rn-vlc-plyr ~1.0.1';
    } else {
      safeMeta.engine = safeMeta.platform === 'ios' ? 'AVFoundation / AVPlayer' : 'Media3 / ExoPlayer';
      safeMeta.playerLibrary = 'expo-video ~57.0.5';
    }
  }
  if (Platform.Version != null) {
    safeMeta.osVersion = String(Platform.Version);
  }

  if (safeMeta.error && typeof safeMeta.error === 'string') {
    safeMeta.error = redactString(safeMeta.error);
  }
  if (safeMeta.technical && typeof safeMeta.technical === 'string') {
    safeMeta.technical = redactString(safeMeta.technical);
  }

  logPlayer(event, safeMeta);
}

/**
 * Safe, robust libVLC media options for Android & iOS.
 * Avoids clock-jitter/clock-synchro disabling which causes Matroska (.mkv) container
 * demuxer stalls and audio desync.
 *
 * @param {Object} [options]
 * @param {boolean} [options.isLive=false]
 * @returns {Array<string>} List of VLC command-line media options
 */
export function getPlatformVlcOptions({ isLive = false, subtitleSize = 'normal' } = {}) {
  let fontSizePx = 18;
  let relFontSize = 0;
  try {
    const { SUBTITLE_FONT_SIZES } = require('../playback/playerSettings.js');
    fontSizePx = SUBTITLE_FONT_SIZES[subtitleSize] || SUBTITLE_FONT_SIZES.normal || 18;
  } catch (_e) {
    fontSizePx = 18;
  }
  const relMap = { small: -3, normal: 0, large: 2, extra_large: 4 };
  relFontSize = relMap[subtitleSize] ?? 0;
  const base = [
    ':network-caching=1500',
    ':http-reconnect',
    `:freetype-fontsize=${fontSizePx}`,
    `:freetype-rel-fontsize=${relFontSize}`,
    ':freetype-color=16777215',
  ];
  if (isLive) {
    return [
      ...base,
      ':live-caching=1000',
    ];
  }
  return [
    ...base,
    ':file-caching=1500',
  ];
}
