import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
  useWindowDimensions,
} from 'react-native';
import Colors from '../constants/colors';
import IPTVImage from './IPTVImage';
import { PlayIcon } from './Icons';

export default function SeriesNextEpisodeOverlay({
  visible = false,
  episodeFinished = false,
  seriesTitle = '',
  episodeLabel = 'Next episode',
  posterUri = null,
  posterItem = null,
  serverUrl = null,
  onPlayNow,
  onCancel,
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;
  const shadeAnim = useRef(new Animated.Value(0)).current;
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;
  const cardMaxWidth = isLandscape
    ? Math.min(460, Math.max(340, screenW * 0.42))
    : Math.min(400, screenW - 28);

  useEffect(() => {
    if (!visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(16);
      shadeAnim.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, fadeAnim, slideAnim, shadeAnim]);

  useEffect(() => {
    Animated.timing(shadeAnim, {
      toValue: visible && episodeFinished ? 1 : 0,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [visible, episodeFinished, shadeAnim]);

  if (!visible) return null;

  const displayEpisode =
    episodeLabel && seriesTitle && episodeLabel.startsWith(seriesTitle)
      ? episodeLabel.slice(seriesTitle.length).replace(/^[\s·\-–:]+/, '').trim() || episodeLabel
      : episodeLabel;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[styles.shade, { opacity: shadeAnim }]}
      />

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.dock,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            paddingBottom: isLandscape ? 78 : 72,
          },
        ]}
      >
        <View style={[styles.card, { maxWidth: cardMaxWidth }]} pointerEvents="auto">
          <View style={styles.accent} />
          <View style={styles.cardBody}>
            <View style={styles.headerRow}>
              <Text style={styles.upNext}>Up next</Text>
              {episodeFinished ? (
                <View style={styles.finishedBadge}>
                  <Text style={styles.finishedBadgeText}>Finished</Text>
                </View>
              ) : (
                <Text style={styles.soonText}>In the last moments</Text>
              )}
            </View>

            <View style={styles.bodyRow}>
              <View style={styles.thumbWrap}>
                <IPTVImage
                  uri={posterUri}
                  item={posterItem}
                  serverUrl={serverUrl}
                  type="series"
                  title={displayEpisode}
                  style={styles.thumb}
                  borderRadius={8}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.textCol}>
                {seriesTitle ? (
                  <Text style={styles.seriesTitle} numberOfLines={1}>
                    {seriesTitle}
                  </Text>
                ) : null}
                <Text style={styles.episodeLabel} numberOfLines={2}>
                  {displayEpisode}
                </Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onCancel}
                activeOpacity={0.85}
                accessibilityLabel="Stay on this episode"
              >
                <Text style={styles.cancelBtnText}>Not now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.playBtn}
                onPress={onPlayNow}
                activeOpacity={0.88}
                accessibilityLabel="Play next episode"
              >
                <PlayIcon size={14} color="#FFFFFF" />
                <Text style={styles.playBtnText}>Play next</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 140,
    elevation: 140,
  },
  shade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  dock: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: 18,
  },
  card: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: 'rgba(14, 14, 18, 0.97)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    ...Platform.select({
      android: { elevation: 12 },
      default: {},
    }),
  },
  accent: {
    width: 4,
    backgroundColor: Colors.brand.primary,
  },
  cardBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  upNext: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.brand.primary,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  soonText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.45)',
  },
  finishedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  finishedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: 0.3,
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  thumbWrap: {
    width: 64,
    height: 90,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: Colors.background.card,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  seriesTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.55)',
    marginBottom: 4,
  },
  episodeLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 21,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text.secondary,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.brand.primary,
  },
  playBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
