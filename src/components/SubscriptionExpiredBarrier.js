import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Clipboard,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import Colors from '../constants/colors';
import { useApp } from '../state/AppContext';

export default function SubscriptionExpiredBarrier() {
  const {
    isSubscriptionValid,
    isInitialized,
    subscription,
    isTrialEligible,
    deviceId,
    installationId,
    refreshSubscription,
  } = useApp();

  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only render when initialized and backend subscription is strictly invalid (and not eligible for fresh trial)
  if (!isInitialized || isSubscriptionValid !== false || (isTrialEligible && !subscription)) {
    return null;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshSubscription();
    } catch (_e) {} finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyUuid = () => {
    if (installationId) {
      if (Clipboard && Clipboard.setString) {
        Clipboard.setString(installationId);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const statusText = subscription?.status ? subscription.status.toUpperCase() : 'INACTIVE';
  const reasonText = subscription?.reason || 'Your trial or subscription on this device is currently inactive.';
  const expiresFormatted = subscription?.expires_at ? new Date(subscription.expires_at).toLocaleDateString() : 'N/A';

  return (
    <View style={styles.barrierContainer} pointerEvents="auto">
      <View style={styles.barrierCard}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Logo & Header */}
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <View style={styles.statusBadgeContainer}>
            <Text style={styles.statusBadgeText}>{statusText}</Text>
          </View>

          <Text style={styles.barrierTitle}>Subscription Inactive</Text>
          <Text style={styles.barrierSubtitle}>
            {reasonText}
          </Text>

          {/* Identity & Timestamps Box */}
          <View style={styles.detailsBox}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>DEVICE ID</Text>
              <Text style={styles.detailValueBold}>{deviceId || 'UNKNOWN'}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>UUID</Text>
              <TouchableOpacity onPress={handleCopyUuid} activeOpacity={0.7} style={styles.copyRow}>
                <Text style={styles.detailValueMono} numberOfLines={1}>
                  {installationId || 'Not Registered'}
                </Text>
                <Text style={styles.copyButtonText}>{copied ? 'COPIED' : 'COPY'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>EXPIRES</Text>
              <Text style={styles.detailValue}>{expiresFormatted}</Text>
            </View>
          </View>

          {/* Action Buttons Side-by-side matching Settings Screen */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleRefresh}
              disabled={isRefreshing}
              activeOpacity={0.8}
            >
              {isRefreshing ? (
                <ActivityIndicator color="#000000" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Check Status</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push('/settings')}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Settings</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footerNote}>
            To renew or activate this device, provide your Device ID or UUID to your administrator.
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barrierContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  barrierCard: {
    width: '90%',
    maxWidth: 380,
    maxHeight: '92%',
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  scrollContent: {
    alignItems: 'center',
  },
  logo: {
    width: 90,
    height: 24,
    marginBottom: 8,
  },
  statusBadgeContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 8,
  },
  statusBadgeText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  barrierTitle: {
    color: Colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  barrierSubtitle: {
    color: Colors.text.secondary,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  detailsBox: {
    width: '100%',
    backgroundColor: Colors.background.card,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: Colors.text.tertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailValue: {
    color: Colors.text.secondary,
    fontSize: 11,
  },
  detailValueBold: {
    color: Colors.brand.primary,
    fontSize: 11.5,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailValueMono: {
    color: Colors.text.primary,
    fontSize: 10.5,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    maxWidth: 160,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  copyButtonText: {
    color: Colors.brand.primary,
    fontSize: 9,
    fontWeight: '800',
  },
  actionsContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
    marginTop: 2,
    marginBottom: 10,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: Colors.brand.primary,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: Colors.text.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  footerNote: {
    color: Colors.text.tertiary,
    fontSize: 10,
    textAlign: 'center',
    lineHeight: 14,
  },
});
