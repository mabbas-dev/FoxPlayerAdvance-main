import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
} from 'react-native';
import FoxModal from './FoxModal';
import { useRouter } from 'expo-router';
import Colors from '../constants/colors';
import { useApp } from '../state/AppContext';
import { ClockIcon } from './Icons';
import { isPlaylistExpired } from '../services/networkErrors';

/**
 * Modern, Minimalist Playlist Expired View
 *
 * Production-quality, consistent expired state presentation across:
 * - Live TV
 * - Movies
 * - Series
 * - Favorites
 *
 * Clean, flat aesthetics (zero neon effects / glows / excessive gradients).
 */
export default function PlaylistExpiredView({
  title = 'Playlist Expired',
  playlistName: propPlaylistName,
  message,
  onRetry,
  compact = false,
  style,
}) {
  const {
    activePlaylist,
    playlistConfig,
    savedPlaylists = [],
    activePlaylistId,
    switchPlaylist,
    reloadPlaylist,
    activePlaylistName,
  } = useApp();
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState(null);
  const dialogAnim = React.useRef(new Animated.Value(0)).current;

  const currentName =
    propPlaylistName ||
    activePlaylistName ||
    activePlaylist?.name ||
    playlistConfig?.name ||
    playlistConfig?.config?.name ||
    'Current Playlist';

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

  const handleSwitch = useCallback(
    async (targetId) => {
      if (!targetId || switchingId) return;
      setSwitchingId(targetId);
      closeDialog(async () => {
        try {
          if (typeof switchPlaylist === 'function') {
            await switchPlaylist(targetId);
          }
        } catch (err) {
          console.warn('[PlaylistExpiredView] Switch playlist error:', err?.message);
        } finally {
          setSwitchingId(null);
        }
      });
    },
    [switchingId, closeDialog, switchPlaylist]
  );

  const handleAddNew = useCallback(() => {
    closeDialog(() => {
      try {
        router.push('/pairing?mode=add');
      } catch (err) {
        console.warn('[PlaylistExpiredView] Navigate to add error:', err?.message);
      }
    });
  }, [closeDialog, router]);

  const handleCheckStatus = useCallback(() => {
    if (typeof onRetry === 'function') {
      onRetry();
    } else if (typeof reloadPlaylist === 'function') {
      reloadPlaylist(null, { isManual: true }).catch(() => {});
    }
  }, [onRetry, reloadPlaylist]);

  const displayMessage =
    message ||
    `The subscription for "${currentName}" has expired. Switch to another playlist or add a new line to continue watching.`;

  return (
    <View style={[styles.container, compact && styles.containerCompact, style]}>
      {/* Amber Minimalist Capsule */}
      <View style={styles.expiredCapsule}>
        <ClockIcon size={13} color="#F59E0B" />
        <Text style={styles.expiredCapsuleText}>{title.toUpperCase()}</Text>
      </View>

      {/* Clean Heading */}
      <Text style={[styles.headingText, compact && styles.headingTextCompact]}>
        {title}
      </Text>

      {/* Description */}
      <Text style={[styles.messageText, compact && styles.messageTextCompact]} numberOfLines={3}>
        {displayMessage}
      </Text>

      {/* Action Buttons Row */}
      <View style={styles.actionsRow}>
        {savedPlaylists.length > 1 && (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={openDialog}
            activeOpacity={0.8}
            accessibilityLabel="Switch Playlist"
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>
              Switch Playlist ({savedPlaylists.length})
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.primaryAddBtn}
          onPress={handleAddNew}
          activeOpacity={0.8}
          accessibilityLabel="Add New Playlist"
          accessibilityRole="button"
        >
          <Text style={styles.primaryAddBtnText}>+ Add Playlist</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleCheckStatus}
          activeOpacity={0.8}
          accessibilityLabel="Check Status"
          accessibilityRole="button"
        >
          <Text style={styles.secondaryBtnText}>Check Status</Text>
        </TouchableOpacity>
      </View>

      {/* Switch Playlist Pop Dialog */}
      <FoxModal
        visible={dialogOpen}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        hardwareAccelerated={true}
        onRequestClose={() => closeDialog()}
      >
        <View style={styles.modalRootContainer}>
          {/* Full-screen Backdrop */}
          <Animated.View
            style={[
              StyleSheet.absoluteFillObject,
              styles.dialogBackdrop,
              { opacity: dialogAnim },
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFillObject}
              activeOpacity={1}
              onPress={() => closeDialog()}
              accessibilityLabel="Close dialog"
              accessibilityRole="button"
            />
          </Animated.View>

          {/* Centered Dialog Card */}
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
            {/* Header */}
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

            {/* List */}
            <ScrollView
              style={styles.dialogScrollView}
              contentContainerStyle={styles.dialogScrollContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {savedPlaylists.map((pl) => {
                const isCurrentPl = String(pl.id) === String(activePlaylistId);
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
              })}
            </ScrollView>

            {/* Footer */}
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
      </FoxModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    backgroundColor: 'transparent',
  },
  containerCompact: {
    paddingVertical: 16,
    paddingHorizontal: 16,
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
    fontSize: 10,
    fontWeight: '800',
    color: '#F59E0B',
    letterSpacing: 0.8,
  },
  headingText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  headingTextCompact: {
    fontSize: 16,
    marginBottom: 6,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#94A3B8',
    textAlign: 'center',
    maxWidth: 480,
    marginBottom: 20,
  },
  messageTextCompact: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  primaryAddBtn: {
    height: 38,
    paddingHorizontal: 18,
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

  /* Modal Dialog */
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
    zIndex: 2,
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
});
