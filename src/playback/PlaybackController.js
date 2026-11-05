/**
 * FOX PLAYER — Authoritative Playback Controller
 *
 * Coordinates playback state, operation serialization (opId), single-source-of-truth play()
 * execution, error classification, watchdog timeouts, and telemetry diagnostics.
 *
 * Sits directly between the Shared UI Layer and the Platform Players:
 * UI -> PlaybackController -> ActivePlatformPlayer (AndroidPlayer / IOSPlayer)
 */

let Platform = { OS: 'ios', select: (obj) => (obj ? (obj.ios || obj.default) : undefined) };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}
import { PLAYBACK_STATE, PLAYER_COMMAND, MEDIA_TYPE } from './playbackTypes.js';
import { normalizePlaybackSource } from './sourceNormalizer.js';
import { getPlatformPlayer } from './PlatformPlayer.js';
import { logPlayerDiagnostic } from '../utils/playerConfig.js';
import { DEFAULT_IPTV_USER_AGENT } from '../utils/mediaSourcePipeline.js';

export class PlaybackController {
  /**
   * @param {Object} [options]
   * @param {string} [options.platform=Platform.OS]
   * @param {Object} [options.driver]
   */
  constructor({ platform = Platform.OS, driver = null } = {}) {
    this.platform = platform;
    this.driver = driver || getPlatformPlayer(platform);

    // Core playback state
    this.state = PLAYBACK_STATE.IDLE;
    this.previousState = PLAYBACK_STATE.IDLE;
    this.currentSource = null;
    this.currentUri = null;
    this.activePlayer = null;

    // Operation serialization: guarantees old requests (Channel A -> B -> C) cannot overwrite state
    this.operationId = 0;

    // Authoritative intent tracking
    this.playbackIntent = 'PLAYING'; // 'PLAYING' | 'PAUSED'
    this.userPaused = false;
    this.isFocused = true;

    // Error & Retry management
    this.lastError = null;
    this.errorMessage = null;
    this.fallbackAttempted = false;
    this.watchdogTimer = null;

    // Seek lifecycle management
    this.seekOperationId = 0;
    this.seekTargetTime = null;
    this.isSeekingSettling = false;
    this.seekWatchdogTimer = null;
    this.wasPlayingBeforeSeek = true;

    // Event listeners
    this.listeners = new Set();

    // Diagnostics timeline
    this.timing = {
      t0_tap: 0,
      t1_source: 0,
      t2_player: 0,
      t3_assigned: 0,
      t4_loading: 0,
      t5_ready: 0,
      t6_firstFrame: 0,
      t7_play: 0,
      t8_playing: 0,
    };
  }

  /**
   * Subscribes a listener to controller events.
   *
   * @param {Function} listener - Callback (event, payload) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Dispatches event to all subscribers.
   */
  notify(event, payload = {}) {
    this.listeners.forEach((fn) => {
      try {
        fn(event, payload);
      } catch (_e) {}
    });
  }

  /**
   * Sets internal state and notifies subscribers if changed.
   */
  setState(newState, payload = {}) {
    if (this.state !== newState) {
      this.previousState = this.state;
      this.state = newState;
      this.notify('stateChange', {
        state: newState,
        previousState: this.previousState,
        ...payload,
      });
    }
  }

  /**
   * Attaches the underlying native player instance and configures platform settings.
   *
   * @param {Object} player - expo-video player instance
   * @param {Object} [options]
   */
  attachPlayer(player, options = {}) {
    if (!player) return;
    this.activePlayer = player;
    this.driver.configurePlayer(player, options);
  }

  /**
   * Updates screen focus state.
   */
  setFocused(isFocused) {
    this.isFocused = Boolean(isFocused);
    if (!this.isFocused && this.activePlayer) {
      this.pause();
    }
  }

