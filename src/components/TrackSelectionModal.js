import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import FoxModal from './FoxModal';
import Colors from '../constants/colors';
import {
  AudioTrackIcon,
  SubtitleTrackIcon,
  CheckIcon,
  CloseXIcon,
} from './Icons';
import {
  SUBTITLE_SIZE,
  SUBTITLE_FONT_SIZES,
  normalizeSubtitleSizeId,
} from '../playback/playerSettings.js';

// Comprehensive language map for converting ISO codes to friendly display names
const LANGUAGE_NAMES = {
  en: 'English',
  eng: 'English',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fra: 'French',
  fre: 'French',
  de: 'German',
  deu: 'German',
  ger: 'German',
  it: 'Italian',
  ita: 'Italian',
  pt: 'Portuguese',
  por: 'Portuguese',
  ru: 'Russian',
  rus: 'Russian',
  ar: 'Arabic',
  ara: 'Arabic',
  hi: 'Hindi',
  hin: 'Hindi',
  ur: 'Urdu',
  urd: 'Urdu',
  zh: 'Chinese',
  zho: 'Chinese',
  chi: 'Chinese',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  tr: 'Turkish',
  tur: 'Turkish',
  pl: 'Polish',
  pol: 'Polish',
  nl: 'Dutch',
  nld: 'Dutch',
  dut: 'Dutch',
  sv: 'Swedish',
  swe: 'Swedish',
  no: 'Norwegian',
  nor: 'Norwegian',
  da: 'Danish',
  dan: 'Danish',
  fi: 'Finnish',
  fin: 'Finnish',
  el: 'Greek',
  ell: 'Greek',
  gre: 'Greek',
  ro: 'Romanian',
  ron: 'Romanian',
  rum: 'Romanian',
  cs: 'Czech',
  ces: 'Czech',
  cze: 'Czech',
  hu: 'Hungarian',
  hun: 'Hungarian',
  uk: 'Ukrainian',
  ukr: 'Ukrainian',
  und: 'Original Audio',
};

// Caption font size presets (S / N / L / XL → playerSettings px map)
export const SUBTITLE_SIZES = [
  { id: SUBTITLE_SIZE.SMALL, label: 'Small', sizePx: SUBTITLE_FONT_SIZES.small },
  { id: SUBTITLE_SIZE.NORMAL, label: 'Normal', sizePx: SUBTITLE_FONT_SIZES.normal },
  { id: SUBTITLE_SIZE.LARGE, label: 'Large', sizePx: SUBTITLE_FONT_SIZES.large },
  {
    id: SUBTITLE_SIZE.EXTRA_LARGE,
    label: 'Extra Large',
    sizePx: SUBTITLE_FONT_SIZES.extra_large,
  },
];

/**
 * Parses and extracts a clean display title, language code, and description subtext for a track.
 */
export function parseTrackInfo(track, index = 0, defaultPrefix = 'Track') {
  if (!track) {
    return {
      displayTitle: `${defaultPrefix} ${index + 1}`,
      langCode: '',
      friendlyName: 'Default Audio',
      subtext: 'Original Stream',
    };
  }

  let code = (track.language || '').toLowerCase().trim();
  let friendlyName = LANGUAGE_NAMES[code] || '';

  const rawLabel = (track.label || track.name || track.title || '').trim();
  const isNumericOnly = /^\d+$/.test(rawLabel);

  // If language code wasn't explicit (e.g. VLC tracks), search name/label
  if (!friendlyName && rawLabel && !isNumericOnly) {
    const lower = rawLabel.toLowerCase();
    for (const [c, name] of Object.entries(LANGUAGE_NAMES)) {
      if (lower.includes(name.toLowerCase()) || lower === c) {
        code = c;
        friendlyName = name;
        break;
      }
    }
  }

  let displayTitle = '';
  if (isNumericOnly) {
    const num = rawLabel || String(index + 1);
    displayTitle = friendlyName ? `${friendlyName} • ${defaultPrefix} ${num}` : `${defaultPrefix} ${num}`;
  } else if (rawLabel) {
    displayTitle = friendlyName && !rawLabel.toLowerCase().includes(friendlyName.toLowerCase())
      ? `${friendlyName} • ${rawLabel}`
      : rawLabel;
  } else if (friendlyName) {
    displayTitle = index === 0 ? `${friendlyName} (Default)` : `${friendlyName} (${defaultPrefix} ${index + 1})`;
  } else {
    displayTitle = index === 0 ? 'Default Audio Track' : `${defaultPrefix} ${index + 1}`;
  }

  let subtext = '';
  if (track.isDefault || track.default) {
    subtext = friendlyName ? `${friendlyName} • Stream Default` : 'Original Default Audio Stream';
  } else if (friendlyName) {
    subtext = `${friendlyName} Audio Stream`;
  } else if (track.channels) {
    subtext = `${track.channels} Channels Audio`;
  } else {
    subtext = `Multi-Channel Audio Stream ${index + 1}`;
  }

  const langCode = (code && code !== 'und')
    ? code.toUpperCase().slice(0, 3)
    : (friendlyName ? friendlyName.slice(0, 3).toUpperCase() : '');

  return {
    displayTitle,
    langCode,
    friendlyName: friendlyName || 'Default Audio',
    subtext,
  };
}

