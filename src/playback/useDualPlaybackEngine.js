/**
 * FOX PLAYER — useDualPlaybackEngine Hook
 *
 * Master React hook managing the Dual Playback Architecture:
 * - Orchestrates Native Player (Media3/AVPlayer) & VLC Player (libVLC)
 * - Exposes unified player state, controls, audio/subtitle tracks, and diagnostics
 * - Integrates seamlessly with PlayerScreen and EmbeddedVideoPlayer
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVideoPlayer } from 'expo-video';
import { DualPlaybackCoordinator } from './engines/DualPlaybackCoordinator.js';
import { PLAYBACK_STATE, ENGINE_TYPE, ENGINE_MODE } from './playbackTypes.js';
import { probeVlcNativeAvailability } from './playerSettings.js';

// Safe dynamic resolution of useVlcPlayer hook from rn-vlc-plyr
let useVlcPlayerHook = null;
try {
  const vlcProbe = probeVlcNativeAvailability();
  if (vlcProbe.available) {
    const vlcModule = require('rn-vlc-plyr');
    if (vlcModule && typeof vlcModule.useVlcPlayer === 'function') {
      useVlcPlayerHook = vlcModule.useVlcPlayer;
    }
  }
} catch (_e) {
  useVlcPlayerHook = null;
}

export function useDualPlaybackEngine({
  initialSource = null,
  initialMode = ENGINE_MODE.AUTO,
  isLive = false,
  type = 'movie',
  isFocused = true,
  contentFit = 'contain',
  isMini = false,
  startupTimeoutMs = 12000,
  onEngineSwitch = null,
} = {}) {
  // 1. Stable coordinator instance
  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new DualPlaybackCoordinator({
      mode: initialMode,
      startupTimeoutMs,
    });
  }
  const coordinator = coordinatorRef.current;

  // 2. Underlying engine player instances
  const nativePlayer = useVideoPlayer(null);

  // Lazily initialize vlcPlayer instance ONLY when VLC engine is selected or activated
  const [vlcPlayer, setVlcPlayer] = useState(() => {
    if (initialMode !== ENGINE_MODE.VLC) return null;
    try {
      const vlcProbe = probeVlcNativeAvailability();
      if (!vlcProbe.available) return null;
      const vlcModule = require('rn-vlc-plyr');
      if (vlcModule && typeof vlcModule.createVlcPlayer === 'function') {
        return vlcModule.createVlcPlayer();
      }
    } catch (_e) {}
    return null;
  });

  const getOrCreateVlcPlayer = useCallback(() => {
    if (vlcPlayer) return vlcPlayer;
    try {
      const vlcProbe = probeVlcNativeAvailability();
      if (!vlcProbe.available) return null;
      const vlcModule = require('rn-vlc-plyr');
      if (vlcModule && typeof vlcModule.createVlcPlayer === 'function') {
        const instance = vlcModule.createVlcPlayer();
        setVlcPlayer(instance);
        return instance;
      }
    } catch (_e) {}
    return null;
  }, [vlcPlayer]);

  useEffect(() => {
    return () => {
      if (vlcPlayer) {
        try {
          vlcPlayer.stop();
          if (typeof vlcPlayer.release === 'function') {
            vlcPlayer.release();
          }
        } catch (_e) {}
      }
    };
  }, [vlcPlayer]);

  // 3. React state synced from coordinator
  const [activeEngineType, setActiveEngineType] = useState(coordinator.getActiveEngineType());
  const [engineMode, setEngineModeState] = useState(coordinator.getEngineMode());
  const [playerState, setPlayerState] = useState(PLAYBACK_STATE.IDLE);
  const [isBufferingUI, setIsBufferingUI] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLiveStream, setIsLiveStream] = useState(isLive || type === 'live');
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);
  const [isSwitching, setIsSwitching] = useState(false);

  // Track management
  const [availableAudioTracks, setAvailableAudioTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(null);
  const [availableSubtitleTracks, setAvailableSubtitleTracks] = useState([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState(null);

  // Debounced buffering state
  const bufferTimerRef = useRef(null);
  const setDebouncedBuffering = useCallback((buffering) => {
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }

    if (buffering) {
      bufferTimerRef.current = setTimeout(() => {
        setIsBufferingUI(true);
      }, 120);
    } else {
      bufferTimerRef.current = setTimeout(() => {
        setIsBufferingUI(false);
      }, 150);
    }
  }, []);

  // 4. Attach native & VLC player instances to coordinator engines
  useEffect(() => {
    if (nativePlayer) {
      coordinator.nativeEngine.attachPlayer(nativePlayer, { isLive, type });
    }
  }, [nativePlayer, coordinator, isLive, type]);

  useEffect(() => {
    if (vlcPlayer) {
      coordinator.vlcEngine.attachPlayer(vlcPlayer);
    }
  }, [vlcPlayer, coordinator]);

  // 5. Subscribe to coordinator lifecycle events
  useEffect(() => {
    const unsubscribe = coordinator.subscribe((event, payload) => {
      switch (event) {
        case 'stateChanged':
          setPlayerState(payload.state);
          if (
            payload.state === PLAYBACK_STATE.LOADING ||
            payload.state === PLAYBACK_STATE.BUFFERING
          ) {
            setDebouncedBuffering(true);
          } else if (payload.state === PLAYBACK_STATE.PLAYING || payload.state === PLAYBACK_STATE.READY) {
            setDebouncedBuffering(false);
            setErrorMessage(null);
            setErrorDetails(null);
          }
          break;

        case 'buffering':
          setDebouncedBuffering(payload.isBuffering);
          break;

        case 'ready':
          setDuration(payload.duration || 0);
          setIsLiveStream(Boolean(payload.isLive));
          setDebouncedBuffering(false);
          setIsSwitching(false);
          break;

        case 'progress':
          if (payload.currentTime != null) setCurrentTime(payload.currentTime);
          if (payload.duration != null && payload.duration > 0) setDuration(payload.duration);
          break;

        case 'tracksChanged':
          if (payload.audioTracks) {
            setAvailableAudioTracks(payload.audioTracks);
            if (!payload.selectedAudioTrack && payload.audioTracks.length > 0) {
              const def = payload.audioTracks.find((t) => t.isDefault || t.default) || payload.audioTracks[0];
              setSelectedAudioTrack(def);
            }
          }
          if (payload.subtitleTracks) setAvailableSubtitleTracks(payload.subtitleTracks);
          if (payload.selectedAudioTrack !== undefined && payload.selectedAudioTrack !== null) {
            setSelectedAudioTrack(payload.selectedAudioTrack);
          }
          if (payload.selectedSubtitleTrack !== undefined) setSelectedSubtitleTrack(payload.selectedSubtitleTrack);
          break;

        case 'engineSwitching':
          if (payload.to === ENGINE_TYPE.VLC) {
            getOrCreateVlcPlayer();
          }
          setIsSwitching(true);
          setDebouncedBuffering(true);
          setActiveEngineType(payload.to);
          break;

        case 'engineSwitched':
          setIsSwitching(false);
          setActiveEngineType(payload.to);
          if (typeof onEngineSwitch === 'function') {
            onEngineSwitch(payload);
          }
          break;

        case 'engineModeChanged':
          setEngineModeState(payload.mode);
          setActiveEngineType(payload.activeEngineType);
          break;

        case 'error':
          setDebouncedBuffering(false);
          setIsSwitching(false);
          setErrorMessage(payload.message || 'Playback error occurred.');
          setErrorDetails(payload);
          break;

        case 'playing':
          setDebouncedBuffering(false);
          break;

        case 'paused':
        case 'ended':
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, [coordinator, onEngineSwitch, setDebouncedBuffering]);

  // Handle focus changes (pause if unfocused)
  useEffect(() => {
    if (!isFocused && playerState === PLAYBACK_STATE.PLAYING) {
      coordinator.pause().catch(() => {});
    }
  }, [isFocused, playerState, coordinator]);

  // Load initial source if supplied
  useEffect(() => {
    if (initialSource) {
      coordinator.load(initialSource);
    }
  }, [initialSource, coordinator]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      coordinator.release().catch(() => {});
    };
  }, [coordinator]);

  /* --- Normalized Control Callbacks --- */

  const load = useCallback(
    (source, options = {}) => {
      setErrorMessage(null);
      setErrorDetails(null);
      return coordinator.load(source, options);
    },
    [coordinator]
  );

  const play = useCallback(() => coordinator.play(), [coordinator]);
  const pause = useCallback(() => coordinator.pause(), [coordinator]);
  const stop = useCallback(() => coordinator.stop(), [coordinator]);

  const togglePlay = useCallback(() => {
    if (playerState === PLAYBACK_STATE.PLAYING) {
      return coordinator.pause();
    }
    return coordinator.play();
  }, [coordinator, playerState]);

  const seekTo = useCallback((position) => coordinator.seekTo(position), [coordinator]);
  const setVolume = useCallback((vol) => coordinator.setVolume(vol), [coordinator]);
  const setMuted = useCallback((muted) => coordinator.setMuted(muted), [coordinator]);
  const setPlaybackRate = useCallback((rate) => coordinator.setPlaybackRate(rate), [coordinator]);
  const selectAudioTrack = useCallback((id) => coordinator.selectAudioTrack(id), [coordinator]);
  const selectSubtitleTrack = useCallback((id) => coordinator.selectSubtitleTrack(id), [coordinator]);
  const setAspectRatio = useCallback((mode) => coordinator.setAspectRatio(mode), [coordinator]);

  const setEngineMode = useCallback(
    async (mode) => {
      if (mode === ENGINE_MODE.VLC) {
        getOrCreateVlcPlayer();
      }
      await coordinator.setEngineMode(mode);
      setEngineModeState(coordinator.getEngineMode());
      setActiveEngineType(coordinator.getActiveEngineType());
    },
    [coordinator, getOrCreateVlcPlayer]
  );

  const switchEngineManually = useCallback(
    async (targetEngine) => {
      if (targetEngine === ENGINE_TYPE.VLC) {
        getOrCreateVlcPlayer();
      }
      await coordinator.switchEngine(targetEngine);
      setActiveEngineType(coordinator.getActiveEngineType());
    },
    [coordinator, getOrCreateVlcPlayer]
  );

  const retry = useCallback(() => {
    if (coordinator.currentSource) {
      return coordinator.load(coordinator.currentSource, { autoPlay: true });
    }
  }, [coordinator]);

  return {
    coordinator,
    activeEngineType,
    engineMode,
    activeEngineLabel: coordinator.getActiveEngineLabel(),
    nativePlayer,
    vlcPlayer,
    playerState,
    isPlaying: playerState === PLAYBACK_STATE.PLAYING,
    isBufferingUI,
    isSwitching,
    currentTime,
    duration,
    isLiveStream,
    errorMessage,
    errorDetails,
    availableAudioTracks,
    selectedAudioTrack,
    availableSubtitleTracks,
    selectedSubtitleTrack,
    // Operations
    load,
    play,
    pause,
    togglePlay,
    stop,
    seekTo,
    setVolume,
    setMuted,
    setPlaybackRate,
    selectAudioTrack,
    selectSubtitleTrack,
    setAspectRatio,
    setEngineMode,
    switchEngineManually,
    retry,
  };
}

export default useDualPlaybackEngine;