  /**
   * Loads and begins playback of a new media item.
   * Atomic operation with race-condition safety.
   *
   * @param {Object} itemOrSource - Raw channel/movie/series item or config
   * @param {Object} [options]
   */
  async load(itemOrSource, options = {}) {
    const opId = ++this.operationId;
    const now = Date.now();

    // Clear any active watchdog
    this.clearWatchdog();

    // Reset retry and error state
    this.fallbackAttempted = false;
    this.lastError = null;
    this.errorMessage = null;
    this.userPaused = false;
    this.playbackIntent = 'PLAYING';

    this.timing.t0_tap = options.tapTime || now;
    this.timing.t1_source = now;

    // Platform-aware normalization
    const normalized = normalizePlaybackSource(itemOrSource, this.platform);
    this.currentSource = normalized;

    if (!normalized.isValid) {
      if (opId === this.operationId) {
        this.errorMessage = normalized.validationError || 'Stream address invalid.';
        this.setState(PLAYBACK_STATE.UNAVAILABLE, { error: this.errorMessage });
      }
      return;
    }

    const nextUri = normalized.uri;
    this.currentUri = nextUri;

    // Check if the player is already playing this exact URI (e.g. across mini/max transition)
    if (
      this.activePlayer &&
      (this.activePlayer._activeUri === nextUri || this.activePlayer._foxCurrentUri === nextUri) &&
      this.activePlayer.status === 'readyToPlay' &&
      this.state !== PLAYBACK_STATE.ERROR
    ) {
      this.setState(this.activePlayer.playing ? PLAYBACK_STATE.PLAYING : PLAYBACK_STATE.PAUSED);
      return;
    }

    // Prepare platform-specific VideoSource object
    const playerSource = this.driver.prepareSource(normalized);
    if (!playerSource) {
      if (opId === this.operationId) {
        this.errorMessage = 'Failed to prepare stream source.';
        this.setState(PLAYBACK_STATE.ERROR, { error: this.errorMessage });
      }
      return;
    }

    const effectiveUri = playerSource.uri || nextUri;
    this.currentUri = effectiveUri;

    // Immediately pause previous playback to release server stream connection slot and prevent HTTP 509
    if (this.activePlayer) {
      this.activePlayer._activeUri = effectiveUri;
      this.activePlayer._foxCurrentUri = effectiveUri;
      try {
        this.activePlayer.pause();
      } catch (_e) {}
    }

    this.setState(PLAYBACK_STATE.LOADING, { uri: effectiveUri, opId });
    this.timing.t2_player = Date.now();
    this.timing.t3_assigned = Date.now();

    // Arm connect watchdog (25s live, 30s VOD)
    const timeoutMs = normalized.isLive ? 25000 : 30000;
    this.armWatchdog(timeoutMs, effectiveUri, opId);

    logPlayerDiagnostic('loadStarted', {
      platform: this.platform,
      engine: this.driver.engine,
      contentType: playerSource.contentType || normalized.contentType,
      mediaType: normalized.mediaType,
      streamType: normalized.streamType,
      url: effectiveUri,
      opId,
    });

    try {
      if (this.activePlayer) {
        if (typeof this.activePlayer.replaceAsync === 'function') {
          await this.activePlayer.replaceAsync(playerSource);
          if (opId === this.operationId && this.playbackIntent === 'PLAYING' && !this.userPaused && this.isFocused) {
            this.timing.t7_play = Date.now();
            this.activePlayer.play();
          }
        } else if (typeof this.activePlayer.replace === 'function') {
          this.activePlayer.replace(playerSource);
          if (opId === this.operationId && this.playbackIntent === 'PLAYING' && !this.userPaused && this.isFocused) {
            this.timing.t7_play = Date.now();
            this.activePlayer.play();
          }
        }
      }
    } catch (err) {
      if (opId === this.operationId) {
        this.handleError(err, nextUri, opId);
      }
    }
  }

  /**
   * Replaces current source with a new one (alias for load with same semantic).
   */
  async replace(itemOrSource, options = {}) {
    return this.load(itemOrSource, options);
  }

