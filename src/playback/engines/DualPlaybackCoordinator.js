/**
 * FOX PLAYER — Dual Playback Engine Coordinator
 *
 * Coordinates automatic and manual switching between:
 * - Primary Engine: AndroidX Media3 ExoPlayer (Android) / AVFoundation AVPlayer (iOS)
 * - Fallback Engine: libVLC (rn-vlc-plyr)
 *
 * Production Invariants:
 * 1. Default sequence in AUTO mode: Native -> Fallback VLC on recoverable failure (if VLC is available).
 * 2. Maximum ONE automatic fallback attempt per playback session to prevent infinite loops.
 * 3. Never auto-switches for errors VLC cannot fix (No Internet, 401/403 Auth, 404 Missing, DRM).
 * 4. Completely releases previous engine before starting the new one (guarantees zero dual audio).
 * 5. Preserves stream URL, headers, volume, mute, VOD position, and aspect ratio during switch.
 * 6. Configurable startup timeout (default 12s) and buffer profile.
 * 7. Integrates with centralized playerSettings service.
 */

import {
  PLAYBACK_STATE,
  ENGINE_TYPE,
  ENGINE_MODE,
  ENGINE_SWITCH_REASON,
  ENGINE_LABELS,
} from '../playbackTypes.js';
import { NativePlaybackEngine } from './NativePlaybackEngine.js';
import { VlcPlaybackEngine } from './VlcPlaybackEngine.js';
import {
  getPlayerSettings,
  savePlayerSettings,
  subscribePlayerSettings,
  probeVlcNativeAvailability,
  validateEngineSelection,
} from '../playerSettings.js';

let Platform = { OS: 'android' };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}

const DEFAULT_STARTUP_TIMEOUT_MS = 12000;

export class DualPlaybackCoordinator {
  /**
   * @param {Object} [options]
   * @param {string} [options.mode] - 'AUTO' | 'NATIVE' | 'VLC'
   * @param {number} [options.startupTimeoutMs=12000]
   */
  constructor({
    mode = null,
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  } = {}) {
    // Current settings from centralized service
    this.settings = getPlayerSettings();
    this.mode = mode || this.settings.preferredEngine || ENGINE_MODE.AUTO;
    this.startupTimeoutMs = startupTimeoutMs;

    // Determine initial active engine
    const vlcProbe = probeVlcNativeAvailability();
    if (this.mode === ENGINE_MODE.VLC && vlcProbe.available) {
      this.activeEngineType = ENGINE_TYPE.VLC;
    } else {
      this.activeEngineType = ENGINE_TYPE.NATIVE;
    }

    this.nativeEngine = new NativePlaybackEngine();
    this.vlcEngine = new VlcPlaybackEngine();

    // Session attempt counters (resets on each new stream load)
    this.nativeAttempts = 0;
    this.vlcAttempts = 0;
    this.currentOperationId = 0;

    // Playback state cache for seamless engine switching
    this.currentSource = null;
    this.savedPosition = 0;
    this.currentVolume = 1.0;
    this.isMuted = false;
    this.currentRate = 1.0;
    this.contentFit = 'contain';
    this.lastError = null;

    // Timers
    this.startupTimer = null;

    // Listeners
    this.listeners = new Set();

    // Initialize listeners on both engines
    this._bindEngineEvents(this.nativeEngine, ENGINE_TYPE.NATIVE);
    this._bindEngineEvents(this.vlcEngine, ENGINE_TYPE.VLC);

    // Subscribe to live settings updates
    this.settingsUnsubscribe = subscribePlayerSettings((nextSettings) => {
      this.settings = nextSettings;
      if (nextSettings.preferredEngine && nextSettings.preferredEngine !== this.mode) {
        this.setEngineMode(nextSettings.preferredEngine).catch(() => {});
      }
    });
  }

  async setEngineMode(nextMode) {
    const validation = validateEngineSelection(nextMode);
    if (!validation.valid) {
      console.warn(`[DualPlaybackCoordinator] Invalid engine mode ${nextMode}: ${validation.error}`);
      return;
    }

    this.mode = nextMode;
    await savePlayerSettings({ preferredEngine: nextMode });

    const targetEngine = nextMode === ENGINE_MODE.VLC ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
    if (targetEngine !== this.activeEngineType && this.currentSource) {
      // User manually toggled engine mode during active playback
      await this.switchEngine(targetEngine, ENGINE_SWITCH_REASON.MANUAL_SWITCH);
    } else {
      this.activeEngineType = targetEngine;
    }

    this.emit('engineModeChanged', { mode: this.mode, activeEngineType: this.activeEngineType });
  }

  getEngineMode() {
    return this.mode;
  }

  getActiveEngineType() {
    return this.activeEngineType;
  }

