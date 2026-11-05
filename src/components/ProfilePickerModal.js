/**
 * FOX PLAYER — "Who's Watching?" API Profile Picker
 *
 * Authoritative OTT profile selection screen:
 * - Displays device playlist profiles directly fetched from the backend API
 * - Follows the exact Fox Player dark luxury theme (Deep dark palette with Brand Orange & Cyan accents)
 * - Highlights the active profile with smooth micro-animations
 * - Displays format badge (XTREAM / M3U) and provider host/account subtitle
 * - Allows switching profiles or adding new profiles
 */

import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  useWindowDimensions,
  Image,
  ScrollView,
} from 'react-native';
import FoxModal from './FoxModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UserIcon, PlusIcon, CheckIcon } from './Icons';
import Colors from '../constants/colors';

// Profile accent colors matching Fox Player's design system (orange-led palette)
const PROFILE_ACCENT_COLORS = ['#F97316', '#FB923C', '#EA580C', '#F59E0B', '#A855F7', '#10B981'];

function resolveProfileAccent(color, fallbackIndex = 0) {
  if (!color || color === '#00F0FF' || String(color).toLowerCase() === '#00f0ff') {
    return PROFILE_ACCENT_COLORS[fallbackIndex % PROFILE_ACCENT_COLORS.length];
  }
  return color;
}

function getProfileSubtitle(pl) {
  if (!pl) return 'IPTV Profile';
  if (pl.type === 'xtream') {
    if (pl.username) return `@${pl.username}`;
    if (pl.serverUrl || pl.server_url) {
      const match = (pl.serverUrl || pl.server_url).match(/^(?:https?:\/\/)?([^/:]+)/i);
      return match ? match[1] : 'Xtream Server';
    }
    return 'Xtream IPTV';
  }
  if (pl.playlistUrl || pl.playlist_url) {
    const match = (pl.playlistUrl || pl.playlist_url).match(/^(?:https?:\/\/)?([^/:]+)/i);
    return match ? match[1] : 'M3U Source';
  }
  return 'IPTV Playlist';
}

