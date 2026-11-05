let Platform = { OS: 'ios', select: (obj) => (obj ? (obj.ios || obj.default) : undefined) };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}
import {
  buildLiveStreamUrl,
  buildVodStreamUrl,
  buildSeriesStreamUrl,
} from '../services/xtreamService.js';
import { API_BASE_URL } from '../constants/index.js';
import { sanitizeMediaUrl, prepareStreamUrlForPlatform } from './playerConfig.js';
import { logPlayer } from './diagnostics.js';

export const DEFAULT_IPTV_USER_AGENT = 'IPTVSmartersPro/3.1.5 (Linux; Android 12)';

/**
 * Standardizes server base URL with protocol.
 */
export function sanitizeServerUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

/**
 * Strict Stream Source Validator.
 *
 * Verifies that a stream source is non-empty, a valid string/URI,
 * has a supported network scheme (http/https/file), and is not a placeholder.
 *
 * @param {string | Object | null | undefined} source
 * @returns {{ isValid: boolean, error?: string, uri: string | null }}
 */
export function validateStreamSource(source) {
  if (source == null) {
    return { isValid: false, error: 'Source is null or undefined.', uri: null };
  }

  let rawUri = '';
  if (typeof source === 'string') {
    rawUri = source.trim();
  } else if (typeof source === 'object' && source.uri && typeof source.uri === 'string') {
    rawUri = source.uri.trim();
  } else if (typeof source === 'object' && source.url && typeof source.url === 'string') {
    rawUri = source.url.trim();
  }

  if (!rawUri) {
    return { isValid: false, error: 'Source URI is empty.', uri: null };
  }

  // Reject literal placeholder strings
  const lower = rawUri.toLowerCase();
  if (
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'none' ||
    lower === '[object object]'
  ) {
    return { isValid: false, error: 'Source URI is an invalid placeholder.', uri: null };
  }

  // Protocol check: must be http, https, or file
  if (!/^(https?|file):\/\//i.test(rawUri)) {
    return {
      isValid: false,
      error: `Unsupported stream protocol in URI: ${rawUri.substring(0, 20)}...`,
      uri: null,
    };
  }

  // Basic URL structure validation
  try {
    const parsed = new URL(rawUri);
    if (!parsed.hostname && parsed.protocol !== 'file:') {
      return { isValid: false, error: 'Source URI lacks a valid hostname.', uri: null };
    }
  } catch (_e) {
    return { isValid: false, error: 'Source URI failed URL parse.', uri: null };
  }

  return { isValid: true, error: null, uri: rawUri };
}

/**
 * Robust Content-Type Detector.
 * Determines whether a stream is HLS, Progressive, DASH, or SmoothStreaming.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {'live' | 'vod' | 'series' | string} [options.type]
 * @param {string} [options.extension]
 * @returns {'hls' | 'progressive' | 'dash' | 'smoothStreaming' | 'auto'}
 */
export function detectContentType(url, { type = '', extension = '', platform = Platform.OS } = {}) {
  if (!url || typeof url !== 'string') return 'auto';

  const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
  const ext = (extension || '').toLowerCase().replace(/^\.+/, '');

  if (cleanUrl.endsWith('.m3u8') || cleanUrl.includes('.m3u8') || ext === 'm3u8') {
    return 'hls';
  }

  if (cleanUrl.endsWith('.mpd') || cleanUrl.includes('.mpd') || ext === 'mpd') {
    return platform === 'android' ? 'dash' : 'auto';
  }

  if (cleanUrl.endsWith('.ism/manifest') || cleanUrl.endsWith('.ism') || ext === 'ism') {
    return platform === 'android' ? 'smoothStreaming' : 'auto';
  }

  const isLive = type === 'live' || type === 'channel';

  // Live TV stream detection
  if (isLive) {
    if (cleanUrl.endsWith('.m3u8') || url.includes('.m3u8')) {
      return 'hls';
    }
    // Return 'auto' so AVPlayer/ExoPlayer dynamic extractors probe the container
    // and never attempt to parse binary MPEG-TS (.ts) as an HLS text manifest (Code -16845).
    return 'auto';
  }

  if (
    cleanUrl.endsWith('.mp4') ||
    cleanUrl.endsWith('.mov') ||
    cleanUrl.endsWith('.m4v') ||
    cleanUrl.endsWith('.mkv') ||
    cleanUrl.endsWith('.avi') ||
    cleanUrl.endsWith('.webm') ||
    cleanUrl.endsWith('.flv') ||
    ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'flv'].includes(ext)
  ) {
    return 'progressive';
  }

  return 'auto';
}

