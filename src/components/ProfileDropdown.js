import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TouchableWithoutFeedback,
  Platform,
  Animated,
  Easing,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import FoxModal from './FoxModal';
import { useRouter } from 'expo-router';
import { useApp } from '../state/AppContext';
import Colors from '../constants/colors';
import {
  UserIcon,
  ChevronDownIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
} from './Icons';

function resolveAccentColor(color) {
  if (!color || color === '#00F0FF' || String(color).toLowerCase() === '#00f0ff') {
    return Colors.brand.primary;
  }
  return color;
}

export default function ProfileDropdown({ compact = false }) {
  const {
    savedPlaylists = [],
    activePlaylistId,
    activePlaylist,
    switchPlaylist,
    deleteSavedPlaylist,
    isConfigured,
    activeProfile,
  } = useApp();

  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const cardWidth = Math.min(265, Math.max(240, windowWidth - 24));

  const [isOpen, setIsOpen] = useState(false);
  const [dropdownCoords, setDropdownCoords] = useState({ top: 54, right: 16 });
  const [switchingPlaylistId, setSwitchingPlaylistId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const buttonRef = useRef(null);
  const isClosingRef = useRef(false);

  // Animation value
  const openAnim = useRef(new Animated.Value(0)).current;

  // Active playlist display name
  const activeName =
    activePlaylist?.name ||
    (savedPlaylists.length > 0 ? savedPlaylists[0].name : 'Profile');

  const accentColor = resolveAccentColor(activeProfile?.color);

  // Smooth animated exit
  const closeDropdown = useCallback(
    (onFinished) => {
      isClosingRef.current = true;
      Animated.timing(openAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start(() => {
        setIsOpen(false);
        setSwitchingPlaylistId(null);
        setConfirmDeleteId(null);
        isClosingRef.current = false;
        if (typeof onFinished === 'function') {
          onFinished();
        }
      });
    },
    [openAnim]
  );

  // Auto-close dropdown if all playlists are removed and app becomes not configured
  useEffect(() => {
    if (!isConfigured && isOpen) {
      closeDropdown();
    }
  }, [isConfigured, isOpen, closeDropdown]);

  // Open with anchored spring pop animation right under the button
  const openDropdown = useCallback(() => {
    if (isClosingRef.current) return;
    if (isOpen) {
      closeDropdown();
      return;
    }

    const showDropdownAt = (top, right) => {
      setDropdownCoords({ top, right });
      setIsOpen(true);
      setConfirmDeleteId(null);
      openAnim.setValue(0);

      Animated.spring(openAnim, {
        toValue: 1,
        tension: 95,
        friction: 8,
        useNativeDriver: true,
      }).start();
    };

    if (buttonRef.current?.measureInWindow) {
      buttonRef.current.measureInWindow((x, y, width, height) => {
        if (
          typeof x === 'number' &&
          typeof y === 'number' &&
          typeof width === 'number' &&
          typeof height === 'number'
        ) {
          const topPos = Math.max(8, Math.round(y + height + 5));
          const rightPos = Math.max(
            8,
            Math.min(windowWidth - cardWidth - 8, Math.round(windowWidth - (x + width)))
          );
          showDropdownAt(topPos, rightPos);
        } else {
          showDropdownAt(54, 16);
        }
      });
    } else {
      showDropdownAt(54, 16);
    }
  }, [isOpen, openAnim, closeDropdown, windowWidth, cardWidth]);

  const handleSelectPlaylist = useCallback(
    (playlistId) => {
      if (playlistId === activePlaylistId) {
        closeDropdown();
        return;
      }
      setSwitchingPlaylistId(playlistId);
      closeDropdown(async () => {
        try {
          const res = await switchPlaylist(playlistId);
          if (res?.success) {
            router.replace('/(tabs)');
          }
        } catch (err) {
          console.error('[ProfileDropdown] Switch error:', err);
        } finally {
          setSwitchingPlaylistId(null);
        }
      });
    },
    [activePlaylistId, switchPlaylist, closeDropdown, router]
  );

  const handleAddPlaylist = useCallback(() => {
    closeDropdown(() => {
      router.push('/pairing?mode=add');
    });
  }, [router, closeDropdown]);

  const handleDeletePress = useCallback((playlistId, e) => {
    if (e?.stopPropagation) e.stopPropagation();
    setConfirmDeleteId(playlistId);
  }, []);

  const handleConfirmDelete = useCallback(
    async (playlistId, e) => {
      if (e?.stopPropagation) e.stopPropagation();
      try {
        await deleteSavedPlaylist(playlistId);
      } catch (err) {
        console.error('[ProfileDropdown] Delete error:', err);
      } finally {
        setConfirmDeleteId(null);
      }
    },
    [deleteSavedPlaylist]
  );

  const handleCancelDelete = useCallback((e) => {
    if (e?.stopPropagation) e.stopPropagation();
    setConfirmDeleteId(null);
  }, []);

  // Pop-in scale: 0.94 -> 1.0 (subtle tactile pop directly in place)
  const cardScale = useMemo(
    () =>
      openAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.94, 1],
      }),
    [openAnim]
  );

  // Crisp opacity
  const cardOpacity = useMemo(
    () =>
      openAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
      }),
    [openAnim]
  );

  const backdropOpacity = useMemo(
    () =>
      openAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
      }),
    [openAnim]
  );

  const chevronRotate = useMemo(
    () =>
      openAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '180deg'],
      }),
    [openAnim]
  );

  // Dynamic scroll height to prevent landscape screen overflow
  const availableScrollHeight = Math.max(
    110,
    Math.min(220, windowHeight - dropdownCoords.top - 120)
  );

  return (
    <View style={styles.container}>
      {/* Top-Right Profile / Playlist Trigger Button */}
      <TouchableOpacity
        ref={buttonRef}
        style={[
          styles.profileButton,
          isOpen && styles.profileButtonActive,
          compact && styles.profileButtonCompact,
        ]}
        onPress={openDropdown}
        activeOpacity={0.8}
        accessibilityLabel={`Playlist: ${activeName}`}
        accessibilityRole="button"
      >
        <View
          style={[
            styles.avatarIconWrapper,
            {
              backgroundColor: Colors.brand.glow,
              borderColor: Colors.brand.primary,
              borderWidth: 1,
            },
          ]}
        >
          <UserIcon size={12} color={accentColor} />
        </View>

        {!compact && (
          <Text style={styles.playlistNameText} numberOfLines={1} ellipsizeMode="tail">
            {activeName}
          </Text>
        )}

        <Animated.View
          style={[styles.chevronWrapper, { transform: [{ rotate: chevronRotate }] }]}
        >
          <ChevronDownIcon size={12} color="#9BA3B2" />
        </Animated.View>
      </TouchableOpacity>

      {/* Anchored Dropdown Menu Modal (Completely unmounted when closed) */}
      {isOpen ? (
        <FoxModal
          visible={true}
          transparent={true}
          statusBarTranslucent={true}
          hardwareAccelerated={true}
          animationType="none"
          onRequestClose={() => closeDropdown()}
        >
          <TouchableWithoutFeedback onPress={() => closeDropdown()}>
            <Animated.View style={[styles.modalOverlay, { opacity: backdropOpacity }]}>
              <TouchableWithoutFeedback>
                <Animated.View
                  style={[
                    styles.dropdownCard,
                    {
                      top: dropdownCoords.top,
                      right: dropdownCoords.right,
                      width: cardWidth,
                      opacity: cardOpacity,
                      transform: [{ scale: cardScale }],
                    },
                  ]}
                >
                  {/* Playlist list */}
                  <ScrollView
                    style={[styles.playlistScroll, { maxHeight: availableScrollHeight }]}
                    contentContainerStyle={styles.playlistScrollContent}
                    showsVerticalScrollIndicator={true}
                    bounces={false}
                  >
                    {savedPlaylists.length === 0 ? (
                      <View style={styles.emptyItem}>
                        <Text style={styles.emptyItemText}>No playlists saved</Text>
                      </View>
                    ) : (
                      savedPlaylists.map((pl) => {
                        const isActive = String(pl.id) === String(activePlaylistId);
                        const isSwitching = String(pl.id) === String(switchingPlaylistId);
                        const isConfirmingDelete = String(pl.id) === String(confirmDeleteId);

                        if (isConfirmingDelete) {
                          return (
                            <View key={String(pl.id)} style={styles.deleteConfirmRow}>
                              <Text style={styles.deleteConfirmText} numberOfLines={1}>
                                Remove playlist?
                              </Text>
                              <View style={styles.deleteActions}>
                                <TouchableOpacity
                                  style={styles.cancelBtn}
                                  onPress={handleCancelDelete}
                                  activeOpacity={0.7}
                                >
                                  <Text style={styles.cancelBtnText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={styles.confirmDeleteBtn}
                                  onPress={(e) => handleConfirmDelete(pl.id, e)}
                                  activeOpacity={0.7}
                                >
                                  <Text style={styles.confirmDeleteBtnText}>Delete</Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        }

                        return (
                          <TouchableOpacity
                            key={String(pl.id)}
                            style={[styles.playlistRow, isActive && styles.playlistRowActive]}
                            onPress={() => handleSelectPlaylist(pl.id)}
                            activeOpacity={0.75}
                            disabled={isSwitching}
                          >
                            {/* Active / Switching Indicator */}
                            <View style={styles.checkWrapper}>
                              {isSwitching ? (
                                <ActivityIndicator size="small" color={Colors.brand.primary} />
                              ) : isActive ? (
                                <View style={styles.checkCircleActive}>
                                  <CheckIcon size={10} color="#FFFFFF" />
                                </View>
                              ) : (
                                <View style={styles.checkCircleInactive} />
                              )}
                            </View>

                            <View style={styles.playlistInfo}>
                              <Text
                                style={[
                                  styles.playlistTitle,
                                  isActive && styles.playlistTitleActive,
                                ]}
                                numberOfLines={2}
                                ellipsizeMode="tail"
                              >
                                {pl.name || 'Untitled playlist'}
                              </Text>
                            </View>

                            {/* Delete Action (only if more than 1 playlist) */}
                            {savedPlaylists.length > 1 && (
                              <TouchableOpacity
                                style={styles.deleteButton}
                                onPress={(e) => handleDeletePress(pl.id, e)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                accessibilityLabel={`Delete ${pl.name}`}
                                activeOpacity={0.65}
                              >
                                <TrashIcon size={12} color="#6B7280" />
                              </TouchableOpacity>
                            )}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>

                  <TouchableOpacity
                    style={styles.addPlaylistButton}
                    onPress={handleAddPlaylist}
                    activeOpacity={0.8}
                  >
                    <PlusIcon size={12} color={Colors.brand.primary} />
                    <Text style={styles.addPlaylistText}>Add playlist</Text>
                  </TouchableOpacity>
                </Animated.View>
              </TouchableWithoutFeedback>
            </Animated.View>
          </TouchableWithoutFeedback>
        </FoxModal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  profileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#151923',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#262B38',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 7,
    maxWidth: 195,
  },
  profileButtonActive: {
    backgroundColor: '#1C2230',
    borderColor: '#3B4356',
  },
  profileButtonCompact: {
    paddingHorizontal: 8,
    maxWidth: 60,
    gap: 4,
  },
  avatarIconWrapper: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#202636',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistNameText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E5E7EB',
    flexShrink: 1,
  },
  chevronWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  dropdownCard: {
    position: 'absolute',
    backgroundColor: '#151923',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262B38',
    paddingVertical: 6,
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 2,
  },
  profileSectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  profileSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  profileMiniDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  profileTextBlock: {
    flex: 1,
  },
  profileSectionName: {
    fontSize: 12,
    fontWeight: '700',
  },
  profileSectionType: {
    fontSize: 10,
    color: '#9BA3B2',
  },
  switchProfileBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  switchProfileBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  dropdownHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dropdownHeaderTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8E95A5',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  countBadge: {
    backgroundColor: '#202636',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8E95A5',
  },
  divider: {
    height: 1,
    backgroundColor: '#202636',
    marginVertical: 5,
    marginHorizontal: 10,
  },
  playlistScroll: {},
  playlistScrollContent: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  emptyItem: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyItemText: {
    fontSize: 12,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginVertical: 2,
    backgroundColor: '#181D2A',
    borderWidth: 1,
    borderColor: '#222838',
    gap: 8,
  },
  playlistRowActive: {
    backgroundColor: '#1F2536',
    borderColor: '#3B445A',
  },
  checkWrapper: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleActive: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleInactive: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#3A4254',
  },
  playlistInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  playlistTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playlistTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9BA3B2',
    flexShrink: 1,
  },
  playlistTitleActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  activePill: {
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  activePillText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: Colors.brand.primary,
    letterSpacing: 0.3,
  },
  playlistMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeBadge: {
    backgroundColor: '#202636',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#2B3346',
  },
  typeBadgeText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#8E95A5',
    letterSpacing: 0.3,
  },
  subtitleText: {
    fontSize: 10,
    color: '#5C6370',
    flexShrink: 1,
  },
  deleteButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#202636',
  },
  deleteConfirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginVertical: 2,
    backgroundColor: '#251D22',
    borderWidth: 1,
    borderColor: '#4A2A33',
  },
  deleteConfirmText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#F87171',
    flexShrink: 1,
  },
  deleteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cancelBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#2E3547',
  },
  cancelBtnText: {
    fontSize: 10.5,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  confirmDeleteBtn: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: '#DC2626',
  },
  confirmDeleteBtnText: {
    fontSize: 10.5,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  addPlaylistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 6,
    marginTop: 2,
    borderRadius: 8,
    backgroundColor: '#1A1F2C',
    borderWidth: 1,
    borderColor: '#262D3E',
    gap: 8,
  },
  addIconCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2A3245',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlaylistText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: Colors.brand.primary,
    letterSpacing: 0.2,
  },
});