export default function ProfilePickerModal({
  visible = false,
  profiles = [],
  activeProfileId = null,
  onSelectProfile = () => {},
  onAddNewProfile = null,
  onClose = null,
  isDismissable = true,
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const isLandscape = screenWidth > screenHeight;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 70,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.95);
    }
  }, [visible, fadeAnim, scaleAnim]);

  const apiProfiles = useMemo(() => (Array.isArray(profiles) ? profiles : []), [profiles]);

  if (!visible) return null;

  const canAddMore = typeof onAddNewProfile === 'function';
  const totalCards = Math.max(1, apiProfiles.length + (canAddMore ? 1 : 0));
  const cardGap = isLandscape ? 12 : 10;
  const horizontalPad = 32;
  const maxCardWidth = isLandscape ? 132 : 118;
  const columnsPortrait = Math.min(2, totalCards);

  const cardWidth = isLandscape
    ? Math.min(
      maxCardWidth,
      Math.floor((Math.min(screenWidth, 720) - horizontalPad * 2 - cardGap * (totalCards - 1)) / totalCards),
    )
    : Math.min(
      maxCardWidth,
      Math.floor((screenWidth - horizontalPad * 2 - cardGap * (columnsPortrait - 1)) / columnsPortrait),
    );

  const avatarSize = isLandscape ? 52 : 48;
  const profileIconSize = isLandscape ? 26 : 24;
  const addIconSize = isLandscape ? 22 : 20;

  return (
    <FoxModal
      visible={visible}
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      hardwareAccelerated={true}
      onRequestClose={() => {
        if (isDismissable && typeof onClose === 'function') {
          onClose();
        }
      }}
    >
      <View style={styles.backdrop}>
        {/* Top Header Bar */}
        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/inside-app-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>

          {isDismissable && typeof onClose === 'function' && (
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              accessibilityLabel="Close profile picker"
              accessibilityRole="button"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Central Content */}
        <Animated.View
          style={[
            styles.contentContainer,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
              maxWidth: Math.min(screenWidth - 24, isLandscape ? 680 : 320),
            },
          ]}
        >
          <Text style={styles.title}>Select Profile</Text>
          <Text style={styles.subtitle}>Pick a playlist to continue</Text>

          {/* Profiles Row */}
          <ScrollView
            horizontal={isLandscape}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.profilesScrollContent,
              isLandscape ? styles.rowLandscape : styles.rowPortrait,
              { gap: cardGap },
            ]}
          >
            {apiProfiles.map((profile, index) => {
              const isActive = String(profile.id) === String(activeProfileId);
              const accentColor = resolveProfileAccent(profile.color, index);
              const subtitle = getProfileSubtitle(profile);
              const displayName = profile.name || profile.playlist_name || `Profile ${index + 1}`;
              const typeLabel = profile.type === 'm3u' ? 'M3U' : 'XTREAM';

              return (
                <TouchableOpacity
                  key={String(profile.id || index)}
                  style={[
                    styles.profileCard,
                    { width: cardWidth },
                    isActive && [styles.profileCardActive, { borderColor: accentColor }],
                  ]}
                  activeOpacity={0.78}
                  onPress={() => onSelectProfile(profile)}
                  accessibilityLabel={`Select profile ${displayName}`}
                  accessibilityRole="button"
                >
                  {/* Avatar Circle with Themed Glow */}
                  <View
                    style={[
                      styles.avatarWrapper,
                      {
                        width: avatarSize,
                        height: avatarSize,
                        borderRadius: avatarSize / 2,
                        backgroundColor: `${accentColor}14`,
                        borderColor: `${accentColor}99`,
                        shadowColor: accentColor,
                      },
                    ]}
                  >
                    <UserIcon size={profileIconSize} color={accentColor} />

                    {isActive && (
                      <View style={[styles.activeCheckBadge, { backgroundColor: accentColor }]}>
                        <CheckIcon size={10} color="#000000" />
                      </View>
                    )}
                  </View>

                  {/* Profile Name */}
                  <Text
                    style={[
                      styles.profileName,
                      isActive && { color: accentColor, fontWeight: '700' },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {displayName}
                  </Text>

                  {/* Subtitle / Host */}
                  <Text style={styles.profileSubtitle} numberOfLines={1} ellipsizeMode="middle">
                    {subtitle}
                  </Text>

                  {/* Badges Row */}
                  <View style={styles.badgesRow}>
                    <View style={[styles.typeBadge, { backgroundColor: `${accentColor}20` }]}>
                      <Text style={[styles.typeBadgeText, { color: accentColor }]}>{typeLabel}</Text>
                    </View>

                    {isActive && (
                      <View style={styles.activePill}>
                        <Text style={styles.activePillText}>ACTIVE</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Optional Add Profile Card */}
            {canAddMore && (
              <TouchableOpacity
                style={[styles.addProfileCard, { width: cardWidth }]}
                activeOpacity={0.75}
                onPress={onAddNewProfile}
                accessibilityLabel="Add new profile"
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.addAvatarWrapper,
                    {
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: avatarSize / 2,
                    },
                  ]}
                >
                  <PlusIcon size={addIconSize} color={Colors.brand.primary} />
                </View>
                <Text style={styles.addProfileTitle}>Add playlist</Text>
                <Text style={styles.addProfileSubtitle}>
                  {4 - apiProfiles.length} slot{4 - apiProfiles.length === 1 ? '' : 's'} left
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#080A0F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoImage: {
    width: 112,
    height: 30,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#121820',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  contentContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 16,
    alignSelf: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F1F5F9',
    letterSpacing: 0.2,
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 17,
  },
  profilesScrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  rowLandscape: {
    flexDirection: 'row',
  },
  rowPortrait: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  profileCard: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: '#121820',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    minHeight: 148,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 3,
  },
  profileCardActive: {
    backgroundColor: '#151C28',
    borderWidth: 1.5,
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 5,
  },
  avatarWrapper: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    position: 'relative',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  activeCheckBadge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#121820',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F1F5F9',
    textAlign: 'center',
    marginBottom: 2,
    width: '100%',
  },
  profileSubtitle: {
    fontSize: 10,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 8,
    width: '100%',
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  activePill: {
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activePillText: {
    color: '#4ADE80',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.35,
  },
  addProfileCard: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(18, 24, 32, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.28)',
    borderStyle: 'dashed',
    minHeight: 148,
  },
  addAvatarWrapper: {
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  addProfileTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    textAlign: 'center',
    marginBottom: 2,
    width: '100%',
  },
  addProfileSubtitle: {
    fontSize: 10,
    color: '#64748B',
    textAlign: 'center',
    width: '100%',
  },
});
