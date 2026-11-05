import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import Colors from '../constants/colors';

/**
 * Universal High-Performance OTT Streaming Progress Bar
 *
 * Supports two distinct modes:
 * 1. Determinate Mode (when progress > 0):
 *    - Smoothly animates width from 5% to 100% based on reported progress.
 *    - Always keeps a minimum visible pip and leading edge glow.
 *
 * 2. Indeterminate Mode (when progress <= 0 or indeterminate === true):
 *    - Continuous, silky smooth sweeping luminous beam across the track (0% to 55%).
 *    - Stays 100% within track bounds and never disappears.
 */
export default function ProgressBar({
  progress = 0,
  indeterminate = false,
  height = 8,
  trackColor = 'rgba(255, 255, 255, 0.12)',
  fillColor = Colors.brand.primary,
  borderRadius = 4,
  style,
}) {
  // Normalize progress (handle both 0-1 and 0-100 formats)
  const numProgress = Number(progress);
  const normalizedProgress = isNaN(numProgress)
    ? 0
    : numProgress > 1
    ? numProgress / 100
    : numProgress;

  const isIndeterminate = indeterminate || normalizedProgress <= 0;
  const clampedProgress = Math.max(0, Math.min(1, normalizedProgress));

  // Determinate progress animation
  const determinateAnim = useRef(new Animated.Value(0)).current;

  // Indeterminate sweep animation
  const indeterminateAnim = useRef(new Animated.Value(0)).current;

  // Determinate progress updates
  useEffect(() => {
    if (!isIndeterminate) {
      Animated.timing(determinateAnim, {
        toValue: Math.max(0.05, clampedProgress),
        duration: 350,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    } else {
      determinateAnim.setValue(0);
    }
  }, [clampedProgress, isIndeterminate, determinateAnim]);

  // Indeterminate looping sweep
  const indeterminateLoop = useRef(null);
  useEffect(() => {
    if (isIndeterminate) {
      indeterminateAnim.setValue(0);
      indeterminateLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(indeterminateAnim, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(indeterminateAnim, {
            toValue: 0,
            duration: 1100,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ])
      );
      indeterminateLoop.current.start();
    }
    return () => {
      indeterminateLoop.current?.stop();
    };
  }, [isIndeterminate, indeterminateAnim]);

  // Indeterminate left interpolation (moves smoothly from 0% to 55%)
  const indeterminateLeft = indeterminateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '55%'],
  });

  // Determinate width interpolation (from 5% to 100%)
  const determinateWidth = determinateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['5%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[
        styles.track,
        {
          height,
          backgroundColor: trackColor,
          borderRadius,
        },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: isIndeterminate ? undefined : Math.round(clampedProgress * 100),
      }}
    >
      {/* Ambient Baseline Track Glow */}
      <View
        style={[
          styles.ambientGlow,
          {
            height,
            borderRadius,
            backgroundColor: fillColor,
          },
        ]}
      />

      {isIndeterminate ? (
        /* Indeterminate Sweeping Luminous Beam (width 45%, moving left: 0% -> 55%) */
        <Animated.View
          style={[
            styles.indeterminatePill,
            {
              left: indeterminateLeft,
              height,
              borderRadius,
              backgroundColor: fillColor,
            },
          ]}
        >
          <View
            style={[
              styles.leadingPip,
              {
                height,
                width: Math.max(4, height),
                borderRadius: height / 2,
              },
            ]}
          />
        </Animated.View>
      ) : (
        /* Determinate Progress Fill with Leading Edge Glow Pip */
        <Animated.View
          style={[
            styles.determinateFill,
            {
              width: determinateWidth,
              height,
              borderRadius,
              backgroundColor: fillColor,
            },
          ]}
        >
          <View
            style={[
              styles.leadingPip,
              {
                height,
                width: Math.max(4, height),
                borderRadius: height / 2,
              },
            ]}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    minWidth: 200,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  ambientGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.22,
  },
  determinateFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  leadingPip: {
    backgroundColor: '#FFFFFF',
    opacity: 0.95,
  },
  indeterminatePill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '45%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    opacity: 0.95,
  },
});