/**
 * Central Stream Source Resolver.
 *
 * Single authoritative pipeline that normalizes Live TV, Movies, and Series
 * into a consistent, validated playback session object.
 *
 * Guaranteed URL generation rules:
 * - Movies: /movie/{username}/{password}/{streamId}.{extension}
 * - Series: /series/{username}/{password}/{episodeId}.{extension} (NEVER uses series_id!)
 * - Live:   /live/{username}/{password}/{streamId}.{extension}
 *
 * @param {Object} content - Media item or resolution config
 * @param {Object} [options]
 * @returns {{
 *   uri: string,
 *   url: string,
 *   contentType: 'hls' | 'progressive' | 'dash' | 'smoothStreaming' | 'auto',
 *   streamType: 'live' | 'vod' | 'series',
 *   isLive: boolean,
 *   isVOD: boolean,
 *   isValid: boolean,
 *   validationError: string | null,
 *   title: string,
 *   poster: string | null,
 *   streamId: string,
 *   extension: string,
 *   metadata: Object,
 *   playerSource: Object
 * }}
 */
export function resolveStreamSource(content, options = {}) {
  if (!content) {
    return {
      uri: '',
      url: '',
      contentType: 'auto',
      streamType: 'vod',
      isLive: false,
      isVOD: true,
      isValid: false,
      validationError: 'No media content provided to resolveStreamSource.',
      title: 'Fox Player',
      poster: null,
      streamId: '',
      extension: 'mp4',
      metadata: {},
      playerSource: null,
    };
  }

  // Support both { type, item, credentials } and direct item with options
  const item = content.item || content;
  const rawType = (content.type || item.type || options.type || 'movie').toLowerCase();
  const credentials = content.credentials || options.credentials || {};

  const streamType = (rawType === 'live' || rawType === 'channel')
    ? 'live'
    : (rawType === 'series' || rawType === 'episode')
      ? 'series'
      : 'vod';

  const isLive = streamType === 'live';
  const isVOD = streamType === 'vod' || streamType === 'series';

  // Server credentials resolution
  const serverUrl = sanitizeServerUrl(
    item.serverUrl || item.server_url || credentials.serverUrl || credentials.server_url || ''
  );
  const username = item.username || credentials.username || '';
  const password = item.password || credentials.password || '';

  // Direct URL property extraction (inspects all known provider variations)
  let playUrl = (
    item.url ||
    item.streamUrl ||
    item.videoUrl ||
    item.stream_url ||
    item.directUrl ||
    item.direct_url ||
    item.link ||
    item.uri ||
    ''
  ).trim();

  let streamId = '';
  let extension = isLive ? 'ts' : 'mp4';
  const title = item.name || item.title || item.cleanName || 'Fox Player';
  const poster = item.poster || item.logo || item.thumbnail || item.cover || item.posterUri || null;

  if (isLive) {
    streamId = String(item.streamId || item.stream_id || item.id || item.num || '');
    extension = (item.containerExtension || item.container_extension || 'ts').replace(/^\.+/, '');

    // For Xtream Live channels without a full URL:
    // Build Xtream live stream URL using the provider extension (native .m3u8 on iOS)
    if (!playUrl || !/^https?:\/\//i.test(playUrl)) {
      if (serverUrl && username && password && streamId) {
        playUrl = buildLiveStreamUrl(serverUrl, username, password, streamId, extension);
      }
    }
  } else if (streamType === 'vod') {
    streamId = String(item.streamId || item.stream_id || item.id || '');
    extension = (
      item.containerExtension ||
      item.container_extension ||
      item.extension ||
      'mp4'
    ).replace(/^\.+/, '');

    if (!playUrl || !/^https?:\/\//i.test(playUrl)) {
      if (serverUrl && username && password && streamId) {
        playUrl = buildVodStreamUrl(serverUrl, username, password, streamId, extension);
      }
    }
  } else if (streamType === 'series') {
    // CRITICAL: episode id must be used, NEVER series_id
    streamId = String(
      item.id ||
      item.streamId ||
      item.stream_id ||
      item.info?.stream_id ||
      ''
    );

    extension = (
      item.containerExtension ||
      item.container_extension ||
      item.info?.container_extension ||
      item.extension ||
      'mp4'
    ).replace(/^\.+/, '');

    if (!playUrl || !/^https?:\/\//i.test(playUrl)) {
      if (serverUrl && username && password && streamId) {
        playUrl = buildSeriesStreamUrl(serverUrl, username, password, streamId, extension);
      }
    }
  }

  // Refine container extension from URL if available
  if (playUrl) {
    try {
      const cleanPath = playUrl.split('?')[0].split('#')[0];
      const match = cleanPath.match(/\.([a-zA-Z0-9]{2,5})$/);
      if (match) {
        extension = match[1].toLowerCase();
      }
    } catch (_e) {}
  }

  // Sanitize and encode URL for native consumption (safe for iOS NSURL)
  const finalUrl = sanitizeMediaUrl(playUrl);

  // Validate the resulting stream URL
  const validation = validateStreamSource(finalUrl);

  // Detect content type
  const contentType = detectContentType(finalUrl, { type: streamType, extension });

  // HTTP Headers: standard IPTV User-Agent and any parsed VLC options
  const headers = {
    'User-Agent': DEFAULT_IPTV_USER_AGENT,
  };
  if (item?.vlcOptions) {
    if (item.vlcOptions['http-user-agent']) {
      headers['User-Agent'] = item.vlcOptions['http-user-agent'];
    }
    if (item.vlcOptions['http-referrer'] || item.vlcOptions['referrer']) {
      headers['Referer'] = item.vlcOptions['http-referrer'] || item.vlcOptions['referrer'];
    }
  }
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  // Native player source object tailored for expo-video
  let playerSource = null;
  if (validation.isValid) {
    playerSource = {
      uri: finalUrl,
      ...(contentType !== 'auto' ? { contentType } : {}),
      headers,
      metadata: {
        title,
        ...(poster ? { artwork: poster } : {}),
      },
    };
  }

  return {
    uri: finalUrl,
    url: finalUrl, // Backward compatibility
    contentType,
    streamType,
    isLive,
    isVOD,
    isValid: validation.isValid,
    validationError: validation.error,
    title,
    poster,
    streamId,
    extension,
    headers,
    metadata: {
      year: item.year || null,
      rating: item.rating || null,
      duration: isLive ? null : (item.duration || null),
    },
    playerSource,
    rawItem: item,
  };
}

