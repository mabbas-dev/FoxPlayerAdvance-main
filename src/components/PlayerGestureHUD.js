import React, { useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import {
  VolumeHighIcon,
  VolumeMediumIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
  SunIcon,
  SunLowIcon,
} from './Icons';
import { measureAndLogLayout } from '../utils/layoutDiagnostics';

/**
 * VLC-Style Video Player On-Screen Gesture HUD Indicator
 *
 * Requirements:
 * 1. Minimalist black translucent background with subtle border and rounded corners.
 * 2. Independent indicators for Brightness (Left) and Volume (Right).
 * 3. Dynamic icons matching the active percentage value.
 * 4. Elegant vertical progress bar filled from bottom to top.
 * 5. Clean percentage readout typography.
 * 6. Smooth native driver fade & scale animations.
 * 7. Non-blocking (pointerEvents="none").
 */
export default function PlayerGestureHUD({
  type = null, // 'volume' | 'brightness' | null
  value = 0.5, // 0.0 to 1.0
  visible = false,
  opacityAnim = null,
  insets = { top: 0, bottom: 0, left: 0, right: 0 },
  isMini = false,
}) {
  const hudRef = useRef(null);

  if (!type || !visible || isMini) return null;

  const percentage = Math.max(0, Math.min(100, Math.round((typeof value === 'number' && !isNaN(value) ? value : 0) * 100)));
  const isBrightness = type === 'brightness';
  const isVolume = type === 'volume';

  // Position on appropriate side respecting safe area insets
  const leftPosition = isBrightness ? Math.max((insets?.left || 0) + 24, 28) : undefined;
  const rightPosition = isVolume ? Math.max((insets?.right || 0) + 24, 28) : undefined;

  // Accent theme
  const accentColor = isBrightness ? '#F59E0B' : (percentage === 0 ? '#EF4444' : '#38BDF8');

  // Dynamic Icon Selection
  let RenderIcon = null;
  if (isBrightness) {
    RenderIcon = percentage <= 35 ? SunLowIcon : SunIcon;
  } else {
    if (percentage === 0) {
      RenderIcon = VolumeMuteIcon;
    } else if (percentage <= 33) {
      RenderIcon = VolumeLowIcon;
    } else if (percentage <= 66) {
      RenderIcon = VolumeMediumIcon;
    } else {
      RenderIcon = VolumeHighIcon;
    }
  }

  const animStyle = opacityAnim ? {
    opacity: opacityAnim.interpolate ? opacityAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    }) : opacityAnim,
    transform: [
      {
        scale: opacityAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.85, 1],
          extrapolate: 'clamp',
        }),
      },
    ],
  } : { opacity: 1 };

  return (
    <Animated.View
      ref={hudRef}
      pointerEvents="none"
      style={[
        styles.hudContainer,
        leftPosition !== undefined && { left: leftPosition },
        rightPosition !== undefined && { right: rightPosition },
        animStyle,
      ]}
      accessibilityLabel={`${isBrightness ? 'Brightness' : 'Volume'} ${percentage} percent`}
      onLayout={(e) => {
        const layout = e.nativeEvent.layout;
        measureAndLogLayout('PlayerGestureHUD:hudContainer', hudRef, layout, insets, { type, isMini, percentage });
      }}
    >
      {/* Top Icon */}
      <View style={styles.iconWrapper}>
        <RenderIcon size={22} color={accentColor} />
      </View>

      {/* Vertical Progress Meter */}
      <View style={styles.meterTrack}>
        <View
          style={[
            styles.meterFill,
            {
              height: `${percentage}%`,
              backgroundColor: accentColor,
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hudContainer: {
    position: 'absolute',
    top: '50%',
    marginTop: -75,
    width: 46,
    height: 150,
    borderRadius: 23,
    backgroundColor: 'rgba(12, 16, 24, 0.88)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
    elevation: 20,
    zIndex: 90,
  },
  iconWrapper: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meterTrack: {
    width: 6,
    flex: 1,
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  meterFill: {
    width: '100%',
    borderRadius: 3,
  },
});
