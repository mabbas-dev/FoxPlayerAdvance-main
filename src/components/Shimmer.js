import React, { createContext, useContext, useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import Colors from '../constants/colors';

// Shared Shimmer Context so all skeleton components share ONE single native animation loop
const ShimmerContext = createContext(null);

export function ShimmerProvider({ children }) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1600,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  return (
    <ShimmerContext.Provider value={shimmerAnim}>
      {children}
    </ShimmerContext.Provider>
  );
}

export function useShimmer() {
  return useContext(ShimmerContext);
}

/**
 * Universal Lightweight Shimmer Block
 * Uses shared animation loop for maximum 60fps performance on low-end Android devices.
 * Uses a wide interpolation range [-400, 900] to seamlessly sweep across full landscape screens and cards without clipping.
 */
export function ShimmerBlock({
  width = '100%',
  height = 16,
  borderRadius = 6,
  style,
  children,
}) {
  const contextAnim = useShimmer();
  const localAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!contextAnim) {
      const loop = Animated.loop(
        Animated.timing(localAnim, {
          toValue: 1,
          duration: 1600,
          easing: Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: true,
        })
      );
      loop.start();
      return () => loop.stop();
    }
  }, [contextAnim, localAnim]);

  const anim = contextAnim || localAnim;

  // Wide interpolation span covers wide landscape cards and screen columns without clipping
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-350, 850],
  });

  const pulseOpacity = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.03, 0.09, 0.03],
  });

  return (
    <View
      style={[
        styles.shimmerBase,
        { width, height, borderRadius },
        style,
      ]}
    >
      {/* Background Pulse Layer */}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          styles.shimmerPulse,
          { opacity: pulseOpacity, borderRadius },
        ]}
      />
      {/* Moving Feathered Light Sweep Band */}
      <Animated.View
        style={[
          styles.shimmerHighlightBand,
          {
            transform: [{ translateX }, { skewX: '-20deg' }],
          },
        ]}
      />
      {children}
    </View>
  );
}

/**
 * Category List Skeleton (Left Column: ~22% width)
 * Matches real CategoryCard layout with left indicator pill, title, and count
 */
