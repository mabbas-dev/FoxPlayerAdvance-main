/**
 * FOX PLAYER — VLC Playback Engine (libVLC / rn-vlc-plyr)
 *
 * Implements BasePlaybackEngine using rn-vlc-plyr (libVLC native engine).
 * Provides broad IPTV codec & container compatibility (MPEG-TS, MKV, AVI, RTSP, AAC, AC3).
 *
 * Guaranteed safe against missing native Nitro Module binaries.
 */

import { BasePlaybackEngine } from './BasePlaybackEngine.js';
import { PLAYBACK_STATE, ENGINE_TYPE } from '../playbackTypes.js';
import { DEFAULT_IPTV_USER_AGENT } from '../../utils/mediaSourcePipeline.js';
import { getPlatformVlcOptions } from '../../utils/playerConfig.js';
import { probeVlcNativeAvailability } from '../playerSettings.js';

let VlcModule = null;
try {
  const vlcProbe = probeVlcNativeAvailability();
  if (vlcProbe.available) {
    VlcModule = require('rn-vlc-plyr');
  }
} catch (_e) {
  VlcModule = null;
}

export function isVlcNativeAvailable() {
  return probeVlcNativeAvailability().available;
}

export class VlcPlaybackEngine extends BasePlaybackEngine {
  constructor({ player = null } = {}) {
    super(ENGINE_TYPE.VLC, 'VLC Player (libVLC)');

    this.player = player;
    this.subscriptions = [];
    this.contentFit = 'contain';

    this.capabilities = {
      canSeek: false,
      canSetRate: true,
      canSelectAudioTrack: true,
      canSelectSubtitleTrack: true,
      canSetVolume: true,
      supportsCustomHeaders: false, // libvlc supports UserAgent + Referer, but not arbitrary headers
      supportsPictureInPicture: false,
    };

    if (this.player) {
      this.attachPlayer(this.player);
    }
  }

  /**
   * Check whether native VLC engine binary is available in the current runtime.
   */
  static isAvailable() {
    return probeVlcNativeAvailability().available;
  }

  /**
   * Attach native VlcPlayer instance and bind event listeners.
   */
  attachPlayer(player) {
    this.detachPlayer();
    this.player = player;
    if (!player) return;

    try {
      // 1. Status change listener
      if (typeof player.addOnStatusChangeListener === 'function') {
        const sub = player.addOnStatusChangeListener((status) => {
          this._handleStatusChange(status);
        });
        if (sub?.remove) this.subscriptions.push(() => sub.remove());
      }

      // 2. Loaded listener (duration, tracks, video size)
      if (typeof player.addOnLoadedListener === 'function') {
        const sub = player.addOnLoadedListener((loadedInfo) => {
          this._handleLoaded(loadedInfo);
        });
        if (sub?.remove) this.subscriptions.push(() => sub.remove());
      }

      // 3. Time update listener (ms -> seconds)
      if (typeof player.addOnTimeUpdateListener === 'function') {
        const sub = player.addOnTimeUpdateListener((event) => {
          const currentTime = (event.currentTime || 0) / 1000;
          const duration = (event.duration || 0) / 1000;
          this.emit('progress', {
            currentTime,
            duration,
            bufferedPosition: currentTime,
          });
        });
        if (sub?.remove) this.subscriptions.push(() => sub.remove());
      }

      // 4. Tracks change listener
      if (typeof player.addOnTracksChangeListener === 'function') {
        const sub = player.addOnTracksChangeListener((tracks) => {
          this.emit('tracksChanged', {
            audioTracks: tracks.audioTracks || [],
            subtitleTracks: tracks.subtitleTracks || [],
            selectedAudioTrack: tracks.selectedAudioTrack,
            selectedSubtitleTrack: tracks.selectedSubtitleTrack,
          });
        });
        if (sub?.remove) this.subscriptions.push(() => sub.remove());
      }

      // 5. Error listener
      if (typeof player.addOnErrorListener === 'function') {
        const sub = player.addOnErrorListener((err) => {
          this.setState(PLAYBACK_STATE.ERROR);
          this.emit('error', {
            code: err.code || 'VLC_PLAYBACK_ERROR',
            message: err.message || 'VLC playback failed',
            category: 'VLC_ERROR',
            isRecoverable: false,
            rawError: err,
          });
        });
        if (sub?.remove) this.subscriptions.push(() => sub.remove());
      }

      // 6. Ended listener
      if (typeof player.addOnEndedListener === 'function') {
        const sub = player.addOnEndedListener(() => {
          this.setState(PLAYBACK_STATE.ENDED);
          this.emit('ended');
        });
        if (sub?.remove) this.subscriptions.push(() => sub.remove());
      }
    } catch (e) {
      console.warn('[VlcPlaybackEngine] Error binding native listeners:', e);
    }
  }

