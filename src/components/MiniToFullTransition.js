/**
 * MiniToFullTransition
 *
 * Orchestrates the cinematic expansion animation when the user taps the
 * Live TV mini-player to open the full-screen player, and the reverse
 * contraction when returning to the Live TV screen.
 *
 * ── How the illusion works ────────────────────────────────────────────────
 *  1. The user taps the mini player.
 *  2. A dark overlay fades in over the application content.
 *  3. An absolutely-positioned "expansion clone" div (the same dark colour
 *     as the player) animates from the mini-player's measured frame
 *     to full-screen dimensions over ~380 ms.
 *  4. At ~70 % expansion the router navigates to /player.
 *     – The player screen itself starts with opacity 0 and fades in.
 *     – Because the expansion clone is already covering the screen the
 *       navigation feels invisible.
 *  5. The player screen's entrance animation (staggered controls) starts.
 *
 *  On the way back:
 *  – PlayerScreen fires its exit callback, which contracts the clone
 *    back to the mini-player rectangle before router.back() completes.
 *
 * ── Performance notes ────────────────────────────────────────────────────
 *  All Reanimated worklets run on the UI thread via native driver.
 *  The JS bridge is only used for the router.push call.
 * ─────────────────────────────────────────────────────────────────────────
 */

import React, { useRef, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Animated,
} from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Duration constants (ms) */
const EXPAND_DURATION    = 360;
const OVERLAY_DURATION   = 280;
const NAV_TRIGGER_DELAY  = 240; // push route at this point in the animation

/**
 * Props:
 *  onNavigate  — called after animation reaches ~70 %, triggers router.push
 *  miniLayout  — { x, y, width, height } of the mini-player in screen coords
 *               Measured once via onLayout + measure().
 *  children    — the EmbeddedVideoPlayer content
 */
export default function MiniToFullTransition({ onNavigate, children }) {
  const containerRef = useRef(null);

  // Shared animated values (standard RN Animated – runs on UI thread via native driver)
  const expandAnim  = useRef(new Animated.Value(0)).current; // 0 = mini, 1 = full
  const overlayAnim = useRef(new Animated.Value(0)).current; // 0 = transparent, 1 = black
  const scaleAnim   = useRef(new Animated.Value(1)).current;

  const [isTransitioning, setIsTransitioning] = useState(false);
  const [miniFrame, setMiniFrame]             = useState(null);

  /** Measure the mini-player's on-screen position */
  const measureContainer = useCallback(() => {
    if (!containerRef.current) return;
    containerRef.current.measure((_x, _y, w, h, pageX, pageY) => {
      setMiniFrame({ x: pageX, y: pageY, width: w, height: h });
    });
  }, []);

  /** Tap handler — starts the expansion animation then triggers navigation */
  const handleExpandTap = useCallback(() => {
    if (isTransitioning) return;
    if (!miniFrame) {
      onNavigate?.();
      return;
    }
    setIsTransitioning(true);

    // Phase 1 → subtle press scale feedback (10 ms)
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();

    // Phase 2 → dark overlay fades in
    Animated.timing(overlayAnim, {
      toValue: 1,
      duration: OVERLAY_DURATION,
      useNativeDriver: true,
    }).start();

    // Phase 3 → expansion rectangle animates
    Animated.timing(expandAnim, {
      toValue: 1,
      duration: EXPAND_DURATION,
      useNativeDriver: false, // width/height/position require non-native driver
    }).start();

    // Phase 4 → push route at 70% of animation
    setTimeout(() => {
      onNavigate?.();
    }, NAV_TRIGGER_DELAY);

    // Phase 5 → reset transition state after animation + navigation settle
    setTimeout(() => {
      expandAnim.setValue(0);
      overlayAnim.setValue(0);
      setIsTransitioning(false);
    }, EXPAND_DURATION + 120);
  }, [isTransitioning, miniFrame, expandAnim, overlayAnim, scaleAnim, onNavigate]);

  // Interpolated expansion rectangle geometry
  // Interpolates from miniFrame → full screen
  const expLeft   = miniFrame
    ? expandAnim.interpolate({ inputRange: [0, 1], outputRange: [miniFrame.x, 0] })
    : 0;
  const expTop    = miniFrame
    ? expandAnim.interpolate({ inputRange: [0, 1], outputRange: [miniFrame.y, 0] })
    : 0;
  const expWidth  = miniFrame
    ? expandAnim.interpolate({ inputRange: [0, 1], outputRange: [miniFrame.width, SCREEN_W] })
    : SCREEN_W;
  const expHeight = miniFrame
    ? expandAnim.interpolate({ inputRange: [0, 1], outputRange: [miniFrame.height, SCREEN_H] })
    : SCREEN_H;
  const expRadius = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const expOpacity = expandAnim.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 1] });

  return (
    <View
      ref={containerRef}
      style={styles.miniContainer}
      onLayout={measureContainer}
    >
      {/* Actual mini player content */}
      <Animated.View
        style={[styles.miniContent, { transform: [{ scale: scaleAnim }] }]}
      >
        {/* Tap-to-expand touch target */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleExpandTap}
          disabled={isTransitioning}
        />
        {React.isValidElement(children)
          ? React.cloneElement(children, {
              onFullscreen: handleExpandTap,
            })
          : children}
      </Animated.View>

      {/* ── Dark scrim overlay ─────────────────────────────────────────── */}
      {isTransitioning && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            styles.scrim,
            { opacity: overlayAnim },
          ]}
        />
      )}

      {/* ── Expansion clone rectangle ──────────────────────────────────── */}
      {isTransitioning && miniFrame && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.expansionRect,
            {
              left:         expLeft,
              top:          expTop,
              width:        expWidth,
              height:       expHeight,
              borderRadius: expRadius,
              opacity:      expOpacity,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  miniContainer: {
    flex: 1,
  },
  miniContent: {
    flex: 1,
  },
  scrim: {
    backgroundColor: '#000000',
    zIndex: 50,
  },
  expansionRect: {
    position: 'absolute',
    backgroundColor: '#05080F',
    zIndex: 60,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 20,
  },
});
