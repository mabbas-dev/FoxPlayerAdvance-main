import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Image,
  ScrollView,
  FlatList,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import FoxModal from '../components/FoxModal';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import Colors from '../constants/colors';
import { REFRESH_STATE } from '../constants';
import ProgressBar from '../components/ProgressBar';
import PlaylistHeaderActions from '../components/PlaylistHeaderActions';
import SubscriptionDetailsModal from '../components/SubscriptionDetailsModal';
import { useSubscription, SUBSCRIPTION_STATUS } from '../state/SubscriptionContext';
import {
  TvPlayIcon,
  MovieClapperIcon,
  SeriesFilmIcon,
  StarIcon,
  RefreshIcon,
  UserIcon,
  GearIcon,
  CheckCircleIcon,
  CalendarIcon,
  PlayIcon,
  AlertCircleIcon,
} from '../components/Icons';
import { isPlaylistExpired } from '../services/networkErrors';

export default function HomeScreen() {
  const {
    playlistConfig,
    deviceStatus,
    reloadPlaylist,
    refreshState,
    refreshProgress,
    liveData,
    moviesData,
    seriesData,
    favorites = [],
    showPlaylistExpiredDialog,
    isExpired: contextIsExpired,
    activePlaylist,
  } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isRefreshing =
    refreshState === REFRESH_STATE.REFRESHING ||
    refreshState === REFRESH_STATE.SWITCHING ||
    refreshState === REFRESH_STATE.SYNCHRONIZING;

  const refreshSpinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isRefreshing) {
      const loop = Animated.loop(
        Animated.timing(refreshSpinAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      loop.start();
      return () => loop.stop();
    } else {
      refreshSpinAnim.stopAnimation();
      refreshSpinAnim.setValue(0);
    }
  }, [isRefreshing, refreshSpinAnim]);

  const spin = refreshSpinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const [activeCard, setActiveCard] = useState('live');
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [favouritesModalVisible, setFavouritesModalVisible] = useState(false);
  const [subscriptionModalVisible, setSubscriptionModalVisible] = useState(false);

  const handleOpenSubscriptionDetails = useCallback((e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    setSubscriptionModalVisible(true);
  }, []);
  // Derive favorites directly from AppContext (100% active-playlist scoped)
  const favoritesList = useMemo(() => {
    const channels = (favorites || []).filter((f) => f.type === 'live' || f.type === 'channel');
    const movies = (favorites || []).filter((f) => f.type === 'movie');
    const series = (favorites || []).filter((f) => f.type === 'series');
    return { channels, movies, series };
  }, [favorites]);

  const {
    subscriptionStatus,
    appExpiresAt,
    appExpiresAtFormatted,
    appExpiresAtCompact,
    remainingDays,
    isLifetime,
    isTrialEligible,
    trialDurationDays,
    openTrialDisclaimer,
    refreshSubscription,
  } = useSubscription();

  // Exclusively authoritative application subscription display (separated strictly from IPTV provider expiry)
  const appSubscriptionInfo = useMemo(() => {
    switch (subscriptionStatus) {
      case SUBSCRIPTION_STATUS.CHECKING:
        return {
          isExpired: false,
          isChecking: true,
          badgeLabel: 'Checking',
          badgeStyle: styles.activeTag,
          badgeTextStyle: styles.activeText,
          icon: <ActivityIndicator size="small" color={Colors.brand.primary} style={{ transform: [{ scale: 0.7 }] }} />,
          calendarColor: Colors.text.secondary,
          expiryText: 'Verifying app expiry...',
          onPress: null,
        };
      case SUBSCRIPTION_STATUS.ACTIVE_TRIAL:
        return {
          isExpired: false,
          useStructuredExpiry: true,
          expiryPrefix: 'Expires at',
          expiryDate: appExpiresAtCompact,
          badgeLabel: 'Free Trial',
          badgeStyle: styles.activeTag,
          badgeTextStyle: styles.activeText,
          icon: <CheckCircleIcon size={13} color={Colors.status.success} />,
          calendarColor: Colors.brand.primary,
          expiryText: appExpiresAtCompact,
          onPress: null,
        };
      case SUBSCRIPTION_STATUS.ACTIVE_PAID:
        return {
          isExpired: false,
          hideBadge: true,
          useStructuredExpiry: true,
          expiryPrefix: 'Expires at',
          expiryDate: isLifetime ? 'Lifetime' : appExpiresAtCompact,
          badgeLabel: '',
          badgeStyle: styles.activeTag,
          badgeTextStyle: styles.activeText,
          icon: <CheckCircleIcon size={12} color={Colors.status.success} />,
          calendarColor: Colors.status.success,
          expiryText: appExpiresAtCompact,
          onPress: null,
        };
      case SUBSCRIPTION_STATUS.TRIAL_AVAILABLE:
        return {
          isExpired: false,
          isOffer: true,
          badgeLabel: 'Free Trial',
          badgeStyle: styles.expiredTag,
          badgeTextStyle: styles.expiredText,
          icon: <StarIcon size={13} color="#F59E0B" />,
          calendarColor: '#F59E0B',
          expiryText: `${trialDurationDays} Days Available • Tap to Activate`,
          onPress: openTrialDisclaimer,
        };
      case SUBSCRIPTION_STATUS.EXPIRED:
        return {
          isExpired: true,
          useStructuredExpiry: Boolean(appExpiresAt),
          expiryPrefix: 'Expired on',
          expiryDate: appExpiresAt ? appExpiresAtCompact : '—',
          badgeLabel: 'Subscription Expired',
          badgeStyle: styles.expiredTag,
          badgeTextStyle: styles.expiredText,
          icon: <AlertCircleIcon size={13} color="#F59E0B" />,
          calendarColor: '#F59E0B',
          expiryText: appExpiresAt ? appExpiresAtCompact : 'Expired',
          onPress: () => router.push('/settings'),
        };
      case SUBSCRIPTION_STATUS.BACKEND_UNAVAILABLE:
        return {
          isExpired: false,
          badgeLabel: 'Guest Mode',
          badgeStyle: styles.activeTag,
          badgeTextStyle: styles.activeText,
          icon: <CheckCircleIcon size={13} color={Colors.brand.primary} />,
          calendarColor: Colors.text.secondary,
          expiryText: 'Active • Tap to sync server',
          onPress: refreshSubscription,
        };
      default:
        return {
          isExpired: false,
          badgeLabel: 'App Subscription',
          badgeStyle: styles.activeTag,
          badgeTextStyle: styles.activeText,
          icon: <CheckCircleIcon size={13} color={Colors.brand.primary} />,
          calendarColor: Colors.text.secondary,
          expiryText: 'Status unavailable',
          onPress: () => router.push('/settings'),
        };
    }
  }, [subscriptionStatus, appExpiresAt, appExpiresAtFormatted, appExpiresAtCompact, remainingDays, isLifetime, trialDurationDays, openTrialDisclaimer, refreshSubscription, router]);

  const handleCardPress = useCallback((id) => {
    setActiveCard(id);
    if (id === 'live') {
      router.navigate('/live');
    } else if (id === 'movies') {
      router.navigate('/movies');
    } else if (id === 'series') {
      router.navigate('/series');
    } else if (id === 'favourites') {
      router.navigate('/favorites');
    }
  }, [router]);

  const handleRefresh = useCallback(async () => {
    try {
      await reloadPlaylist(null, { isManual: true });
    } catch (_e) {
      // Handled by central coordinator
    }
  }, [reloadPlaylist]);

  const totalFavs =
    favoritesList.channels.length +
    favoritesList.movies.length +
    favoritesList.series.length;

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: 4,
          paddingBottom: Math.max(insets.bottom, 4),
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
        },
      ]}
    >
      {/* Top Toolbar */}
      <View style={styles.topSection}>
        {/* Left Side: Brand Logo */}
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* Center: Authoritative Fox Player App Subscription Pill */}
        <TouchableOpacity
          style={[styles.statusPill, appSubscriptionInfo.isExpired && styles.statusPillExpired]}
          onPress={handleOpenSubscriptionDetails}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Subscription status: ${appSubscriptionInfo.badgeLabel}. ${appSubscriptionInfo.expiryText}. Tap for details.`}
          accessibilityHint="Opens subscription and expiry details dialog"
        >
          {appSubscriptionInfo.hideBadge ? (
            <View style={styles.expireTagStructured}>
              {appSubscriptionInfo.icon}
              {appSubscriptionInfo.useStructuredExpiry ? (
                <>
                  <Text style={styles.expirePrefix}>{appSubscriptionInfo.expiryPrefix}</Text>
                  <Text
                    style={[
                      styles.expireDateValue,
                      appSubscriptionInfo.isExpired && styles.expireTextHighlight,
                    ]}
                    numberOfLines={1}
                  >
                    {appSubscriptionInfo.expiryDate}
                  </Text>
                </>
              ) : (
                <Text style={[styles.expireText, styles.expireTextCompact]} numberOfLines={1}>
                  {appSubscriptionInfo.expiryText}
                </Text>
              )}
            </View>
          ) : (
            <>
              <View style={appSubscriptionInfo.badgeStyle}>
                {appSubscriptionInfo.icon}
                <Text style={appSubscriptionInfo.badgeTextStyle}>
                  {appSubscriptionInfo.badgeLabel}
                </Text>
              </View>
              <View style={styles.statusDivider} />
              <View style={styles.expireTag}>
                <CalendarIcon size={13} color={appSubscriptionInfo.calendarColor} />
                {appSubscriptionInfo.useStructuredExpiry ? (
                  <>
                    <Text style={styles.expirePrefix}>{appSubscriptionInfo.expiryPrefix}</Text>
                    <Text
                      style={[
                        styles.expireDateValue,
                        appSubscriptionInfo.isExpired && styles.expireTextHighlight,
                      ]}
                      numberOfLines={1}
                    >
                      {appSubscriptionInfo.expiryDate}
                    </Text>
                  </>
                ) : (
                  <Text style={[styles.expireText, appSubscriptionInfo.isExpired && styles.expireTextHighlight]} numberOfLines={1}>
                    {appSubscriptionInfo.expiryText}
                  </Text>
                )}
              </View>
            </>
          )}
        </TouchableOpacity>

        {/* Top Right Profile */}
        <View style={styles.headerRight}>
          <PlaylistHeaderActions />
        </View>
      </View>

      {/* Main 4 Cards Row */}
      <View style={styles.cardsRow}>
        {/* 1. Live TV */}
        <TouchableOpacity
          style={[
            styles.card,
            activeCard === 'live' && styles.cardActive,
          ]}
          onPress={() => handleCardPress('live')}
          activeOpacity={0.8}
          accessibilityLabel="Live TV"
        >
          <View style={styles.cardIconWrapper}>
            <TvPlayIcon size={38} color={Colors.brand.primary} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>Live TV</Text>
        </TouchableOpacity>

        {/* 2. Movies */}
        <TouchableOpacity
          style={[
            styles.card,
            activeCard === 'movies' && styles.cardActive,
          ]}
          onPress={() => handleCardPress('movies')}
          activeOpacity={0.8}
          accessibilityLabel="Movies"
        >
          <View style={styles.cardIconWrapper}>
            <MovieClapperIcon size={38} color={Colors.brand.primary} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>Movies</Text>
        </TouchableOpacity>

        {/* 3. Series */}
        <TouchableOpacity
          style={[
            styles.card,
            activeCard === 'series' && styles.cardActive,
          ]}
          onPress={() => handleCardPress('series')}
          activeOpacity={0.8}
          accessibilityLabel="Series"
        >
          <View style={styles.cardIconWrapper}>
            <SeriesFilmIcon size={38} color={Colors.brand.primary} />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>Series</Text>
        </TouchableOpacity>

        {/* 4. Favourites */}
        <TouchableOpacity
          style={[
            styles.card,
            activeCard === 'favourites' && styles.cardActive,
          ]}
          onPress={() => handleCardPress('favourites')}
          activeOpacity={0.8}
          accessibilityLabel="Favourites"
        >
          <View style={styles.cardIconWrapper}>
            <StarIcon size={38} color={Colors.brand.primary} filled />
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>Favourites</Text>
          {favorites.length > 0 && (
            <View style={styles.cardCountBadge}>
              <Text style={styles.cardCountText}>{favorites.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Bottom Section */}
      <View style={styles.bottomSection}>
        {/* Action Buttons Row */}
        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            style={[styles.actionPill, isRefreshing && styles.actionPillSyncing]}
            onPress={handleRefresh}
            activeOpacity={0.8}
            disabled={isRefreshing}
            accessibilityLabel="Refresh content"
          >
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <RefreshIcon size={14} color="#FFFFFF" />
            </Animated.View>
            <Text style={styles.actionPillText}>{isRefreshing ? 'Refreshing...' : 'Refresh'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionPill}
            onPress={() => setAccountModalVisible(true)}
            activeOpacity={0.8}
            accessibilityLabel="View Account"
          >
            <UserIcon size={15} color="#FFFFFF" />
            <Text style={styles.actionPillText}>Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionPill}
            onPress={() => router.push('/settings')}
            activeOpacity={0.8}
            accessibilityLabel="Settings"
          >
            <GearIcon size={15} color="#FFFFFF" />
            <Text style={styles.actionPillText}>Settings</Text>
          </TouchableOpacity>
        </View>

        {isRefreshing && (
          <View style={styles.syncHairlineWrapper}>
            <ProgressBar progress={refreshProgress} height={2} />
          </View>
        )}

        {/* Disclaimer Text */}
        <Text style={styles.disclaimerText} numberOfLines={1}>
          FoxPlayer is a media player only, and does not include any content.
        </Text>
      </View>

      {/* Account Modal (Fits completely without scrolling) */}
      <FoxModal
        visible={accountModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAccountModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.accountModalCard}>
            <Text style={styles.modalTitle}>ACCOUNT DETAILS</Text>

            <View style={styles.accountGrid}>
              <View style={styles.accountCol}>
                <View style={styles.accountRow}>
                  <Text style={styles.accountLabel}>Status:</Text>
                  <Text style={[styles.accountValue, { color: Colors.status.success }]}>
                    {deviceStatus === 'READY' ? 'Active' : deviceStatus}
                  </Text>
                </View>
                <View style={styles.accountRow}>
                  <Text style={styles.accountLabel}>App Expiry:</Text>
                  <Text style={styles.accountValue} numberOfLines={1}>
                    {appExpiresAt ? appExpiresAtFormatted : (subscriptionStatus === SUBSCRIPTION_STATUS.TRIAL_AVAILABLE ? 'Trial Available' : 'N/A')}
                  </Text>
                </View>
                <View style={styles.accountRow}>
                  <Text style={styles.accountLabel}>Live TV:</Text>
                  <Text style={styles.accountValue}>
                    {liveData?.total ? liveData.total.toLocaleString() : '0'} channels
                  </Text>
                </View>
              </View>

              <View style={styles.accountCol}>
                <View style={styles.accountRow}>
                  <Text style={styles.accountLabel}>Movies:</Text>
                  <Text style={styles.accountValue}>
                    {moviesData?.total ? moviesData.total.toLocaleString() : '0'} titles
                  </Text>
                </View>
                <View style={styles.accountRow}>
                  <Text style={styles.accountLabel}>Series:</Text>
                  <Text style={styles.accountValue}>
                    {seriesData?.total ? seriesData.total.toLocaleString() : '0'} shows
                  </Text>
                </View>
                <View style={styles.accountRow}>
                  <Text style={styles.accountLabel}>Playlist:</Text>
                  <Text style={styles.accountValue} numberOfLines={1}>
                    {playlistConfig?.name || playlistConfig?.config?.playlist_name || (playlistConfig?.type || playlistConfig?.config?.type || 'Xtream').toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setAccountModalVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </FoxModal>

      {/* Favourites Quick Modal */}
      <FoxModal
        visible={favouritesModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFavouritesModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.accountModalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>FAVOURITES</Text>
              
              {totalFavs === 0 ? (
                <Text style={styles.favouritesEmptyText}>
                  No favorites added yet. Tap the heart or star icon in Movies, Series, or Live TV to add items to your Favourites.
                </Text>
              ) : (
                <View style={{ gap: 8, marginVertical: 10 }}>
                  {favoritesList.channels.length > 0 && (
                    <TouchableOpacity
                      style={styles.favSectionRow}
                      onPress={() => {
                        setFavouritesModalVisible(false);
                        router.navigate('/live');
                      }}
                    >
                      <TvPlayIcon size={18} color={Colors.brand.primary} />
                      <Text style={styles.favSectionText}>
                        Live Channels ({favoritesList.channels.length})
                      </Text>
                      <Text style={styles.favSectionChevron}>&gt;</Text>
                    </TouchableOpacity>
                  )}

                  {favoritesList.movies.length > 0 && (
                    <TouchableOpacity
                      style={styles.favSectionRow}
                      onPress={() => {
                        setFavouritesModalVisible(false);
                        router.navigate('/movies');
                      }}
                    >
                      <MovieClapperIcon size={18} color={Colors.brand.primary} />
                      <Text style={styles.favSectionText}>
                        Movies ({favoritesList.movies.length})
                      </Text>
                      <Text style={styles.favSectionChevron}>&gt;</Text>
                    </TouchableOpacity>
                  )}

                  {favoritesList.series.length > 0 && (
                    <TouchableOpacity
                      style={styles.favSectionRow}
                      onPress={() => {
                        setFavouritesModalVisible(false);
                        router.navigate('/series');
                      }}
                    >
                      <SeriesFilmIcon size={18} color={Colors.brand.primary} />
                      <Text style={styles.favSectionText}>
                        Series ({favoritesList.series.length})
                      </Text>
                      <Text style={styles.favSectionChevron}>&gt;</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setFavouritesModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </FoxModal>

      {/* Authoritative Animated Subscription & Expiry Details Dialog */}
      <SubscriptionDetailsModal
        visible={subscriptionModalVisible}
        onClose={() => setSubscriptionModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
    justifyContent: 'space-between',
  },
  topSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 4,
    gap: 10,
  },
  headerLeft: {
    flexShrink: 0,
  },
  logo: {
    width: 140,
    height: 36,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexShrink: 1,
  },
  activeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  statusPillExpired: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  expiredTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  expiredText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F59E0B',
  },
  statusDivider: {
    width: 1,
    height: 12,
    backgroundColor: Colors.border.strong,
    marginHorizontal: 8,
  },
  expireTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  expireTagStructured: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  expirePrefix: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.text.secondary,
  },
  expireDateValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.15,
  },
  expireText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text.secondary,
  },
  expireTextHighlight: {
    color: '#F59E0B',
  },
  expireTextCompact: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  cardsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    flex: 1,
    maxHeight: 140,
    minHeight: 100,
    marginVertical: 6,
    gap: 10,
  },
  card: {
    flex: 1,
    height: '100%',
    backgroundColor: Colors.background.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    position: 'relative',
  },
  cardActive: {
    backgroundColor: Colors.background.cardActive,
    borderColor: Colors.brand.primary,
    borderWidth: 1.5,
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  cardIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text.primary,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  cardCountBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 3,
    backgroundColor: Colors.brand.primary,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  bottomSection: {
    alignItems: 'center',
    width: '100%',
    gap: 6,
    paddingTop: 2,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 6,
  },
  actionPillSyncing: {
    borderColor: Colors.brand.primary,
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
  },
  syncHairlineWrapper: {
    width: '100%',
    paddingHorizontal: 4,
    marginVertical: 1,
  },
  actionPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  disclaimerText: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.text.tertiary,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  accountModalCard: {
    width: '90%',
    maxWidth: 380,
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: 14,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1.2,
    marginBottom: 12,
    textAlign: 'center',
  },
  accountGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  accountCol: {
    flex: 1,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.default,
  },
  accountLabel: {
    fontSize: 13,
    color: Colors.text.secondary,
    fontWeight: '500',
  },
  accountValue: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  favouritesEmptyText: {
    fontSize: 13,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    marginVertical: 14,
  },
  favSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    padding: 12,
    borderRadius: 8,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  favSectionText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  favSectionChevron: {
    fontSize: 14,
    color: Colors.text.tertiary,
    fontWeight: '700',
  },
  modalCloseBtn: {
    marginTop: 14,
    backgroundColor: Colors.brand.primary,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
});