  detachPlayer() {
    this.subscriptions.forEach((unsub) => {
      try {
        unsub();
      } catch (_e) {}
    });
    this.subscriptions = [];
  }

  _handleStatusChange(status) {
    switch (status) {
      case 'opening':
      case 'buffering':
        this.setState(PLAYBACK_STATE.BUFFERING);
        this.emit('buffering', { isBuffering: true });
        break;
      case 'playing':
        this.setState(PLAYBACK_STATE.PLAYING);
        this.emit('playing');
        this.emit('buffering', { isBuffering: false });
        break;
      case 'paused':
        this.setState(PLAYBACK_STATE.PAUSED);
        this.emit('paused');
        this.emit('buffering', { isBuffering: false });
        break;
      case 'stopped':
      case 'ended':
        this.setState(PLAYBACK_STATE.ENDED);
        this.emit('ended');
        break;
      case 'error':
        this.setState(PLAYBACK_STATE.ERROR);
        this.emit('error', {
          code: 'VLC_ERROR',
          message: 'VLC media error',
          category: 'MEDIA_ERROR',
          isRecoverable: false,
        });
        break;
      case 'idle':
      default:
        this.setState(PLAYBACK_STATE.IDLE);
        break;
    }
  }

  _handleLoaded(loadedInfo) {
    const duration = (loadedInfo.duration || 0) / 1000;
    const isLive = Boolean(loadedInfo.isLive || duration <= 0);
    this.capabilities.canSeek = Boolean(loadedInfo.isSeekable && !isLive);

    this.setState(PLAYBACK_STATE.READY);
    this.emit('ready', {
      duration,
      isLive,
      videoSize: loadedInfo.videoSize || { width: 0, height: 0 },
    });

    if (loadedInfo.audioTracks || loadedInfo.subtitleTracks) {
      this.emit('tracksChanged', {
        audioTracks: loadedInfo.audioTracks || [],
        subtitleTracks: loadedInfo.subtitleTracks || [],
      });
    }
  }