/**
 * Single Centralized Playback Source Normalizer.
 *
 * Authoritative pipeline that determines:
 * - uri (platform-prepared, safe for iOS NSURL)
 * - contentType
 * - headers
 * - provider type ('xtream' | 'm3u' | 'direct')
 * - stream type ('live' | 'vod' | 'series')
 * - media type ('hls' | 'progressive' | 'ts' | 'mp4' | 'mkv')
 * - playerSource (tailored for expo-video native consumption on iOS or Android)
 *
 * @param {Object} content - Media item or resolution config
 * @param {Object|string} [options] - Options or platform string ('ios' | 'android')
 * @returns {Object} Normalized playback session object
 */
export function normalizePlaybackSource(content, options = {}) {
  const opts = typeof options === 'string' ? { platform: options } : (options || {});
  const targetPlatform = opts.platform || Platform.OS;

  const resolved = resolveStreamSource(content, opts);
  if (!resolved.isValid) {
    return {
      ...resolved,
      platform: targetPlatform,
      headers: { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
      providerType: 'unknown',
      mediaType: 'unknown',
      playerSource: null,
    };
  }

  const rawItem = resolved.rawItem || content.item || content;

  // Platform-specific stream URL transformation (preserves authentic stream URLs for direct native playback)
  const platformUri = prepareStreamUrlForPlatform(resolved.uri, {
    type: resolved.streamType,
    extension: resolved.extension,
    platform: targetPlatform,
    streamId: resolved.contentId || resolved.streamId || rawItem?.stream_id || rawItem?.id || '',
  });

  // Re-detect content type for platform-prepared URL
  let contentType = detectContentType(platformUri, {
    type: resolved.streamType,
    extension: resolved.extension,
    platform: targetPlatform,
  });

  // On iOS AVPlayer, explicitly specify 'hls' when URL is an HLS manifest (.m3u8)
  if (targetPlatform === 'ios') {
    if (platformUri.includes('.m3u8')) {
      contentType = 'hls';
    } else if (platformUri.includes('.mp4') || platformUri.includes('.mov') || platformUri.includes('.m4v')) {
      contentType = 'progressive';
    }
  }

  // Derive provider type
  const isM3U = Boolean(rawItem?.url && !rawItem?.serverUrl && !rawItem?.server_url);
  const providerType = isM3U ? 'm3u' : 'xtream';

  // Derive media type
  let mediaType = resolved.extension;
  if (contentType === 'hls' || platformUri.includes('.m3u8')) {
    mediaType = 'hls';
  } else if (platformUri.includes('.mp4')) {
    mediaType = 'mp4';
  } else if (platformUri.includes('.mkv')) {
    mediaType = 'mkv';
  } else if (platformUri.includes('.ts')) {
    mediaType = 'ts';
  }

  // HTTP Headers
  const headers = {
    'User-Agent': DEFAULT_IPTV_USER_AGENT,
    ...(resolved.headers || {}),
  };
  if (opts.headers) {
    Object.assign(headers, opts.headers);
  }

  const playerSource = {
    uri: platformUri,
    ...(contentType !== 'auto' ? { contentType } : {}),
    headers,
    metadata: {
      title: resolved.title,
      ...(resolved.poster ? { artwork: resolved.poster } : {}),
    },
  };

  return {
    ...resolved,
    rawUrl: resolved.uri,
    originalUrl: resolved.uri,
    uri: platformUri,
    url: platformUri,
    contentType,
    headers,
    platform: targetPlatform,
    providerType,
    mediaType,
    playerSource,
  };
}

/**
 * Drop-in backward-compatible wrapper for existing resolveMediaSource calls.
 */
export function resolveMediaSource({ type, item, credentials = {}, platform = Platform.OS }) {
  const normalized = normalizePlaybackSource({ type, item, credentials }, { platform });
  return {
    type: normalized.streamType,
    url: normalized.uri,
    uri: normalized.uri,
    title: normalized.title,
    poster: normalized.poster,
    streamId: normalized.streamId,
    extension: normalized.extension,
    contentType: normalized.contentType,
    headers: normalized.headers,
    isLive: normalized.isLive,
    isVOD: normalized.isVOD,
    isValid: normalized.isValid,
    validationError: normalized.validationError,
    metadata: normalized.metadata,
    playerSource: normalized.playerSource,
  };
}

/**
 * Sanitized Live Channel Debug Logger.
 *
 * Logs channel diagnostics upon user selection WITHOUT EVER exposing
 * credentials, passwords, or authentication tokens.
 *
 * @param {Object} channel
 * @param {Object} resolvedSource
 */
export function logLiveChannelDebug(channel, resolvedSource) {
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
  if (!isDev) return;

  try {
    const rawUrl = resolvedSource?.uri || resolvedSource?.url || channel?.url || '';
    let host = 'UNKNOWN';
    let protocol = 'UNKNOWN';

    if (rawUrl && typeof rawUrl === 'string') {
      try {
        const parsed = new URL(rawUrl);
        host = parsed.host || 'UNKNOWN';
        protocol = (parsed.protocol || '').replace(':', '');
      } catch (_e) {
        host = 'INVALID_URL';
      }
    }

    const channelId = channel?.id || channel?.streamId || resolvedSource?.streamId || 'UNKNOWN';
    const channelName = channel?.name || channel?.title || resolvedSource?.title || 'Unknown Channel';
    const sourceType = channel?.url ? 'm3u' : 'xtream';
    const ext = resolvedSource?.extension || channel?.containerExtension || 'ts';
    const hasSource = Boolean(resolvedSource?.isValid && rawUrl);
    const isUrlEmpty = !rawUrl || rawUrl.trim() === '';
    const isUrlUndefined = rawUrl === undefined;
    const isUrlNull = rawUrl === null;
    const contentType = resolvedSource?.contentType || 'auto';

    console.log('[LIVE CHANNEL DEBUG]', {
      channelId: String(channelId),
      channelName: String(channelName),
      sourceType,
      protocol,
      host,
      extension: ext,
      hasSource,
      isUrlEmpty,
      isUrlUndefined,
      isUrlNull,
      detectedContentType: contentType,
      platform: Platform.OS,
      isValid: Boolean(resolvedSource?.isValid),
    });

    logPlayer('liveChannelSelect', {
      channelId: String(channelId),
      sourceType,
      protocol,
      host,
      extension: ext,
      hasSource,
      contentType,
      platform: Platform.OS,
    });
  } catch (err) {
    console.warn('[LIVE CHANNEL DEBUG] Failed to log diagnostics:', err?.message);
  }
}
