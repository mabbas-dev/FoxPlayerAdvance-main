/**
 * FOX PLAYER — Base Playback Engine Contract
 *
 * Defines the unified, normalized playback interface exposed by all engines
 * (Native ExoPlayer / AVPlayer and VLC libVLC).
 */

import { PLAYBACK_STATE, ENGINE_TYPE } from '../playbackTypes.js';

export class BasePlaybackEngine {
  /**
   * @param {string} engineType - 'NATIVE' | 'VLC'
   * @param {string} name - Friendly engine name
   */
  constructor(engineType, name) {
    this.engineType = engineType;
    this.name = name;
    this.state = PLAYBACK_STATE.IDLE;
    this.source = null;
    this.isReleased = false;

    // Track capabilities
    this.capabilities = {
      canSeek: false,
      canSetRate: true,
      canSelectAudioTrack: true,
      canSelectSubtitleTrack: true,
      canSetVolume: true,
      supportsCustomHeaders: true,
      supportsPictureInPicture: true,
    };

    // Listeners set: (event, payload) => void
    this.listeners = new Set();
  }

  /**
   * Subscribe to normalized engine events.
   * Events: 'ready', 'playing', 'paused', 'buffering', 'progress', 'error', 'ended', 'tracksChanged', 'stateChanged'
   *
   * @param {Function} listener
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Dispatches normalized event to all listeners.
   */
  emit(event, payload = {}) {
    if (this.isReleased) return;
    this.listeners.forEach((fn) => {
      try {
        fn(event, payload);
      } catch (_e) {}
    });
  }

  /**
   * Transition normalized state and emit stateChanged.
   */
  setState(nextState) {
    if (this.state === nextState) return;
    const previous = this.state;
    this.state = nextState;
    this.emit('stateChanged', { state: nextState, previousState: previous });
  }

  getPlaybackState() {
    return this.state;
  }

  /* --- Subclasses MUST implement these methods --- */

  /**
   * Load source and prepare playback.
   * @param {Object} source - Normalized source { uri, headers, userAgent, isLive, type, title, metadata }
   * @param {Object} [options]
   */
  async load(source, options = {}) {
    throw new Error(`${this.name}: load() must be implemented by subclass`);
  }

  async play() {
    throw new Error(`${this.name}: play() must be implemented by subclass`);
  }

  async pause() {
    throw new Error(`${this.name}: pause() must be implemented by subclass`);
  }

  async stop() {
    throw new Error(`${this.name}: stop() must be implemented by subclass`);
  }

  async seekTo(positionSeconds) {
    throw new Error(`${this.name}: seekTo() must be implemented by subclass`);
  }

  async setVolume(volume) {
    throw new Error(`${this.name}: setVolume() must be implemented by subclass`);
  }

  async setMuted(muted) {
    throw new Error(`${this.name}: setMuted() must be implemented by subclass`);
  }

  async setPlaybackRate(rate) {
    throw new Error(`${this.name}: setPlaybackRate() must be implemented by subclass`);
  }

  async selectAudioTrack(trackId) {
    throw new Error(`${this.name}: selectAudioTrack() must be implemented by subclass`);
  }

  async selectSubtitleTrack(trackId) {
    throw new Error(`${this.name}: selectSubtitleTrack() must be implemented by subclass`);
  }

  async setAspectRatio(mode) {
    throw new Error(`${this.name}: setAspectRatio() must be implemented by subclass`);
  }

  getCurrentPosition() {
    return 0;
  }

  getDuration() {
    return 0;
  }

  getBufferedPosition() {
    return 0;
  }

  async release() {
    this.isReleased = true;
    this.listeners.clear();
    this.state = PLAYBACK_STATE.IDLE;
  }
}
