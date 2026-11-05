/**
 * FOX PLAYER — Android Playback Implementation
 *
 * Android-optimized playback path leveraging AndroidX Media3 / ExoPlayer.
 * Optimized for:
 * - HLS streams
 * - IPTV Live TV with progressive MPEG-TS (.ts) demuxing via ExoPlayer TsExtractor
 * - MP4, MKV, AVI, and progressive VOD
 * - Android-specific buffer tuning (3.0s live, 10.0s VOD)
 * - SurfaceView flicker elimination (useExoShutter: false)
 * - Rapid stream switching without player destruction
 */

import { classifyPlayerError } from '../utils/playerErrorMapper.js';
import { getStreamFallbackUrl, sanitizePlaybackUrl } from '../utils/playerConfig.js';
import { CONTENT_TYPE, MEDIA_TYPE } from './playbackTypes.js';
import { DEFAULT_IPTV_USER_AGENT } from '../utils/mediaSourcePipeline.js';

export class AndroidPlayerDriver {
  constructor() {
    this.name = 'AndroidPlayer';
    this.platform = 'android';
    this.engine = 'Media3 / ExoPlayer';
  }

  /**
   * Returns buffer configuration tuned specifically for Android ExoPlayer.
   *
   * @param {Object} options
   * @param {boolean} [options.isLive=false]
   * @param {string} [options.type='movie']
   * @returns {Object} BufferOptions
   */
  getBufferConfig({ isLive = false, type = 'movie' } = {}) {
    const live = isLive || type === 'live' || type === 'channel';
    return {
      preferredForwardBufferDuration: live ? 3.0 : 10.0,
      minBufferForPlayback: live ? 1.0 : 2.5,
    };
  }

  /**
   * Returns VideoView props optimized for Android.
   * SurfaceView provides zero-copy hardware decoding for smooth, lag-free playback.
   *
   * @param {Object} options
   * @param {string} [options.contentFit='contain']
   * @param {boolean} [options.isMini=false]
   * @param {string} [options.surfaceType='surfaceView']
   * @returns {Object} VideoView surface props
   */
  getVideoViewProps({ contentFit = 'contain', isMini = false, surfaceType = 'surfaceView' } = {}) {
    return {
      contentFit,
      surfaceType,
      useExoShutter: false,
      nativeControls: false,
      pointerEvents: 'none',
      fullscreenOptions: { enable: !isMini },
    };
  }

  /**
   * Generates Android-optimized VideoSource for expo-video.
   * Android ExoPlayer natively handles MPEG-TS without needing synthetic manifest conversion.
   *
   * @param {Object} normalizedSource - Output of normalizePlaybackSource
   * @returns {Object|null} VideoSource object
   */
  prepareSource(normalizedSource) {
    if (!normalizedSource || !normalizedSource.isValid || !normalizedSource.uri) {
      return null;
    }

    const { uri, contentType, headers, metadata } = normalizedSource;

    let sourceContentType = contentType;
    if (sourceContentType === CONTENT_TYPE.AUTO || !sourceContentType) {
      if (uri.includes('.m3u8')) {
        sourceContentType = CONTENT_TYPE.HLS;
      } else if (uri.includes('.mpd')) {
        sourceContentType = CONTENT_TYPE.DASH;
      } else if (uri.includes('.ism')) {
        sourceContentType = CONTENT_TYPE.SMOOTH_STREAMING;
      } else if (normalizedSource.isLive || normalizedSource.streamType === 'live') {
        sourceContentType = CONTENT_TYPE.AUTO;
      } else if (uri.includes('.mp4') || uri.includes('.mkv') || uri.includes('.mov') || uri.includes('.avi')) {
        sourceContentType = CONTENT_TYPE.PROGRESSIVE;
      } else {
        sourceContentType = CONTENT_TYPE.AUTO;
      }
    }

    const defaultHeaders = { 'User-Agent': DEFAULT_IPTV_USER_AGENT };
    const mergedHeaders = headers ? { ...defaultHeaders, ...headers } : defaultHeaders;

    return {
      uri,
      ...(sourceContentType && sourceContentType !== 'auto' ? { contentType: sourceContentType } : {}),
      headers: mergedHeaders,
      metadata: {
        title: metadata?.title || 'Live Channel',
        ...(metadata?.poster ? { artwork: metadata.poster } : {}),
      },
    };
  }

  /**
   * Configures native player instance properties for Android.
   *
   * @param {Object} player - expo-video player instance
   * @param {Object} options - { isLive, type }
   */
  configurePlayer(player, { isLive = false, type = 'movie' } = {}) {
    if (!player) return;
    const live = isLive || type === 'live' || type === 'channel';
    const bufferOptions = this.getBufferConfig({ isLive: live, type });

    try {
      player.loop = false;
      player.timeUpdateEventInterval = live ? 1.0 : 0.5;
      player.staysActiveInBackground = false;
      if (bufferOptions) {
        player.bufferOptions = bufferOptions;
      }
    } catch (_e) {}
  }

  /**
   * Classifies playback error for Android / Media3 stack.
   *
   * @param {Error|string|Object} error
   * @returns {Object} Classified error details
   */
  classifyError(error) {
    return classifyPlayerError(error);
  }

  /**
   * Provides alternative fallback URL for stream failures.
   *
   * @param {string} currentUrl
   * @param {Object} options
   * @returns {string|null}
   */
  getFallbackUrl(currentUrl, options = {}) {
    return getStreamFallbackUrl(currentUrl, { ...options, platform: 'android' });
  }

  /**
   * Checks codec/format support on Android.
   * Android supports standard OTT codecs, MPEG-TS, MKV, H.264, HEVC.
   *
   * @param {string} mediaType
   * @returns {boolean}
   */
  isSupportedFormat(mediaType) {
    const ext = (mediaType || '').toLowerCase().replace(/^\.+/, '');
    const supported = ['m3u8', 'ts', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'mpd', 'ism'];
    return supported.includes(ext);
  }
}

export const AndroidPlayer = new AndroidPlayerDriver();
export default AndroidPlayer;