  /**
   * Single authoritative play() call.
   */
  play() {
    this.playbackIntent = 'PLAYING';
    this.userPaused = false;
    if (this.activePlayer && this.isFocused) {
      try {
        this.activePlayer.play();
        if (this.state === PLAYBACK_STATE.PAUSED || this.state === PLAYBACK_STATE.READY) {
          this.setState(PLAYBACK_STATE.PLAYING);
        }
      } catch (_e) {}
    }
  }

  /**
   * Single authoritative pause() call.
   */
  pause() {
    this.playbackIntent = 'PAUSED';
    this.userPaused = true;
    if (this.activePlayer) {
      try {
        this.activePlayer.pause();
        if (this.state === PLAYBACK_STATE.PLAYING) {
          this.setState(PLAYBACK_STATE.PAUSED);
        }
      } catch (_e) {}
    }
  }

  /**
   * Stops playback and unloads media.
   */
  stop() {
    this.clearWatchdog();
    this.playbackIntent = 'PAUSED';
    this.userPaused = true;
    this.currentUri = null;
    if (this.activePlayer) {
      try {
        this.activePlayer._activeUri = null;
        this.activePlayer._foxCurrentUri = null;
        this.activePlayer.pause();
        if (typeof this.activePlayer.replaceAsync === 'function') {
          this.activePlayer.replaceAsync(null).catch(() => {});
        } else if (typeof this.activePlayer.replace === 'function') {
          this.activePlayer.replace(null);
        }
      } catch (_e) {}
    }
    this.setState(PLAYBACK_STATE.IDLE);
  }

  /**
   * Seeks to a specific position in seconds (for VOD only).
   */
  seek(positionSeconds) {
    if (this.currentSource?.isLive) return;
    if (this.activePlayer && typeof this.activePlayer.currentTime === 'number') {
      try {
        const safeTime = Math.max(0, positionSeconds);
        const seekId = ++this.seekOperationId;
        this.seekTargetTime = safeTime;
        this.isSeekingSettling = true;
        this.wasPlayingBeforeSeek = (this.playbackIntent === 'PLAYING' && !this.userPaused);

        this.clearSeekWatchdog();

        if (this.wasPlayingBeforeSeek && this.state !== PLAYBACK_STATE.PAUSED) {
          this.setState(PLAYBACK_STATE.BUFFERING, { seeking: true, targetTime: safeTime });
        }

        this.activePlayer.currentTime = safeTime;
        this.lastPlaybackTime = safeTime;
        this.lastAdvanceTime = Date.now();

        // Bounded seek watchdog (2.0s)
        this.seekWatchdogTimer = setTimeout(() => {
          if (seekId === this.seekOperationId && this.isSeekingSettling) {
            this.isSeekingSettling = false;
            this.seekTargetTime = null;
            if (this.wasPlayingBeforeSeek && !this.userPaused && this.state !== PLAYBACK_STATE.PAUSED) {
              this.setState(PLAYBACK_STATE.PLAYING);
            }
          }
        }, 2000);
      } catch (_e) {}
    }
  }

  /**
   * Releases player and cancels active tasks.
   */
  release() {
    this.clearWatchdog();
    this.clearSeekWatchdog();
    this.listeners.clear();
    this.stop();
  }

