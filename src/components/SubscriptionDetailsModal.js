import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  Easing,
  ActivityIndicator,
  Clipboard,
  Platform,
} from 'react-native';
import Colors from '../constants/colors';
import FoxModal from './FoxModal';
import { useSubscription, SUBSCRIPTION_STATUS } from '../state/SubscriptionContext';
import {
  formatAppExpiryDateCompact,
  getSubscriptionTimeRemaining,
  isLifetimeSubscription,
  getSubscriptionPlanLabel,
} from '../utils/subscriptionUtils';
import { useApp } from '../state/AppContext';
import { CloseXIcon, RefreshIcon, CopyIcon, CheckIcon } from './Icons';

function getStatusPresentation(subscriptionStatus, subscription, options) {
  const {
    lifetimeActive,
    isSubscriptionValid,
    isTrialEligible,
    trialDurationDays,
    isCached,
    appExpiresAt,
  } = options;

  const serverTime = subscription?.server_time || null;
  const timeInfo = getSubscriptionTimeRemaining(appExpiresAt, serverTime, {
    isLifetime: lifetimeActive,
  });
  const rawStatus = String(subscription?.status || '').toLowerCase();

  if (subscriptionStatus === SUBSCRIPTION_STATUS.CHECKING) {
    return { label: 'Checking', hint: 'Syncing with server…', tone: 'neutral' };
  }
  if (subscriptionStatus === SUBSCRIPTION_STATUS.BACKEND_UNAVAILABLE) {
    return {
      label: 'Offline',
      hint: isCached ? 'Last saved status' : 'Tap Refresh',
      tone: 'warn',
    };
  }
  if (subscriptionStatus === SUBSCRIPTION_STATUS.TRIAL_AVAILABLE) {
    return {
      label: 'Trial available',
      hint: `${trialDurationDays}-day trial`,
      tone: 'warn',
    };
  }
  if (rawStatus === 'disabled' || rawStatus === 'revoked') {
    return { label: 'Inactive', hint: 'Contact support', tone: 'error' };
  }
  if (subscriptionStatus === SUBSCRIPTION_STATUS.EXPIRED || !isSubscriptionValid) {
    return { label: 'Expired', hint: timeInfo.text, tone: 'error' };
  }
  if (lifetimeActive) {
    return { label: 'Lifetime', hint: 'No renewal needed', tone: 'brand' };
  }
  if (subscription?.subscription_type === 'trial' || subscription?.type === 'trial') {
    return { label: 'Trial active', hint: timeInfo.text, tone: 'ok' };
  }
  return { label: 'Active', hint: timeInfo.text, tone: 'ok' };
}

const TONE_STYLES = {
  brand: { color: Colors.brand.primary, bg: 'rgba(249, 115, 22, 0.14)', border: 'rgba(249, 115, 22, 0.35)' },
  ok: { color: '#34D399', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.35)' },
  warn: { color: '#FBBF24', bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)' },
  error: { color: '#F87171', bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.35)' },
  neutral: { color: '#93C5FD', bg: 'rgba(147, 197, 253, 0.12)', border: 'rgba(147, 197, 253, 0.35)' },
};

