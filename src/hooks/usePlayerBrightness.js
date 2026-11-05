import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, Platform } from 'react-native';

let Brightness = null;
try {
  Brightness = require('expo-brightness');
} catch (_e) {
  Brightness = null;
}

const DEFAULT_BRIGHTNESS = 0.5;

// Module-level persistent cache across player screens/channel changes
let lastPersistedPlayerBrightness = null;

/**
 * Hook for controlling video player screen brightness with lifecycle safety.
 *
 * Requirements:
 * 1. Read device / window brightness on mount and save as initial reference.
 * 2. Progressive real-time updates clamped strictly between 0.0 and 1.0.
 * 3. Throttled native bridge calls to maintain 60fps gesture responsiveness.
 * 4. Automatic restore on player unmount and app backgrounding.
 * 5. Safe failure handling without crashing when native module is unavailable.
 *
 * @param {Object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {number} [options.initialValue]
 * @returns {Object} { brightness, setBrightness, adjustBrightness, restoreBrightness, isSupported }
 */
export function usePlayerBrightness({ enabled = true, initialValue = null } = {}) {
  const [brightness, setBrightnessState] = useState(() => {
    if (initialValue !== null && initialValue >= 0 && initialValue <= 1) return initialValue;
    if (lastPersistedPlayerBrightness !== null) return lastPersistedPlayerBrightness;
    return DEFAULT_BRIGHTNESS;
  });

  const initialBrightnessRef = useRef(null);
  const currentBrightnessRef = useRef(brightness);
  const hasModifiedRef        = useRef(false);
  const isMountedRef          = useRef(true);
  const isApplyingNativeRef   = useRef(false);
  const pendingNativeValueRef = useRef(null);
  const isSupportedRef        = useRef(Boolean(Brightness && (Brightness.setBrightnessAsync || Brightness.getBrightnessAsync)));

  // Synchronize ref
  currentBrightnessRef.current = brightness;

  /**
   * Safe native set brightness with frame scheduling / throttle
   */
  const applyNativeBrightness = useCallback(async (val) => {
    if (!Brightness || !isSupportedRef.current) return;

    pendingNativeValueRef.current = val;
    if (isApplyingNativeRef.current) return;

    isApplyingNativeRef.current = true;
    try {
      while (pendingNativeValueRef.current !== null && isMountedRef.current) {
        const nextVal = pendingNativeValueRef.current;
        pendingNativeValueRef.current = null;
        if (typeof Brightness.setBrightnessAsync === 'function') {
          await Brightness.setBrightnessAsync(nextVal);
        }
      }
    } catch (_e) {
      // Graceful error recovery: platform or permission constraint
    } finally {
      isApplyingNativeRef.current = false;
    }
  }, []);

  /**
   * Set absolute brightness [0.0, 1.0]
   */
  const setBrightness = useCallback((targetValue) => {
    if (typeof targetValue !== 'number' || isNaN(targetValue)) return;
    const clamped = Math.max(0, Math.min(1, targetValue));
    hasModifiedRef.current = true;
    lastPersistedPlayerBrightness = clamped;
    currentBrightnessRef.current = clamped;
    setBrightnessState(clamped);
    applyNativeBrightness(clamped);
  }, [applyNativeBrightness]);

  /**
   * Adjust brightness by relative delta
   * e.g. +0.05 or -0.05
   */
  const adjustBrightness = useCallback((delta) => {
    if (typeof delta !== 'number' || isNaN(delta)) return currentBrightnessRef.current;
    const next = Math.max(0, Math.min(1, currentBrightnessRef.current + delta));
    setBrightness(next);
    return next;
  }, [setBrightness]);

  /**
   * Restore initial device brightness
   */
  const restoreBrightness = useCallback(async () => {
    if (!hasModifiedRef.current || initialBrightnessRef.current === null) return;
    try {
      if (Brightness) {
        if (Platform.OS === 'android' && typeof Brightness.restoreSystemBrightnessAsync === 'function') {
          await Brightness.restoreSystemBrightnessAsync();
        } else if (typeof Brightness.setBrightnessAsync === 'function') {
          await Brightness.setBrightnessAsync(initialBrightnessRef.current);
        }
      }
      hasModifiedRef.current = false;
    } catch (_e) {}
  }, []);

  // Initialize brightness from device on mount
  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) return;

    let isCancelled = false;

    async function initBrightness() {
      if (!Brightness) return;
      try {
        let systemOrWindow = null;
        if (typeof Brightness.getBrightnessAsync === 'function') {
          systemOrWindow = await Brightness.getBrightnessAsync();
        }

        // On Android, -1 represents "default/auto" window brightness
        if (systemOrWindow === null || systemOrWindow < 0 || isNaN(systemOrWindow)) {
          if (typeof Brightness.getSystemBrightnessAsync === 'function') {
            systemOrWindow = await Brightness.getSystemBrightnessAsync();
          }
        }

        if (!isCancelled && typeof systemOrWindow === 'number' && systemOrWindow >= 0 && systemOrWindow <= 1) {
          const clamped = Math.max(0, Math.min(1, systemOrWindow));
          if (initialBrightnessRef.current === null) {
            initialBrightnessRef.current = clamped;
          }
          if (!hasModifiedRef.current) {
            currentBrightnessRef.current = clamped;
            if (lastPersistedPlayerBrightness === null) {
              lastPersistedPlayerBrightness = clamped;
            }
            setBrightnessState(clamped);
          }
        } else if (initialBrightnessRef.current === null) {
          initialBrightnessRef.current = DEFAULT_BRIGHTNESS;
        }
      } catch (_e) {
        if (initialBrightnessRef.current === null) {
          initialBrightnessRef.current = DEFAULT_BRIGHTNESS;
        }
      }
    }

    initBrightness();

    return () => {
      isCancelled = true;
    };
  }, [enabled]);

  // AppState listener: restore on background, re-apply on active if player modified it
  useEffect(() => {
    if (!enabled) return;

    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (hasModifiedRef.current && initialBrightnessRef.current !== null && Brightness) {
          try {
            if (Platform.OS === 'android' && typeof Brightness.restoreSystemBrightnessAsync === 'function') {
              Brightness.restoreSystemBrightnessAsync();
            } else if (typeof Brightness.setBrightnessAsync === 'function') {
              Brightness.setBrightnessAsync(initialBrightnessRef.current);
            }
          } catch (_e) {}
        }
      } else if (nextAppState === 'active') {
        if (hasModifiedRef.current && isMountedRef.current && Brightness) {
          try {
            if (typeof Brightness.setBrightnessAsync === 'function') {
              Brightness.setBrightnessAsync(currentBrightnessRef.current);
            }
          } catch (_e) {}
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (hasModifiedRef.current && initialBrightnessRef.current !== null && Brightness) {
        try {
          if (Platform.OS === 'android' && typeof Brightness.restoreSystemBrightnessAsync === 'function') {
            Brightness.restoreSystemBrightnessAsync();
          } else if (typeof Brightness.setBrightnessAsync === 'function') {
            Brightness.setBrightnessAsync(initialBrightnessRef.current);
          }
        } catch (_e) {}
      }
    };
  }, []);

  return {
    brightness,
    setBrightness,
    adjustBrightness,
    restoreBrightness,
    isSupported: isSupportedRef.current,
  };
}

export default usePlayerBrightness;