  /**
   * Arms the watchdog timer for diagnostics.
   * NEVER triggers false fatal error on slow connection or prolonged buffering.
   */
  armWatchdog(durationMs, failedUrl, opId) {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      if (
        opId === this.operationId &&
        (this.state === PLAYBACK_STATE.LOADING ||
          this.state === PLAYBACK_STATE.BUFFERING ||
          this.state === PLAYBACK_STATE.RETRYING)
      ) {
        logPlayerDiagnostic('playbackWatchdogExpired', {
          platform: this.platform,
          url: failedUrl,
          opId,
          state: this.state,
          durationMs,
        });
      }
    }, durationMs);
  }

  /**
   * Clears the watchdog timer.
   */
  clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Clears the seek watchdog timer.
   */
  clearSeekWatchdog() {
    if (this.seekWatchdogTimer) {
      clearTimeout(this.seekWatchdogTimer);
      this.seekWatchdogTimer = null;
    }
  }

  /**
   * Handles native playback status change events.
   *
   * @param {'idle' | 'loading' | 'readyToPlay' | 'error'} status
   * @param {Object} [meta]
   */
  onNativeStatusChange(status, meta = {}) {
    if (status === 'readyToPlay') {
      this.clearWatchdog();
      this.timing.t5_ready = Date.now();
      if (!this.timing.t6_firstFrame) {
        this.timing.t6_firstFrame = Date.now();
      }

      if (this.playbackIntent === 'PLAYING' && !this.userPaused && this.isFocused) {
        if (this.activePlayer && !this.activePlayer.playing) {
          try {
            this.activePlayer.play();
          } catch (_e) {}
        }
        // Do NOT treat readyToPlay as proof of playback. Transition to READY or maintain LOADING until verified.
        if (this.activePlayer && this.activePlayer.playing && (this.activePlayer.currentTime || 0) > 0.05) {
          this.timing.t8_playing = Date.now();
          this.setState(PLAYBACK_STATE.PLAYING);
        } else {
          this.setState(PLAYBACK_STATE.READY);
        }
      } else {
        this.setState(PLAYBACK_STATE.PAUSED);
      }
    } else if (status === 'loading') {
      this.timing.t4_loading = Date.now();
      if (this.state === PLAYBACK_STATE.PLAYING && this.activePlayer && !this.activePlayer.playing) {
        this.setState(PLAYBACK_STATE.BUFFERING);
      }
    } else if (status === 'error') {
      this.handleError(meta.error || new Error('Native player error'), this.currentUri, this.operationId);
    }
  }

  /**
   * Handles native playing change events.
   *
   * @param {boolean} isPlaying
   */
  onNativePlayingChange(isPlaying) {
    if (this.state === PLAYBACK_STATE.ERROR) return;

    if (isPlaying) {
      if (this.userPaused || this.playbackIntent === 'PAUSED') {
        try { this.activePlayer?.pause(); } catch (_e) {}
        this.setState(PLAYBACK_STATE.PAUSED);
        return;
      }
      this.timing.t8_playing = Date.now();
      this.setState(PLAYBACK_STATE.PLAYING);
    } else {
      if (this.userPaused || this.playbackIntent === 'PAUSED') {
        this.setState(PLAYBACK_STATE.PAUSED);
      } else if (this.state === PLAYBACK_STATE.PLAYING) {
        this.setState(PLAYBACK_STATE.BUFFERING);
      }
    }
  }

  /**
   * Handles native periodic time update events.
   *
   * @param {number} currentTime
   */
  onNativeTimeUpdate(currentTime) {
    if (this.state === PLAYBACK_STATE.ERROR || this.userPaused || this.playbackIntent === 'PAUSED') return;

    const curr = typeof currentTime === 'number' ? currentTime : (this.activePlayer?.currentTime || 0);
    const now = Date.now();

    // Stale event suppression during seeking
    if (this.isSeekingSettling && this.seekTargetTime !== null) {
      const target = this.seekTargetTime;
      const hasReachedTarget = Math.abs(curr - target) <= 0.5 || (target > 0 && curr >= target - 0.2);
      if (hasReachedTarget) {
        this.isSeekingSettling = false;
        this.seekTargetTime = null;
        this.clearSeekWatchdog();
        if (this.wasPlayingBeforeSeek && !this.userPaused && this.state !== PLAYBACK_STATE.PAUSED) {
          this.setState(PLAYBACK_STATE.PLAYING);
        }
      } else {
        return;
      }
    }

    // Glitch protection against transient CMTimeZero from AVPlayer
    if (curr === 0 && (this.lastPlaybackTime || 0) > 1.5) {
      return;
    }

    if (!this.lastAdvanceTime) {
      this.lastAdvanceTime = now;
      this.lastPlaybackTime = curr;
    }

    const isAdvancing = curr - (this.lastPlaybackTime || 0) > 0.03 || (curr > 0.05 && this.lastPlaybackTime === 0);
    if (isAdvancing) {
      this.lastPlaybackTime = curr;
      this.lastAdvanceTime = now;
      if (this.state === PLAYBACK_STATE.BUFFERING || this.state === PLAYBACK_STATE.READY || this.state === PLAYBACK_STATE.LOADING) {
        this.setState(PLAYBACK_STATE.PLAYING);
      }
    } else if (this.state === PLAYBACK_STATE.PLAYING && now - this.lastAdvanceTime > 1400) {
      // Detected mid-stream stall
      this.setState(PLAYBACK_STATE.BUFFERING);
    }
  }

  /**
   * Handles stream reaching the end (for VOD/Series).
   */
  onNativePlayToEnd() {
    this.clearWatchdog();
    this.playbackIntent = 'PAUSED';
    this.setState(PLAYBACK_STATE.ENDED);
  }

  /**
   * Handles error with classification, stale operation discard, and single fallback attempt.
   *
   * @param {Error|string|Object} rawError
   * @param {string} failedUrl
   * @param {number} opId
   */
  handleError(rawError, failedUrl, opId) {
    if (opId !== this.operationId) {
      // Discard stale error from obsolete stream
      return;
    }

    const classified = this.driver.classifyError(rawError);

    // Cancelled operations (-999 / user switched channel) are non-fatal
    if (classified.category === 'CANCELLED') {
      return;
    }

    this.clearWatchdog();

    // Controlled fallback attempt
    if (!this.fallbackAttempted && classified.isFatal) {
      const fallbackUrl = this.driver.getFallbackUrl(failedUrl, {
        isLive: this.currentSource?.isLive,
        type: this.currentSource?.streamType,
      });

      if (fallbackUrl && fallbackUrl !== failedUrl) {
        this.fallbackAttempted = true;
        this.currentUri = fallbackUrl;
        if (this.activePlayer) {
          this.activePlayer._activeUri = fallbackUrl;
          this.activePlayer._foxCurrentUri = fallbackUrl;
        }

        this.setState(PLAYBACK_STATE.RETRYING, { fallbackUrl });
        logPlayerDiagnostic('fallbackAttempt', {
          fallbackUrl,
          platform: this.platform,
          opId,
        });

        const fallbackSource = {
          uri: fallbackUrl,
          contentType: fallbackUrl.includes('.m3u8') ? 'hls' : 'progressive',
          headers: this.currentSource?.headers || { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
          metadata: this.currentSource?.metadata,
        };

        try {
          if (this.activePlayer) {
            if (typeof this.activePlayer.replaceAsync === 'function') {
              this.activePlayer.replaceAsync(fallbackSource).catch((err) => {
                if (opId === this.operationId) this.triggerFinalError(err, classified);
              });
            } else if (typeof this.activePlayer.replace === 'function') {
              this.activePlayer.replace(fallbackSource);
            }
            if (this.playbackIntent === 'PLAYING' && !this.userPaused && this.isFocused) {
              this.activePlayer.play();
            }
          }
          return;
        } catch (_e) {}
      }
    }

    this.triggerFinalError(rawError, classified);
  }

  /**
   * Final error state trigger.
   */
  triggerFinalError(rawError, classified) {
    this.lastError = rawError;
    this.errorMessage = classified.userMessage || 'Stream unavailable';
    this.setState(PLAYBACK_STATE.ERROR, {
      category: classified.category,
      message: this.errorMessage,
      technicalMessage: classified.technicalMessage,
    });

    logPlayerDiagnostic('playbackError', {
      platform: this.platform,
      category: classified.category,
      technical: classified.technicalMessage,
      url: this.currentUri,
      opId: this.operationId,
    });
  }
}

export default PlaybackController;
