import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import {
  getRecentlyWatched,
  getRecentWatchEntryKey,
  removeRecentlyWatched,
  clearRecentlyWatched,
} from '../storage/userStorage';
import ClearHistoryConfirmModal from '../components/ClearHistoryConfirmModal';
import Colors from '../constants/colors';
import PlaylistHeaderActions from '../components/PlaylistHeaderActions';
import RecentlyWatchedCard from '../components/RecentlyWatchedCard';
import { MovieSkeletonGrid, ShimmerProvider } from '../components/Shimmer';
import { BackArrowIcon, TrashIcon } from '../components/Icons';
import { safeBack } from '../utils/navigation';
import { navigateToRecentItem, resolveRecentPlayUrl } from '../utils/recentlyWatchedHelpers';

const GRID_COLUMNS = 6;
const SKELETON_COUNT = 10;
export default function RecentlyWatchedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activePlaylistId, activePlaylist, playlistConfig } = useApp();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const openingRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const clearingRef = useRef(false);

  const serverUrl = useMemo(() => {
    const cfg = playlistConfig?.config || playlistConfig?.configuration || playlistConfig || {};
    return cfg.server_url || cfg.serverUrl || '';
  }, [playlistConfig]);

  const loadItems = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!activePlaylistId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await getRecentlyWatched(activePlaylistId);
      if (generation !== loadGenerationRef.current) return;
      const vodOnly = (Array.isArray(list) ? list : []).filter(
        (entry) => entry?.type !== 'live' && entry?.type !== 'channel',
      );
      setItems(vodOnly);
    } catch (_e) {
      if (generation !== loadGenerationRef.current) return;
      setItems([]);
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [activePlaylistId]);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems]),
  );

  const handlePressItem = useCallback(
    async (item) => {
      if (openingRef.current) return;
      openingRef.current = true;
      try {
        const playUrl = await resolveRecentPlayUrl(activePlaylistId, item);
        navigateToRecentItem(router, item, playUrl);
      } finally {
        setTimeout(() => {
          openingRef.current = false;
        }, 500);
      }
    },
    [activePlaylistId, router],
  );

  const handleRemoveItem = useCallback(
    async (item) => {
      const entryKey = getRecentWatchEntryKey(item.type, item.id);
      setItems((prev) =>
        prev.filter((r) => getRecentWatchEntryKey(r.type, r.id) !== entryKey),
      );
      try {
        await removeRecentlyWatched(item.type, item.id, activePlaylistId);
      } catch (_e) {
        loadItems();
      }
    },
    [activePlaylistId, loadItems],
  );

  const keyExtractor = useCallback(
    (item) => `${activePlaylistId || 'none'}:${item.type}:${String(item.id)}`,
    [activePlaylistId],
  );

  const renderItem = useCallback(
    ({ item }) => (
      <RecentlyWatchedCard
        item={item}
        serverUrl={serverUrl}
        onPress={handlePressItem}
        onRemove={handleRemoveItem}
      />
    ),
    [handlePressItem, handleRemoveItem, serverUrl],
  );

  const safePadding = {
    paddingTop: 4,
    paddingBottom: Math.max(insets.bottom, 4),
    paddingLeft: Math.max(insets.left, 16),
    paddingRight: Math.max(insets.right, 16),
  };

  const playlistLabel = activePlaylist?.name || 'This playlist';

  const handleConfirmClearAll = useCallback(async () => {
    if (!activePlaylistId || clearingRef.current) return;
    clearingRef.current = true;
    setClearing(true);
    try {
      await clearRecentlyWatched(activePlaylistId);
      const fresh = await getRecentlyWatched(activePlaylistId);
      setItems(Array.isArray(fresh) ? fresh : []);
      setShowClearConfirm(false);
    } catch (_e) {
      await loadItems();
    } finally {
      clearingRef.current = false;
      setClearing(false);
    }
  }, [activePlaylistId, loadItems]);

  const canClearHistory = Boolean(activePlaylistId) && !loading && items.length > 0;

  return (
    <View style={[styles.container, safePadding]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.screenTitle}>Recently watched</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.clearAllBtn, !canClearHistory && styles.clearAllBtnDisabled]}
            onPress={() => {
              if (canClearHistory) setShowClearConfirm(true);
            }}
            disabled={!canClearHistory || clearing}
            activeOpacity={0.82}
            accessibilityLabel="Clear all watch history"
            accessibilityState={{ disabled: !canClearHistory }}
          >
            {clearing ? (
              <ActivityIndicator size="small" color="#FCA5A5" />
            ) : (
              <>
                <TrashIcon size={14} color={canClearHistory ? '#FCA5A5' : Colors.text.tertiary} />
                <Text style={[styles.clearAllText, !canClearHistory && styles.clearAllTextDisabled]}>
                  Clear all
                </Text>
              </>
            )}
          </TouchableOpacity>
          <PlaylistHeaderActions showRecentlyWatched={false} />
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => safeBack(router)}
            activeOpacity={0.8}
            accessibilityLabel="Go back"
          >
            <BackArrowIcon size={16} color={Colors.brand.primary} />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ClearHistoryConfirmModal
        visible={showClearConfirm}
        busy={clearing}
        onCancel={() => {
          if (!clearingRef.current) setShowClearConfirm(false);
        }}
        onConfirm={handleConfirmClearAll}
        message={`Remove all ${items.length} movie and series entries from "${playlistLabel}"? Live TV is not stored here. This cannot be undone.`}
      />

      <View style={styles.gridArea}>
        {loading ? (
          <View style={styles.gridColumn}>
            <ShimmerProvider>
              <MovieSkeletonGrid count={SKELETON_COUNT} />
            </ShimmerProvider>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyStateWrap}>
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyText}>
                Movies and series you play on this playlist appear here with your watch percentage.
              </Text>
            </View>
          </View>
        ) : (
          <FlatList
            style={styles.gridColumn}
            data={items}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            numColumns={GRID_COLUMNS}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={5}
            updateCellsBatchingPeriod={40}
            removeClippedSubviews={Platform.OS === 'android'}
            extraData={`${activePlaylistId}:${items.length}`}
            {...(Platform.OS === 'ios'
              ? {
                  contentInsetAdjustmentBehavior: 'never',
                  automaticallyAdjustContentInsets: false,
                }
              : {})}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 2,
    marginBottom: 10,
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  logo: {
    width: 120,
    height: 32,
    flexShrink: 0,
  },
  screenTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    minHeight: 34,
  },
  clearAllBtnDisabled: {
    opacity: 0.45,
    borderColor: Colors.border.default,
    backgroundColor: Colors.background.card,
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FCA5A5',
    letterSpacing: 0.2,
  },
  clearAllTextDisabled: {
    color: Colors.text.tertiary,
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
  gridArea: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    alignItems: 'flex-start',
  },
  gridColumn: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  gridRow: {
    gap: 8,
    justifyContent: 'flex-start',
    width: '100%',
  },
  gridContent: {
    gap: 10,
    paddingRight: 2,
    paddingBottom: 10,
  },
  emptyStateWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyBox: {
    maxWidth: 420,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
