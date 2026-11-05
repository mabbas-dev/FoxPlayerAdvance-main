/**
 * FOX PLAYER — iOS Playback Implementation
 *
 * Apple-native optimized playback path leveraging AVFoundation / AVPlayer.
 * Optimized for:
 * - AVPlayer-compatible playback with native HLS manifest parsing
 * - iOS low-latency buffering (preferredForwardBufferDuration: 2.5s live / 6.0s VOD)
 * - Zero pre-roll stall (waitsToMinimizeStalling: false)
 * - Safe iOS NSURL encoding (prevents nil URL crashes)
 * - Strict HLS vs Progressive stream segregation (never forces contentType: 'hls' on raw .ts)
 * - Clean AVPlayerViewController / AVPlayerLayer surface properties
 * - AVPlayer error classification (filtering non-fatal cancellation -999, detecting ATS -1022, HLS -16845)
 * - Controlled format fallbacks (.ts <-> .m3u8 for Live, .mkv -> .mp4 for VOD)
 */

import { classifyPlayerError } from '../utils/playerErrorMapper.js';
import { getStreamFallbackUrl, sanitizeMediaUrl } from '../utils/playerConfig.js';
import { CONTENT_TYPE, CONTAINER_FORMAT, MEDIA_TYPE } from './playbackTypes.js';
import { DEFAULT_IPTV_USER_AGENT } from '../utils/mediaSourcePipeline.js';

export class IOSPlayerDriver {
  constructor() {
    this.name = 'IOSPlayer';
    this.platform = 'ios';
    this.engine = 'AVFoundation / AVPlayer';
  }

  /**
   * Returns buffer configuration tuned specifically for Apple AVPlayer.
   *
   * Crucial optimizations:
   * - waitsToMinimizeStalling = false: prevents AVPlayer from stalling 30-60 seconds waiting for large buffers
   * - preferredForwardBufferDuration = 1.0s for Live TV: plays as soon as first segment is ready
   * - preferredForwardBufferDuration = 2.0s for VOD: fast initial frame + stable onward streaming
   *
   * @param {Object} options
   * @param {boolean} [options.isLive=false]
   * @param {string} [options.type='movie']
   * @returns {Object} BufferOptions
   */
  getBufferConfig({ isLive = false, type = 'movie', enableStallRecovery = false } = {}) {
    const live = isLive || type === 'live' || type === 'channel';
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

  /**
   * Returns VideoView surface props for iOS.
   * Does NOT pass Android-only props like useExoShutter.
   *
   * @param {Object} options
   * @param {string} [options.contentFit='contain']
   * @param {boolean} [options.isMini=false]
   * @returns {Object} VideoView surface props
   */
  getVideoViewProps({ contentFit = 'contain', isMini = false } = {}) {
    return {
      contentFit,
      nativeControls: false,
      pointerEvents: 'none',
      fullscreenOptions: { enable: !isMini },
    };
  }

  /**
   * Generates iOS-optimized VideoSource for expo-video / AVPlayer.
   *
   * Critical invariants:
   * 1. Safe NSURL encoding for URLs with spaces, brackets, or unencoded unicode.
   * 2. Sets contentType: 'hls' ONLY when the stream is genuinely an HLS playlist (.m3u8).
   *    Never passes 'hls' on raw .ts streams, preventing VideoPlayerItem.swift from attempting
   *    to parse raw MPEG-TS binary bytes as M3U text, which causes -16845 fatal CoreMedia errors.
   *
   * @param {Object} normalizedSource - Output of normalizePlaybackSource
   * @returns {Object|null} VideoSource object
   */
  prepareSource(normalizedSource) {
    if (!normalizedSource || !normalizedSource.isValid || !normalizedSource.uri) {
      return null;
    }

    let safeUri = sanitizeMediaUrl(normalizedSource.uri);

    const cleanPath = safeUri.split('?')[0].split('#')[0].toLowerCase();

    // Determine iOS AVPlayer contentType:
    // Sets contentType: 'hls' ONLY when the stream is an HLS playlist (.m3u8).
    let sourceContentType = null;
    if (cleanPath.endsWith('.m3u8') || safeUri.includes('.m3u8')) {
      sourceContentType = CONTENT_TYPE.HLS;
    } else if (cleanPath.endsWith('.mp4') || cleanPath.endsWith('.mov')) {
      sourceContentType = CONTENT_TYPE.PROGRESSIVE;
    }

    const defaultHeaders = { 'User-Agent': DEFAULT_IPTV_USER_AGENT };
    const headers = normalizedSource.headers ? { ...defaultHeaders, ...normalizedSource.headers } : defaultHeaders;

    return {
      uri: safeUri,
      ...(sourceContentType ? { contentType: sourceContentType } : {}),
      headers,
      metadata: {
        title: normalizedSource.metadata?.title || 'Live Channel',
        ...(normalizedSource.metadata?.poster ? { artwork: normalizedSource.metadata.poster } : {}),
      },
    };
  }

  /**
   * Configures native player instance properties for Apple AVPlayer.
   *
   * @param {Object} player - expo-video player instance
   * @param {Object} options - { isLive, type }
   */
  configurePlayer(player, { isLive = false, type = 'movie' } = {}) {
    if (!player) return;
    const live = isLive || type === 'live' || type === 'channel';
    const bufferOptions = this.getBufferConfig({ isLive: live, type });

    try {
      player.loop = false; // Live streams must never loop to prevent AVPlayer seek-to-zero stalls
      player.timeUpdateEventInterval = 0.25;
      player.staysActiveInBackground = false;
      if (bufferOptions) {
        player.bufferOptions = bufferOptions;
      }
    } catch (_e) {}
  }

  /**
   * Classifies playback errors from Apple AVFoundation / CoreMedia.
   *
   * @param {Error|string|Object} error
   * @returns {Object} Classified error details
   */
  classifyError(error) {
    return classifyPlayerError(error);
  }

  /**
   * Provides iOS-specific stream fallback URL.
   * - Live TV: .ts <-> .m3u8
   * - VOD: .mkv -> .mp4 (since AVPlayer cannot decode MKV containers)
   *
   * @param {string} currentUrl
   * @param {Object} options
   * @returns {string|null}
   */
  getFallbackUrl(currentUrl, options = {}) {
    return getStreamFallbackUrl(currentUrl, { ...options, platform: 'ios' });
  }

  /**
   * Checks codec/format support on iOS AVPlayer.
   * Apple natively supports HLS (.m3u8), MP4, MOV, AAC, H.264, HEVC.
   * Apple AVPlayer does NOT natively support MKV, AVI, FLV, or raw progressive MPEG-TS over plain HTTP.
   *
   * @param {string} mediaType
   * @returns {boolean}
   */
  isSupportedFormat(mediaType) {
    const ext = (mediaType || '').toLowerCase().replace(/^\.+/, '');
    const supported = ['m3u8', 'mp4', 'mov', 'm4v'];
    return supported.includes(ext);
  }
}

export const IOSPlayer = new IOSPlayerDriver();
export default IOSPlayer;
