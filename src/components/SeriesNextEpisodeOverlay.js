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
  const slideAnim = useRef(new Animated.Value(8)).current;
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;
  const cardMaxWidth = isLandscape ? Math.min(300, screenW * 0.34) : Math.min(280, screenW - 24);

  useEffect(() => {
    if (!visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(8);
      return;
    }

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, fadeAnim, slideAnim]);

  if (!visible) return null;

  const displayEpisode =
    episodeLabel && seriesTitle && episodeLabel.startsWith(seriesTitle)
      ? episodeLabel.slice(seriesTitle.length).replace(/^[\s·\-–:]+/, '').trim() || episodeLabel
      : episodeLabel;

  return (
    <Animated.View
      style={[
        styles.root,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
          marginBottom: isLandscape ? 52 : 46,
        },
      ]}
      pointerEvents="box-none"
    >
      {episodeFinished ? (
        <View style={[styles.finishedPill, { maxWidth: cardMaxWidth }]} pointerEvents="none">
          <Text style={styles.finishedPillText}>Episode finished</Text>
        </View>
      ) : null}

      <View style={[styles.card, { maxWidth: cardMaxWidth }]} pointerEvents="auto">
        <Text style={styles.upNext}>Up next</Text>

        <View style={styles.bodyRow}>
          <View style={styles.thumbWrap}>
            <IPTVImage
              uri={posterUri}
              item={posterItem}
              serverUrl={serverUrl}
              type="series"
              title={displayEpisode}
              style={styles.thumb}
              borderRadius={4}
              resizeMode="cover"
            />
          </View>
          <View style={styles.textCol}>
            {seriesTitle ? (
              <Text style={styles.seriesTitle} numberOfLines={1}>
                {seriesTitle}
              </Text>
            ) : null}
            <Text style={styles.episodeLabel} numberOfLines={1}>
              {displayEpisode}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.playBtn}
            onPress={onPlayNow}
            activeOpacity={0.88}
            accessibilityLabel="Play next episode"
          >
            <PlayIcon size={13} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.dismissLink}
          onPress={onCancel}
          activeOpacity={0.75}
          accessibilityLabel="Hide up next"
        >
          <Text style={styles.dismissLinkText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: 12,
    bottom: Platform.OS === 'ios' ? 6 : 4,
    zIndex: 120,
    elevation: 120,
    alignItems: 'flex-end',
  },
  finishedPill: {
    alignSelf: 'flex-end',
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  finishedPillText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.72)',
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: 'rgba(12, 12, 16, 0.92)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  upNext: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.brand.primary,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thumbWrap: {
    width: 36,
    height: 48,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: Colors.background.card,
    borderWidth: 1,
    borderColor: Colors.border.default,
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
    fontSize: 10,
    fontWeight: '500',
    color: Colors.text.tertiary,
    marginBottom: 1,
  },
  episodeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 14,
  },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.brand.primary,
  },
  dismissLink: {
    alignSelf: 'flex-end',
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  dismissLinkText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.text.tertiary,
  },
});
