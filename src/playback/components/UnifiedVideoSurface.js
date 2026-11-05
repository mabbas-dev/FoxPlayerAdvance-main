/**
 * FOX PLAYER — Unified Video Surface
 *
 * Renders the video frame surface for either:
 * - Native Engine: VideoView (expo-video / ExoPlayer / AVPlayer)
 * - VLC Engine: VlcPlayerView (rn-vlc-plyr / libVLC)
 *
 * Sits seamlessly beneath the shared overlay, controls, gestures, and HUD.
 * Prevents flicker and surface destruction during orientation and fullscreen changes.
 * Protected by PlayerSurfaceErrorBoundary to prevent native crash propagation.
 */

import React, { memo, useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { VideoView } from 'expo-video';
import { ENGINE_TYPE } from '../playbackTypes.js';
import { probeVlcNativeAvailability } from '../playerSettings.js';
import { PlayerSurfaceErrorBoundary } from './PlayerSurfaceErrorBoundary.js';
import Colors from '../../constants/colors';

// Dynamic safe resolution of VlcPlayerView
let cachedVlcPlayerView = null;
function getVlcPlayerView() {
  if (cachedVlcPlayerView) return cachedVlcPlayerView;
  try {
    const vlcModule = require('rn-vlc-plyr');
    if (vlcModule?.VlcPlayerView) {
      cachedVlcPlayerView = vlcModule.VlcPlayerView;
      return cachedVlcPlayerView;
    }
  } catch (_e) {}
  return null;
}

function UnifiedVideoSurfaceComponent({
  activeEngineType = ENGINE_TYPE.NATIVE,
  nativePlayer = null,
  vlcPlayer = null,
  contentFit = 'contain',
  isMini = false,
  style = null,
  isSwitching = false,
  allowsPictureInPicture = false,
  surfaceType = 'surfaceView',
  onSurfaceError = null,
  onRecoverToNative = null,
  onFirstFrameRender = null,
}) {
  const vlcProbe = useMemo(() => probeVlcNativeAvailability(), []);
  const ResolvedVlcView = useMemo(() => getVlcPlayerView(), []);

  // Map standard contentFit ('contain' | 'cover' | 'fill') to VLC resizeMode ('contain' | 'cover' | 'stretch')
  const vlcResizeMode = useMemo(() => {
    if (contentFit === 'fill') return 'stretch';
    if (contentFit === 'cover') return 'cover';
    return 'contain';
  }, [contentFit]);

  const nativeVideoViewProps = useMemo(() => {
    return {
      contentFit,
      nativeControls: false,
      pointerEvents: 'none',
      fullscreenOptions: { enable: !isMini },
      allowsPictureInPicture,
      ...(Platform.OS === 'android'
        ? {
            surfaceType: surfaceType || 'surfaceView',
            useExoShutter: false,
          }
        : {}),
    };
  }, [contentFit, isMini, allowsPictureInPicture, surfaceType]);

  // Track previous engine for seamless zero-flicker transition
  const previousEngineRef = useRef(activeEngineType);
  useEffect(() => {
    if (!isSwitching) {
      previousEngineRef.current = activeEngineType;
    }
  }, [activeEngineType, isSwitching]);

  const isVlcAvailable = Boolean(vlcProbe.available && vlcPlayer && ResolvedVlcView);

  const shouldRenderNative = (activeEngineType === ENGINE_TYPE.NATIVE && nativePlayer) ||
    (!isVlcAvailable && nativePlayer) ||
    (isSwitching && previousEngineRef.current === ENGINE_TYPE.NATIVE && nativePlayer);

  const shouldRenderVlc = (activeEngineType === ENGINE_TYPE.VLC && isVlcAvailable) ||
    (isSwitching && previousEngineRef.current === ENGINE_TYPE.VLC && isVlcAvailable);

  const isNativeOnTop = activeEngineType === ENGINE_TYPE.NATIVE;

  return (
    <PlayerSurfaceErrorBoundary
      onError={(err) => {
        if (typeof onSurfaceError === 'function') {
          onSurfaceError(err);
        }
      }}
      onRecover={() => {
        if (typeof onRecoverToNative === 'function') {
          onRecoverToNative();
        }
      }}
    >
      <View style={[styles.container, style]} pointerEvents="box-none">
        {/* Layer A (Underneath): Frozen frame of previous engine during transition */}
        {!isNativeOnTop && shouldRenderNative && isSwitching && (
          <VideoView
            key="native-video-surface-underneath"
            style={StyleSheet.absoluteFill}
            player={nativePlayer}
            onFirstFrameRender={onFirstFrameRender}
            {...nativeVideoViewProps}
          />
        )}
        {isNativeOnTop && shouldRenderVlc && isSwitching && ResolvedVlcView && (
          React.createElement(ResolvedVlcView, {
            key: 'vlc-video-surface-underneath',
            style: StyleSheet.absoluteFill,
            player: vlcPlayer,
            resizeMode: vlcResizeMode,
            surfaceType: Platform.OS === 'android' ? 'texture' : undefined,
          })
        )}

        {/* Layer B (Top): Active incoming engine surface */}
        {isNativeOnTop && shouldRenderNative && (
          <VideoView
            key="native-video-surface"
            style={StyleSheet.absoluteFill}
            player={nativePlayer}
            onFirstFrameRender={onFirstFrameRender}
            {...nativeVideoViewProps}
          />
        )}
        {!isNativeOnTop && shouldRenderVlc && ResolvedVlcView && (
          React.createElement(ResolvedVlcView, {
            key: 'vlc-video-surface',
            style: StyleSheet.absoluteFill,
            player: vlcPlayer,
            resizeMode: vlcResizeMode,
            surfaceType: Platform.OS === 'android' ? 'texture' : undefined,
          })
        )}
      </View>
    </PlayerSurfaceErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  placeholder: {
    backgroundColor: '#0A0A0C',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  placeholderTitle: {
    color: '#FFB800',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  placeholderSubtitle: {
    color: '#8A92A6',
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: 16,
  },
  switchNativeBtn: {
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  switchNativeBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

export const UnifiedVideoSurface = memo(UnifiedVideoSurfaceComponent);
export default UnifiedVideoSurface;
