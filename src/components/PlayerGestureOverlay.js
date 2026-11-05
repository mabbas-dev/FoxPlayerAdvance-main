import React, { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react';
import { View, StyleSheet, PanResponder, Animated, Dimensions } from 'react-native';
import PlayerGestureHUD from './PlayerGestureHUD';

const getCurrentTimestamp = () => Date.now();

/**
 * VLC-Style Master Gesture & Touch Overlay
 *
 * Requirements:
 * 1. Left 50% vertical swipe adjusts screen brightness.
 * 2. Right 50% vertical swipe adjusts media playback volume.
 * 3. Locks to initial side until touch release, even if finger crosses center.
 * 4. Strict vertical movement threshold (|dy| > 10 && |dy| > |dx| * 1.2) prevents accidental triggers on taps or horizontal seeking.
 * 5. Smooth progressive adjustment clamped strictly between 0% and 100% with zero initial activation jump.
 * 6. Single taps toggle player controls; double taps on left/right trigger 10s rewind/forward.
 * 7. Clean HUD indicator with automatic 1200ms auto-dismiss and pending-timer cancellation.
 * 8. Notifies parent on gesture start/end to coordinate controls auto-hide.
 */
function PlayerGestureOverlayComponent({
  brightness = 0.5,
  setBrightness,
  volume = 1.0,
  setVolume,
  onSingleTap,
  onDoubleTapLeft,
  onDoubleTapRight,
  onGestureStart,
  onGestureEnd,
  disabled = false,
  isMini = false,
  controlsVisible = false,
  insets = { top: 0, bottom: 0, left: 0, right: 0 },
  children = null,
  onHudChange = null,
}) {
  const [hudType, setHudType]       = useState(null); // 'volume' | 'brightness' | null
  const [hudValue, setHudValue]     = useState(0.5);
  const [hudVisible, setHudVisible] = useState(false);

  const hudVisibleRef = useRef(false);
  hudVisibleRef.current = hudVisible;

  const hudOpacityAnim = useRef(new Animated.Value(0)).current;
  const hideTimerRef   = useRef(null);
  const gestureSessionRef = useRef(0);
  const lastUpdateTimestampRef = useRef(0);

  const notifyHud = useCallback((type, value, visible) => {
    // Only forward HUD updates to parent screen when controls are visible;
    // when controls are hidden, this overlay renders the HUD directly without re-rendering PlayerScreen!
    if (controlsVisibleRef.current && typeof onHudChange === 'function') {
      onHudChange({
        type,
        value,
        visible,
        opacityAnim: hudOpacityAnim,
      });
    }
  }, [onHudChange, hudOpacityAnim]);

  const containerRef       = useRef(null);
  const { width: initW, height: initH } = Dimensions.get('window');
  const initialH = isMini ? 186 : (initH > initW ? Math.round(initW * (9 / 16)) : (initH || 400));
  const layoutWidthRef     = useRef(initW || 800);
  const layoutHeightRef    = useRef(initialH || 220);
  const containerPageXRef  = useRef(0);

  const isSwipingRef               = useRef(false);
  const hasMovedPastThresholdRef   = useRef(false);
  const gestureModeRef             = useRef(null);
  const startValueRef              = useRef(0.5);
  const recognitionDyRef           = useRef(0);
  const touchStartRef              = useRef({ time: 0, pageX: 0, pageY: 0 });
  const lastNotifiedValRef         = useRef(null);

  const brightnessRef = useRef(brightness);
  const volumeRef     = useRef(volume);
  brightnessRef.current = brightness;
  volumeRef.current     = volume;

  const controlsVisibleRef = useRef(controlsVisible);
  controlsVisibleRef.current = controlsVisible;

  const lastTapRef          = useRef({ time: 0, side: null });
  const singleTapTimerRef   = useRef(null);

  const updateMeasurements = useCallback(() => {
    if (containerRef.current?.measureInWindow) {
      containerRef.current.measureInWindow((x, _y, width, height) => {
        if (typeof x === 'number' && !isNaN(x)) {
          containerPageXRef.current = x;
        }
        if (typeof width === 'number' && width > 0) layoutWidthRef.current = width;
        if (typeof height === 'number' && height > 0) layoutHeightRef.current = height;
      });
    }
  }, []);

  const handleLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0) layoutWidthRef.current = width;
    if (height > 0) layoutHeightRef.current = height;
    updateMeasurements();
  }, [updateMeasurements]);

  // Cleanup timers and animations on unmount
  useEffect(() => {
    return () => {
      gestureSessionRef.current += 1;
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      hudOpacityAnim.stopAnimation();
      hudOpacityAnim.setValue(0);
      notifyHud(null, 0.5, false);
    };
  }, [hudOpacityAnim, notifyHud]);

  const propsRef = useRef({
    disabled,
    isMini,
    insets,
    setBrightness,
    setVolume,
    onSingleTap,
    onDoubleTapLeft,
    onDoubleTapRight,
    onGestureStart,
    onGestureEnd,
  });
  propsRef.current = {
    disabled,
    isMini,
    insets,
    setBrightness,
    setVolume,
    onSingleTap,
    onDoubleTapLeft,
    onDoubleTapRight,
    onGestureStart,
    onGestureEnd,
  };

  // PanResponder created ONCE in useRef — never recreated mid-playback on prop changes
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => {
        if (propsRef.current.disabled) return false;
        if (!controlsVisibleRef.current) return true;

        const locationY = evt?.nativeEvent?.locationY;
        const locationX = evt?.nativeEvent?.locationX;
        if (typeof locationY !== 'number') return true;

        const containerH = layoutHeightRef.current || (propsRef.current.isMini ? 186 : 220);
        const containerW = layoutWidthRef.current || (Dimensions.get('window').width || 800);

        // When controls are visible in MINI mode, protect interactive mini controls:
        if (propsRef.current.isMini) {
          if (locationY < 44) return false;
          if (locationY > containerH - 44) return false;
          const centerY = containerH * 0.5;
          const centerX = containerW * 0.5;
          if (Math.abs(locationY - centerY) < 32 && Math.abs((locationX ?? centerX) - centerX) < 32) {
            return false;
          }
          return true;
        }

        // When controls are visible in MAX mode, protect interactive button zones from touch hijacking:
        // Top zone: back button, title, actions
        // Bottom zone: seekbar, mute, speed, fit, fullscreen
        // Center zone: middle vertical & horizontal (play/pause and skips)
        const insetsTop = propsRef.current.insets?.top || 0;
        const insetsBottom = propsRef.current.insets?.bottom || 0;
        const topBoundary = Math.max(70, insetsTop + 45);
        const bottomBoundary = Math.max(80, insetsBottom + 45);

        // Top zone check (back button, title, actions)
        if (locationY < topBoundary) return false;
        // Bottom zone check (seekbar and bottom actions)
        if (locationY > containerH - bottomBoundary) return false;
        // Center zone check (play/pause and skips)
        const centerY = containerH * 0.5;
        const centerX = containerW * 0.5;
        if (Math.abs(locationY - centerY) < 60 && Math.abs((locationX ?? centerX) - centerX) < 150) {
          return false;
        }
        return true;
      },
      onStartShouldSetPanResponderCapture: () => false,

      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (propsRef.current.disabled || propsRef.current.isMini) return false;
        if (controlsVisibleRef.current) {
          const locationY = evt?.nativeEvent?.locationY;
          const locationX = evt?.nativeEvent?.locationX;
          if (typeof locationY === 'number') {
            const containerH = layoutHeightRef.current || 220;
            const containerW = layoutWidthRef.current || 800;
            const insetsTop = propsRef.current.insets?.top || 0;
            const insetsBottom = propsRef.current.insets?.bottom || 0;
            if (locationY < Math.max(70, insetsTop + 45)) return false;
            if (locationY > containerH - Math.max(80, insetsBottom + 45)) return false;
            if (typeof locationX === 'number') {
              const centerY = containerH * 0.5;
              const centerX = containerW * 0.5;
              if (Math.abs(locationY - centerY) < 60 && Math.abs(locationX - centerX) < 150) {
                return false;
              }
            }
          }
        }
        const dy = Math.abs(gestureState.dy);
        const dx = Math.abs(gestureState.dx);
        return (dy > 7 && dy > dx * 1.05) || (dy > 10 && dy > dx * 1.2);
      },
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) => {
        if (propsRef.current.disabled || propsRef.current.isMini) return false;
        // When controls are hidden during playback, capture vertical swipe so native video surface cannot steal it
        if (!controlsVisibleRef.current) {
          const dy = Math.abs(gestureState.dy);
          const dx = Math.abs(gestureState.dx);
          return (dy > 7 && dy > dx * 1.05) || (dy > 10 && dy > dx * 1.2);
        }
        return false;
      },
      onPanResponderTerminationRequest: () => false, // Refuse termination so in-flight swipe is never killed

      onPanResponderGrant: (evt, gestureState) => {
        if (propsRef.current.disabled) return;
        const now = getCurrentTimestamp();
        const pageX = typeof gestureState.x0 === 'number' && gestureState.x0 > 0
          ? gestureState.x0
          : (evt?.nativeEvent?.pageX || 0);
        const pageY = typeof gestureState.y0 === 'number' && gestureState.y0 > 0
          ? gestureState.y0
          : (evt?.nativeEvent?.pageY || 0);
        const locationX = evt?.nativeEvent?.locationX;
        const locationY = evt?.nativeEvent?.locationY;

        touchStartRef.current = { time: now, pageX, pageY, locationX, locationY };
        if (typeof locationX === 'number' && locationX >= 0 && typeof pageX === 'number' && pageX >= locationX) {
          containerPageXRef.current = Math.max(0, pageX - locationX);
        }
        lastNotifiedValRef.current = null;
        isSwipingRef.current = false;
        hasMovedPastThresholdRef.current = false;
        gestureModeRef.current = null;
        if (__DEV__) {
          console.log(`[FoxPlayer:Gesture] onPanResponderGrant: x0=${Math.round(pageX)}, y0=${Math.round(pageY)}, controlsVisible=${controlsVisibleRef.current}`);
        }
      },

      onPanResponderMove: (_evt, gestureState) => {
        if (propsRef.current.disabled || propsRef.current.isMini) return;

        const dy = gestureState.dy;
        const dx = gestureState.dx;
        const absDy = Math.abs(dy);
        const absDx = Math.abs(dx);

        // Recognition step: verify clear vertical intent
        if (!hasMovedPastThresholdRef.current) {
          if ((absDy > 7 && absDy > absDx * 1.05) || (absDy > 10 && absDy > absDx * 1.2)) {
            hasMovedPastThresholdRef.current = true;
            isSwipingRef.current = true;

            // Cancel any pending tap
            if (singleTapTimerRef.current) {
              clearTimeout(singleTapTimerRef.current);
              singleTapTimerRef.current = null;
            }

            // Cancel any pending hide operation when a new valid swipe begins
            if (hideTimerRef.current) {
              clearTimeout(hideTimerRef.current);
              hideTimerRef.current = null;
            }
            hudOpacityAnim.stopAnimation();
            gestureSessionRef.current += 1;

            // Calculate touch position relative to container
            const startX = touchStartRef.current.pageX;
            const containerX = containerPageXRef.current || 0;
            const width = layoutWidthRef.current || Dimensions.get('window').width || 800;
            const relX = (typeof touchStartRef.current.locationX === 'number' && touchStartRef.current.locationX >= 0 && touchStartRef.current.locationX <= width)
              ? touchStartRef.current.locationX
              : (startX - containerX);

            // Strict side separation: Left = Brightness, Right = Volume
            const isLeft = relX < width * 0.5;
            const mode = isLeft ? 'brightness' : 'volume';
            gestureModeRef.current = mode;

            const currentVal = mode === 'brightness' ? brightnessRef.current : volumeRef.current;
            startValueRef.current = typeof currentVal === 'number' && !isNaN(currentVal) ? currentVal : 0.5;
            recognitionDyRef.current = dy;

            if (typeof propsRef.current.onGestureStart === 'function') {
              propsRef.current.onGestureStart();
            }

            setHudType(mode);
            setHudValue(startValueRef.current);
            setHudVisible(true);
            notifyHud(mode, startValueRef.current, true);

            hudOpacityAnim.stopAnimation();
            Animated.timing(hudOpacityAnim, {
              toValue: 1,
              duration: 120,
              useNativeDriver: true,
            }).start();

            if (__DEV__) {
              console.log(`[FoxPlayer:Gesture] swipeStarted: mode=${mode}, startVal=${startValueRef.current.toFixed(2)}, relX=${Math.round(relX)}/${Math.round(width)}`);
            }
          }
        }

        // Active swipe tracking
        if (isSwipingRef.current && gestureModeRef.current) {
          const mode = gestureModeRef.current;
          const containerH = layoutHeightRef.current || Dimensions.get('window').height || 400;
          const sensitivity = Math.min(300, Math.max(160, containerH * 0.5));
          const effectiveDy = dy - (recognitionDyRef.current || 0);

          // Sliding UP (negative dy) increases value; sliding DOWN decreases value
          const delta = -effectiveDy / sensitivity;
          const clamped = Math.max(0, Math.min(1, startValueRef.current + delta));

          const lastVal = lastNotifiedValRef.current;
          const now = getCurrentTimestamp();
          const timeSinceLastUpdate = now - (lastUpdateTimestampRef.current || 0);
          const isSignificantChange = lastVal === null || Math.abs(clamped - lastVal) >= 0.02;
          const isBoundary = clamped === 0 || clamped === 1;

          if (lastVal === null || ((timeSinceLastUpdate >= 45 || isSignificantChange) && isSignificantChange) || isBoundary) {
            lastUpdateTimestampRef.current = now;
            lastNotifiedValRef.current = clamped;
            setHudValue(clamped);
            notifyHud(mode, clamped, true);

            if (mode === 'brightness' && typeof propsRef.current.setBrightness === 'function') {
              propsRef.current.setBrightness(clamped);
            } else if (mode === 'volume' && typeof propsRef.current.setVolume === 'function') {
              propsRef.current.setVolume(clamped, { isGesture: true });
            }
          }
        }
      },

      onPanResponderRelease: (_evt, gestureState) => {
        const now = getCurrentTimestamp();
        const duration = now - touchStartRef.current.time;
        const totalMovement = Math.hypot(gestureState.dx, gestureState.dy);

        if (isSwipingRef.current) {
          const mode = gestureModeRef.current;
          if (mode) {
            const containerH = layoutHeightRef.current || Dimensions.get('window').height || 400;
            const sensitivity = Math.min(300, Math.max(160, containerH * 0.5));
            const effectiveDy = gestureState.dy - (recognitionDyRef.current || 0);
            const delta = -effectiveDy / sensitivity;
            const finalClamped = Math.max(0, Math.min(1, startValueRef.current + delta));
            lastUpdateTimestampRef.current = now;
            lastNotifiedValRef.current = finalClamped;
            setHudValue(finalClamped);
            notifyHud(mode, finalClamped, true);
            if (mode === 'brightness' && typeof propsRef.current.setBrightness === 'function') {
              propsRef.current.setBrightness(finalClamped);
            } else if (mode === 'volume' && typeof propsRef.current.setVolume === 'function') {
              propsRef.current.setVolume(finalClamped, { isGesture: false });
            }
            if (__DEV__) {
              console.log(`[FoxPlayer:Gesture] swipeReleased: mode=${mode}, finalVal=${finalClamped.toFixed(2)}`);
            }
          }

          isSwipingRef.current = false;
          hasMovedPastThresholdRef.current = false;
          lastNotifiedValRef.current = null;
          gestureModeRef.current = null;

          if (typeof propsRef.current.onGestureEnd === 'function') {
            propsRef.current.onGestureEnd();
          }

          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          const currentSession = ++gestureSessionRef.current;
          hideTimerRef.current = setTimeout(() => {
            if (gestureSessionRef.current !== currentSession) return;
            Animated.timing(hudOpacityAnim, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }).start(() => {
              if (gestureSessionRef.current === currentSession) {
                hudOpacityAnim.setValue(0);
                setHudVisible(false);
                setHudType(null);
                notifyHud(null, 0.5, false);
              }
            });
          }, 1200);
        } else if (totalMovement < 24 && duration < 500) {
          // Qualified as a TAP
          if (hudVisibleRef.current) {
            if (hideTimerRef.current) {
              clearTimeout(hideTimerRef.current);
              hideTimerRef.current = null;
            }
            const currentSession = ++gestureSessionRef.current;
            Animated.timing(hudOpacityAnim, {
              toValue: 0,
              duration: 150,
              useNativeDriver: true,
            }).start(() => {
              if (gestureSessionRef.current === currentSession) {
                hudOpacityAnim.setValue(0);
                setHudVisible(false);
                setHudType(null);
                notifyHud(null, 0.5, false);
              }
            });
          }
          const { onSingleTap, onDoubleTapLeft, onDoubleTapRight } = propsRef.current;
          if (controlsVisibleRef.current) {
            // When controls are already visible, single tap immediately hides them without delay
            if (singleTapTimerRef.current) {
              clearTimeout(singleTapTimerRef.current);
              singleTapTimerRef.current = null;
            }
            lastTapRef.current = { time: 0, side: null };
            if (typeof onSingleTap === 'function') {
              onSingleTap();
            }
            return;
          }

          // Controls are hidden: evaluate single tap or double-tap
          const width = layoutWidthRef.current || Dimensions.get('window').width || 800;
          const touchX = (typeof touchStartRef.current.locationX === 'number' && touchStartRef.current.locationX >= 0 && touchStartRef.current.locationX <= width)
            ? touchStartRef.current.locationX
            : (touchStartRef.current.pageX - (containerPageXRef.current || 0));
          const side = touchX < width * 0.5 ? 'left' : 'right';

          const hasDoubleTap = !propsRef.current.isMini && (side === 'left' ? typeof onDoubleTapLeft === 'function' : typeof onDoubleTapRight === 'function');

          if (hasDoubleTap) {
            const last = lastTapRef.current;
            if (now - last.time < 300 && last.side === side) {
              // Double Tap detected: seek 10s without revealing controls
              if (singleTapTimerRef.current) {
                clearTimeout(singleTapTimerRef.current);
                singleTapTimerRef.current = null;
              }
              lastTapRef.current = { time: 0, side: null };
              if (side === 'left' && typeof onDoubleTapLeft === 'function') {
                onDoubleTapLeft();
              } else if (side === 'right' && typeof onDoubleTapRight === 'function') {
                onDoubleTapRight();
              }
              return;
            }

            // Record first tap timestamp and arm short 200ms timer to confirm single tap
            lastTapRef.current = { time: now, side };
            if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
            singleTapTimerRef.current = setTimeout(() => {
              lastTapRef.current = { time: 0, side: null };
              if (typeof onSingleTap === 'function') {
                onSingleTap();
              }
            }, 200);
          } else {
            // No double tap configured or mini player -> fire single tap immediately
            if (typeof onSingleTap === 'function') {
              onSingleTap();
            }
          }
        } else {
          // Touch released without qualifying as swipe or tap
          if (hudVisibleRef.current && !hideTimerRef.current) {
            const currentSession = ++gestureSessionRef.current;
            hideTimerRef.current = setTimeout(() => {
              if (gestureSessionRef.current !== currentSession) return;
              Animated.timing(hudOpacityAnim, {
                toValue: 0,
                duration: 250,
                useNativeDriver: true,
              }).start(() => {
                if (gestureSessionRef.current === currentSession) {
                  hudOpacityAnim.setValue(0);
                  setHudVisible(false);
                  setHudType(null);
                  notifyHud(null, 0.5, false);
                }
              });
            }, 1200);
          }
        }
      },

      onPanResponderTerminate: () => {
        if (isSwipingRef.current) {
          isSwipingRef.current = false;
          hasMovedPastThresholdRef.current = false;
          lastNotifiedValRef.current = null;
          gestureModeRef.current = null;
          if (typeof propsRef.current.onGestureEnd === 'function') {
            propsRef.current.onGestureEnd();
          }
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          const currentSession = ++gestureSessionRef.current;
          hideTimerRef.current = setTimeout(() => {
            if (gestureSessionRef.current !== currentSession) return;
            Animated.timing(hudOpacityAnim, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }).start(() => {
              if (gestureSessionRef.current === currentSession) {
                hudOpacityAnim.setValue(0);
                setHudVisible(false);
                setHudType(null);
                notifyHud(null, 0.5, false);
              }
            });
          }, 1200);
        } else if (hudVisibleRef.current && !hideTimerRef.current) {
          const currentSession = ++gestureSessionRef.current;
          hideTimerRef.current = setTimeout(() => {
            if (gestureSessionRef.current !== currentSession) return;
            Animated.timing(hudOpacityAnim, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }).start(() => {
              if (gestureSessionRef.current === currentSession) {
                hudOpacityAnim.setValue(0);
                setHudVisible(false);
                setHudType(null);
                notifyHud(null, 0.5, false);
              }
            });
          }, 1200);
        }
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
      },
    })
  ).current;

  return (
    <View
      ref={containerRef}
      style={[StyleSheet.absoluteFill, styles.overlayRoot]}
      onLayout={handleLayout}
      {...panResponder.panHandlers}
    >
      {/* Children elements (e.g. Seek Feedback HUD) */}
      {children}

      {/* VLC-Style HUD Indicator */}
      {(!controlsVisible || !onHudChange) && (
        <PlayerGestureHUD
          type={hudType}
          value={hudValue}
          visible={hudVisible}
          opacityAnim={hudOpacityAnim}
          insets={insets}
          isMini={isMini}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    zIndex: 10,
    elevation: 5,
  },
});

export const PlayerGestureOverlay = memo(PlayerGestureOverlayComponent);
export default PlayerGestureOverlay;
