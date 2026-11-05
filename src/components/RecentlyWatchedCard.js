import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Colors from '../constants/colors';
import IPTVImage from './IPTVImage';
import { TrashIcon } from './Icons';
import {
  getRecentWatchProgressDisplay,
  getRecentWatchProgressPercent,
  getRecentWatchTypeLabel,
} from '../utils/recentlyWatchedHelpers';

function ProgressBadge({ display }) {
  if (!display?.text && display?.variant !== 'live') return null;

  const isLive = display.variant === 'live';
  const isComplete = display.variant === 'complete' || display.variant === 'almost';

  return (
    <View
      style={[
        styles.progressBadge,
        isLive && styles.progressBadgeLive,
        isComplete && styles.progressBadgeComplete,
        display.variant === 'started' && styles.progressBadgeMuted,
      ]}
      pointerEvents="none"
    >
      {isLive ? <View style={styles.liveDot} /> : null}
      <Text
        style={[
          styles.progressBadgeText,
          isLive && styles.progressBadgeTextLive,
          display.variant === 'started' && styles.progressBadgeTextMuted,
        ]}
        numberOfLines={1}
      >
        {display.text}
      </Text>
    </View>
  );
}

export const RecentlyWatchedCard = React.memo(
  function RecentlyWatchedCard({ item, serverUrl, onPress, onRemove, style }) {
    const normType = item?.type === 'channel' ? 'live' : item?.type || 'movie';
    const contentId = String(item?.id || item?.streamId || '');
    const title = item?.name || item?.title || 'Untitled';
    const posterUri = item?.poster || item?.logo || item?.image || null;
    const typeLabel = getRecentWatchTypeLabel(item);
    const progressDisplay = useMemo(() => getRecentWatchProgressDisplay(item), [item]);
    const progressPercent = useMemo(() => getRecentWatchProgressPercent(item), [item]);

    const handlePress = useCallback(() => {
      onPress?.(item);
    }, [onPress, item]);

    const handleRemovePress = useCallback(
      (e) => {
        e?.stopPropagation?.();
        onRemove?.(item, e);
      },
      [onRemove, item],
    );

    return (
      <TouchableOpacity
        style={[styles.card, style]}
        onPress={handlePress}
        activeOpacity={0.82}
        accessibilityLabel={`${typeLabel}, ${title}${progressDisplay.text ? `, ${progressDisplay.text} watched` : ''}`}
      >
        <View style={styles.posterContainer}>
          <IPTVImage
            uri={posterUri}
            item={item}
            serverUrl={serverUrl}
            type={normType}
            contentId={contentId}
            title={title}
            style={styles.posterImage}
            borderRadius={8}
            resizeMode="cover"
          />
          <View style={styles.typeBadge} pointerEvents="none">
            <Text style={styles.typeBadgeText}>
              {normType === 'live' ? 'LIVE' : normType === 'series' ? 'SERIES' : 'MOVIE'}
            </Text>
          </View>
          <ProgressBadge display={progressDisplay} />
          {progressPercent != null ? (
            <View style={styles.progressTrack} pointerEvents="none">
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
          ) : null}
          {onRemove ? (
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={handleRemovePress}
              activeOpacity={0.75}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={`Remove ${title} from recently watched`}
            >
              <TrashIcon size={13} color="rgba(255, 255, 255, 0.88)" />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.metaContainer}>
          <Text style={styles.title} numberOfLines={2} ellipsizeMode="tail">
            {title}
          </Text>
        </View>
      </TouchableOpacity>
    );
  },
  (prev, next) => {
    const prevId = `${prev.item?.type}:${prev.item?.id}`;
    const nextId = `${next.item?.type}:${next.item?.id}`;
    const prevPoster = prev.item?.poster || prev.item?.logo;
    const nextPoster = next.item?.poster || next.item?.logo;
    return (
      prevId === nextId &&
      prevPoster === nextPoster &&
      prev.item?.name === next.item?.name &&
      prev.item?.positionSec === next.item?.positionSec &&
      prev.item?.durationSec === next.item?.durationSec &&
      prev.serverUrl === next.serverUrl &&
      prev.onPress === next.onPress &&
      prev.onRemove === next.onRemove
    );
  },
);

export default RecentlyWatchedCard;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    maxWidth: '16.666%',
    alignItems: 'center',
    marginBottom: 8,
  },
  posterContainer: {
    width: '100%',
    aspectRatio: 0.68,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.background.card,
    marginBottom: 5,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  typeBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    zIndex: 10,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  removeBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderRadius: 12,
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    zIndex: 12,
  },
  progressBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.brand.primary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    zIndex: 10,
  },
  progressBadgeLive: {
    borderColor: 'rgba(239, 68, 68, 0.85)',
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
  },
  progressBadgeComplete: {
    borderColor: 'rgba(34, 197, 94, 0.75)',
  },
  progressBadgeMuted: {
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  progressBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.brand.primary,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  progressBadgeTextLive: {
    color: '#FCA5A5',
    fontSize: 9,
    letterSpacing: 1,
  },
  progressBadgeTextMuted: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    zIndex: 9,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.brand.primary,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  metaContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 9.5,
    fontWeight: '600',
    color: Colors.text.secondary,
    textAlign: 'center',
    width: '100%',
    letterSpacing: 0.15,
    lineHeight: 12,
  },
});
