/**
 * FOX PLAYER — Platform-Specific Source Normalizer
 *
 * Normalizes media items across Live TV, Movies, and Series into
 * platform-specific VideoSource configurations for Android (Media3)
 * and iOS (AVFoundation).
 */

let Platform = { OS: 'ios', select: (obj) => (obj ? (obj.ios || obj.default) : undefined) };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}
import {
  validateStreamSource,
  detectContentType,
  resolveStreamSource,
  normalizePlaybackSource as baseNormalizePlaybackSource,
  DEFAULT_IPTV_USER_AGENT,
} from '../utils/mediaSourcePipeline.js';
import {
  sanitizeMediaUrl,
  prepareStreamUrlForPlatform,
  getStreamFallbackUrl,
  sanitizePlaybackUrl,
  sanitizePlaybackHeaders,
} from '../utils/playerConfig.js';
import {
  CONTENT_TYPE,
  MEDIA_TYPE,
  CONTAINER_FORMAT,
  PROVIDER_TYPE,
  MEDIA_CLASS,
} from './playbackTypes.js';

/**
 * Normalizes an incoming media item or stream definition into a
 * structured, platform-aware source definition.
 *
 * @param {Object} itemOrConfig - Raw content item or config object
 * @param {string} [platform=Platform.OS] - 'android' | 'ios'
 * @returns {{
 *   uri: string,
 *   url: string,
 *   contentType: string,
 *   mediaType: string,
 *   streamType: string,
 *   isLive: boolean,
 *   isVOD: boolean,
 *   isHLS: boolean,
 *   mediaClass: string,
 *   headers: Object,
 *   provider: string,
 *   providerType: string,
 *   playlistId: string,
 *   contentId: string,
 *   metadata: Object,
 *   isValid: boolean,
 *   validationError: string | null,
 *   platform: string,
 *   rawItem: Object
 * }}
 */
