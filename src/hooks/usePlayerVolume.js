import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';

let VolumeManager = null;
try {
  const vmModule = require('react-native-volume-manager');
  VolumeManager = vmModule?.VolumeManager || vmModule?.default || vmModule;
} catch (_e) {
  VolumeManager = null;
}

const DEFAULT_VOLUME = 1.0;

// Module-level persistent cache across player screens and channel changes
let lastPersistedPlayerVolume = null;
let lastConfirmedDeviceVolume = null;

/**
 * Hook for managing native device media volume and player audio synchronization.
 *
 * Requirements:
 * 1. Device media volume is the authoritative source of truth (STREAM_MUSIC on Android, output volume on iOS).
 * 2. Initial volume indicator starts immediately at the device's real hardware media volume (0% - 100%).
 * 3. Player swipe gestures control actual system media volume via native VolumeManager without audio glitches.
 * 4. Listens to external hardware volume buttons (Volume Up/Down) and keeps the UI synchronized.
 * 5. Prevents infinite feedback loops between native volume events and gesture state.
 * 6. Coalesces rapid 60fps gesture updates via throttled native queue to prevent bridge thrashing.
 * 7. Clamps volume strictly between 0.0 (0%) and 1.0 (100%) and auto-unmutes when swiping up above 0.
 * 8. Zero audio pipeline stalls: never recreates or reconfigures playback buffers on volume change.
 *
 * @param {Object} [options]
 * @param {Object} [options.player] - expo-video player instance
 * @param {number} [options.initialVolume=1.0]
 * @param {Function} [options.onVolumeChange] - Callback receiving (volume, { source: 'gesture' | 'hardware' })
 * @returns {Object} { volume, isMuted, setVolume, adjustVolume, toggleMute, notifyGestureStart, notifyGestureEnd, refreshVolume, isNativeSupported }
 */
