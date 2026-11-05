import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Text,
  StyleSheet,
  Animated,
  View,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toastService } from '../services/toastService';
import {
  WarningToastIcon,
  CheckCircleIcon,
  CloseIcon,
} from './Icons';
import Colors from '../constants/colors';

/**
 * Individual Dismissible Toast Card Component
 * Strictly implements the SHOW -> VISIBLE -> AUTO/MANUAL DISMISS -> EXIT ANIMATION -> REMOVED lifecycle.
 */
const ToastItem = React.memo(function ToastItem({ toast, onRemove }) {
  const translateY = useRef(new Animated.Value(20)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const isDismissingRef = useRef(false);
  const timerRef = useRef(null);

  const startExitAnimation = useCallback(() => {
    if (isDismissingRef.current) return;
    isDismissingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 14,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Actually removes the toast from state/DOM after animation completes
      onRemove(toast.id);
    });
  }, [opacity, translateY, onRemove, toast.id]);

  useEffect(() => {
    // 1. Entrance animation (SHOW -> VISIBLE)
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        friction: 8,
        tension: 65,
        useNativeDriver: true,
      }),
    ]).start();

    // 2. Auto-dismiss timer (sensible 3–5 seconds duration)
    timerRef.current = setTimeout(() => {
      startExitAnimation();
    }, toast.duration || 3500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [opacity, translateY, toast.duration, startExitAnimation]);

  const renderIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircleIcon size={16} color="#10B981" />;
      case 'error':
        return <WarningToastIcon size={16} color="#EF4444" />;
      default:
        return <WarningToastIcon size={16} color={Colors.brand.primary} />;
    }
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.toastCard,
        {
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <TouchableOpacity
        style={styles.toastTouchArea}
        onPress={startExitAnimation}
        activeOpacity={0.88}
        accessibilityLabel={`Dismiss notification: ${toast.message}`}
      >
        <View style={styles.iconBox}>{renderIcon()}</View>
        <Text style={styles.toastText} numberOfLines={2} ellipsizeMode="tail">
          {toast.message}
        </Text>
        <View style={styles.closeBtn}>
          <CloseIcon size={13} color="rgba(255, 255, 255, 0.7)" />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

/**
 * Global Toast Container Component
 * Non-blocking, non-modal, queue-managed notification manager.
 */
export default function GlobalToast({ bottomOffset = null }) {
  const [toasts, setToasts] = useState([]);
  const insets = useSafeAreaInsets();

  const handleRemove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const unsubscribe = toastService.subscribe((payload) => {
      // Support both structured events and direct toast objects
      const action = payload?.action || (payload?.message ? 'show' : null);
      const toastData = payload?.toast || payload;

      if (action === 'show' && toastData?.id) {
        setToasts((prev) => {
          // Prevent duplicates already in queue
          if (prev.some((t) => t.id === toastData.id || t.message === toastData.message)) {
            return prev;
          }
          // Keep at most 2 toasts active simultaneously
          const next = [...prev, toastData];
          return next.slice(-2);
        });
      } else if (action === 'dismiss' && payload?.id) {
        setToasts((prev) => prev.filter((t) => t.id !== payload.id));
      } else if (action === 'dismiss_all') {
        setToasts([]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (toasts.length === 0) return null;

  // Responsive safe-area bottom offset
  const computedBottom = bottomOffset !== null
    ? bottomOffset
    : Math.max(insets.bottom + 16, 28);

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.globalContainer,
        { bottom: computedBottom },
      ]}
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={handleRemove}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  globalContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 99999,
    gap: 8,
  },
  toastCard: {
    maxWidth: '85%',
    minWidth: 260,
    backgroundColor: 'rgba(18, 18, 20, 0.96)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
    overflow: 'hidden',
  },
  toastTouchArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  iconBox: {
    flexShrink: 0,
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