export function normalizePlaybackSource(itemOrConfig, platform = Platform.OS) {
  const targetPlatform = (typeof platform === 'string' ? platform : platform?.platform || Platform.OS).toLowerCase();

  // Run through base resolver to extract authentic URLs, credentials, stream IDs, and headers
  const base = baseNormalizePlaybackSource(itemOrConfig, { platform: targetPlatform });

  if (!base || !base.isValid) {
    return {
      uri: base?.uri || '',
      url: base?.url || '',
      contentType: CONTENT_TYPE.AUTO,
      mediaType: CONTAINER_FORMAT.UNKNOWN,
      streamType: base?.streamType || MEDIA_TYPE.VOD,
      isLive: Boolean(base?.isLive),
      isVOD: Boolean(base?.isVOD),
      isHLS: false,
      mediaClass: MEDIA_CLASS.UNKNOWN,
      headers: { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
      provider: PROVIDER_TYPE.UNKNOWN,
      providerType: PROVIDER_TYPE.UNKNOWN,
      playlistId: itemOrConfig?.playlistId || itemOrConfig?.playlist_id || '',
      contentId: itemOrConfig?.stream_id || itemOrConfig?.id || '',
      metadata: base?.metadata || {},
      isValid: false,
      validationError: base?.validationError || 'Invalid stream source.',
      platform: targetPlatform,
      rawItem: base?.rawItem || itemOrConfig,
    };
  }

  // Preserve authentic URL without stripping query params, ports, or changing provider paths
  const cleanUri = sanitizeMediaUrl(base.uri);
  const cleanPath = cleanUri.split('?')[0].split('#')[0].toLowerCase();

  // Accurate container/mediaType determination
  let mediaType = CONTAINER_FORMAT.UNKNOWN;
  if (cleanPath.endsWith('.m3u8') || cleanUri.includes('.m3u8')) {
    mediaType = CONTAINER_FORMAT.M3U8;
  } else if (cleanPath.endsWith('.ts') || cleanUri.includes('.ts')) {
    mediaType = CONTAINER_FORMAT.TS;
  } else if (cleanPath.endsWith('.mp4')) {
    mediaType = CONTAINER_FORMAT.MP4;
  } else if (cleanPath.endsWith('.mkv')) {
    mediaType = CONTAINER_FORMAT.MKV;
  } else if (cleanPath.endsWith('.avi')) {
    mediaType = CONTAINER_FORMAT.AVI;
  } else if (cleanPath.endsWith('.mov')) {
    mediaType = CONTAINER_FORMAT.MOV;
  } else if (base.extension) {
    mediaType = base.extension.toLowerCase();
  }

  // Platform-specific content type classification:
  // On iOS (AVFoundation):
  // - If URL contains .m3u8 or was flagged explicitly as HLS by the provider, set 'hls'.
  // On Android (Media3 / ExoPlayer):
  // - ExoPlayer natively decodes HLS, DASH, Progressive TS, and MP4.
  // - For live TS streams, keep AUTO so DefaultExtractorsFactory dynamically probes packets.
  let contentType = CONTENT_TYPE.AUTO;
  if (mediaType === CONTAINER_FORMAT.M3U8 || cleanUri.includes('.m3u8')) {
    contentType = CONTENT_TYPE.HLS;
  } else if (base.isLive) {
    contentType = (targetPlatform === 'ios' && (cleanUri.includes('.m3u8') || mediaType === CONTAINER_FORMAT.M3U8)) ? CONTENT_TYPE.HLS : CONTENT_TYPE.AUTO;
  } else if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'].includes(mediaType)) {
    contentType = CONTENT_TYPE.PROGRESSIVE;
  } else if (base.contentType && base.contentType !== 'auto') {
    contentType = base.contentType;
  }

  // Provider classification
  const provider = base.providerType || (base.rawItem?.serverUrl ? PROVIDER_TYPE.XTREAM : PROVIDER_TYPE.M3U);

  const isHLS = mediaType === CONTAINER_FORMAT.M3U8 || cleanPath.endsWith('.m3u8') || cleanUri.includes('.m3u8') || contentType === CONTENT_TYPE.HLS;

  // Explicit media category classification (Section 3 of architecture specification)
  let mediaClass = MEDIA_CLASS.UNKNOWN;
  if (base.isLive) {
    mediaClass = isHLS ? MEDIA_CLASS.LIVE_HLS : MEDIA_CLASS.LIVE_PROGRESSIVE;
  } else if (base.isVOD || base.streamType === MEDIA_TYPE.SERIES) {
    mediaClass = isHLS ? MEDIA_CLASS.VOD_HLS : MEDIA_CLASS.VOD_PROGRESSIVE;
  }

  const playlistId = base.rawItem?.playlistId || base.rawItem?.playlist_id || itemOrConfig?.playlistId || itemOrConfig?.playlist_id || '';
  const contentId = String(base.streamId || base.rawItem?.stream_id || base.rawItem?.id || base.rawItem?.num || itemOrConfig?.stream_id || itemOrConfig?.id || '');

  const defaultHeaders = { 'User-Agent': DEFAULT_IPTV_USER_AGENT };
  const headers = base.headers ? { ...defaultHeaders, ...base.headers } : defaultHeaders;

  const playerSource = base.playerSource || (cleanUri ? {
    uri: cleanUri,
    ...(contentType && contentType !== 'auto' ? { contentType } : {}),
    headers,
    metadata: {
      title: base.title || 'Fox Player',
      ...(base.poster ? { artwork: base.poster } : {}),
    },
  } : null);

  return {
    uri: cleanUri,
    url: cleanUri,
    contentType,
    mediaType,
    streamType: base.streamType,
    isLive: base.isLive,
    isVOD: base.isVOD,
    isHLS,
    mediaClass,
    headers,
    provider,
    providerType: provider,
    playlistId,
    contentId,
    metadata: {
      title: base.title || 'Fox Player',
      poster: base.poster || null,
      streamId: base.streamId || '',
      extension: base.extension || '',
      ...(base.metadata || {}),
    },
    playerSource,
    isValid: true,
    validationError: null,
    platform: targetPlatform,
    rawItem: base.rawItem || itemOrConfig,
  };
}

export {
  validateStreamSource,
  detectContentType,
  resolveStreamSource,
  sanitizeMediaUrl,
  prepareStreamUrlForPlatform,
  getStreamFallbackUrl,
  sanitizePlaybackUrl,
  sanitizePlaybackHeaders,
  normalizePlaybackSource as normalizeStreamSource,
};