export default function SubscriptionDetailsModal({ visible, onClose }) {
  const {
    subscription,
    subscriptionStatus,
    subscriptionPlanLabel,
    isLifetime,
    appExpiresAt,
    isSubscriptionValid,
    isTrialEligible,
    trialDurationDays,
    isActivating,
    activateTrial,
    refreshSubscription,
    isCached,
    deviceId: subDeviceId,
  } = useSubscription();

  const { deviceId: appDeviceId, subscription: appSubscription } = useApp();
  const effectiveSubscription = subscription || appSubscription || null;
  const authoritativeDeviceId =
    effectiveSubscription?.device_id || subDeviceId || appDeviceId || 'N/A';

  const [isRendered, setIsRendered] = useState(visible);
  const animVal = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedType, setCopiedType] = useState(null);
  const copiedTimerRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setIsRefreshing(true);
      try {
        await refreshSubscription({ silent: true });
      } catch (_e) {
        // context sets error / cache fallback
      } finally {
        if (!cancelled) setIsRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, refreshSubscription]);

  useEffect(() => {
    if (visible) {
      setIsRendered(true);
      isClosingRef.current = false;
      animVal.setValue(0);
      Animated.timing(animVal, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (isRendered && !isClosingRef.current) {
      isClosingRef.current = true;
      Animated.timing(animVal, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setIsRendered(false);
          isClosingRef.current = false;
        }
      });
    }
  }, [visible, isRendered, animVal]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(animVal, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setIsRendered(false);
        isClosingRef.current = false;
        onClose?.();
      }
    });
  }, [animVal, onClose]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshSubscription({ silent: false });
    } catch (_e) {
      // handled in context
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshSubscription]);

  const handleActivateTrial = useCallback(async () => {
    if (isActivating) return;
    try {
      await activateTrial();
    } catch (_e) {}
  }, [isActivating, activateTrial]);

  const handleCopy = useCallback((text) => {
    if (!text || text === 'N/A') return;
    try {
      Clipboard.setString(text);
      setCopiedType('device');
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedType(null), 2000);
    } catch (_e) {}
  }, []);

  const lifetimeActive =
    isLifetime || isLifetimeSubscription(effectiveSubscription);

  const effectiveExpiresAt = appExpiresAt || effectiveSubscription?.expires_at || null;

  const status = useMemo(
    () =>
      getStatusPresentation(subscriptionStatus, effectiveSubscription, {
        lifetimeActive,
        isSubscriptionValid,
        isTrialEligible,
        trialDurationDays,
        isCached,
        appExpiresAt: effectiveExpiresAt,
      }),
    [
      subscriptionStatus,
      effectiveSubscription,
      lifetimeActive,
      isSubscriptionValid,
      isTrialEligible,
      trialDurationDays,
      isCached,
      effectiveExpiresAt,
    ]
  );

  const tone = TONE_STYLES[status.tone] || TONE_STYLES.neutral;

  const formattedExpiryDate = useMemo(() => {
    if (lifetimeActive) return 'Lifetime';
    if (!effectiveExpiresAt) return '—';
    return formatAppExpiryDateCompact(effectiveExpiresAt);
  }, [effectiveExpiresAt, lifetimeActive]);

  const planLabel =
    subscriptionPlanLabel ||
    getSubscriptionPlanLabel(effectiveSubscription, { isTrialEligible });

  const showBodyLoading =
    isRefreshing && !effectiveSubscription && subscriptionStatus !== SUBSCRIPTION_STATUS.TRIAL_AVAILABLE;

  if (!isRendered) return null;

  const overlayOpacity = animVal;
  const cardScale = animVal.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const cardOpacity = animVal;

  return (
    <FoxModal
      visible={isRendered}
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      hardwareAccelerated
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.dimLayer, { opacity: overlayOpacity }]}
        />

        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close subscription dialog"
        />

        <Animated.View
          style={[
            styles.card,
            {
              opacity: cardOpacity,
              transform: [{ scale: cardScale }],
            },
          ]}
        >
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Subscription</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={handleClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <CloseXIcon size={14} color="#CBD5E1" />
              </TouchableOpacity>
            </View>

            <View style={styles.body}>
              {isCached ? (
                <Text style={styles.offlineNote}>Offline — last saved status</Text>
              ) : null}

              {showBodyLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={Colors.brand.primary} />
                  <Text style={styles.loadingText}>Loading subscription…</Text>
                </View>
              ) : null}

              <View style={[styles.statusPill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Text style={[styles.statusPillText, { color: tone.color }]}>{status.label}</Text>
                <Text style={styles.statusHint} numberOfLines={1}>
                  {status.hint}
                </Text>
              </View>

              <View style={styles.expiryBlock}>
                <Text style={styles.expiryLabel}>Expires at</Text>
                <Text style={styles.expiryValue}>{formattedExpiryDate}</Text>
              </View>

              <View style={styles.row}>
                <Text style={styles.rowLabel}>Plan</Text>
                <Text style={styles.rowValue}>{planLabel}</Text>
              </View>

              <View style={[styles.row, styles.rowLast]}>
                <Text style={styles.rowLabel}>Device ID</Text>
                <View style={styles.deviceRow}>
                  <Text style={styles.deviceId} numberOfLines={1}>
                    {authoritativeDeviceId}
                  </Text>
                  <TouchableOpacity
                    style={styles.copyBtn}
                    onPress={() => handleCopy(authoritativeDeviceId)}
                    accessibilityLabel="Copy device ID"
                  >
                    {copiedType === 'device' ? (
                      <CheckIcon size={11} color={Colors.status.success} />
                    ) : (
                      <CopyIcon size={11} color="#CBD5E1" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleRefresh}
                disabled={isRefreshing}
                activeOpacity={0.8}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color={Colors.text.secondary} />
                ) : (
                  <>
                    <RefreshIcon size={13} color={Colors.text.secondary} />
                    <Text style={styles.secondaryBtnText}>Refresh</Text>
                  </>
                )}
              </TouchableOpacity>

              {isTrialEligible && !isSubscriptionValid ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, isActivating && styles.btnDisabled]}
                  onPress={handleActivateTrial}
                  disabled={isActivating}
                  activeOpacity={0.85}
                >
                  {isActivating ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Activate trial</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.primaryBtn} onPress={handleClose} activeOpacity={0.85}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
        </Animated.View>
      </View>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  dimLayer: {
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
  },
  card: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: '#12161E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 12 },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  closeBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  body: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  loadingText: {
    fontSize: 11,
    color: Colors.text.secondary,
    fontWeight: '500',
  },
  offlineNote: {
    fontSize: 11,
    color: '#FBBF24',
    fontWeight: '600',
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 1,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusHint: {
    fontSize: 10,
    color: Colors.text.secondary,
    fontWeight: '500',
  },
  expiryBlock: {
    gap: 2,
  },
  expiryLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  expiryValue: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    gap: 12,
  },
  rowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  rowLabel: {
    fontSize: 11,
    color: Colors.text.secondary,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
    maxWidth: '68%',
  },
  deviceId: {
    fontSize: 10,
    fontWeight: '600',
    color: '#E2E8F0',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    flexShrink: 1,
    textAlign: 'right',
  },
  copyBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 2,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    minWidth: 84,
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text.secondary,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  primaryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  btnDisabled: {
    opacity: 0.65,
  },
});