  /**
   * Load source into VLC player.
   */
  async load(source, options = {}) {
    this.source = source;
    if (!source || !source.uri) {
      this.setState(PLAYBACK_STATE.ERROR);
      this.emit('error', {
        code: 'INVALID_SOURCE',
        message: 'Invalid stream URL for VLC',
        isRecoverable: false,
      });
      return;
    }

    const probe = probeVlcNativeAvailability();
    if (!probe.available) {
      this.setState(PLAYBACK_STATE.ERROR);
      this.emit('error', {
        code: 'VLC_NOT_BUNDLED',
        message: probe.reason || 'VLC native engine is not bundled in this build.',
        isRecoverable: false,
      });
      return;
    }

    this.setState(PLAYBACK_STATE.LOADING);
    this.emit('buffering', { isBuffering: true });

    // Ensure player instance exists
    if (!this.player && VlcModule && typeof VlcModule.createVlcPlayer === 'function') {
      try {
        const newPlayer = VlcModule.createVlcPlayer();
        this.attachPlayer(newPlayer);
      } catch (err) {
        this.setState(PLAYBACK_STATE.ERROR);
        this.emit('error', {
          code: 'VLC_INIT_FAILED',
          message: 'Could not initialize VLC player instance: ' + err.message,
          isRecoverable: false,
          rawError: err,
        });
        return;
      }
    }

    if (!this.player) {
      this.setState(PLAYBACK_STATE.ERROR);
      this.emit('error', {
        code: 'VLC_PLAYER_NULL',
        message: 'VLC player instance could not be constructed.',
        isRecoverable: false,
      });
      return;
    }

    // Build VLC source configuration
    const userAgent = source.headers?.['User-Agent'] || source.userAgent || DEFAULT_IPTV_USER_AGENT;
    const referrer = source.headers?.Referer || source.headers?.referer || undefined;
    const vlcSource = {
      uri: source.uri,
      ...(userAgent ? { userAgent } : {}),
      ...(referrer ? { referrer } : {}),
      vlcOptions: getPlatformVlcOptions({ isLive: Boolean(options.isLive) }),
      title: source.title || 'IPTV Stream',
    };

    try {
      this.player.autoPlay = options.autoPlay !== false;
      this.player.source = vlcSource;
      if (options.autoPlay !== false) {
        try { this.player.play(); } catch (_e) {}
      }
    } catch (e) {
      this.setState(PLAYBACK_STATE.ERROR);
      this.emit('error', {
        code: 'VLC_LOAD_FAILED',
        message: e.message || 'VLC failed to load source',
        isRecoverable: false,
        rawError: e,
      });
    }
  }

  async play() {
    if (!this.player) return;
    try {
      this.player.play();
    } catch (_e) {}
  }

  async pause() {
    if (!this.player) return;
    try {
      this.player.pause();
    } catch (_e) {}
  }

  async stop() {
    if (!this.player) return;
    try {
      this.player.stop();
      this.setState(PLAYBACK_STATE.IDLE);
    } catch (_e) {}
  }

  async seekTo(positionSeconds) {
    if (!this.player) return;
    try {
      // Convert seconds to milliseconds for VLC
      this.player.seek(Math.round(Math.max(0, positionSeconds) * 1000));
    } catch (_e) {}
  }

  async setVolume(volume) {
    if (!this.player) return;
    try {
      // Convert normalized 0.0 - 1.0 to VLC's 0 - 100
      this.player.volume = Math.round(Math.max(0, Math.min(1, volume)) * 100);
    } catch (_e) {}
  }

  async setMuted(muted) {
    if (!this.player) return;
    try {
      this.player.muted = Boolean(muted);
    } catch (_e) {}
  }

  async setPlaybackRate(rate) {
    if (!this.player) return;
    try {
      this.player.rate = Math.max(0.25, Math.min(4, rate));
    } catch (_e) {}
  }

  async selectAudioTrack(trackId) {
    if (!this.player) return;
    try {
      this.player.setAudioTrack(Number(trackId));
    } catch (_e) {}
  }

  async selectSubtitleTrack(trackId) {
    if (!this.player) return;
    try {
      this.player.setSubtitleTrack(Number(trackId));
    } catch (_e) {}
  }

  async setAspectRatio(mode) {
    this.contentFit = mode;
  }

  getCurrentPosition() {
    return (this.player?.currentTime || 0) / 1000;
  }

  getDuration() {
    return (this.player?.duration || 0) / 1000;
  }

  getBufferedPosition() {
    return this.getCurrentPosition();
  }

  async release() {
    await super.release();
    this.detachPlayer();
    if (this.player) {
      try {
        this.player.stop();
        if (typeof this.player.release === 'function') {
          this.player.release();
        }
      } catch (_e) {}
      this.player = null;
    }
  }
}

export default VlcPlaybackEngine;