export function usePlayerVolume({ player = null, initialVolume = DEFAULT_VOLUME, onVolumeChange = null } = {}) {
  const getInitialVolume = () => {
    if (lastConfirmedDeviceVolume !== null) {
      return lastConfirmedDeviceVolume;
    }
    if (lastPersistedPlayerVolume !== null) {
      return lastPersistedPlayerVolume;
    }
    if (player && typeof player.volume === 'number' && player.volume >= 0 && player.volume <= 1) {
      return player.volume;
    }
    if (typeof initialVolume === 'number' && initialVolume >= 0 && initialVolume <= 1) {
      return initialVolume;
    }
    return DEFAULT_VOLUME;
  };

  const [volume, setVolumeState] = useState(getInitialVolume);
  const [isMuted, setIsMuted] = useState(() => Boolean(player?.muted));

  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const playerRef = useRef(player);
  const previousUnmutedVolumeRef = useRef(volume > 0 ? volume : 0.5);

  const isMountedRef = useRef(true);
  const isApplyingNativeRef = useRef(false);
  const pendingNativeValueRef = useRef(null);
  const isGestureActiveRef = useRef(false);
  const lastGestureApplyTimestampRef = useRef(0);
  const isNativeSupportedRef = useRef(Boolean(VolumeManager && typeof VolumeManager.getVolume === 'function'));

  playerRef.current = player;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;

  // Initialize and query authoritative device media volume on mount
  useEffect(() => {
    isMountedRef.current = true;

    async function querySystemMediaVolume() {
      if (VolumeManager && typeof VolumeManager.getVolume === 'function') {
        try {
          const result = await VolumeManager.getVolume();
          const sysVol = typeof result === 'object' && result !== null
            ? (typeof result.volume === 'number' ? result.volume : (typeof result.music === 'number' ? result.music : null))
            : (typeof result === 'number' ? result : null);

          if (typeof sysVol === 'number' && !isNaN(sysVol) && sysVol >= 0 && sysVol <= 1) {
            lastConfirmedDeviceVolume = sysVol;
            lastPersistedPlayerVolume = sysVol;
            if (isMountedRef.current) {
              volumeRef.current = sysVol;
              setVolumeState(sysVol);
              setIsMuted(sysVol === 0);
              if (sysVol > 0) {
                previousUnmutedVolumeRef.current = sysVol;
              }

              const activePlayer = playerRef.current;
              if (activePlayer) {
                try {
                  activePlayer.volume = sysVol;
                  activePlayer.muted = (sysVol === 0);
                } catch (_e) {}
              }
            }
          }
        } catch (_e) {
          // Graceful fallback to player volume or cached state
        }
      }
    }

    querySystemMediaVolume();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Suppress native OS volume UI overlay while custom player is active
  useEffect(() => {
    if (VolumeManager && typeof VolumeManager.showNativeVolumeUI === 'function') {
      try {
        VolumeManager.showNativeVolumeUI({ enabled: false });
      } catch (_e) {}

      return () => {
        try {
          VolumeManager.showNativeVolumeUI({ enabled: true });
        } catch (_e) {}
      };
    }
  }, []);

  // Listen to external hardware button (Volume Up/Down) and system slider changes
  useEffect(() => {
    if (!VolumeManager || typeof VolumeManager.addVolumeListener !== 'function') return;

    let subscription = null;
    try {
      subscription = VolumeManager.addVolumeListener((result) => {
        const incoming = typeof result === 'object' && result !== null
          ? (typeof result.volume === 'number' ? result.volume : (typeof result.music === 'number' ? result.music : null))
          : (typeof result === 'number' ? result : null);

        if (typeof incoming !== 'number' || isNaN(incoming)) return;
        const clamped = Math.max(0, Math.min(1, incoming));

        // Break infinite feedback loop if event originated from our own gesture or setVolume call
        const now = Date.now();
        const isEcho = isGestureActiveRef.current || (now - lastGestureApplyTimestampRef.current < 450);
        if (isEcho) {
          lastConfirmedDeviceVolume = clamped;
          lastPersistedPlayerVolume = clamped;
          return;
        }

        // Ignore micro-fluctuations
        if (Math.abs(clamped - volumeRef.current) < 0.008 && clamped !== 0 && clamped !== 1) {
          return;
        }

        lastConfirmedDeviceVolume = clamped;
        lastPersistedPlayerVolume = clamped;
        volumeRef.current = clamped;
        setVolumeState(clamped);
        setIsMuted(clamped === 0);
        if (clamped > 0) {
          previousUnmutedVolumeRef.current = clamped;
        }

        const activePlayer = playerRef.current;
        if (activePlayer) {
          try {
            activePlayer.volume = clamped;
            if (clamped > 0 && activePlayer.muted) {
              activePlayer.muted = false;
            } else if (clamped === 0) {
              activePlayer.muted = true;
            }
          } catch (_e) {}
        }

        if (typeof onVolumeChange === 'function') {
          try {
            onVolumeChange(clamped, { source: 'hardware' });
          } catch (_e) {}
        }
      });
    } catch (_e) {}

    return () => {
      try {
        if (subscription && typeof subscription.remove === 'function') {
          subscription.remove();
        }
      } catch (_e) {}
    };
  }, [onVolumeChange]);

  // Synchronize player audio stream when active player instance attaches
  useEffect(() => {
    if (!player) return;

    try {
      const activeVol = volumeRef.current;
      player.volume = activeVol;
      if (activeVol > 0) {
        player.muted = false;
      } else {
        player.muted = true;
      }
    } catch (_e) {}
  }, [player]);

  /**
   * Coalesced native volume applier.
   * Ensures 60fps gestures do not flood the native bridge with concurrent calls.
   */
  const applyNativeVolume = useCallback(async (val) => {
    if (!VolumeManager || typeof VolumeManager.setVolume !== 'function') return;

    pendingNativeValueRef.current = val;
    if (isApplyingNativeRef.current) return;

    isApplyingNativeRef.current = true;
    try {
      while (pendingNativeValueRef.current !== null && isMountedRef.current) {
        const nextVal = pendingNativeValueRef.current;
        pendingNativeValueRef.current = null;
        lastGestureApplyTimestampRef.current = Date.now();

        const config = {
          type: 'music', // Android STREAM_MUSIC only
          showUI: false, // Suppress intrusive OS volume toast
          playSound: false, // Avoid audible beep on volume change
        };

        await VolumeManager.setVolume(nextVal, config);
      }
    } catch (_e) {
      // Graceful error recovery
    } finally {
      isApplyingNativeRef.current = false;
    }
  }, []);

  /**
   * Set absolute volume [0.0, 1.0]
   */
  const setVolume = useCallback((targetValue, options = {}) => {
    if (typeof targetValue !== 'number' || isNaN(targetValue)) return;
    const clamped = Math.max(0, Math.min(1, targetValue));

    lastGestureApplyTimestampRef.current = Date.now();
    if (options.isGesture !== undefined) {
      isGestureActiveRef.current = Boolean(options.isGesture);
    }

    volumeRef.current = clamped;
    lastConfirmedDeviceVolume = clamped;
    lastPersistedPlayerVolume = clamped;
    setVolumeState(clamped);

    if (clamped > 0) {
      previousUnmutedVolumeRef.current = clamped;
    }

    const activePlayer = playerRef.current;
    if (activePlayer) {
      try {
        activePlayer.volume = clamped;

        // Auto-unmute when volume increases above 0
        if (clamped > 0 && activePlayer.muted) {
          activePlayer.muted = false;
          setIsMuted(false);
        } else if (clamped === 0) {
          activePlayer.muted = true;
          setIsMuted(true);
        }
      } catch (_e) {}
    }

    // Apply to native device media volume
    applyNativeVolume(clamped);

    if (typeof onVolumeChange === 'function') {
      try {
        onVolumeChange(clamped, { source: options.source || 'gesture' });
      } catch (_e) {}
    }
  }, [applyNativeVolume, onVolumeChange]);

  /**
   * Adjust volume by relative delta e.g. +0.05 or -0.05
   */
  const adjustVolume = useCallback((delta, options = {}) => {
    if (typeof delta !== 'number' || isNaN(delta)) return volumeRef.current;
    const next = Math.max(0, Math.min(1, volumeRef.current + delta));
    setVolume(next, options);
    return next;
  }, [setVolume]);

  /**
   * Notify gesture lifecycle start
   */
  const notifyGestureStart = useCallback(() => {
    isGestureActiveRef.current = true;
  }, []);

  /**
   * Notify gesture lifecycle end
   */
  const notifyGestureEnd = useCallback(() => {
    isGestureActiveRef.current = false;
    lastGestureApplyTimestampRef.current = Date.now();
  }, []);

  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    const activePlayer = playerRef.current;
    const currentVol = volumeRef.current;

    if (isMuted || currentVol === 0) {
      // Unmute: restore previous unmuted volume or fallback to 0.5
      const restoreVol = (previousUnmutedVolumeRef.current > 0) ? previousUnmutedVolumeRef.current : 0.5;
      setIsMuted(false);
      setVolume(restoreVol, { source: 'toggleMute' });
      if (activePlayer) {
        try {
          activePlayer.muted = false;
          activePlayer.volume = restoreVol;
        } catch (_e) {}
      }
    } else {
      // Mute: save current level and silence
      previousUnmutedVolumeRef.current = currentVol;
      setIsMuted(true);
      setVolume(0, { source: 'toggleMute' });
      if (activePlayer) {
        try {
          activePlayer.muted = true;
          activePlayer.volume = 0;
        } catch (_e) {}
      }
    }
  }, [isMuted, setVolume]);

  /**
   * Force re-query system media volume
   */
  const refreshVolume = useCallback(async () => {
    if (VolumeManager && typeof VolumeManager.getVolume === 'function') {
      try {
        const result = await VolumeManager.getVolume();
        const sysVol = typeof result === 'object' && result !== null
          ? (typeof result.volume === 'number' ? result.volume : (typeof result.music === 'number' ? result.music : null))
          : (typeof result === 'number' ? result : null);

        if (typeof sysVol === 'number' && !isNaN(sysVol) && sysVol >= 0 && sysVol <= 1) {
          lastConfirmedDeviceVolume = sysVol;
          lastPersistedPlayerVolume = sysVol;
          volumeRef.current = sysVol;
          setVolumeState(sysVol);
          setIsMuted(sysVol === 0);
          return sysVol;
        }
      } catch (_e) {}
    }
    return volumeRef.current;
  }, []);

  return {
    volume,
    isMuted,
    setVolume,
    adjustVolume,
    toggleMute,
    notifyGestureStart,
    notifyGestureEnd,
    refreshVolume,
    isNativeSupported: isNativeSupportedRef.current,
  };
}

export default usePlayerVolume;