  getActiveEngine() {
    return this.activeEngineType === ENGINE_TYPE.VLC ? this.vlcEngine : this.nativeEngine;
  }

  getActiveEngineLabel() {
    return ENGINE_LABELS[this.activeEngineType] || this.activeEngineType;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event, payload = {}) {
    this.listeners.forEach((fn) => {
      try {
        fn(event, payload);
      } catch (_e) {}
    });
  }

  _bindEngineEvents(engine, type) {
    engine.subscribe((event, payload) => {
      // Ignore events from non-active engine to prevent ghost events & race conditions
      if (this.activeEngineType !== type) return;

      if (event === 'ready' || event === 'playing') {
        this._clearStartupTimer();
      }

      if (event === 'progress') {
        if (payload.currentTime > 0) {
          this.savedPosition = payload.currentTime;
        }
      }

      if (event === 'error') {
        this._handleEngineError(payload, type);
        return;
      }

      // Re-emit normalized event to coordinator subscribers
      this.emit(event, payload);
    });
  }

  _startStartupTimer(opId) {
    this._clearStartupTimer();
    this.startupTimer = setTimeout(() => {
      if (this.currentOperationId !== opId) return;
      const state = this.getActiveEngine().getPlaybackState();
      if (state === PLAYBACK_STATE.LOADING || state === PLAYBACK_STATE.BUFFERING || state === PLAYBACK_STATE.IDLE) {
        console.warn(`[DualPlaybackCoordinator] Startup timeout (${this.startupTimeoutMs}ms) on ${this.activeEngineType}`);
        this._handleStartupTimeout();
      }
    }, this.startupTimeoutMs);
  }

  _clearStartupTimer() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  /**
   * Determine whether switching engines is appropriate for this error.
   */
  static isSwitchableError(errorDetails) {
    if (!errorDetails) return false;
    const msg = String(errorDetails.message || errorDetails.sanitizedMessage || errorDetails.technicalMessage || errorDetails.userMessage || '').toLowerCase();
    const code = String(errorDetails.code || errorDetails.errorCode || '').toLowerCase();
    const cat = String(errorDetails.category || '').toLowerCase();

    // 1. NON-SWITCHABLE: Errors a second engine CANNOT fix
    if (
      cat === 'offline' ||
      code === 'offline' ||
      msg.includes('no internet') ||
      msg.includes('network offline') ||
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('forbidden') ||
      msg.includes('unauthorized') ||
      msg.includes('404') ||
      msg.includes('not found') ||
      msg.includes('drm') ||
      msg.includes('widevine') ||
      msg.includes('fairplay') ||
      msg.includes('stream expired') ||
      msg.includes('token expired') ||
      msg.includes('subscription expired') ||
      cat === 'expired' ||
      code === 'expired'
    ) {
      return false;
    }

    // 2. SWITCHABLE: Codec, demuxer, parser, or platform-specific failures
    if (
      code === 'startup_timeout' ||
      code === 'unsupported_format' ||
      cat === 'unsupported_format' ||
      code === 'demuxer_error' ||
      code === 'decoder_error' ||
      msg.includes('mkv') ||
      msg.includes('-11828') ||
      msg.includes('mediacodec') ||
      msg.includes('decoderinitializationexception') ||
      msg.includes('extractor') ||
      msg.includes('demux') ||
      msg.includes('decoder') ||
      msg.includes('codec') ||
      msg.includes('unsupported') ||
      msg.includes('malformed') ||
      msg.includes('-16845') || // CoreMedia HLS error on raw TS
      msg.includes('-11800') || // AVFoundation unknown error
      msg.includes('parse') ||
      msg.includes('container') ||
      msg.includes('behind live window')
    ) {
      return true;
    }

    return true;
  }

  isSwitchableError(errorDetails) {
    return DualPlaybackCoordinator.isSwitchableError(errorDetails);
  }

  async _handleStartupTimeout() {
    const isAuto = this.mode === ENGINE_MODE.AUTO;
    const autoFallback = this.settings?.autoFallbackEnabled !== false;
    const vlcProbe = probeVlcNativeAvailability();

    if (isAuto && autoFallback && this.activeEngineType === ENGINE_TYPE.NATIVE && this.vlcAttempts < 1 && vlcProbe.available) {
      await this.switchEngine(ENGINE_TYPE.VLC, ENGINE_SWITCH_REASON.STARTUP_TIMEOUT);
      return;
    }

    this.emit('error', {
      code: 'STARTUP_TIMEOUT',
      message: `Playback startup timed out after ${Math.round(this.startupTimeoutMs / 1000)}s on ${this.activeEngineType}.`,
      category: 'TIMEOUT',
      isRecoverable: true,
      canSwitchEngine: this.activeEngineType === ENGINE_TYPE.NATIVE && this.vlcAttempts < 1 && vlcProbe.available,
    });
  }

