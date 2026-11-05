import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function VideoShimmerOverlay({
  visible = true,
}) {
  // Keep Animated.Value objects in stable refs — mutated only in effects
  const shimmerAnimRef = useRef(new Animated.Value(0));
  const pulseAnimRef   = useRef(new Animated.Value(0.12));
  const fadeAnimRef    = useRef(new Animated.Value(visible ? 1 : 0));
  const animLoop   = useRef(null);
  const pulseLoop  = useRef(null);

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnimRef.current, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      animLoop.current = Animated.loop(
        Animated.timing(shimmerAnimRef.current, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        })
      );
      animLoop.current.start();

      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnimRef.current, { toValue: 0.25, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnimRef.current, { toValue: 0.08, duration: 900, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      Animated.timing(fadeAnimRef.current, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      animLoop.current?.stop();
      pulseLoop.current?.stop();
    }

    return () => {
      animLoop.current?.stop();
      pulseLoop.current?.stop();
    };
  }, [visible]);

  if (!visible) return null;

  const sweepDistance = Math.max(SCREEN_WIDTH, 800) * 1.5;
  const translateX = shimmerAnimRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [-sweepDistance, sweepDistance],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.overlay, { opacity: fadeAnimRef.current }]}
    >
      {/* Dark Ambient Base Layer */}
      <Animated.View style={[styles.ambientBackdrop, { opacity: pulseAnimRef.current }]} />

      {/* Full-width Diagonal Shimmer Sweep */}
      <View style={styles.sweepContainer}>
        <Animated.View
          style={[
            styles.shimmerBand,
            { transform: [{ translateX }, { rotate: '25deg' }] },
          ]}
        />
      </View>

      {/* Subtle Center Pulsing Ring */}
      <View style={styles.centerGlow}>
        <Animated.View
          style={[
            styles.centerGlowRing,
            {
              opacity: pulseAnimRef.current,
              transform: [{ scale: pulseAnimRef.current.interpolate({ inputRange: [0.08, 0.25], outputRange: [0.9, 1.1] }) }],
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 8, 15, 0.72)',
    overflow: 'hidden',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ambientBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1E293B',
  },
  sweepContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  shimmerBand: {
    width: 260,
    height: '240%',
    position: 'absolute',
    top: '-70%',
    left: '30%',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 80,
  },
  centerGlow: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerGlowRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: 'rgba(249, 115, 22, 0.5)',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
  },
});
