import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import { addRecentlyWatched } from '../storage/userStorage';
import { buildVodStreamUrl, buildLiveStreamUrl } from '../services/xtreamService';
import { getCachedConfig } from '../services/iptvService';
import Colors from '../constants/colors';
let ExpoImage = null;
try {
  const mod = require('expo-image');
  if (mod && (mod.Image || mod.default)) ExpoImage = mod.Image || mod.default;
} catch (_e) {
  ExpoImage = null;
}
import { normalizeImageUrl } from '../utils/imageHelpers';
import AnimatedSearchBar from '../components/AnimatedSearchBar';
import FavoriteCard from '../components/FavoriteCard';
import SkeletonCard from '../components/SkeletonCard';
import { BackArrowIcon, HeartIcon } from '../components/Icons';
import PlaylistHeaderActions from '../components/PlaylistHeaderActions';
import PlaylistExpiredView from '../components/PlaylistExpiredView';
import { safeBack } from '../utils/navigation';

const FILTER_TABS = [
  { id: 'ALL', label: 'All Favorites' },
  { id: 'movie', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'live', label: 'Live TV' },
];

export default function FavoritesScreen() {
  const {
    favorites = [],
    favoritesLoaded = true,
    removeFavorite,
    playlistConfig,
    moviesData,
    activePlaylistId,
    isExpired,
  } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Resolve IPTV credentials for movie playback
  const credentials = useMemo(() => {
    const cfg = playlistConfig?.config || playlistConfig?.configuration || playlistConfig || {};
    const serverUrl = cfg.server_url || cfg.serverUrl || moviesData?.serverUrl || '';
    const username = cfg.username || moviesData?.username || '';
    const password = cfg.password || moviesData?.password || '';
    return { serverUrl, username, password };
  }, [playlistConfig, moviesData]);

  // Compute live item counts for filter tabs
  const tabCounts = useMemo(() => {
    let movies = 0;
    let series = 0;
    let live = 0;
    for (const f of favorites) {
      const t = f.type === 'channel' ? 'live' : f.type;
      if (t === 'movie') movies++;
      else if (t === 'series') series++;
      else if (t === 'live') live++;
    }
    return {
      ALL: favorites.length,
      movie: movies,
      series: series,
      live: live,
    };
  }, [favorites]);

  // Filter items by selected tab and search query
  const filteredFavorites = useMemo(() => {
    let list = favorites;

    // Filter by type tab
    if (activeTab !== 'ALL') {
      const target = activeTab === 'channel' ? 'live' : activeTab;
      list = list.filter((f) => (f.type === 'channel' ? 'live' : f.type) === target);
    }

    // Filter by search query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((f) => {
        const title = (f.title || f.name || '').toLowerCase();
        const year = String(f.year || '');
        return title.includes(q) || year.includes(q);
      });
    }

    return list;
  }, [favorites, activeTab, searchQuery]);

  // Non-blocking background prefetch of above-the-fold favorite items into disk/memory cache
  useEffect(() => {
    if (filteredFavorites && filteredFavorites.length > 0) {
      const urls = filteredFavorites
        .slice(0, 20)
        .map((f) => normalizeImageUrl(f?.posterUri || f?.poster || f?.cover || f?.logo || f?.stream_icon))
        .filter((u) => Boolean(u && typeof u === 'string' && u.startsWith('http')));
      if (urls.length > 0 && ExpoImage && typeof ExpoImage.prefetch === 'function') {
        try {
          ExpoImage.prefetch(urls);
        } catch (_e) {}
      }
    }
  }, [filteredFavorites]);

  // Open favorite item according to its exact type
  const handleItemPress = useCallback(
    async (item) => {
      if (isExpired) return;
      const normType = item.type === 'channel' ? 'live' : item.type;

      if (normType === 'movie') {
        let playUrl = item.url;
        let creds = { ...credentials };

        if (!creds.serverUrl || !creds.username) {
          const cachedCfg = await getCachedConfig(activePlaylistId);
          const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
          creds = {
            serverUrl: cfg.server_url || cfg.serverUrl || '',
            username: cfg.username || '',
            password: cfg.password || '',
          };
        }

        if (!playUrl && creds.serverUrl && creds.username && creds.password) {
          playUrl = buildVodStreamUrl(
            creds.serverUrl,
            creds.username,
            creds.password,
            item.streamId || item.id,
            item.containerExtension || 'mp4'
          );
        }

        if (!playUrl) {
          console.warn('[FAVORITES] Cannot play movie without stream URL');
          return;
        }

        // Non-blocking history record — does not delay player startup
        addRecentlyWatched(
          {
            id: String(item.id),
            type: 'movie',
            name: item.title,
            poster: item.image || null,
            url: playUrl,
            streamId: String(item.streamId || item.id || ''),
            containerExtension: item.containerExtension || 'mp4',
          },
          activePlaylistId,
        ).catch(() => {});

        router.push({
          pathname: '/player',
          params: {
            url: playUrl,
            title: item.title,
            type: 'movie',
            poster: item.image || '',
            streamId: String(item.streamId || item.id || ''),
            extension: item.containerExtension || 'mp4',
            selectedAt: String(Date.now()),
          },
        });
      } else if (normType === 'series') {
        router.push({
          pathname: '/(tabs)/series',
          params: {
            seriesId: String(item.seriesId || item.id),
          },
        });
      } else if (normType === 'live') {
        let playUrl = item.url;
        let creds = { ...credentials };

        if (!creds.serverUrl || !creds.username) {
          const cachedCfg = await getCachedConfig(activePlaylistId);
          const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
          creds = {
            serverUrl: cfg.server_url || cfg.serverUrl || '',
            username: cfg.username || '',
            password: cfg.password || '',
          };
        }

        const streamId = item.streamId || item.stream_id || item.id;
        const extension = (item.containerExtension && item.containerExtension !== 'mp4') ? item.containerExtension : 'ts';

        if (!playUrl && creds.serverUrl && creds.username && creds.password && streamId) {
          playUrl = buildLiveStreamUrl(
            creds.serverUrl,
            creds.username,
            creds.password,
            streamId,
            extension
          );
        }

        router.push({
          pathname: '/(tabs)/live',
          params: {
            channelId: String(item.id),
            streamId: String(streamId || ''),
            channelName: item.title || item.name || '',
            url: playUrl || '',
            logo: item.image || item.logo || '',
            categoryId: item.categoryId ? String(item.categoryId) : '',
            containerExtension: extension,
            selectedAt: String(Date.now()),
          },
        });
      }
    },
    [isExpired, credentials, activePlaylistId, router]
  );

  // Unfavorite handler
  const handleRemove = useCallback(
    (item) => {
      removeFavorite(item.type, item.id);
    },
    [removeFavorite]
  );

  const safePadding = {
    paddingTop: 4,
    paddingBottom: Math.max(insets.bottom, 4),
    paddingLeft: Math.max(insets.left, 16),
    paddingRight: Math.max(insets.right, 16),
  };

  // State 0: Playlist Expired (Render clean, minimal PlaylistExpiredView within normal screen layout)
  if (isExpired) {
    return (
      <View style={[styles.container, safePadding]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/inside-app-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.headerRight}>
            <PlaylistHeaderActions />
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => safeBack(router)}
              activeOpacity={0.8}
              accessibilityLabel="Go back to Home"
            >
              <BackArrowIcon size={16} color={Colors.brand.primary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>

        <PlaylistExpiredView title="Favorites Unavailable" />
      </View>
    );
  }

  return (
    <View style={[styles.container, safePadding]}>
      {/* Top Header Toolbar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {/* Animated Search Bar */}
        <View style={styles.searchWrapper}>
          <AnimatedSearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClear={() => setSearchQuery('')}
            placeholders={[
              'Search your favorites...',
              'Find saved movies, series, live channels...',
              'Type to filter favorites...',
            ]}
          />
        </View>

        {/* Right Header: Profile & Back Button */}
        <View style={styles.headerRight}>
          <PlaylistHeaderActions />
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => safeBack(router)}
            activeOpacity={0.8}
            accessibilityLabel="Go back to Home"
          >
            <BackArrowIcon size={16} color={Colors.brand.primary} />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main 2-Section Content Split */}
      <View style={styles.contentSplit}>
        {/* Left Column: Filter Categories */}
        <View style={styles.columnCategories}>
          <View style={styles.categoriesListContent}>
            {FILTER_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count = tabCounts[tab.id] || 0;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[
                    styles.categoryCard,
                    isActive && styles.categoryCardActive,
                  ]}
                  onPress={() => setActiveTab(tab.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.categoryTitle} numberOfLines={1}>
                    {tab.label}
                  </Text>
                  <Text style={styles.categoryCount}>Total: {count}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Right Area: Grid of Favorite Cards */}
        <View style={styles.columnGrid}>
          {searchQuery ? (
            <View style={styles.searchHeaderBox}>
              <Text style={styles.searchHeaderText}>
                Search Results ({filteredFavorites.length})
              </Text>
            </View>
          ) : null}

          {!favoritesLoaded ? (
            <View style={styles.skeletonGrid}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => (
                <View key={k} style={styles.skeletonWrapper}>
                  <SkeletonCard height={140} borderRadius={10} />
                </View>
              ))}
            </View>
          ) : filteredFavorites.length === 0 ? (
            <View style={styles.fixedEmptyContainer}>
              <View style={styles.emptyIconCircle}>
                <HeartIcon size={34} color={Colors.brand.primary} />
              </View>
              <Text style={styles.emptyTitle}>
                {searchQuery ? 'No matching favorites' : 'No Favorites Yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? 'Try searching with another term or switch categories.'
                  : 'Add movies, series or channels to access them quickly here.'}
              </Text>
              {!searchQuery && (
                <View style={styles.emptyActionsRow}>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => router.push('/(tabs)/movies')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.emptyActionBtnText}>Browse Movies</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => router.push('/(tabs)/series')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.emptyActionBtnText}>Browse Series</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => router.push('/(tabs)/live')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.emptyActionBtnText}>Live TV</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ) : (
            <FlatList
              data={filteredFavorites}
              keyExtractor={(item) => `${activePlaylistId}:${item.type === 'channel' ? 'live' : item.type}:${String(item.id)}`}
              numColumns={5}
              showsVerticalScrollIndicator={false}
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              windowSize={5}
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.gridContent}
              renderItem={({ item }) => (
                <FavoriteCard
                  item={item}
                  serverUrl={credentials?.serverUrl}
                  onPress={handleItemPress}
                  onRemove={handleRemove}
                />
              )}
              {...(Platform.OS === 'ios' ? {
                contentInsetAdjustmentBehavior: 'never',
                automaticallyAdjustContentInsets: false,
              } : {})}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 2,
    marginBottom: 6,
    gap: 12,
  },
  headerLeft: {
    flexShrink: 0,
  },
  logo: {
    width: 120,
    height: 32,
  },
  searchWrapper: {
    flex: 1,
    maxWidth: 360,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  contentSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
    minHeight: 0,
  },
  columnCategories: {
    flex: 0.22,
    height: '100%',
  },
  categoriesListContent: {
    gap: 6,
    paddingRight: 2,
  },
  categoryCard: {
    backgroundColor: Colors.surface.elevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  categoryCardActive: {
    backgroundColor: Colors.background.cardActive,
    borderColor: Colors.brand.primary,
    borderWidth: 1.5,
  },
  categoryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  categoryCount: {
    fontSize: 11,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },
  columnGrid: {
    flex: 0.78,
    height: '100%',
  },
  searchHeaderBox: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  searchHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.brand.primary,
    letterSpacing: 0.5,
  },
  gridRow: {
    gap: 8,
    justifyContent: 'flex-start',
  },
  gridContent: {
    paddingBottom: 24,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skeletonWrapper: {
    flex: 1,
    maxWidth: '20%',
    marginBottom: 8,
  },
  fixedEmptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    width: '100%',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 380,
    marginBottom: 20,
  },
  emptyActionsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  emptyActionBtn: {
    backgroundColor: Colors.surface.elevated,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  emptyActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