  async _handleEngineError(errorPayload, fromEngineType) {
    this._clearStartupTimer();
    this.lastError = errorPayload;

    const isAuto = this.mode === ENGINE_MODE.AUTO;
    const autoFallback = this.settings?.autoFallbackEnabled !== false;
    const vlcProbe = probeVlcNativeAvailability();

    const canSwitchToVlc =
      autoFallback &&
      fromEngineType === ENGINE_TYPE.NATIVE &&
      this.vlcAttempts < 1 &&
      vlcProbe.available &&
      this.isSwitchableError(errorPayload);

    const canSwitchToNative =
      autoFallback &&
      fromEngineType === ENGINE_TYPE.VLC &&
      this.nativeAttempts < 1 &&
      this.isSwitchableError(errorPayload);

    if (isAuto && canSwitchToVlc) {
      const reason = errorPayload.code || ENGINE_SWITCH_REASON.DECODER_ERROR;
      console.log(`[DualPlaybackCoordinator] Auto-switching from NATIVE to VLC due to: ${reason}`);
      await this.switchEngine(ENGINE_TYPE.VLC, reason);
      return;
    }

    if (isAuto && canSwitchToNative) {
      console.log('[DualPlaybackCoordinator] Auto-switching from VLC to NATIVE');
      await this.switchEngine(ENGINE_TYPE.NATIVE, ENGINE_SWITCH_REASON.DECODER_ERROR);
      return;
    }

    // Both engines failed or non-recoverable error
    this.emit('error', {
      ...errorPayload,
      activeEngine: fromEngineType,
      bothEnginesFailed: this.nativeAttempts >= 1 && (this.vlcAttempts >= 1 || !vlcProbe.available),
      canSwitchEngine:
        (fromEngineType === ENGINE_TYPE.NATIVE && this.vlcAttempts < 1 && vlcProbe.available) ||
        (fromEngineType === ENGINE_TYPE.VLC && this.nativeAttempts < 1),
    });
  }

  /**
   * Switch active engine seamlessly, preserving stream state and releasing the old engine.
   */
  async switchEngine(targetEngineType, reason = ENGINE_SWITCH_REASON.MANUAL_SWITCH) {
    if (this.activeEngineType === targetEngineType && this.getActiveEngine().getPlaybackState() === PLAYBACK_STATE.PLAYING) {
      return;
    }

    // Guard against switching to VLC if native binary is absent
    if (targetEngineType === ENGINE_TYPE.VLC) {
      const vlcProbe = probeVlcNativeAvailability();
      if (!vlcProbe.available) {
        console.warn('[DualPlaybackCoordinator] Cannot switch to VLC:', vlcProbe.reason);
        this.emit('error', {
          code: 'VLC_UNAVAILABLE',
          message: vlcProbe.reason || 'VLC Player is not available on this device.',
          category: 'PLAYER_UNAVAILABLE',
          isRecoverable: true,
          canSwitchEngine: false,
        });
        return;
      }
    }

    const opId = ++this.currentOperationId;
    const fromEngine = this.activeEngineType;
    const oldEngine = this.getActiveEngine();

    // 1. Save state before teardown
    const currentPosition = this.savedPosition;
    const currentVolume = this.currentVolume;
    const isMuted = this.isMuted;
    const rate = this.currentRate;
    const fit = this.contentFit;
    const source = this.currentSource;

    this.emit('engineSwitching', {
      from: fromEngine,
      to: targetEngineType,
      reason,
      savedPosition: currentPosition,
    });

    // 2. FULLY STOP AND RELEASE THE PREVIOUS ENGINE (Eliminates dual audio!)
    try {
      await oldEngine.stop();
      if (typeof oldEngine.pause === 'function') await oldEngine.pause();
    } catch (_e) {}

    if (this.currentOperationId !== opId) return;

    // 3. Activate target engine
    this.activeEngineType = targetEngineType;
    if (targetEngineType === ENGINE_TYPE.VLC) {
      this.vlcAttempts++;
    } else {
      this.nativeAttempts++;
    }

    const newEngine = this.getActiveEngine();

    // 4. Restore audio & fit settings on new engine
    try {
      await newEngine.setVolume(currentVolume);
      await newEngine.setMuted(isMuted);
      await newEngine.setPlaybackRate(rate);
      await newEngine.setAspectRatio(fit);
    } catch (_e) {}

    // 5. Reload source in target engine
    if (source) {
      this._startStartupTimer(opId);
      try {
        await newEngine.load(source, { autoPlay: true });
        // Restore VOD position if applicable
        if (currentPosition > 0 && !source.isLive && source.type !== 'live') {
          setTimeout(() => {
            if (this.currentOperationId === opId) {
              newEngine.seekTo(currentPosition).catch(() => {});
            }
          }, 300);
        }
      } catch (err) {
        this._handleEngineError({ code: 'SWITCH_LOAD_FAILED', message: err.message }, targetEngineType);
      }
    }

    this.emit('engineSwitched', {
      from: fromEngine,
      to: targetEngineType,
      reason,
      engineLabel: this.getActiveEngineLabel(),
    });
  }

