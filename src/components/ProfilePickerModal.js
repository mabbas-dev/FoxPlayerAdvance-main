/**
 * FOX PLAYER — "Who's Watching?" API Profile Picker
 *
 * Authoritative OTT profile selection screen:
 * - Displays device playlist profiles directly fetched from the backend API
 * - Follows the exact Fox Player dark luxury theme (Deep dark palette with Brand Orange & Cyan accents)
 * - Highlights the active profile with smooth micro-animations
 * - Displays format badge (XTREAM / M3U) and provider host/account subtitle
 * - Allows switching profiles or adding new profiles (up to 4 profiles per device)
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

  const apiProfiles = useMemo(() => {
    return Array.isArray(profiles) ? profiles.slice(0, 4) : [];
  }, [profiles]);

  if (!visible) return null;

  const canAddMore = apiProfiles.length < 4 && typeof onAddNewProfile === 'function';
  const totalCards = Math.max(1, apiProfiles.length + (canAddMore ? 1 : 0));

  const cardWidth = isLandscape
    ? Math.min(180, Math.floor((screenWidth - 120) / totalCards))
    : Math.min(150, Math.floor((screenWidth - 60) / Math.min(2, totalCards)));

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
            },
          ]}
        >
          <Text style={styles.title}>Select Profile</Text>
          <Text style={styles.subtitle}>Choose your IPTV profile to continue</Text>

          {/* Profiles Row */}
          <ScrollView
            horizontal={isLandscape}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.profilesScrollContent,
              isLandscape ? styles.rowLandscape : styles.rowPortrait,
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
                        backgroundColor: `${accentColor}18`,
                        borderColor: accentColor,
                        shadowColor: accentColor,
                      },
                    ]}
                  >
                    <UserIcon size={36} color={accentColor} />

                    {isActive && (
                      <View style={[styles.activeCheckBadge, { backgroundColor: accentColor }]}>
                        <CheckIcon size={12} color="#000000" />
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

            {/* Optional Add Profile Card if fewer than 4 profiles configured */}
            {canAddMore && (
              <TouchableOpacity
                style={[styles.addProfileCard, { width: cardWidth }]}
                activeOpacity={0.75}
                onPress={onAddNewProfile}
                accessibilityLabel="Add new profile"
                accessibilityRole="button"
              >
                <View style={styles.addAvatarWrapper}>
                  <PlusIcon size={30} color={Colors.brand.primary} />
                </View>
                <Text style={styles.addProfileTitle}>+ Add Profile</Text>
                <Text style={styles.addProfileSubtitle}>Available Slot</Text>
                <View style={styles.badgesRow}>
                  <View style={[styles.typeBadge, { backgroundColor: Colors.brand.glow }]}>
                    <Text style={[styles.typeBadgeText, { color: Colors.brand.primary }]}>+ ADD</Text>
                  </View>
                </View>
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
    paddingHorizontal: 32,
    zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoImage: {
    width: 140,
    height: 38,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#161C26',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#F0F2F5',
    fontSize: 16,
    fontWeight: '700',
  },
  contentContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F0F2F5',
    letterSpacing: 0.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#9BA3B2',
    marginBottom: 28,
    textAlign: 'center',
  },
  profilesScrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  rowLandscape: {
    flexDirection: 'row',
    gap: 18,
  },
  rowPortrait: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  profileCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#161C26',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  profileCardActive: {
    backgroundColor: '#1A212E',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 10,
  },
  avatarWrapper: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    position: 'relative',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  activeCheckBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#161C26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F2F5',
    textAlign: 'center',
    marginBottom: 3,
    width: '100%',
  },
  profileSubtitle: {
    fontSize: 11,
    color: '#9BA3B2',
    textAlign: 'center',
    marginBottom: 10,
    width: '100%',
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  activePill: {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activePillText: {
    color: '#22C55E',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  addProfileCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#111620',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderStyle: 'dashed',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  addAvatarWrapper: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.brand.glow,
    borderWidth: 1.5,
    borderColor: Colors.border.glow,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  addProfileTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#CBD5E1',
    textAlign: 'center',
    marginBottom: 3,
    width: '100%',
  },
  addProfileSubtitle: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 10,
    width: '100%',
  },
});
