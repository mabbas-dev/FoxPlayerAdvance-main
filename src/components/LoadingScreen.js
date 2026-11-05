import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Image,
  TouchableOpacity,
  Platform,
  ScrollView,
  ActivityIndicator,
  } from 'react-native';
import FoxModal from './FoxModal';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Colors from '../constants/colors';
import { useApp } from '../state/AppContext';
import { REFRESH_STATE } from '../constants';
import { getOrCreateDeviceId } from '../storage/deviceStorage';
import ProgressBar from './ProgressBar';
import { isPlaylistExpired } from '../services/networkErrors';
import { AlertCircleIcon, ClockIcon } from './Icons';

/**
 * Commercial OTT Full-Screen Loading & Lifecycle Experience
 *
 * Clean, flat modern design with pure geometric centering for iPhone & Android landscape:
 * - Pure optical & geometric centering (zero offset on notched iPhones)
 * - Minimalist device ID badge pinned to top-right
 * - Clean, uncluttered expired presentation with pop-animated playlist dialogue (text-only, no SVGs)
 * - Modern flat dark aesthetics (no heavy neon / shadow effects)
 * - High-precision animated progress bar for content loading
 */
export default function LoadingScreen({
  step = 'Loading Your Content',
  progress = 0,
  deviceId: propDeviceId,
  showDeviceId = true,
  error = null,
  isExpired: propIsExpired = null,
  expiredInfo: propExpiredInfo = null,
  savedPlaylists: propSavedPlaylists = null,
  activePlaylistId: propActivePlaylistId = null,
  activePlaylist: propActivePlaylist = null,
  onRetry = null,
  onDismiss = null,
  onSwitchPlaylist = null,
}) {
  const app = useApp() || {};
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [asyncDeviceId, setAsyncDeviceId] = useState(null);
  const [logoLoadError, setLogoLoadError] = useState(false);
  const [switchingId, setSwitchingId] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const contextDeviceId = app.deviceId;
  useEffect(() => {
    if (!propDeviceId && !contextDeviceId) {
      getOrCreateDeviceId()
        .then((id) => {
          if (id) setAsyncDeviceId(id);
        })
        .catch(() => {});
    }
  }, [propDeviceId, contextDeviceId]);

  const deviceId = propDeviceId || contextDeviceId || asyncDeviceId || '';

  // Resolve state values from props or AppContext
  const refreshState = app.refreshState;
  const playlistExpiredModal = app.playlistExpiredModal || {};
  const savedPlaylists = propSavedPlaylists || app.savedPlaylists || [];
  const activePlaylistId = propActivePlaylistId || app.activePlaylistId;
  const activePlaylist = propActivePlaylist || app.activePlaylist;

  const isExpired =
    propIsExpired !== null
      ? Boolean(propIsExpired)
      : refreshState === REFRESH_STATE.EXPIRED || Boolean(playlistExpiredModal?.visible);

  const expiredPlaylistId =
    propExpiredInfo?.playlistId ||
    playlistExpiredModal?.playlistId ||
    activePlaylistId;

  const currentExpiredPl =
    savedPlaylists.find((p) => String(p.id) === String(expiredPlaylistId)) || activePlaylist;
  const currentExpiredName =
    propExpiredInfo?.playlistName ||
    playlistExpiredModal?.playlistName ||
    currentExpiredPl?.name ||
    'Current Playlist';

  // Filter alternative playlists available to switch to
  const alternativePlaylists = useMemo(() => {
    return savedPlaylists.filter((p) => String(p.id) !== String(expiredPlaylistId));
  }, [savedPlaylists, expiredPlaylistId]);

  // Subtle breathing animations (100% native driver)
  const logoBreathAnim = useRef(new Animated.Value(0.95)).current;
  const pulseAnim = useRef(new Animated.Value(0.7)).current;
  const statusDotAnim = useRef(new Animated.Value(0.4)).current;
  const dialogAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const logoLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoBreathAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(logoBreathAnim, { toValue: 0.95, duration: 1400, useNativeDriver: true }),
      ])
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 900, useNativeDriver: true }),
      ])
    );
    const dotLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(statusDotAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(statusDotAnim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    );

    logoLoop.start();
    pulseLoop.start();
    dotLoop.start();

    return () => {
      logoLoop.stop();
      pulseLoop.stop();
      dotLoop.stop();
    };
  }, [logoBreathAnim, pulseAnim, statusDotAnim]);

  // Pop-Scale Spring Animation for Modal Dialog
  const openDialog = useCallback(() => {
    dialogAnim.setValue(0);
    setDialogOpen(true);
    requestAnimationFrame(() => {
      Animated.spring(dialogAnim, {
        toValue: 1,
        tension: 190,
        friction: 14,
        useNativeDriver: true,
      }).start();
    });
  }, [dialogAnim]);

  const closeDialog = useCallback(
    (onEnd) => {
      Animated.timing(dialogAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setDialogOpen(false);
        if (typeof onEnd === 'function') onEnd();
      });
    },
    [dialogAnim]
  );

  // Handlers for Expired Playlist actions
  const handleSwitch = useCallback(
    async (targetId) => {
      if (!targetId || switchingId) return;
      setSwitchingId(targetId);
      closeDialog(async () => {
        try {
          if (typeof onSwitchPlaylist === 'function') {
            await onSwitchPlaylist(targetId);
          } else if (typeof app.switchPlaylist === 'function') {
            await app.switchPlaylist(targetId);
          }
        } catch (err) {
          console.warn('[LoadingScreen] Switch playlist error:', err?.message);
        } finally {
          setSwitchingId(null);
        }
      });
    },
    [switchingId, closeDialog, onSwitchPlaylist, app.switchPlaylist]
  );

  const handleAddNew = useCallback(() => {
    closeDialog(() => {
      try {
        if (typeof onDismiss === 'function') {
          onDismiss();
        } else if (typeof app.hidePlaylistExpiredDialog === 'function') {
          app.hidePlaylistExpiredDialog();
        }
        router.push('/pairing?mode=add');
      } catch (err) {
        console.warn('[LoadingScreen] Navigate to add error:', err?.message);
      }
    });
  }, [closeDialog, onDismiss, app.hidePlaylistExpiredDialog, router]);

  const handleRetryPress = useCallback(() => {
    closeDialog(() => {
      if (typeof onRetry === 'function') {
        onRetry();
      } else if (typeof app.retryRefresh === 'function') {
        app.retryRefresh();
      }
    });
  }, [closeDialog, onRetry, app.retryRefresh]);

  const handleDismissPress = useCallback(() => {
    closeDialog(() => {
      if (typeof onDismiss === 'function') {
        onDismiss();
      } else if (typeof app.hidePlaylistExpiredDialog === 'function') {
        app.hidePlaylistExpiredDialog();
      }
    });
  }, [closeDialog, onDismiss, app.hidePlaylistExpiredDialog]);

  // Contextual step message resolution
  const hasCustomStep = step && step !== 'Loading' && step !== 'Loading Your Content';
  const displayStep = hasCustomStep ? step : 'Loading Your Content';
  const subMessage = hasCustomStep
    ? 'Please wait while your content is loaded...'
    : 'Connecting to service and preparing your media...';

  // Safe bounds strictly for pinned headers/footers (not shifting center content)
  const safeTop = Math.max(10, (insets?.top || 0) + 6);
  const safeBottom = Math.max(8, (insets?.bottom || 0) + 4);
  const safeRight = Math.max(16, (insets?.right || 0) + 12);

  const renderDialogueContent = () => (
    <View style={styles.modalRootContainer}>
      {/* Full-screen Backdrop with independent fade animation */}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          styles.dialogBackdrop,
          {
            opacity: dialogAnim,
          },
        ]}
      >
        {/* Full-screen Backdrop dismiss touch target */}
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          activeOpacity={1}
          onPress={() => closeDialog()}
          accessibilityLabel="Close dialog"
          accessibilityRole="button"
        />
      </Animated.View>

      {/* Centered Dialog Card (Direct Flexbox Centering, Zero Bottom-Left Flash) */}
      <Animated.View
        style={[
          styles.dialogCard,
          {
            opacity: dialogAnim,
            transform: [
              {
                scale: dialogAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.92, 1.0],
                }),
              },
              {
                translateY: dialogAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          },
        ]}
        accessibilityRole="alert"
        aria-modal="true"
      >
        {/* Dialogue Header */}
        <View style={styles.dialogHeader}>
          <View style={styles.dialogHeaderTitleBlock}>
            <Text style={styles.dialogTitle}>Switch Playlist</Text>
            <Text style={styles.dialogSubtitle}>Select a playlist to continue.</Text>
          </View>
          <TouchableOpacity
            style={styles.dialogCloseCircleBtn}
            onPress={() => closeDialog()}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Text style={styles.dialogCloseText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Playlists Text-Only List (Strictly No SVGs) */}
        <ScrollView
          style={styles.dialogScrollView}
          contentContainerStyle={styles.dialogScrollContent}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {savedPlaylists && savedPlaylists.length > 0 ? (
            savedPlaylists.map((pl) => {
              const isCurrentPl = String(pl.id) === String(expiredPlaylistId);
              const isPlExpired = isPlaylistExpired(pl);
              const isThisSwitching = switchingId === pl.id;

              return (
                <TouchableOpacity
                  key={String(pl.id)}
                  style={[
                    styles.dialogItem,
                    isCurrentPl && styles.dialogItemCurrent,
                    isPlExpired && !isCurrentPl && styles.dialogItemDisabled,
                  ]}
                  onPress={() => {
                    if (!isCurrentPl && !isPlExpired) {
                      handleSwitch(pl.id);
                    }
                  }}
                  disabled={isThisSwitching || isCurrentPl || isPlExpired}
                  activeOpacity={0.7}
                  accessibilityLabel={`Select playlist ${pl.name || 'IPTV Playlist'}`}
                  accessibilityRole="button"
                >
                  <View style={styles.dialogItemLeft}>
                    <Text
                      style={[
                        styles.dialogItemName,
                        (isCurrentPl || isPlExpired) && styles.dialogItemNameExpired,
                      ]}
                      numberOfLines={1}
                    >
                      {pl.name || 'IPTV Playlist'}
                    </Text>
                    {isCurrentPl ? (
                      <Text style={styles.dialogItemSubtext}>Current expired playlist</Text>
                    ) : isPlExpired ? (
                      <Text style={styles.dialogItemSubtext}>Expired subscription</Text>
                    ) : null}
                  </View>

                  <View style={styles.dialogItemRight}>
                    {isThisSwitching ? (
                      <ActivityIndicator size="small" color={Colors.brand.primary} />
                    ) : isCurrentPl ? (
                      <View style={styles.dialogExpiredBadge}>
                        <Text style={styles.dialogExpiredBadgeText}>EXPIRED</Text>
                      </View>
                    ) : isPlExpired ? (
                      <View style={styles.dialogExpiredBadge}>
                        <Text style={styles.dialogExpiredBadgeText}>EXPIRED</Text>
                      </View>
                    ) : (
                      <View style={styles.dialogSwitchBadge}>
                        <Text style={styles.dialogSwitchBadgeText}>SWITCH</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.dialogEmptyContainer}>
              <Text style={styles.dialogEmptyText}>No saved playlists found</Text>
            </View>
          )}
        </ScrollView>

        {/* Dialogue Footer Actions Row */}
        <View style={styles.dialogFooterRow}>
          <TouchableOpacity
            style={styles.dialogFooterAddBtn}
            onPress={handleAddNew}
            activeOpacity={0.8}
            accessibilityLabel="Add New Playlist"
            accessibilityRole="button"
          >
            <Text style={styles.dialogFooterAddText}>+ Add New Playlist</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dialogFooterCancelBtn}
            onPress={() => closeDialog()}
            activeOpacity={0.8}
            accessibilityLabel="Cancel"
            accessibilityRole="button"
          >
            <Text style={styles.dialogFooterCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );

  // Note: SafeArea handled via useSafeAreaInsets; reference for compatibility:
  // <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safeArea} />
  return (
    <View style={styles.container}>
      {/* Minimalist Device ID Badge pinned strictly to top-right */}
      {showDeviceId ? (
        <View style={[styles.topRightBadge, { top: safeTop, right: safeRight }]}>
          <View style={styles.macBadge}>
            <Text style={styles.macLabel}>DEVICE ID: </Text>
            <Text style={styles.macValue}>{deviceId || '--------'}</Text>
          </View>
        </View>
      ) : null}

      {/* Pure Mathematical & Visual Center Stage (Stationary, Unaffected by Modal) */}
      <View style={styles.centerWrapper} pointerEvents="box-none">
        <View style={styles.centerContent}>
          {/* Animated Breathing Logo */}
          <Animated.View
            style={[
              styles.logoAnimWrapper,
              { opacity: logoBreathAnim, transform: [{ scale: logoBreathAnim }] },
            ]}
          >
            {logoLoadError ? (
              <View style={styles.fallbackLogoContainer}>
                <Text style={styles.fallbackLogoFox}>FOX </Text>
                <Text style={styles.fallbackLogoPlayer}>PLAYER</Text>
              </View>
            ) : (
              <Image
                source={require('../../assets/inside-app-logo.png')}
                style={styles.logo}
                resizeMode="contain"
                onError={() => setLogoLoadError(true)}
              />
            )}
          </Animated.View>

          {/* 1. SIMPLE, FLAT MODERN & NON-CLUTTERED EXPIRED VIEW */}
          {isExpired ? (
            <View style={styles.expiredContainer}>
              {/* Minimal Amber Status Capsule */}
              <View style={styles.expiredCapsule}>
                <ClockIcon size={12} color="#F59E0B" />
                <Text style={styles.expiredCapsuleText}>PLAYLIST EXPIRED</Text>
              </View>

              {/* Clean, Simple 1-Line Description */}
              <Text style={styles.expiredMessageText} numberOfLines={2}>
                The playlist{' '}
                <Text style={styles.expiredNameHighlight}>{`"${currentExpiredName}"`}</Text>{' '}
                subscription has ended.
              </Text>

              {/* Flat Modern Actions Row */}
              <View style={styles.expiredActionsRow}>
                {/* Dialogue Trigger Button for Saved Playlists */}
                {savedPlaylists && savedPlaylists.length > 0 && (
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={openDialog}
                    activeOpacity={0.8}
                    accessibilityLabel="Switch Playlist"
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryBtnText}>
                      Switch Playlist{savedPlaylists.length > 1 ? ` (${savedPlaylists.length})` : ''}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Add New Playlist Button */}
                <TouchableOpacity
                  style={styles.primaryAddBtn}
                  onPress={handleAddNew}
                  activeOpacity={0.8}
                  accessibilityLabel="Add Playlist"
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryAddBtnText}>+ Add Playlist</Text>
                </TouchableOpacity>

                {/* Check Again / Retry Button */}
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={handleRetryPress}
                  activeOpacity={0.8}
                  accessibilityLabel="Check Status"
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryBtnText}>Check Status</Text>
                </TouchableOpacity>

                {/* Dismiss Button */}
                {typeof onDismiss === 'function' && (
                  <TouchableOpacity
                    style={styles.dismissBtn}
                    onPress={handleDismissPress}
                    activeOpacity={0.8}
                    accessibilityLabel="Dismiss"
                    accessibilityRole="button"
                  >
                    <Text style={styles.dismissBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : error ? (
            /* 2. SIMPLE CONNECTION ERROR DISPLAY */
            <View style={styles.errorContainer}>
              <View style={styles.errorPill}>
                <AlertCircleIcon size={15} color="#EF4444" />
                <Text style={styles.errorPillText} numberOfLines={2}>
                  {error}
                </Text>
              </View>

              <View style={styles.errorActionsRow}>
                {typeof onRetry === 'function' && (
                  <TouchableOpacity
                    style={styles.retryButton}
                    onPress={onRetry}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.retryButtonText}>Retry</Text>
                  </TouchableOpacity>
                )}
                {savedPlaylists.length > 1 && (
                  <TouchableOpacity
                    style={styles.switchPlaylistButton}
                    onPress={openDialog}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.switchPlaylistButtonText}>Switch Playlist</Text>
                  </TouchableOpacity>
                )}
                {typeof onDismiss === 'function' && (
                  <TouchableOpacity
                    style={styles.dismissButton}
                    onPress={onDismiss}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.dismissButtonText}>Dismiss</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            /* 3. NORMAL OTT LOADING PROGRESS BAR */
            <>
              <View style={styles.loadingPill}>
                <Animated.View
                  style={[
                    styles.statusDot,
                    {
                      opacity: statusDotAnim,
                      transform: [
                        {
                          scale: statusDotAnim.interpolate({
                            inputRange: [0.3, 1],
                            outputRange: [0.8, 1.2],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <Text style={styles.loadingPillText} numberOfLines={1}>
                  {displayStep}
                </Text>
              </View>

              <View style={styles.progressBarWrapper}>
                <ProgressBar
                  progress={progress}
                  height={8}
                  borderRadius={4}
                  trackColor="rgba(255, 255, 255, 0.14)"
                  fillColor={Colors.brand.primary}
                />
              </View>

              <Animated.Text
                style={[styles.pleaseWaitText, { opacity: pulseAnim }]}
                numberOfLines={1}
              >
                {subMessage}
              </Animated.Text>
            </>
          )}
        </View>
      </View>

      {/* Pop Animated Modal Dialogue (Universal Native Modal Layer) */}
      <FoxModal
        visible={dialogOpen}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        hardwareAccelerated={true}
        onRequestClose={() => closeDialog()}
      >
        {renderDialogueContent()}
      </FoxModal>

      {/* Bottom Disclaimer */}
      <View style={[styles.bottomFooter, { bottom: safeBottom }]}>
        <Text style={styles.disclaimerText} numberOfLines={1}>
          FoxPlayer is a media player only, and does not include any content.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#080A0F',
  },
  container: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#080A0F',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  topRightBadge: {
    position: 'absolute',
    zIndex: 20,
  },
  macBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 24, 34, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  macLabel: {
    fontSize: 9.5,
    fontWeight: '800',
    color: Colors.brand.primary,
    letterSpacing: 0.5,
  },
  macValue: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  centerWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  centerContent: {
    width: '100%',
    maxWidth: 540,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    paddingHorizontal: 16,
  },
  logoAnimWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: {
    width: 136,
    height: 30,
  },
  fallbackLogoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    height: 30,
  },
  fallbackLogoFox: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.brand.primary,
    letterSpacing: 2,
  },
  fallbackLogoPlayer: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  loadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 14,
    paddingVertical: 5.5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 14,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brand.primary,
    marginRight: 8,
  },
  loadingPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  progressBarWrapper: {
    width: 320,
    maxWidth: '85%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  pleaseWaitText: {
    fontSize: 11.5,
    fontWeight: '500',
    color: Colors.text.secondary,
    letterSpacing: 0.3,
    textAlign: 'center',
  },

  /* Flat, Clean & Modern Expired Presentation */
  expiredContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  expiredCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 4.5,
    borderRadius: 14,
    gap: 6,
    marginBottom: 12,
  },
  expiredCapsuleText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#F59E0B',
    letterSpacing: 0.8,
  },
  expiredMessageText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94A3B8',
    textAlign: 'center',
    maxWidth: 460,
    marginBottom: 18,
  },
  expiredNameHighlight: {
    color: '#F59E0B',
    fontWeight: '700',
  },
  expiredActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  primaryAddBtn: {
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 9,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAddBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#000000',
  },
  secondaryBtn: {
    height: 38,
    paddingHorizontal: 15,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dismissBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissBtnText: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#94A3B8',
  },

  /* Clean Animated Pop-in Dialogue (No SVGs) */
  modalRootContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 99999,
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    zIndex: 1,
  },
  dialogCard: {
    width: '90%',
    maxWidth: 380,
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: 14,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 10,
  },
  dialogHeaderTitleBlock: {
    flex: 1,
    marginRight: 10,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  dialogSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#94A3B8',
    marginTop: 2,
  },
  dialogCloseCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dialogCloseText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  dialogScrollView: {
    maxHeight: 180,
  },
  dialogScrollContent: {
    paddingVertical: 2,
  },
  dialogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  dialogItemDisabled: {
    opacity: 0.45,
  },
  dialogItemCurrent: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderWidth: 1,
  },
  dialogItemLeft: {
    flex: 1,
    marginRight: 10,
  },
  dialogItemRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  dialogItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dialogItemNameExpired: {
    color: '#94A3B8',
  },
  dialogItemSubtext: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  dialogSwitchBadge: {
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dialogSwitchBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#080A0F',
    letterSpacing: 0.5,
  },
  dialogExpiredBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dialogExpiredBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  dialogEmptyContainer: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogEmptyText: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#64748B',
  },
  dialogFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  dialogFooterAddBtn: {
    flex: 1,
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogFooterAddText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dialogFooterCancelBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogFooterCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },

  /* Error Container Styles */
  errorContainer: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 440,
    marginTop: 4,
  },
  errorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    marginBottom: 14,
    gap: 8,
  },
  errorPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FCA5A5',
    textAlign: 'center',
    maxWidth: 360,
  },
  errorActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  retryButton: {
    height: 38,
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#080A0F',
    letterSpacing: 0.5,
  },
  switchPlaylistButton: {
    height: 38,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 15,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchPlaylistButtonText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  dismissButton: {
    height: 38,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 14,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  bottomFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  disclaimerText: {
    fontSize: 9.5,
    fontWeight: '500',
    color: '#64748B',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
});
