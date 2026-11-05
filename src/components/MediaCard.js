import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Colors from '../constants/colors';
import IPTVImage from './IPTVImage';
import { HeartIcon } from './Icons';

/**
 * Standardized High-Performance Media Card Component
 * Shared across Movies, Series, and Favorites for unified visual identity and 60fps scrolling.
 */
export const MediaCard = React.memo(
  function MediaCard({
    item,
    type = 'movie',
    isFav = false,
    showTypeBadge = false,
    serverUrl = null,
    onPress,
    onToggleFav,
    style,
  }) {
    const normType = item?.type === 'channel' ? 'live' : (item?.type || type);
    const contentId = String(item?.id || item?.streamId || item?.seriesId || '');
    const title = item?.name || item?.title || 'Untitled';
    const year = item?.year || null;

    const handleCardPress = useCallback(() => {
      if (onPress) onPress(item);
    }, [onPress, item]);

    const handleFavPress = useCallback(
      (e) => {
        e?.stopPropagation?.();
        if (onToggleFav) onToggleFav(item, e);
      },
      [onToggleFav, item]
    );

    // Type badge info for mixed lists (Favorites)
    const typeLabel =
      normType === 'live' ? 'LIVE' : normType === 'series' ? 'SERIES' : 'MOVIE';

    // Normalized poster URI calculation
    const posterUri = item?.posterUri || item?.poster || item?.cover || null;

    return (
      <TouchableOpacity
        style={[styles.card, style]}
        onPress={handleCardPress}
        activeOpacity={0.8}
        accessibilityLabel={`${typeLabel}: ${title}`}
      >
        {/* Poster Container with 0.68 Aspect Ratio */}
        <View style={styles.posterContainer}>
          <IPTVImage
            uri={posterUri}
            item={item}
            serverUrl={item?.serverUrl || serverUrl || null}
            type={normType}
            contentId={contentId}
            title={title}
            style={styles.posterImage}
            borderRadius={8}
            resizeMode="cover"
          />

          {/* Optional Sleek Monochrome Type Badge */}
          {showTypeBadge && (
            <View style={styles.typeBadge} pointerEvents="none">
              <Text style={styles.typeBadgeText}>{typeLabel}</Text>
            </View>
          )}

          {/* Heart Favorite Toggle Button */}
          {onToggleFav && (
            <TouchableOpacity
              style={[styles.heartBtn, isFav && styles.heartBtnActive]}
              onPress={handleFavPress}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={isFav ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
            >
              <HeartIcon
                size={14}
                color={isFav ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)'}
                filled={isFav}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Title and Metadata */}
        <View style={styles.metaContainer}>
          <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
          {year ? (
            <Text style={styles.yearText}>({year})</Text>
          ) : normType === 'live' ? (
            <Text style={styles.categorySubText}>Live Stream</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  },
  (prev, next) => {
    const prevId = prev.item?.id || prev.item?.streamId || prev.item?.seriesId;
    const nextId = next.item?.id || next.item?.streamId || next.item?.seriesId;
    const prevPoster = prev.item?.posterUri || prev.item?.poster || prev.item?.cover || prev.item?.cover_big || prev.item?.cover_tmdb || prev.item?.image || prev.item?.stream_icon;
    const nextPoster = next.item?.posterUri || next.item?.poster || next.item?.cover || next.item?.cover_big || next.item?.cover_tmdb || next.item?.image || next.item?.stream_icon;
    const prevTitle = prev.item?.name || prev.item?.title;
    const nextTitle = next.item?.name || next.item?.title;
    const prevFormat = `${prev.item?.url || ''}|${prev.item?.containerExtension || ''}|${prev.item?.container_extension || ''}`;
    const nextFormat = `${next.item?.url || ''}|${next.item?.containerExtension || ''}|${next.item?.container_extension || ''}`;

    return (
      prevId === nextId &&
      prev.isFav === next.isFav &&
      prev.showTypeBadge === next.showTypeBadge &&
      prevPoster === nextPoster &&
      prevTitle === nextTitle &&
      prevFormat === nextFormat &&
      prev.item?.seasons === next.item?.seasons &&
      prev.item?.formats === next.item?.formats &&
      prev.serverUrl === next.serverUrl &&
      prev.onPress === next.onPress &&
      prev.onToggleFav === next.onToggleFav
    );
  }
);

export default MediaCard;

const styles = StyleSheet.create({
  card: {
    flex: 1,
    maxWidth: '20%',
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
  formatBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    maxWidth: '85%',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.brand.primary,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    zIndex: 10,
  },
  formatBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  heartBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    zIndex: 10,
  },
  heartBtnActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderColor: Colors.brand.primary,
  },
  metaContainer: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    width: '100%',
    letterSpacing: 0.2,
  },
  yearText: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.text.secondary,
    textAlign: 'center',
    marginTop: 1,
  },
  categorySubText: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.text.tertiary,
    textAlign: 'center',
    marginTop: 1,
  },
});
