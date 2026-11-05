import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import Colors from '../constants/colors';

const THUMB_RADIUS = 7;
const THUMB_SIZE = THUMB_RADIUS * 2; // 14px

function formatTime(secs, forceHours = false) {
  if (!secs || isNaN(secs) || secs < 0 || !isFinite(secs)) {
    return forceHours ? '0:00:00' : '00:00';
  }
  const total = Math.floor(secs);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60 || forceHours) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}:${String(remM).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * High-Performance OTT/IPTV Player Seekbar with Exact Finger Tracking.
 *
 * Edge & Boundary Glitch Fixes:
 * 1. Hardware Screen Coordinates: Prioritizes gestureState.moveX (MotionEvent.getRawX)
 *    so finger dragging never freezes or jumps when crossing view boundaries into durationText.
 * 2. Pointer Events Guard: Adds pointerEvents="none" to timeText & durationText so sibling
 *    labels cannot steal or corrupt touch events at the ends of the track.
 * 3. Horizontal HitSlop: Extends left & right hitSlop by 12px so fingers reaching the end
 *    maintain seamless responder ownership without edge clipping.
 * 4. Layout Width Stabilization: Fixed minWidth (58px) and consistent hours format for >= 1hr media
 *    so time label length never jumps mid-scrub, preventing track layout shifts.
 * 5. OS Edge Termination Handling: If Android edge gesture terminates pan near screen edge,
 *    onPanResponderTerminate commits the seek instead of aborting and jumping back.
 * 6. Smooth Progress Animation: Glides smoothly between 250ms ticks via linear interpolation
 *    instead of jumping in discrete steps, with immediate snapping on seek/skip.
 */
function PlayerSeekBarComponent({
  currentTime = 0,
  duration = 0,
  onSeek,
  onSeekingChange,
  isLive = false,
  disabled = false,
}) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const isDraggingRef = useRef(false);
  const currentProgressRef = useRef(0);
  const trackViewRef = useRef(null);
  const trackBoundsRef = useRef({ pageX: 0, width: 1 });
  const rafIdRef = useRef(null);
  const lastReportedSecRef = useRef(-1);

  // Animated progress value (0 to 1) for 60fps native-speed scrubbing
  const progressAnim = useRef(new Animated.Value(0)).current;

  const hasValidDuration = duration > 0 && !isNaN(duration) && isFinite(duration) && !isLive && !disabled;
  const hasHours = duration >= 3600;

  // Mutable props ref ensures PanResponder callbacks ALWAYS access fresh props/duration
  // even if created on mount when duration was 0
  const propsRef = useRef({
    duration,
    hasValidDuration,
    onSeek,
    onSeekingChange,
  });

  propsRef.current = {
    duration,
    hasValidDuration,
    onSeek,
    onSeekingChange,
  };

  // Measure track's absolute window position and width
  const measureTrackBounds = useCallback(() => {
    if (trackViewRef.current?.measureInWindow) {
      trackViewRef.current.measureInWindow((x, y, w, _h) => {
        if (w > 0 && typeof x === 'number') {
          trackBoundsRef.current = { pageX: x, width: w };
        }
      });
    }
  }, []);

  // Update track width on container layout and window dimension changes
  const handleTrackLayout = useCallback((e) => {
    const layoutWidth = e.nativeEvent?.layout?.width;
    if (layoutWidth > 0) {
      trackBoundsRef.current.width = layoutWidth;
    }
    measureTrackBounds();
  }, [measureTrackBounds]);

  useEffect(() => {
    measureTrackBounds();
  }, [windowWidth, windowHeight, measureTrackBounds]);

  const recentSeekRef = useRef(null);

  // Synchronize playback position into progressAnim smoothly when NOT scrubbing
  useEffect(() => {
    if (!isDraggingRef.current && hasValidDuration) {
      if (recentSeekRef.current) {
        const { targetTime, timestamp } = recentSeekRef.current;
        const elapsed = Date.now() - timestamp;
        if (elapsed < 1200 && Math.abs((currentTime || 0) - targetTime) > 3.0) {
          return;
        }
        recentSeekRef.current = null;
      }
      const safeTime = Math.max(0, Math.min(duration, currentTime || 0));
      const targetRatio = duration > 0 ? safeTime / duration : 0;
      currentProgressRef.current = targetRatio;
      progressAnim.setValue(targetRatio);
    }
  }, [currentTime, duration, hasValidDuration, progressAnim]);

  // Calculate normalized progress (0 to 1) from gesture state
  // Prioritizes gestureState.moveX (raw device screen coordinate) so dragging
  // across the edge never clamps or glitches.
  const calculateProgress = useCallback((evt, gestureState) => {
    const trackWidth = trackBoundsRef.current.width > 0 ? trackBoundsRef.current.width : 1;

    let screenX = null;
    if (gestureState?.moveX != null && typeof gestureState.moveX === 'number' && gestureState.moveX > 0) {
      screenX = gestureState.moveX;
    } else if (evt?.nativeEvent?.pageX != null && typeof evt.nativeEvent.pageX === 'number') {
      screenX = evt.nativeEvent.pageX;
    } else if (gestureState?.x0 != null && typeof gestureState.x0 === 'number' && gestureState.x0 > 0) {
      screenX = gestureState.x0;
    }

    if (screenX === null) {
      return currentProgressRef.current;
    }

    const trackLeft = trackBoundsRef.current.pageX;
    const localX = screenX - trackLeft;
    return Math.max(0, Math.min(1, localX / trackWidth));
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      // Dynamically query propsRef so seekbar unblocks immediately as soon as duration arrives
      onStartShouldSetPanResponder: () => Boolean(propsRef.current.hasValidDuration),
      onStartShouldSetPanResponderCapture: () => Boolean(propsRef.current.hasValidDuration),
      onMoveShouldSetPanResponder: () => Boolean(propsRef.current.hasValidDuration),
      onMoveShouldSetPanResponderCapture: () => Boolean(propsRef.current.hasValidDuration),
      onPanResponderTerminationRequest: () => false, // Do not let parent gesture steal seekbar touch

      onPanResponderGrant: (evt, gestureState) => {
        const { hasValidDuration: canSeek, duration: curDuration, onSeekingChange: notifySeeking } = propsRef.current;
        if (!canSeek) return;

        measureTrackBounds();

        const screenX = (gestureState?.x0 != null && gestureState.x0 > 0)
          ? gestureState.x0
          : evt?.nativeEvent?.pageX;
        const locationX = evt?.nativeEvent?.locationX;

        if (typeof screenX === 'number' && typeof locationX === 'number' && locationX >= 0) {
          trackBoundsRef.current.pageX = screenX - locationX;
        }

        isDraggingRef.current = true;
        setIsScrubbing(true);
        notifySeeking?.(true);

        const initialRatio = calculateProgress(evt, gestureState);
        currentProgressRef.current = initialRatio;
        progressAnim.setValue(initialRatio);

        const initialSec = Math.round(initialRatio * curDuration);
        lastReportedSecRef.current = initialSec;
        setScrubTime(initialSec);
      },

      onPanResponderMove: (evt, gestureState) => {
        const { hasValidDuration: canSeek, duration: curDuration } = propsRef.current;
        if (!canSeek || !isDraggingRef.current) return;

        const ratio = calculateProgress(evt, gestureState);
        currentProgressRef.current = ratio;

        // 60 FPS instant visual thumb & track fill update (NO component rerender)
        progressAnim.setValue(ratio);

        // Preview time throttled via requestAnimationFrame only when seconds change
        const currentSec = Math.round(ratio * curDuration);
        if (currentSec !== lastReportedSecRef.current) {
          lastReportedSecRef.current = currentSec;
          if (!rafIdRef.current) {
            rafIdRef.current = requestAnimationFrame(() => {
              rafIdRef.current = null;
              setScrubTime(currentSec);
            });
          }
        }
      },

      onPanResponderRelease: (evt, gestureState) => {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const { hasValidDuration: canSeek, duration: curDuration, onSeek: doSeek, onSeekingChange: notifySeeking } = propsRef.current;
        if (!canSeek) {
          isDraggingRef.current = false;
          setIsScrubbing(false);
          notifySeeking?.(false);
          return;
        }

        const finalRatio = calculateProgress(evt, gestureState);
        currentProgressRef.current = finalRatio;
        progressAnim.setValue(finalRatio);

        const finalTime = Math.max(0, Math.min(curDuration, finalRatio * curDuration));
        // eslint-disable-next-line react-hooks/purity
        recentSeekRef.current = { targetTime: finalTime, timestamp: Date.now() };

        // Perform the player seek strictly ONCE on touch release
        doSeek?.(finalTime);

        // Keep dragging flag for a brief moment to allow video player to seek without jumping
        setTimeout(() => {
          isDraggingRef.current = false;
          setIsScrubbing(false);
          notifySeeking?.(false);
        }, 200);
      },

      onPanResponderTerminate: (evt, gestureState) => {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        // If Android OS edge gesture cancels pan near right screen edge, smoothly commit seek!
        const { hasValidDuration: canSeek, duration: curDuration, onSeek: doSeek, onSeekingChange: notifySeeking } = propsRef.current;
        if (isDraggingRef.current && canSeek) {
          const finalRatio = calculateProgress(evt, gestureState);
          currentProgressRef.current = finalRatio;
          progressAnim.setValue(finalRatio);
          const finalTime = Math.max(0, Math.min(curDuration, finalRatio * curDuration));
          // eslint-disable-next-line react-hooks/purity
          recentSeekRef.current = { targetTime: finalTime, timestamp: Date.now() };
          doSeek?.(finalTime);
        }

        setTimeout(() => {
          isDraggingRef.current = false;
          setIsScrubbing(false);
          notifySeeking?.(false);
        }, 200);
      },
    })
  ).current;

  if (isLive) {
    return null;
  }

  // Interpolated animated fill width and thumb left
  const fillWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const thumbLeft = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const safeDuration = duration > 0 ? duration : 0;
  const displayTime = isScrubbing
    ? Math.max(0, Math.min(safeDuration, scrubTime))
    : Math.max(0, Math.min(safeDuration, currentTime || 0));

  return (
    <View style={styles.container}>
      {/* Current Time Display */}
      <Text
        style={[styles.timeText, hasHours && styles.timeTextHours]}
        numberOfLines={1}
        pointerEvents="none"
      >
        {formatTime(displayTime, hasHours)}
      </Text>

      {/* Interactive Seek Track Area */}
      <View
        ref={trackViewRef}
        style={styles.touchArea}
        onLayout={handleTrackLayout}
        hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
        {...panResponder.panHandlers}
      >
        {/* Track Groove with pointerEvents="none" so touches directly target touchArea */}
        <View style={styles.trackBackground} pointerEvents="none">
          <Animated.View style={[styles.trackFill, { width: fillWidth }]} />
        </View>

        {/* Centered Finger-Tracking Scrubber Thumb */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scrubberThumb,
            { left: thumbLeft },
            isScrubbing && styles.scrubberThumbActive,
          ]}
        />
      </View>

      {/* Total Duration Display */}
      <Text
        style={[styles.timeText, styles.durationText, hasHours && styles.timeTextHours]}
        numberOfLines={1}
        pointerEvents="none"
      >
        {formatTime(duration, hasHours)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    minWidth: 44,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  timeTextHours: {
    minWidth: 58,
  },
  durationText: {
    textAlign: 'right',
    color: Colors.text.tertiary,
  },
  touchArea: {
    flex: 1,
    height: 38,
    justifyContent: 'center',
    position: 'relative',
  },
  trackBackground: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  trackFill: {
    height: '100%',
    backgroundColor: Colors.brand.primary,
    borderRadius: 3,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 12,
    marginLeft: -THUMB_RADIUS,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS,
    backgroundColor: '#FFFFFF',
    borderWidth: 2.5,
    borderColor: Colors.brand.primary,
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
    elevation: 5,
  },
  scrubberThumbActive: {
    transform: [{ scale: 1.35 }],
    backgroundColor: Colors.brand.primary,
    borderColor: '#FFFFFF',
    shadowOpacity: 0.65,
    shadowRadius: 6,
  },
  liveTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 10,
    paddingVertical: 4,
  },
  liveIndicatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    gap: 6,
  },
  liveRedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 0.8,
  },
  liveStreamNotice: {
    fontSize: 12,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },
});

export const PlayerSeekBar = memo(PlayerSeekBarComponent);
export default PlayerSeekBar;