export function formatTrackDisplayLabel(track, index = 0, defaultPrefix = 'Track') {
  const { displayTitle, friendlyName } = parseTrackInfo(track, index, defaultPrefix);
  if (friendlyName && !displayTitle.toLowerCase().includes(friendlyName.toLowerCase())) {
    return `${friendlyName} (${displayTitle})`;
  }
  return displayTitle;
}

/**
 * Modal dialog for selecting audio and subtitle/closed-caption tracks with caption size adjustment.
 * Features a spring pop entrance animation, pre-selected default track, and responsive, smooth scrolling.
 */
export default function TrackSelectionModal({
  visible = false,
  onClose,
  initialTab = 'audio',
  availableAudioTracks = [],
  selectedAudioTrack = null,
  onSelectAudioTrack,
  availableSubtitleTracks = [],
  selectedSubtitleTrack = null,
  onSelectSubtitleTrack,
  subtitleSize = 'normal',
  onSelectSubtitleSize,
}) {
  const [selectedTab, setSelectedTab] = useState(initialTab || 'audio');
  const [currentSubtitleSize, setCurrentSubtitleSize] = useState(
    () => normalizeSubtitleSizeId(subtitleSize),
  );

  // Pop animation values
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(visible);

  // Sync state whenever modal becomes visible
  useEffect(() => {
    if (visible) {
      setIsRendered(true);
      setSelectedTab(initialTab || 'audio');
      setCurrentSubtitleSize(normalizeSubtitleSizeId(subtitleSize));

      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);

      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 7,
          tension: 70,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 140,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.88,
          duration: 140,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setIsRendered(false);
      });
    }
  }, [visible, initialTab, subtitleSize, opacityAnim, scaleAnim]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.88,
        duration: 140,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose?.();
    });
  };

  const audioList = useMemo(() => {
    const list = Array.isArray(availableAudioTracks) ? availableAudioTracks : [];
    // If no tracks returned by player, provide a standard Default Audio Track so user always sees the active track
    if (list.length === 0) {
      return [{
        id: 'default',
        label: 'Default Audio (Original)',
        language: 'und',
        isDefault: true,
        _originalIndex: 0,
      }];
    }
    return list.map((t, idx) => ({
      ...t,
      _originalIndex: idx,
    }));
  }, [availableAudioTracks]);

  const subtitleList = useMemo(() => {
    const list = Array.isArray(availableSubtitleTracks) ? availableSubtitleTracks : [];
    return list.map((t, idx) => ({
      ...t,
      _originalIndex: idx,
    }));
  }, [availableSubtitleTracks]);

  const listMaxHeight = useMemo(() => {
    const rows =
      selectedTab === 'audio'
        ? audioList.length
        : 1 + subtitleList.length + (onSelectSubtitleSize ? 1 : 0);
    return Math.min(240, Math.max(88, rows * 34 + 12));
  }, [selectedTab, audioList.length, subtitleList.length, onSelectSubtitleSize]);

  // Robust determination of currently selected audio track
  const isAudioTrackSelected = (track, idx) => {
    if (!track) return false;

    if (selectedAudioTrack != null) {
      // 0. Object reference identity
      if (track === selectedAudioTrack) return true;

      // 1. Primitive match (ID or Index number/string)
      if (typeof selectedAudioTrack === 'number' || typeof selectedAudioTrack === 'string') {
        const selStr = String(selectedAudioTrack);
        if (track.id != null && String(track.id) === selStr) return true;
        if (track.trackId != null && String(track.trackId) === selStr) return true;
        if (track._originalIndex != null && String(track._originalIndex) === selStr) return true;
        if (track.index != null && String(track.index) === selStr) return true;
        if (String(idx) === selStr) return true;
      }

      // 2. Object match
      if (typeof selectedAudioTrack === 'object') {
        if (track._originalIndex != null && selectedAudioTrack._originalIndex != null && track._originalIndex === selectedAudioTrack._originalIndex) {
          return true;
        }
        const selId = selectedAudioTrack.id ?? selectedAudioTrack.trackId;
        const trackId = track.id ?? track.trackId;
        if (trackId != null && selId != null && String(trackId) === String(selId)) {
          return true;
        }
        if (track.label && selectedAudioTrack.label && track.label === selectedAudioTrack.label) {
          if (track.language && selectedAudioTrack.language) {
            return track.language.toLowerCase() === selectedAudioTrack.language.toLowerCase();
          }
          return true;
        }
        if (track.name && selectedAudioTrack.name && track.name === selectedAudioTrack.name) {
          return true;
        }
        if (
          track.language &&
          selectedAudioTrack.language &&
          track.language.toLowerCase() === selectedAudioTrack.language.toLowerCase() &&
          audioList.filter((t) => t.language?.toLowerCase() === track.language?.toLowerCase()).length === 1
        ) {
          return true;
        }
      }
    }

    // Default Fallback: If nothing explicitly matched, highlight the stream default track or track 0
    if (!selectedAudioTrack) {
      if (track.isDefault || track.default || track.id === 'default') return true;
      const hasAnyDefault = audioList.some((t) => t.isDefault || t.default);
      if (!hasAnyDefault && idx === 0) return true;
    }

    return false;
  };

  // Robust determination of currently selected subtitle track
  const isSubtitleTrackSelected = (track, idx) => {
    if (!track || !selectedSubtitleTrack) return false;

    if (track === selectedSubtitleTrack) return true;

    if (typeof selectedSubtitleTrack === 'number' || typeof selectedSubtitleTrack === 'string') {
      const selStr = String(selectedSubtitleTrack);
      if (track.id != null && String(track.id) === selStr) return true;
      if (track.trackId != null && String(track.trackId) === selStr) return true;
      if (track._originalIndex != null && String(track._originalIndex) === selStr) return true;
      if (track.index != null && String(track.index) === selStr) return true;
      if (String(idx) === selStr) return true;
    }

    if (typeof selectedSubtitleTrack === 'object') {
      if (track._originalIndex != null && selectedSubtitleTrack._originalIndex != null && track._originalIndex === selectedSubtitleTrack._originalIndex) {
        return true;
      }
      const selId = selectedSubtitleTrack.id ?? selectedSubtitleTrack.trackId;
      const trackId = track.id ?? track.trackId;
      if (trackId != null && selId != null && String(trackId) === String(selId)) {
        return true;
      }
      if (track.label && selectedSubtitleTrack.label && track.label === selectedSubtitleTrack.label) {
        return true;
      }
      if (track.name && selectedSubtitleTrack.name && track.name === selectedSubtitleTrack.name) {
        return true;
      }
      if (
        track.language &&
        selectedSubtitleTrack.language &&
        track.language.toLowerCase() === selectedSubtitleTrack.language.toLowerCase() &&
        subtitleList.filter((s) => s.language?.toLowerCase() === track.language?.toLowerCase()).length === 1
      ) {
        return true;
      }
    }

    return false;
  };

  const renderSimpleRow = (key, label, selected, onPress) => (
    <TouchableOpacity
      key={key}
      style={[styles.trackRow, selected && styles.trackRowSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.trackName, selected && styles.trackNameSelected]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? (
        <CheckIcon size={12} color={Colors.brand.primary} />
      ) : (
        <View style={styles.checkPlaceholder} />
      )}
    </TouchableOpacity>
  );

  if (!visible && !isRendered) return null;

  return (
    <FoxModal
      transparent
      visible={visible || isRendered}
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.modalOverlay}>
        {/* Backdrop touchable (sibling to avoid swallowing inner ScrollView gestures) */}
        <Animated.View style={[styles.backdrop, { opacity: opacityAnim }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleClose}
            accessibilityLabel="Close dialog backdrop"
          />
        </Animated.View>

        {/* Modal Card with tactile Spring Pop Entrance */}
        <Animated.View
          style={[
            styles.modalCard,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tabBtn, selectedTab === 'audio' && styles.tabBtnActive]}
                onPress={() => setSelectedTab('audio')}
                activeOpacity={0.8}
              >
                <AudioTrackIcon
                  size={13}
                  color={selectedTab === 'audio' ? Colors.brand.primary : '#94A3B8'}
                />
                <Text style={[styles.tabBtnText, selectedTab === 'audio' && styles.tabBtnTextActive]}>
                  Audio
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, selectedTab === 'subtitles' && styles.tabBtnActive]}
                onPress={() => setSelectedTab('subtitles')}
                activeOpacity={0.8}
              >
                <SubtitleTrackIcon
                  size={13}
                  color={selectedTab === 'subtitles' ? Colors.brand.primary : '#94A3B8'}
                />
                <Text style={[styles.tabBtnText, selectedTab === 'subtitles' && styles.tabBtnTextActive]}>
                  Subtitles
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
              accessibilityLabel="Close"
            >
              <CloseXIcon size={14} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={[styles.listScrollView, { maxHeight: listMaxHeight }]}
            contentContainerStyle={styles.listContent}
            bounces={false}
            nestedScrollEnabled
            showsVerticalScrollIndicator={audioList.length > 6 || subtitleList.length > 5}
            keyboardShouldPersistTaps="handled"
          >
            {selectedTab === 'audio' ? (
              audioList.map((track) => {
                const origIdx = track._originalIndex ?? 0;
                const selected = isAudioTrackSelected(track, origIdx);
                const name = formatTrackDisplayLabel(track, origIdx, 'Audio');
                return renderSimpleRow(
                  track.id != null ? `aud_${track.id}` : `aud_${origIdx}`,
                  name,
                  selected,
                  () => {
                    onSelectAudioTrack?.(track, origIdx);
                    handleClose();
                  }
                );
              })
            ) : (
              <>
                {onSelectSubtitleSize ? (
                  <View style={styles.sizePillRow}>
                    {SUBTITLE_SIZES.map((sz) => {
                      const isSelected = currentSubtitleSize === sz.id;
                      return (
                        <TouchableOpacity
                          key={sz.id}
                          style={[styles.sizePill, isSelected && styles.sizePillActive]}
                          onPress={() => {
                            setCurrentSubtitleSize(sz.id);
                            onSelectSubtitleSize(sz.id);
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.sizePillText, isSelected && styles.sizePillTextActive]}>
                            {sz.id === 'extra_large' ? 'XL' : sz.label.slice(0, 1)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
                {renderSimpleRow(
                  'sub_off',
                  'Off',
                  !selectedSubtitleTrack,
                  () => {
                    onSelectSubtitleTrack?.(null);
                    handleClose();
                  }
                )}
                {subtitleList.map((track) => {
                  const origIdx = track._originalIndex ?? 0;
                  const selected = isSubtitleTrackSelected(track, origIdx);
                  const name = formatTrackDisplayLabel(track, origIdx, 'Subtitle');
                  return renderSimpleRow(
                    track.id != null ? `sub_${track.id}` : `sub_${origIdx}`,
                    name,
                    selected,
                    () => {
                      onSelectSubtitleTrack?.(track, origIdx);
                      handleClose();
                    }
                  );
                })}
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  modalCard: {
    width: '88%',
    maxWidth: 320,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    gap: 6,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 8,
  },
  tabBar: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderColor: 'rgba(249, 115, 22, 0.45)',
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  tabBtnTextActive: {
    color: '#F1F5F9',
    fontWeight: '700',
  },
  listScrollView: {
    width: '100%',
  },
  listContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sizePillRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  sizePill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  sizePillActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.2)',
    borderColor: Colors.brand.primary,
  },
  sizePillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  sizePillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  trackRowSelected: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.4)',
  },
  trackName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#CBD5E1',
    marginRight: 8,
  },
  trackNameSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  checkPlaceholder: {
    width: 12,
    height: 12,
  },
});
