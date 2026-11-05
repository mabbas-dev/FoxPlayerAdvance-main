/**
 * FOX PLAYER — Playback Architecture Types & Constants
 *
 * Defines shared playback states, commands, media types, and error categories
 * used across both Android (Media3) and iOS (AVFoundation) playback paths.
 */

import { ERROR_CLASSIFICATION } from '../utils/playerErrorMapper.js';

/**
 * Standard playback lifecycle states.
 */
export const PLAYBACK_STATE = {
  IDLE: 'IDLE',
  RESOLVING: 'RESOLVING',
  INITIALIZING: 'INITIALIZING',
  LOADING: 'LOADING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  BUFFERING: 'BUFFERING',
  SEEKING: 'SEEKING',
  ENDED: 'ENDED',
  SWITCHING: 'SWITCHING',
  RETRYING: 'RETRYING',
  RECOVERING: 'RETRYING', // backward-compatible alias
  ERROR: 'ERROR',
  UNAVAILABLE: 'UNAVAILABLE',
  RELEASED: 'RELEASED',
};

/**
 * Standard player commands accepted by the PlaybackController.
 */
export const PLAYER_COMMAND = {
  LOAD: 'LOAD',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
  REPLACE: 'REPLACE',
  SEEK: 'SEEK',
  RELEASE: 'RELEASE',
};

/**
 * Supported media and stream classifications.
 */
export const MEDIA_TYPE = {
  LIVE: 'live',
  VOD: 'vod',
  SERIES: 'series',
};

/**
 * Explicit media categories for IPTV playback.
 */
export const MEDIA_CLASS = {
  LIVE_HLS: 'LIVE_HLS',
  LIVE_PROGRESSIVE: 'LIVE_PROGRESSIVE',
  VOD_HLS: 'VOD_HLS',
  VOD_PROGRESSIVE: 'VOD_PROGRESSIVE',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Content-Type classifications recognized by native players.
 */
export const CONTENT_TYPE = {
  HLS: 'hls',
  PROGRESSIVE: 'progressive',
  DASH: 'dash',
  SMOOTH_STREAMING: 'smoothStreaming',
  AUTO: 'auto',
};

/**
 * Stream format containers.
 */
export const CONTAINER_FORMAT = {
  M3U8: 'm3u8',
  TS: 'ts',
  MP4: 'mp4',
  MKV: 'mkv',
  AVI: 'avi',
  MOV: 'mov',
  UNKNOWN: 'unknown',
};

/**
 * Provider source classifications.
 */
export const PROVIDER_TYPE = {
  XTREAM: 'xtream',
  M3U: 'm3u',
  DIRECT: 'direct',
  UNKNOWN: 'unknown',
};

/**
 * Error categories mapped from native players.
 */
export const PLAYBACK_ERROR = ERROR_CLASSIFICATION;

/**
 * Dual Playback Engine Types.
 */
export const ENGINE_TYPE = {
  NATIVE: 'NATIVE', // AndroidX Media3 (ExoPlayer) on Android, AVFoundation (AVPlayer) on iOS
  VLC: 'VLC',       // libVLC (rn-vlc-plyr)
};

/**
 * User Playback Engine Modes.
 */
export const ENGINE_MODE = {
  AUTO: 'AUTO',     // Automatic primary-to-fallback switching on recoverable failure
  NATIVE: 'NATIVE', // Force native engine only
  VLC: 'VLC',       // Force VLC engine only
};

/**
 * Engine Lifecycle Status.
 */
export const ENGINE_STATUS = {
  IDLE: 'IDLE',
  STARTING: 'STARTING',
  ACTIVE: 'ACTIVE',
  SWITCHING: 'SWITCHING',
  FAILED: 'FAILED',
};

/**
 * Reasons triggering engine switch.
 */
export const ENGINE_SWITCH_REASON = {
  STARTUP_TIMEOUT: 'STARTUP_TIMEOUT',
  FORMAT_UNSUPPORTED: 'FORMAT_UNSUPPORTED',
  DEMUXER_ERROR: 'DEMUXER_ERROR',
  DECODER_ERROR: 'DECODER_ERROR',
  PLAYBACK_STALLED: 'PLAYBACK_STALLED',
  MANUAL_SWITCH: 'MANUAL_SWITCH',
};

/**
 * Human-readable engine labels for UI diagnostics and settings.
 */
export const ENGINE_LABELS = {
  NATIVE: 'Native Player (ExoPlayer / AVPlayer)',
  VLC: 'VLC Player (libVLC Engine)',
};

