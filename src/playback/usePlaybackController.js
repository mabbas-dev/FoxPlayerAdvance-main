/**
 * FOX PLAYER — usePlaybackController Hook
 *
 * Connects the shared React UI layer to the authoritative PlaybackController
 * and platform-specific media player driver (AndroidPlayer / IOSPlayer).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppState, Platform } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import { PlaybackController } from './PlaybackController.js';
import { PLAYBACK_STATE } from './playbackTypes.js';
import { getPlatformPlayer } from './PlatformPlayer.js';

export function usePlaybackController({
  source = null,
  resolvedSource = null,
  item = null,
  url = '',
  isLive = false,
  type = 'movie',
  isFocused = true,
  externalPlayer = null,
  contentFit = 'contain',
  isMini = false,
  onStateChange = null,
} = {}) {
  const driver = useMemo(() => getPlatformPlayer(Platform.OS), []);

  // Stable controller reference (retained across ordinary React renders)
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = new PlaybackController({
      platform: Platform.OS,
      driver,
    });
  }
  const controller = controllerRef.current;

  // React state synced from controller
  const [playerState, setPlayerState] = useState(PLAYBACK_STATE.IDLE);
  const [isBufferingUI, setIsBufferingUI] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Buffer debounce timers
  const bufferTimerRef = useRef(null);
  const bufferStartRef = useRef(0);

  const setDebouncedBuffering = useCallback((buffering) => {
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }

    if (buffering) {
      bufferTimerRef.current = setTimeout(() => {
        bufferStartRef.current = Date.now();
        setIsBufferingUI(true);
      }, 120);
    } else {
      const elapsed = Date.now() - bufferStartRef.current;
      const minDisplayMs = 350;
      const remaining = Math.max(0, minDisplayMs - elapsed);
      bufferTimerRef.current = setTimeout(() => {
        setIsBufferingUI(false);
      }, remaining);
    }
  }, []);

  // Internal player instance if not supplied from outside
  const internalPlayer = useVideoPlayer(null, (p) => {
    driver.configurePlayer(p, { isLive, type });
  });

  const player = externalPlayer || internalPlayer;

  // Attach player to controller
  useEffect(() => {
    if (player) {
      controller.attachPlayer(player, { isLive, type });
    }
  }, [player, controller, isLive, type]);

  // Sync focus
  useEffect(() => {
    controller.setFocused(isFocused);
  }, [controller, isFocused]);

  // Subscribe to controller state changes
  useEffect(() => {
    const unsubscribe = controller.subscribe((event, payload) => {
      if (event === 'stateChange') {
        const nextState = payload.state;
        setPlayerState(nextState);

        if (nextState === PLAYBACK_STATE.LOADING || nextState === PLAYBACK_STATE.BUFFERING || nextState === PLAYBACK_STATE.RETRYING) {
          setDebouncedBuffering(true);
        } else {
          setDebouncedBuffering(false);
        }

        if (nextState === PLAYBACK_STATE.ERROR || nextState === PLAYBACK_STATE.UNAVAILABLE) {
          setErrorMessage(payload.message || controller.errorMessage || 'Stream unavailable');
        } else if (nextState === PLAYBACK_STATE.PLAYING || nextState === PLAYBACK_STATE.READY) {
          setErrorMessage(null);
        }

        if (typeof onStateChange === 'function') {
          onStateChange(nextState, payload);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [controller, setDebouncedBuffering, onStateChange]);

  // Hook into native player event listeners
  useEffect(() => {
    if (!player) return;

    const statusSub = player.addListener?.('statusChange', (event) => {
      const status = typeof event === 'string' ? event : event?.status || player.status;
      controller.onNativeStatusChange(status, event);
    });

    const playingSub = player.addListener?.('playingChange', (event) => {
      const isPlaying = typeof event === 'boolean' ? event : event?.isPlaying ?? player.playing;
      if (isPlaying && controller.state !== PLAYBACK_STATE.PLAYING) {
        controller.setState(PLAYBACK_STATE.PLAYING);
      } else if (!isPlaying && controller.state === PLAYBACK_STATE.PLAYING) {
        controller.setState(PLAYBACK_STATE.PAUSED);
      }
    });

    return () => {
      statusSub?.remove?.();
      playingSub?.remove?.();
    };
  }, [player, controller]);

  // Handle AppState changes (pause on background, resume on active)
  useEffect(() => {
    const handleAppState = (nextAppState) => {
      if (nextAppState === 'active') {
        if (isFocused && controller.playbackIntent === 'PLAYING' && !controller.userPaused) {
          controller.play();
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (player) {
          try {
            player.pause();
          } catch (_e) {}
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => {
      sub.remove();
    };
  }, [controller, player, isFocused]);

  // Load stream when source changes
  const activeInput = resolvedSource || source || item || url;
  useEffect(() => {
    if (activeInput) {
      controller.load(activeInput, { isLive, type });
    }
  }, [activeInput, controller, isLive, type]);

  // Teardown when unmounting: only stop if NOT using external shared player
  useEffect(() => {
    return () => {
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      if (!externalPlayer) {
        controller.release();
      }
    };
  }, [controller, externalPlayer]);

  // Native VideoView surface props tailored to host OS
  const videoViewProps = useMemo(() => {
    return driver.getVideoViewProps({ contentFit, isMini });
  }, [driver, contentFit, isMini]);

  const play = useCallback(() => controller.play(), [controller]);
  const pause = useCallback(() => controller.pause(), [controller]);
  const stop = useCallback(() => controller.stop(), [controller]);
  const seek = useCallback((sec) => controller.seek(sec), [controller]);
  const load = useCallback((src, opts) => controller.load(src, opts), [controller]);
  const replace = useCallback((src, opts) => controller.replace(src, opts), [controller]);

  return {
    controller,
    player,
    driver,
    playerState,
    isBufferingUI,
    errorMessage,
    videoViewProps,
    play,
    pause,
    stop,
    seek,
    load,
    replace,
  };
}

export default usePlaybackController;