export function CategorySkeletonList({ count = 8, isPortrait = false }) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <View style={isPortrait ? styles.categorySkeletonRowHorizontal : styles.categorySkeletonColumn}>
      {items.map((i) => (
        <View
          key={`cat-skel-${i}`}
          style={[
            styles.categoryCardSkeleton,
            isPortrait && styles.categoryCardSkeletonPortrait,
          ]}
        >
          {/* Subtle Left Category Accent Pill */}
          <View style={styles.categoryLeftPillPlaceholder} />
          <View style={styles.categoryTextWrapper}>
            <ShimmerBlock width="65%" height={11} borderRadius={3} />
            <ShimmerBlock width="32%" height={8} borderRadius={3} style={{ marginTop: 5 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Movies Skeleton Grid (Right Area: 5-Column Landscape Grid)
 * Exactly mirrors real MediaCard layout (0.68 aspect ratio) with zero layout shifts
 */
export function MovieSkeletonGrid({ count = 10 }) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <View style={styles.gridContent}>
      <View style={styles.gridRowWrap}>
        {items.map((i) => (
          <View key={`movie-skel-${i}`} style={styles.movieCardSkeleton}>
            <View style={styles.moviePosterContainer}>
              <ShimmerBlock width="100%" height="100%" borderRadius={8}>
                {/* Silhouette outlines for Type Badge & Favorite Heart */}
                <View style={styles.cardBadgeSilhouette} />
                <View style={styles.cardHeartSilhouette} />
              </ShimmerBlock>
            </View>
            <ShimmerBlock width="80%" height={11} borderRadius={3} style={{ marginTop: 5 }} />
            <ShimmerBlock width="38%" height={9} borderRadius={3} style={{ marginTop: 4 }} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Series Skeleton Grid (Right Area: 5-Column Landscape Grid)
 * Dedicated Series dimensions and metadata placeholders
 */
export function SeriesSkeletonGrid({ count = 10 }) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <View style={styles.gridContent}>
      <View style={styles.gridRowWrap}>
        {items.map((i) => (
          <View key={`series-skel-${i}`} style={styles.seriesCardSkeleton}>
            <View style={styles.seriesPosterContainer}>
              <ShimmerBlock width="100%" height="100%" borderRadius={8}>
                {/* Silhouette outlines for Series Badge & Favorite Heart */}
                <View style={styles.cardSeriesBadgeSilhouette} />
                <View style={styles.cardHeartSilhouette} />
              </ShimmerBlock>
            </View>
            <ShimmerBlock width="82%" height={11} borderRadius={3} style={{ marginTop: 5 }} />
            <ShimmerBlock width="44%" height={9} borderRadius={3} style={{ marginTop: 4 }} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Live TV Skeleton Layout (3-Column Layout: Categories, Channels, Video Player)
 * Column flex ratios (0.22, 0.28, 0.50) exactly match loaded LiveScreen layout
 */
export function LiveSkeletonLayout({ isPortrait = false }) {
  const channelItems = Array.from({ length: 8 }, (_, i) => i);
  return (
    <View style={[styles.liveSplit, isPortrait && styles.liveSplitPortrait]}>
      {/* Column 1: Categories (~22% width) */}
      <View style={[styles.liveColumnCategories, isPortrait && styles.liveColumnCategoriesPortrait]}>
        <CategorySkeletonList count={isPortrait ? 5 : 7} isPortrait={isPortrait} />
      </View>

      {/* Column 2: Channels (~28% width) */}
      <View style={[styles.liveColumnChannels, isPortrait && styles.liveColumnChannelsPortrait]}>
        <View style={styles.channelSkeletonList}>
          {channelItems.map((i) => (
            <View key={`ch-skel-${i}`} style={styles.channelCardSkeleton}>
              {/* Channel Logo Box Placeholder */}
              <ShimmerBlock width={34} height={34} borderRadius={6} />
              {/* Channel Title & Subtext */}
              <View style={styles.channelInfoSkeleton}>
                <ShimmerBlock width="68%" height={11} borderRadius={3} />
                <ShimmerBlock width="36%" height={8} borderRadius={3} style={{ marginTop: 4 }} />
              </View>
              {/* Heart Favorite Outline Placeholder */}
              <View style={styles.channelHeartSilhouette} />
            </View>
          ))}
        </View>
      </View>

      {/* Column 3: Video Player Anchor (~50% width) */}
      <View style={[styles.liveColumnPlayer, isPortrait && styles.liveColumnPlayerPortrait]}>
        <View style={styles.playerSkeletonContainer}>
          <ShimmerBlock width="100%" height="100%" borderRadius={14}>
            {/* Centered Buffering Ring Silhouette */}
            <View style={styles.playerSkeletonCenterIcon}>
              <View style={styles.playerCenterRing} />
            </View>
            {/* Bottom Controls Bar Silhouette */}
            <View style={styles.playerControlsBarSilhouette} />
          </ShimmerBlock>
        </View>
      </View>
    </View>
  );
}

/**
 * Series Season & Episode Detail Skeleton
 * Matches loaded SeriesScreen season tabs and authentic episode thumbnail cards
 */
export function EpisodeDetailSkeleton() {
  return (
    <View style={styles.detailSplitSkeleton}>
      {/* Left Column: Series Info & Seasons Skeleton (~35% width) */}
      <View style={styles.detailLeftColumnSkeleton}>
        <View style={styles.seriesHeaderInfoSkeleton}>
          <ShimmerBlock width="82%" height={20} borderRadius={4} style={{ marginBottom: 8 }} />
          <ShimmerBlock width="36%" height={13} borderRadius={4} style={{ marginBottom: 10 }} />
          <ShimmerBlock width="100%" height={10} borderRadius={3} style={{ marginBottom: 5 }} />
          <ShimmerBlock width="94%" height={10} borderRadius={3} style={{ marginBottom: 5 }} />
          <ShimmerBlock width="68%" height={10} borderRadius={3} style={{ marginBottom: 14 }} />
        </View>

        {/* SEASONS Section Header */}
        <ShimmerBlock width="32%" height={12} borderRadius={3} style={{ marginBottom: 8 }} />
        <View style={{ gap: 6 }}>
          {[1, 2, 3].map((s) => (
            <View key={s} style={styles.seasonCardSkeleton}>
              <ShimmerBlock width="54%" height={12} borderRadius={3} />
              <ShimmerBlock width="34%" height={9} borderRadius={3} style={{ marginTop: 5 }} />
            </View>
          ))}
        </View>
      </View>

      {/* Right Column: Episodes List Skeleton (~65% width) */}
      <View style={styles.detailRightColumnSkeleton}>
        {/* EPISODES Section Header */}
        <ShimmerBlock width="26%" height={12} borderRadius={3} style={{ marginBottom: 8 }} />
        <View style={{ gap: 7 }}>
          {[1, 2, 3, 4, 5, 6].map((ep) => (
            <View key={ep} style={styles.episodeCardSkeleton}>
              {/* Episode Thumbnail Box (matches real episodeThumbnailBox: 52x36) */}
              <ShimmerBlock width={52} height={36} borderRadius={6} />
              {/* Episode Info: Title and Duration */}
              <View style={styles.episodeInfoSkeleton}>
                <ShimmerBlock width="66%" height={12} borderRadius={3} />
                <ShimmerBlock width="26%" height={9} borderRadius={3} style={{ marginTop: 5 }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shimmerBase: {
    backgroundColor: Colors.background.card,
    overflow: 'hidden',
    position: 'relative',
  },
  shimmerPulse: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  shimmerHighlightBand: {
    position: 'absolute',
    top: -30,
    bottom: -30,
    width: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  categorySkeletonColumn: {
    gap: 6,
    paddingRight: 2,
  },
  categorySkeletonRowHorizontal: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 6,
  },
  categoryCardSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors?.surface?.elevated || Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 8,
    paddingVertical: 8,
    height: 46,
  },
  categoryCardSkeletonPortrait: {
    width: 130,
    height: 38,
    paddingVertical: 6,
  },
  categoryLeftPillPlaceholder: {
    width: 3,
    height: 16,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginRight: 8,
  },
  categoryTextWrapper: {
    flex: 1,
  },
  gridContent: {
    flex: 1,
  },
  gridRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  movieCardSkeleton: {
    width: '18.8%',
    alignItems: 'center',
    marginBottom: 8,
  },
  moviePosterContainer: {
    width: '100%',
    aspectRatio: 0.68,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
    backgroundColor: Colors.background.card,
    position: 'relative',
  },
  cardBadgeSilhouette: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 28,
    height: 12,
    borderRadius: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardSeriesBadgeSilhouette: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 34,
    height: 12,
    borderRadius: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardHeartSilhouette: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  seriesCardSkeleton: {
    width: '18.8%',
    alignItems: 'center',
    marginBottom: 8,
  },
  seriesPosterContainer: {
    width: '100%',
    aspectRatio: 0.68,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
    backgroundColor: Colors.background.card,
    position: 'relative',
  },
  liveSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 0,
  },
  liveSplitPortrait: {
    flexDirection: 'column',
    gap: 8,
  },
  liveColumnCategories: {
    flex: 0.22,
    height: '100%',
  },
  liveColumnCategoriesPortrait: {
    flex: undefined,
    height: 44,
    width: '100%',
  },
  liveColumnChannels: {
    flex: 0.28,
    height: '100%',
  },
  liveColumnChannelsPortrait: {
    flex: 1,
    width: '100%',
  },
  channelSkeletonList: {
    gap: 6,
  },
  channelCardSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors?.surface?.elevated || Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: 6,
    height: 46,
    gap: 8,
  },
  channelInfoSkeleton: {
    flex: 1,
  },
  channelHeartSilhouette: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  liveColumnPlayer: {
    flex: 0.50,
    height: '100%',
    justifyContent: 'flex-start',
  },
  liveColumnPlayerPortrait: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 220,
    height: 124,
  },
  playerSkeletonContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
    backgroundColor: Colors.background.primary,
    position: 'relative',
  },
  playerSkeletonCenterIcon: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerCenterRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  playerControlsBarSilhouette: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    right: 12,
    height: 20,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  detailSplitSkeleton: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
    minHeight: 0,
  },
  detailLeftColumnSkeleton: {
    flex: 0.35,
    height: '100%',
  },
  seriesHeaderInfoSkeleton: {
    marginBottom: 12,
  },
  seasonCardSkeleton: {
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 8,
    height: 50,
    justifyContent: 'center',
  },
  detailRightColumnSkeleton: {
    flex: 0.65,
    height: '100%',
  },
  episodeCardSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: 8,
    height: 52,
    gap: 10,
  },
  episodeInfoSkeleton: {
    flex: 1,
  },
});
