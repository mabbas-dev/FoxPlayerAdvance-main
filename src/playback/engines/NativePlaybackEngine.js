/**
 * FOX PLAYER — Native Playback Engine (Media3 ExoPlayer / AVPlayer)
 *
 * Implements BasePlaybackEngine using expo-video.
 * - Android: AndroidX Media3 / ExoPlayer
 * - iOS: AVFoundation / AVPlayer
 */

let Platform = { OS: 'android', select: (obj) => (obj ? (obj.android || obj.default) : undefined) };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}
import { BasePlaybackEngine } from './BasePlaybackEngine.js';
import { PLAYBACK_STATE, ENGINE_TYPE } from '../playbackTypes.js';
import { classifyPlayerError } from '../../utils/playerErrorMapper.js';
import { getPlatformPlayer } from '../PlatformPlayer.js';

export class NativePlaybackEngine extends BasePlaybackEngine {
  /**
   * @param {Object} [options]
   * @param {Object} [options.player] - Pre-instantiated expo-video player instance (optional)
   */
  constructor({ player = null } = {}) {
    super(
      ENGINE_TYPE.NATIVE,
      Platform.OS === 'android' ? 'Native (Media3 ExoPlayer)' : 'Native (AVPlayer)'
    );

    this.player = player;
    this.driver = getPlatformPlayer(Platform.OS);
    this.unsubscribers = [];
    this.contentFit = 'contain';

    this.capabilities = {
      canSeek: true,
      canSetRate: true,
      canSelectAudioTrack: true,
      canSelectSubtitleTrack: true,
      canSetVolume: true,
      supportsCustomHeaders: true,
      supportsPictureInPicture: true,
    };

    if (this.player) {
      this.attachPlayer(this.player);
    }
  }

  /**
   * Attach or replace underlying expo-video player instance.
   *
   * @param {Object} player - expo-video player instance
   * @param {Object} [options]
   */
  attachPlayer(player, options = {}) {
    this.detachPlayer();
    this.player = player;
    if (!player) return;

    this.driver.configurePlayer(player, options);

    // Listen to statusChange
    const subStatus = player.addListener('statusChange', (event) => {
      this._handleStatusChange(event);
    });

    // Listen to timeUpdate
    const subTime = player.addListener('timeUpdate', (event) => {
      this._handleTimeUpdate(event);
    });

    // Listen to playToEnd
    const subEnd = player.addListener('playToEnd', () => {
      this.setState(PLAYBACK_STATE.ENDED);
      this.emit('ended');
    });

    // Listen to sourceChange
    const subSource = player.addListener('sourceChange', (event) => {
      this.emit('sourceChange', event);
    });

    this.unsubscribers = [
      () => subStatus?.remove?.(),
      () => subTime?.remove?.(),
      () => subEnd?.remove?.(),
      () => subSource?.remove?.(),
    ];
  }

