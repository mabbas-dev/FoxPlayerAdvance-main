import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Colors from '../constants/colors';
import { BrokenVideoIcon, WarningToastIcon } from './Icons';

/**
 * FOX PLAYER — iOS Movies & Series Playback Error Screen
 *
 * Integrated error interface centered in the video viewport.
 * Unconditionally renders:
 * 1. The Video Break SVG illustration.
 * 2. Clear error heading ("Unable to Play Video").
 * 3. Concise, readable user-facing error message (displaying exact error).
 * 3.5 Specific technical error code badge.
 * 4. Greyish warning box explaining why the error occurred.
 * 5. Subtle Retry action when playback is recoverable.
 *
 * Designed with a clean, dark OTT aesthetic without loud colors or excessive glows.
 * Fully responsive for portrait, landscape fullscreen, and mini-player layouts.
 */
export default function BrokenVideoView({
  title = 'Unable to Play Video',
  heading = 'Unable to Play Video',
  errorMessage = 'Something went wrong while playing this video.',
  message = 'Something went wrong while playing this video.',
  exactError,
  errorCode,
  explanation = 'This video may be temporarily unavailable. Please try again.',
  secondaryMessage = 'This video may be temporarily unavailable. Please try again.',
  onRetry,
  onBack,
  onSwitchEngine = null,
  switchEngineLabel = null,
  canRetry = true,
  isMini = false,
  style,
  insets,
}) {
  const displayHeading = heading || title || 'Unable to Play Video';
  const displayMessage = exactError || message || errorMessage || 'Something went wrong while playing this video.';
  const displayExplanation = explanation || secondaryMessage || 'This video may be temporarily unavailable. Please try again.';
  const displayErrorCode = errorCode || null;
  const showRetry = Boolean(onRetry && canRetry !== false);

  const lowerMsg = (
    (displayMessage || '') + ' ' +
    (displayErrorCode || '') + ' ' +
    (exactError || '') + ' ' +
    (errorMessage || '')
  ).toLowerCase();

  let warningTitle = 'Notice';
  let warningReason = displayExplanation;

  const isVodContent = lowerMsg.includes('movie') || lowerMsg.includes('series') || lowerMsg.includes('vod') || lowerMsg.includes('.mp4') || lowerMsg.includes('.mkv') || lowerMsg.includes('episode');

  if (
    lowerMsg.includes('mpeg-ts') ||
    lowerMsg.includes('hls') ||
    (!isVodContent && (lowerMsg.includes('11850') || lowerMsg.includes('12939')))
  ) {
    warningTitle = 'Format Incompatibility';
    warningReason = 'Apple iOS native player requires HLS (.m3u8) streams. Raw MPEG-TS (.ts) streams from this provider cannot be played directly on Apple devices.';
  } else if (
    isVodContent && (lowerMsg.includes('11850') || lowerMsg.includes('byte range') || lowerMsg.includes('12939') || lowerMsg.includes('mkv') || lowerMsg.includes('11828'))
  ) {
    let isVlcAvailable = false;
    try {
      const { probeVlcNativeAvailability } = require('../playback/playerSettings.js');
      isVlcAvailable = Boolean(probeVlcNativeAvailability?.().available);
    } catch (_e) {
      isVlcAvailable = false;
    }

    if (!isVlcAvailable && (lowerMsg.includes('mkv') || lowerMsg.includes('11828'))) {
      warningTitle = 'VLC Engine Required (Expo Go)';
      warningReason = 'Apple iOS AVPlayer cannot decode .mkv container files. In Expo Go, native VLC is disabled. To play MKV movies and series, run a custom development build (npx expo run:ios or EAS Build) which activates the integrated VLC player engine.';
    } else if (isVlcAvailable && (lowerMsg.includes('mkv') || lowerMsg.includes('11828'))) {
      warningTitle = 'MKV Container Playback';
      warningReason = 'Apple iOS native player cannot decode this MKV file. Use the button below to switch to the integrated VLC engine.';
    } else {
      warningTitle = 'VOD Playback Limitation';
      warningReason = 'Apple iOS native player requires progressive MP4 files with HTTP Byte-Range support or HLS (.m3u8). MKV containers or servers without byte-range seeking cannot be played directly on Apple devices.';
    }
  } else if (
    lowerMsg.includes('format') ||
    lowerMsg.includes('codec') ||
    lowerMsg.includes('11828') ||
    lowerMsg.includes('12909')
  ) {
    warningTitle = 'Format Incompatibility';
    warningReason = 'Apple iOS native player cannot decode this container format or video codec profile.';
  } else if (
    lowerMsg.includes('1022') ||
    lowerMsg.includes('ats') ||
    lowerMsg.includes('transport security')
  ) {
    warningTitle = 'iOS Security Policy';
    warningReason = 'Apple App Transport Security (ATS) blocked an unencrypted HTTP stream. The provider must support HTTPS.';
  } else if (
    lowerMsg.includes('509') ||
    lowerMsg.includes('limit')
  ) {
    warningTitle = 'Connection Limit';
    warningReason = 'Maximum simultaneous connections reached for this account. Close other active streams to continue.';
  } else if (
    lowerMsg.includes('401') ||
    lowerMsg.includes('403') ||
    lowerMsg.includes('auth') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden')
  ) {
    warningTitle = 'Access Denied';
    warningReason = 'The provider streaming server rejected authorization credentials for this stream.';
  } else if (
    lowerMsg.includes('404') ||
    lowerMsg.includes('offline') ||
    lowerMsg.includes('off-air') ||
    lowerMsg.includes('16830')
  ) {
    warningTitle = 'Channel Offline';
    warningReason = 'This channel is currently offline or temporarily unavailable from the provider.';
  } else if (
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('1001') ||
    lowerMsg.includes('1009') ||
    lowerMsg.includes('network')
  ) {
    warningTitle = 'Connection Timeout';
    warningReason = 'The streaming server took too long to respond. Please check your internet connection.';
  }

  const safePadding = insets ? {
    paddingTop: Math.max(insets.top || 0, isMini ? 8 : 16),
    paddingBottom: Math.max(insets.bottom || 0, isMini ? 8 : 16),
    paddingLeft: Math.max(insets.left || 0, isMini ? 8 : 16),
    paddingRight: Math.max(insets.right || 0, isMini ? 8 : 16),
  } : null;

  return (
    <View style={[styles.container, isMini && styles.miniContainer, safePadding, style]} pointerEvents="auto">
      <View style={[styles.centerBox, isMini && styles.miniCenterBox]}>
        {/* 1. Video Break SVG Illustration */}
        <View style={[styles.iconWrapper, isMini && styles.miniIconWrapper]}>
          <BrokenVideoIcon
            size={isMini ? 32 : 52}
            color="#71717A"
          />
        </View>

        {/* 2. Error Heading */}
        <Text style={[styles.errorHeading, isMini && styles.miniErrorHeading]}>
          {displayHeading}
        </Text>

        {/* 3. Concise, Meaningful Primary Error Message */}
        <Text style={[styles.errorMessage, isMini && styles.miniErrorMessage]}>
          {displayMessage}
        </Text>

        {/* 3.5 Exact Technical Error Code Badge */}
        {!!displayErrorCode && (
          <View style={[styles.errorCodeBadge, isMini && styles.miniErrorCodeBadge]}>
            <Text style={[styles.errorCodeText, isMini && styles.miniErrorCodeText]}>{displayErrorCode}</Text>
          </View>
        )}

        {/* 4. Greyish Warning Card explaining why this is happening */}
        <View style={[styles.warningBox, isMini && styles.miniWarningBox]}>
          <View style={[styles.warningHeaderRow, isMini && styles.miniWarningHeaderRow]}>
            <WarningToastIcon
              size={isMini ? 12 : 14}
              color="#A1A1AA"
            />
            <Text style={[styles.warningTitle, isMini && styles.miniWarningTitle]}>
              {warningTitle}
            </Text>
          </View>
          <Text style={[styles.errorExplanation, isMini && styles.miniErrorExplanation]}>
            {warningReason}
          </Text>
        </View>

        {/* 5. Actions: Retry & Go Back */}
        <View style={[styles.actionsRow, isMini && styles.miniActionsRow]}>
          {showRetry && (
            <TouchableOpacity
              style={[styles.retryBtn, isMini && styles.miniRetryBtn]}
              onPress={onRetry}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Retry video playback"
            >
              <Text style={[styles.retryBtnText, isMini && styles.miniRetryBtnText]}>Retry</Text>
            </TouchableOpacity>
          )}

          {onSwitchEngine && (
            <TouchableOpacity
              style={[styles.switchEngineBtn, isMini && styles.miniSwitchEngineBtn]}
              onPress={onSwitchEngine}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Switch playback engine"
            >
              <Text style={[styles.switchEngineBtnText, isMini && styles.miniSwitchEngineBtnText]}>
                {switchEngineLabel || 'Try Alternate Engine'}
              </Text>
            </TouchableOpacity>
          )}

          {onBack && !isMini && (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={onBack}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Go back to previous screen"
            >
              <Text style={styles.backBtnText}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 35,
    elevation: 35,
    padding: 16,
  },
  miniContainer: {
    padding: 8,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 420,
    width: '100%',
    paddingHorizontal: 16,
  },
  miniCenterBox: {
    maxWidth: 290,
    paddingHorizontal: 4,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    opacity: 0.9,
  },
  miniIconWrapper: {
    marginBottom: 6,
  },
  errorHeading: {
    fontSize: 16.5,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.2,
    lineHeight: 22,
    marginBottom: 6,
  },
  miniErrorHeading: {
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 15,
    marginBottom: 2,
  },
  errorMessage: {
    fontSize: 13.5,
    fontWeight: '500',
    color: '#E4E4E7',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  miniErrorMessage: {
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 13,
    marginBottom: 4,
    paddingHorizontal: 4,
    color: '#A1A1AA',
  },
  errorCodeBadge: {
    backgroundColor: '#1E1E22',
    borderColor: '#3F3F46',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 6,
    alignSelf: 'center',
  },
  miniErrorCodeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    marginBottom: 4,
  },
  errorCodeText: {
    color: '#A1A1AA',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.3,
  },
  miniErrorCodeText: {
    fontSize: 9.5,
    letterSpacing: 0.2,
  },
  warningBox: {
    backgroundColor: '#1E1E22',
    borderColor: '#3F3F46',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    marginTop: 6,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  miniWarningBox: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 6,
  },
  warningHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 4,
  },
  miniWarningHeaderRow: {
    gap: 4,
    marginBottom: 2,
  },
  warningTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D4D4D8',
    letterSpacing: 0.2,
  },
  miniWarningTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#D4D4D8',
    letterSpacing: 0.1,
  },
  errorExplanation: {
    fontSize: 11.5,
    fontWeight: '400',
    color: '#A1A1AA',
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 4,
  },
  miniErrorExplanation: {
    fontSize: 9.5,
    lineHeight: 13,
    color: '#A1A1AA',
    paddingHorizontal: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  miniActionsRow: {
    gap: 6,
  },
  retryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 104,
  },
  miniRetryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 4.5,
    borderRadius: 6,
    minWidth: 68,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  miniRetryBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
  backBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#27272A',
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 96,
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  backBtnText: {
    color: '#E4E4E7',
    fontWeight: '600',
    fontSize: 12.5,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  switchEngineBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 107, 0, 0.15)',
    borderWidth: 1,
    borderColor: Colors.brand.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    minWidth: 110,
  },
  miniSwitchEngineBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 6,
    minWidth: 70,
  },
  switchEngineBtnText: {
    color: Colors.brand.primary,
    fontWeight: '700',
    fontSize: 12.5,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  miniSwitchEngineBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
});

