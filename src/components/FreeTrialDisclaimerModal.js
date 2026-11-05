import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  Platform,
  Dimensions,
} from 'react-native';
import FoxModal from './FoxModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/colors';
import { useSubscription, SUBSCRIPTION_STATUS } from '../state/SubscriptionContext';
import { CheckCircleIcon, AlertCircleIcon, CalendarIcon, TvPlayIcon, StarIcon } from './Icons';

export default function FreeTrialDisclaimerModal() {
  const {
    showTrialDisclaimer,
    isTrialEligible,
    trialDurationDays,
    isActivating,
    error,
    activateTrial,
    dismissTrialDisclaimer,
    subscriptionStatus,
  } = useSubscription();

  const insets = useSafeAreaInsets();

  // Only render when trial is eligible, disclaimer is triggered, and trial is available
  if (!showTrialDisclaimer || !isTrialEligible || subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE_TRIAL || subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE_PAID) {
    return null;
  }

  const handleActivate = async () => {
    if (isActivating) return;
    await activateTrial();
  };

  const handleDismiss = () => {
    if (isActivating) return;
    dismissTrialDisclaimer();
  };

  return (
    <FoxModal
      visible={true}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.modalContainer,
            {
              paddingTop: Math.max(insets.top, 16),
              paddingBottom: Math.max(insets.bottom, 16),
              paddingLeft: Math.max(insets.left, 20),
              paddingRight: Math.max(insets.right, 20),
            },
          ]}
        >
          <View style={styles.card}>
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Header: Logo & Badge */}
              <View style={styles.headerRow}>
                <Image
                  source={require('../../assets/inside-app-logo.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <View style={styles.offerBadge}>
                  <StarIcon size={12} color="#F59E0B" />
                  <Text style={styles.offerBadgeText}>SPECIAL OFFER</Text>
                </View>
              </View>

              {/* Title & Description */}
              <Text style={styles.title}>Your Free Trial Is Available</Text>
              <Text style={styles.description}>
                Your device is eligible for a limited free trial of Fox Player. Your trial period starts and expires according to the subscription details confirmed by our server.
              </Text>

              {/* Server-Confirmed Details Grid */}
              <View style={styles.detailsGrid}>
                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>TRIAL STATUS</Text>
                  <View style={styles.statusRow}>
                    <View style={styles.statusDot} />
                    <Text style={styles.detailBoxValueActive}>Available</Text>
                  </View>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>DURATION</Text>
                  <Text style={styles.detailBoxValue}>{trialDurationDays} Days</Text>
                </View>

                <View style={styles.detailBox}>
                  <Text style={styles.detailBoxLabel}>APP EXPIRY</Text>
                  <Text style={styles.detailBoxValueSubtle}>Starts upon activation</Text>
                </View>
              </View>

              {/* Value Proposition Highlights */}
              <View style={styles.highlightsContainer}>
                <View style={styles.highlightRow}>
                  <CheckCircleIcon size={14} color={Colors.status.success} />
                  <Text style={styles.highlightText}>
                    Full access to Live TV, Movies, Series, and multi-playlist management
                  </Text>
                </View>
                <View style={styles.highlightRow}>
                  <CheckCircleIcon size={14} color={Colors.status.success} />
                  <Text style={styles.highlightText}>
                    Authoritative server-timed access with zero surprise renewal fees
                  </Text>
                </View>
              </View>

              {/* Error Message if Activation Failed */}
              {error ? (
                <View style={styles.errorContainer}>
                  <AlertCircleIcon size={16} color={Colors.status.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Action Buttons */}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.primaryButton, isActivating && styles.buttonDisabled]}
                  onPress={handleActivate}
                  disabled={isActivating}
                  activeOpacity={0.8}
                  accessibilityLabel="Activate Free Trial"
                  accessibilityRole="button"
                >
                  {isActivating ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>Activating Trial...</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText}>Activate Free Trial</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, isActivating && styles.buttonDisabled]}
                  onPress={handleDismiss}
                  disabled={isActivating}
                  activeOpacity={0.7}
                  accessibilityLabel="Not Now"
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>Not Now</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.footerNote}>
                You can also activate your trial later in Settings. Device identity is verified with our server.
              </Text>
            </ScrollView>
          </View>
        </View>
      </View>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '90%',
    maxWidth: 380,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 14,
    paddingVertical: 14,
    maxHeight: '92%',
  },
  scrollContent: {
    alignItems: 'center',
  },
  headerRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  logo: {
    width: 80,
    height: 22,
  },
  offerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    gap: 4,
  },
  offerBadgeText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  title: {
    color: Colors.text.primary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  description: {
    color: Colors.text.secondary,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  detailsGrid: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  detailBox: {
    flex: 1,
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  detailBoxLabel: {
    color: Colors.text.tertiary,
    fontSize: 9.5,
    fontWeight: '600',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.status.success,
  },
  detailBoxValueActive: {
    color: Colors.status.success,
    fontSize: 11.5,
    fontWeight: '700',
  },
  detailBoxValue: {
    color: Colors.text.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  detailBoxValueSubtle: {
    color: Colors.text.secondary,
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
  highlightsContainer: {
    width: '100%',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
    gap: 6,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  highlightText: {
    color: Colors.text.secondary,
    fontSize: 11,
    flex: 1,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
    gap: 6,
    width: '100%',
  },
  errorText: {
    color: Colors.status.error,
    fontSize: 11,
    flex: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
    marginBottom: 8,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: Colors.brand.primary,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryButtonText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '700',
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
    marginTop: 2,
  },
});