  /**
   * Load a new playback source (resets per-session attempt counters).
   */
  async load(source, options = {}) {
    const opId = ++this.currentOperationId;
    this.currentSource = source;
    this.savedPosition = 0;
    this.lastError = null;

    // Reset attempt counters for new playback session
    this.nativeAttempts = 0;
    this.vlcAttempts = 0;

    const vlcProbe = probeVlcNativeAvailability();

    const isMkvStream = Boolean(
      source?.extension === 'mkv' ||
      source?.containerExtension === 'mkv' ||
      /\.mkv(\?.*)?$/i.test(source?.uri || source?.url || '')
    );

    // Select initial engine based on mode:
    // Both iOS and Android require VLC for MKV container streams.
    // iOS AVPlayer cannot demux Matroska (.mkv) container at all (Code -11828).
    // Android ExoPlayer lacks software AC3/DTS audio decoders, causing video freeze and display lag on MKV.
    // If stream is MKV and VLC is available in AUTO mode, proactively start with VLC.
    if (this.mode === ENGINE_MODE.AUTO && isMkvStream && vlcProbe.available) {
      console.log('[DualPlaybackCoordinator] Proactively launching VLC engine for MKV stream');
      this.activeEngineType = ENGINE_TYPE.VLC;
      this.vlcAttempts = 1;
    } else if (this.mode === ENGINE_MODE.VLC && vlcProbe.available) {
      this.activeEngineType = ENGINE_TYPE.VLC;
      this.vlcAttempts = 1;
    } else {
      this.activeEngineType = ENGINE_TYPE.NATIVE;
      this.nativeAttempts = 1;
    }

    // Stop and silence the other engine
    const inactiveEngine = this.activeEngineType === ENGINE_TYPE.NATIVE ? this.vlcEngine : this.nativeEngine;
    try {
      await inactiveEngine.stop();
    } catch (_e) {}

    const activeEngine = this.getActiveEngine();
    this._startStartupTimer(opId);

    try {
      await activeEngine.setVolume(this.currentVolume);
      await activeEngine.setMuted(this.isMuted);
      await activeEngine.setPlaybackRate(this.currentRate);
      await activeEngine.setAspectRatio(this.contentFit);
      await activeEngine.load(source, options);
    } catch (e) {
      this._handleEngineError({ code: 'LOAD_ERROR', message: e.message }, this.activeEngineType);
    }
  }

  /* --- Normalized Operations Delegated to Active Engine --- */

  async play() {
    return this.getActiveEngine().play();
  }

  async pause() {
    return this.getActiveEngine().pause();
  }

  async stop() {
    this._clearStartupTimer();
    return this.getActiveEngine().stop();
  }

  async seekTo(positionSeconds) {
    this.savedPosition = positionSeconds;
    return this.getActiveEngine().seekTo(positionSeconds);
  }

  async setVolume(volume) {
    this.currentVolume = volume;
    return this.getActiveEngine().setVolume(volume);
  }

  async setMuted(muted) {
    this.isMuted = muted;
    return this.getActiveEngine().setMuted(muted);
  }

  async setPlaybackRate(rate) {
    this.currentRate = rate;
    return this.getActiveEngine().setPlaybackRate(rate);
  }

  async selectAudioTrack(trackId) {
    return this.getActiveEngine().selectAudioTrack(trackId);
  }

  async selectSubtitleTrack(trackId) {
    return this.getActiveEngine().selectSubtitleTrack(trackId);
  }

  async setAspectRatio(mode) {
    this.contentFit = mode;
    return this.getActiveEngine().setAspectRatio(mode);
  }

  getCurrentPosition() {
    return this.getActiveEngine().getCurrentPosition();
  }

  getDuration() {
    return this.getActiveEngine().getDuration();
  }

  getBufferedPosition() {
    return this.getActiveEngine().getBufferedPosition();
  }

  getPlaybackState() {
    return this.getActiveEngine().getPlaybackState();
  }

  async release() {
    this._clearStartupTimer();
    this.currentOperationId++;
    if (typeof this.settingsUnsubscribe === 'function') {
      this.settingsUnsubscribe();
    }
    await Promise.all([
      this.nativeEngine.release().catch(() => {}),
      this.vlcEngine.release().catch(() => {}),
    ]);
    this.listeners.clear();
  }
}

export default DualPlaybackCoordinator;