  detachPlayer() {
    this.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch (_e) {}
    });
    this.unsubscribers = [];
  }

  _handleStatusChange(event) {
    const rawStatus = event.status || this.player?.status;
    const error = event.error || this.player?.error;

    if (rawStatus === 'error' || error) {
      const classified = classifyPlayerError(error);
      if (classified.category === 'CANCELLED' || classified.isFatal === false) {
        // Harmless cancellation or stream switch (e.g. -999 NSURLErrorCancelled on iOS)
        return;
      }
      this.setState(PLAYBACK_STATE.ERROR);
      this.emit('error', {
        code: classified.code,
        message: classified.message,
        category: classified.category,
        isRecoverable: classified.isRecoverable,
        rawError: error,
      });
      return;
    }

    if (rawStatus === 'loading') {
      this.setState(PLAYBACK_STATE.LOADING);
      this.emit('buffering', { isBuffering: true });
    } else if (rawStatus === 'readyToPlay') {
      const duration = this.player?.duration || 0;
      this.capabilities.canSeek = duration > 0 && isFinite(duration);
      this.setState(PLAYBACK_STATE.READY);
      this.emit('ready', {
        duration,
        isLive: !this.capabilities.canSeek,
      });

      if (this.player?.playing) {
        this.setState(PLAYBACK_STATE.PLAYING);
        this.emit('playing');
        this.emit('buffering', { isBuffering: false });
      }
    } else if (rawStatus === 'idle') {
      this.setState(PLAYBACK_STATE.IDLE);
    }

    // Check playing vs paused
    if (this.player?.playing && this.state !== PLAYBACK_STATE.PLAYING && rawStatus === 'readyToPlay') {
      this.setState(PLAYBACK_STATE.PLAYING);
      this.emit('playing');
      this.emit('buffering', { isBuffering: false });
    }
  }

  _handleTimeUpdate(event) {
    const currentTime = event.currentTime != null ? event.currentTime : (this.player?.currentTime || 0);
    const duration = event.duration != null ? event.duration : (this.player?.duration || 0);
    const bufferedPosition = event.bufferedPosition != null ? event.bufferedPosition : currentTime;

    this.emit('progress', {
      currentTime,
      duration,
      bufferedPosition,
    });
  }

  async load(source, options = {}) {
    this.source = source;
    if (!this.player) {
      this.setState(PLAYBACK_STATE.IDLE);
      return;
    }

    this.setState(PLAYBACK_STATE.LOADING);
    this.emit('buffering', { isBuffering: true });

    const prepared = this.driver.prepareSource(source);
    if (!prepared) {
      const err = new Error('Invalid playback source');
      this.setState(PLAYBACK_STATE.ERROR);
      this.emit('error', {
        code: 'INVALID_SOURCE',
        message: 'Invalid playback source',
        isRecoverable: false,
        rawError: err,
      });
      return;
    }

    try {
      if (typeof this.player.replaceAsync === 'function') {
        this.player.replaceAsync(prepared).then(() => {
          if (options.autoPlay !== false) {
            try { this.player.play(); } catch (_e) {}
          }
        }).catch((e) => {
          const classified = classifyPlayerError(e);
          this.setState(PLAYBACK_STATE.ERROR);
          this.emit('error', {
            code: classified.code,
            message: classified.message,
            category: classified.category,
            isRecoverable: classified.isRecoverable,
            rawError: e,
          });
        });
      } else {
        this.player.replace(prepared);
        if (options.autoPlay !== false) {
          this.player.play();
        }
      }
    } catch (e) {
      const classified = classifyPlayerError(e);
      this.setState(PLAYBACK_STATE.ERROR);
      this.emit('error', {
        code: classified.code,
        message: classified.message,
        category: classified.category,
        isRecoverable: classified.isRecoverable,
        rawError: e,
      });
    }
  }

  async play() {
    if (!this.player) return;
    try {
      this.player.play();
      this.setState(PLAYBACK_STATE.PLAYING);
      this.emit('playing');
    } catch (_e) {}
  }

  async pause() {
    if (!this.player) return;
    try {
      this.player.pause();
      this.setState(PLAYBACK_STATE.PAUSED);
      this.emit('paused');
    } catch (_e) {}
  }

  async stop() {
    if (!this.player) return;
    try {
      this.player.pause();
      if (typeof this.player.replaceAsync === 'function') {
        this.player.replaceAsync(null).catch(() => {});
      } else {
        this.player.replace(null);
      }
      this.player.currentTime = 0;
      this.setState(PLAYBACK_STATE.IDLE);
    } catch (_e) {}
  }

  async seekTo(positionSeconds) {
    if (!this.player) return;
    try {
      this.player.currentTime = Math.max(0, positionSeconds);
    } catch (_e) {}
  }

  async setVolume(volume) {
    if (!this.player) return;
    try {
      // Clamped to 0.0 - 1.0
      this.player.volume = Math.max(0, Math.min(1, volume));
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
      this.player.playbackRate = Math.max(0.25, Math.min(4, rate));
    } catch (_e) {}
  }

  async selectAudioTrack(trackId) {
    // expo-video delegates track management via system or availableTracks
    if (!this.player) return;
    try {
      if (typeof this.player.selectAudioTrack === 'function') {
        this.player.selectAudioTrack(trackId);
      }
    } catch (_e) {}
  }

  async selectSubtitleTrack(trackId) {
    if (!this.player) return;
    try {
      if (typeof this.player.selectSubtitleTrack === 'function') {
        this.player.selectSubtitleTrack(trackId);
      }
    } catch (_e) {}
  }

  async setAspectRatio(mode) {
    this.contentFit = mode;
  }

  getCurrentPosition() {
    return this.player?.currentTime || 0;
  }

  getDuration() {
    return this.player?.duration || 0;
  }

  getBufferedPosition() {
    return this.player?.bufferedPosition || this.getCurrentPosition();
  }

  async release() {
    await super.release();
    this.detachPlayer();
    if (this.player) {
      try {
        this.player.pause();
        if (typeof this.player.release === 'function') {
          this.player.release();
        }
      } catch (_e) {}
      this.player = null;
    }
  }
}
