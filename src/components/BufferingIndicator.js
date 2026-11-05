import React, { useEffect, useRef, useId, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import Colors from '../constants/colors';

/**
 * Centered Circular Buffering Animation for OTT Video Player.
 *
 * Geometric Centering Architecture (Android & iOS):
 * - The rotating spinner circle is strictly anchored at (width: size, height: size).
 * - Ambient glow ring is concentrically centered at (size / 2, size / 2).
 * - Status label is anchored absolutely below the circle without exerting any upward vertical force or flex displacement.
 * - Smooth 150ms fade-in and 180ms fade-out lifecycle: completely unmounts when video is playing normally.
 * - Result: indicatorCenterX === videoSurfaceCenterX && indicatorCenterY === videoSurfaceCenterY.
 */
export default function BufferingIndicator({
  visible = true,
  size = 50,
  strokeWidth = 3.5,
  isMini = false,
  showLabel = true,
  labelText = 'Buffering...',
  color = Colors.brand.primary,
}) {
  const uniqueId = useId();
  const gradId = `bufferingGrad_${uniqueId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const [shouldRender, setShouldRender] = useState(visible);
  const fadeAnimRef = useRef(null);
  if (!fadeAnimRef.current) {
    fadeAnimRef.current = new Animated.Value(visible ? 1 : 0);
  }

  const spinAnimRef = useRef(null);
  if (!spinAnimRef.current) {
    spinAnimRef.current = new Animated.Value(0);
  }

  const pulseAnimRef = useRef(null);
  if (!pulseAnimRef.current) {
    pulseAnimRef.current = new Animated.Value(0.5);
  }

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const fadeAnimationRef = useRef(null);
  const spinLoopRef = useRef(null);
  const pulseLoopRef = useRef(null);

  // Handle smooth fade-in and fade-out transitions without unmount race conditions
  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      fadeAnimationRef.current?.stop();
      fadeAnimationRef.current = Animated.timing(fadeAnimRef.current, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      });
      fadeAnimationRef.current.start();
    } else {
      fadeAnimationRef.current?.stop();
      fadeAnimationRef.current = Animated.timing(fadeAnimRef.current, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      });
      fadeAnimationRef.current.start(({ finished }) => {
        // Only unmount if visible is still false at the moment fade finishes
        if (finished && !visibleRef.current) {
          setShouldRender(false);
        }
      });
    }

    return () => {
      fadeAnimationRef.current?.stop();
    };
  }, [visible]);

  // Continuous, uninterrupted spin and pulse loops while shouldRender is active
  useEffect(() => {
    if (!shouldRender) {
      if (spinLoopRef.current) {
        spinLoopRef.current.stop();
        spinLoopRef.current = null;
      }
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
      return;
    }

    if (!spinLoopRef.current) {
      spinAnimRef.current.setValue(0);
      spinLoopRef.current = Animated.loop(
        Animated.timing(spinAnimRef.current, {
          toValue: 1,
          duration: 950,
          easing: Easing.linear,
          useNativeDriver: true,
          isInteraction: false,
        }),
        { resetBeforeIteration: true }
      );
      spinLoopRef.current.start();
    }

    if (!pulseLoopRef.current) {
      pulseAnimRef.current.setValue(0.5);
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnimRef.current, { toValue: 0.9, duration: 650, useNativeDriver: true }),
          Animated.timing(pulseAnimRef.current, { toValue: 0.45, duration: 650, useNativeDriver: true }),
        ])
      );
      pulseLoopRef.current.start();
    }

    return () => {
      if (spinLoopRef.current) {
        spinLoopRef.current.stop();
        spinLoopRef.current = null;
      }
      if (pulseLoopRef.current) {
        pulseLoopRef.current.stop();
        pulseLoopRef.current = null;
      }
    };
  }, [shouldRender]);

  if (!shouldRender) return null;

  const spin = spinAnimRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.72; // 72% arc

  const glowSize = Math.round(size * 1.18);
  const glowOffset = Math.round((size - glowSize) / 2);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          opacity: fadeAnimRef.current,
        },
      ]}
      pointerEvents="none"
    >
      {/* Single Unified Clean Rotating SVG Spinner Arc */}
      <Animated.View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: spin }],
        }}
      >
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Defs>
            <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={color} stopOpacity="1" />
              <Stop offset="100%" stopColor={color} stopOpacity="0.18" />
            </LinearGradient>
          </Defs>
          {/* Background Track Circle */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="rgba(255, 255, 255, 0.12)"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Active Rotating Gradient Arc */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={`url(#${gradId})`}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </Animated.View>

      {/* 3. Label positioned directly below spinner without displacing the center */}
      {!isMini && showLabel ? (
        <View style={[styles.labelWrapper, { top: size + 8 }]} pointerEvents="none">
          <Text style={styles.label} numberOfLines={1}>
            {labelText}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowRing: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  labelWrapper: {
    position: 'absolute',
    left: -120,
    right: -120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    color: Colors.text.secondary,
    fontWeight: '600',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
});
