import React, { useEffect, useRef, useCallback } from 'react';
import {
  Text,
  StyleSheet,
  Animated,
  View,
  TouchableOpacity,
} from 'react-native';
import { WarningToastIcon, CheckCircleIcon, CloseIcon } from './Icons';
import Colors from '../constants/colors';

/**
 * Player Error Toast Component
 * Dismissible, non-blocking toast overlay for player screens.
 */
export default function PlayerErrorToast({
  message,
  visible,
  onDismiss,
  type = 'error',
  duration = 3500,
  bottomOffset = 60,
}) {
  const translateYRef = useRef(new Animated.Value(20));
  const opacityRef = useRef(new Animated.Value(0));
  const isDismissingRef = useRef(false);
  const hideTimerRef = useRef(null);

  const startExitAnimation = useCallback(() => {
    if (isDismissingRef.current) return;
    isDismissingRef.current = true;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

    Animated.parallel([
      Animated.timing(opacityRef.current, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateYRef.current, { toValue: 16, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      isDismissingRef.current = false;
      onDismiss?.();
    });
  }, [onDismiss]);

  useEffect(() => {
    if (visible && message) {
      isDismissingRef.current = false;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);

      opacityRef.current.setValue(0);
      translateYRef.current.setValue(20);

      Animated.parallel([
        Animated.timing(opacityRef.current, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(translateYRef.current, { toValue: 0, friction: 8, tension: 60, useNativeDriver: true }),
      ]).start();

      hideTimerRef.current = setTimeout(() => {
        startExitAnimation();
      }, Math.max(2500, Math.min(5000, duration || 3500)));
    } else {
      opacityRef.current.setValue(0);
      translateYRef.current.setValue(20);
    }

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [visible, message, duration, startExitAnimation]);

  if (!visible || !message) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.toastWrapper,
        { bottom: bottomOffset },
      ]}
    >
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.toastContainer,
          {
            opacity: opacityRef.current,
            transform: [{ translateY: translateYRef.current }],
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.toastContent,
            type === 'success' && styles.toastContentSuccess,
            (type === 'info' || type === 'switch') && styles.toastContentInfo,
            type === 'error' && styles.toastContentError,
          ]}
          onPress={startExitAnimation}
          activeOpacity={0.88}
          accessibilityLabel={`Dismiss: ${message}`}
        >
          {type === 'success' ? (
            <CheckCircleIcon size={16} color="#10B981" />
          ) : type === 'info' || type === 'switch' ? (
            <CheckCircleIcon size={16} color={Colors.brand.primary} />
          ) : (
            <WarningToastIcon size={16} color="#EF4444" />
          )}
          <Text style={styles.toastText} numberOfLines={2}>
            {message}
          </Text>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={startExitAnimation}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Close notification"
          >
            <CloseIcon size={13} color="rgba(255, 255, 255, 0.7)" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  toastWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  toastContainer: {
    maxWidth: '85%',
    minWidth: 140,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 18, 20, 0.96)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
  },
  toastContentSuccess: {
    borderColor: 'rgba(16, 185, 129, 0.45)',
    backgroundColor: 'rgba(12, 22, 16, 0.96)',
  },
  toastContentInfo: {
    borderColor: 'rgba(255, 107, 0, 0.45)',
    backgroundColor: 'rgba(24, 18, 14, 0.96)',
  },
  toastContentError: {
    borderColor: 'rgba(239, 68, 68, 0.45)',
    backgroundColor: 'rgba(24, 14, 14, 0.96)',
  },
  toastText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    lineHeight: 18,
  },
  closeBtn: {
    flexShrink: 0,
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
