import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import { addRecentlyWatched } from '../storage/userStorage';
import {
  xtreamGetVodCategories,
  xtreamGetVodStreams,
} from '../services/xtreamService';
import {
  getCachedMovies,
  getCachedConfig,
  getCategoryMovies,
  cacheCategoryMovies,
} from '../services/iptvService';
import { resolveMediaSource } from '../utils/mediaSourcePipeline';
import { isAdultContent } from '../services/m3uParser';
import EmptyState from '../components/EmptyState';
let ExpoImage = null;
try {
  const mod = require('expo-image');
  if (mod && (mod.Image || mod.default)) ExpoImage = mod.Image || mod.default;
} catch (_e) {
  ExpoImage = null;
}
import { normalizeImageUrl } from '../utils/imageHelpers';
import CachedImage from '../components/CachedImage';
import AnimatedSearchBar from '../components/AnimatedSearchBar';
import MediaCard from '../components/MediaCard';
import AdultPinLockView from '../components/AdultPinLockView';
import Colors from '../constants/colors';
import { CONFIG_TYPES } from '../constants';
import { isProviderExpiredError } from '../services/networkErrors';
import { BackArrowIcon, HeartIcon, LockIcon, UnlockIcon } from '../components/Icons';
import PlaylistHeaderActions from '../components/PlaylistHeaderActions';
import PlaylistExpiredView from '../components/PlaylistExpiredView';
import { safeBack } from '../utils/navigation';
import {
  ShimmerProvider,
  CategorySkeletonList,
  MovieSkeletonGrid,
} from '../components/Shimmer';

// In-flight request lock map to prevent duplicate simultaneous requests per playlist
const inFlightMoviesMap = new Map();

export default function MoviesScreen() {
  const {
    moviesData,
    moviesStore,
    setMoviesStore,
    adultPinEnabled,
    adultUnlocked,
    unlockAdult,
    lockAdult,
    playlistConfig,
    setMoviesData,
    isFavorite,
    toggleFavorite,
    activePlaylistId,
    activePlaylist,
    showPlaylistExpiredDialog,
    isExpired,
  } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Initialize directly from in-memory cache if already loaded for CURRENT playlist (0ms latency on tab switch)
  const isPreloaded = Boolean(
    moviesStore?.loaded &&
    moviesStore?.playlistId &&
    String(moviesStore.playlistId) === String(activePlaylistId) &&
    moviesStore?.allMovies?.length > 0
  );
  const [loading, setLoading]                       = useState(!isPreloaded);
  const [error, setError]                           = useState(null);
  const [rawCategories, setRawCategories]           = useState(isPreloaded ? (moviesStore?.categories || []) : []);
  const [selectedCategoryId, setSelectedCategoryId] = useState('ALL');
  const [categoryItemsMap, setCategoryItemsMap]     = useState(isPreloaded ? (moviesStore?.categoryMap || {}) : {});
  const [allMovies, setAllMovies]                   = useState(isPreloaded ? (moviesStore?.allMovies || []) : []);
  const [displayLimit, setDisplayLimit]             = useState(30);
  const [searchQuery, setSearchQuery]               = useState('');
  const [debouncedQuery, setDebouncedQuery]         = useState('');
  const [loadingCategory, setLoadingCategory]       = useState(false);

  const gridListRef = useRef(null);
  const fullyLoadedCategoriesRef = useRef(new Set());
  const categoryItemsMapRef = useRef(categoryItemsMap);
  useEffect(() => {
    categoryItemsMapRef.current = categoryItemsMap;
  }, [categoryItemsMap]);

  useEffect(() => {
    fullyLoadedCategoriesRef.current = new Set();
  }, [activePlaylistId]);

  // Debounce search query to keep typing responsive at 60fps
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim().toLowerCase());
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Resolve IPTV credentials safely
  const credentials = useMemo(() => {
    const cfg = playlistConfig?.config || playlistConfig?.configuration || playlistConfig || {};
    const serverUrl = cfg.server_url || cfg.serverUrl || moviesData?.serverUrl || '';
    const username = cfg.username || moviesData?.username || '';
    const password = cfg.password || moviesData?.password || '';
    return { serverUrl, username, password };
  }, [playlistConfig, moviesData]);

  // Categories list - adult categories are kept visible with lock status
  const filteredCategories = useMemo(() => {
    if (!Array.isArray(rawCategories)) return [];

    const seenIds = new Set();
    const list = [];

    for (const cat of rawCategories) {
      if (!cat || typeof cat !== 'object') continue;
      const catId = String(cat.id != null ? cat.id : (cat.category_id != null ? cat.category_id : '')).trim();
      if (!catId || catId === 'ALL') continue;
      if (seenIds.has(catId)) continue;
      seenIds.add(catId);

      const isAdult = Boolean(
        cat.isAdult ||
        cat.is_adult === 1 ||
        cat.is_adult === '1' ||
        cat.adult === 1 ||
        cat.adult === true ||
        isAdultContent(cat.name || cat.category_name || '', '')
      );

      const rawCount = cat.itemCount != null
        ? Number(cat.itemCount)
        : (Array.isArray(cat.items) ? cat.items.length : null);

      list.push({
        id: catId,
        name: String(cat.name || cat.category_name || `Category ${catId}`).trim(),
        isAdult,
        itemCount: typeof rawCount === 'number' && !isNaN(rawCount) ? rawCount : null,
      });
    }

    if (list.length > 0) {
      const totalFromCats = list.reduce((acc, c) => acc + (Number(c.itemCount) || 0), 0);
      const allCount = moviesData?.total || (totalFromCats > 0 ? totalFromCats : allMovies.length);
      return [
        { id: 'ALL', name: 'All Movies', isAdult: false, itemCount: allCount },
        ...list,
      ];
    }
    return [];
  }, [rawCategories, allMovies.length, moviesData?.total]);

  // Set of adult category IDs
  const adultCategoryIds = useMemo(() => {
    if (!Array.isArray(filteredCategories)) return new Set();
    const ids = new Set();
    for (const cat of filteredCategories) {
      if (cat.isAdult && cat.id) {
        ids.add(String(cat.id));
      }
    }
    return ids;
  }, [filteredCategories]);

  // Helper to determine if a movie item is adult
  const isMovieAdultItem = useCallback((m) => {
    if (!m) return false;
    return Boolean(
      m.isAdult ||
      adultCategoryIds.has(String(m.categoryId)) ||
      isAdultContent(m.name || m.title || '', '')
    );
  }, [adultCategoryIds]);

  // Current category
  const currentCategory = useMemo(() => {
    if (!filteredCategories.length) return null;
    return (
      filteredCategories.find((c) => String(c?.id) === String(selectedCategoryId)) ||
      filteredCategories[0]
    );
  }, [filteredCategories, selectedCategoryId]);

  // Stable refs to prevent circular effect triggers and infinite request loops
  const moviesStoreRef = useRef(moviesStore);
  useEffect(() => {
    moviesStoreRef.current = moviesStore;
  }, [moviesStore]);

  const activePlaylistIdRef = useRef(activePlaylistId);
  useEffect(() => {
    activePlaylistIdRef.current = activePlaylistId;
  }, [activePlaylistId]);

  const credentialsRef = useRef(credentials);
  useEffect(() => {
    credentialsRef.current = credentials;
  }, [credentials]);

  // Synchronize when moviesStore is updated in AppContext for CURRENT playlist
  useEffect(() => {
    if (
      moviesStore?.loaded &&
      moviesStore?.playlistId &&
      String(moviesStore.playlistId) === String(activePlaylistId) &&
      moviesStore?.allMovies?.length > 0
    ) {
      const timer = setTimeout(() => {
        setRawCategories(moviesStore.categories || []);
        setAllMovies(moviesStore.allMovies || []);
        setCategoryItemsMap(moviesStore.categoryMap || {});
        setLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [moviesStore, activePlaylistId]);

  // Parallel data loading pipeline with deduplication, playlist isolation, and stale request protection
  const loadMovies = useCallback(async (forceRefresh = false) => {
    const currentTargetId = activePlaylistIdRef.current;
    if (!currentTargetId) return;

    const store = moviesStoreRef.current;
    // 1. If already loaded in memory store for THIS playlist and not forced, use instantly
    if (
      !forceRefresh &&
      store?.loaded &&
      store?.playlistId &&
      String(store.playlistId) === String(currentTargetId) &&
      store?.allMovies?.length > 0
    ) {
      if (activePlaylistIdRef.current === currentTargetId) {
        setRawCategories(store.categories);
        setAllMovies(store.allMovies);
        setCategoryItemsMap(store.categoryMap);
        setLoading(false);
      }
      return;
    }

    // 2. Prevent duplicate in-flight requests for THIS playlist
    if (inFlightMoviesMap.has(currentTargetId)) {
      try {
        await inFlightMoviesMap.get(currentTargetId);
      } catch (_e) {}
      return;
    }

    setError(null);

    // Resolve credentials and configuration
    let creds = { ...credentialsRef.current };
    const cachedCfg = await getCachedConfig(currentTargetId);
    const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
    const isM3U = cachedCfg?.type === CONFIG_TYPES.M3U || cfg.type === CONFIG_TYPES.M3U || playlistConfig?.type === CONFIG_TYPES.M3U;

    if (!creds.serverUrl || !creds.username) {
      creds = {
        serverUrl: cfg.server_url || cfg.serverUrl || '',
        username: cfg.username || '',
        password: cfg.password || '',
      };
    }

    // Check disk cache first for instant render if in-memory was empty
    if (!forceRefresh || isM3U) {
      const cached = await getCachedMovies(true, currentTargetId);
      if (activePlaylistIdRef.current !== currentTargetId) return; // Stale check
      if (cached?.categories && cached.categories.length > 0) {
        const map = {};
        const all = [];
        for (const cat of cached.categories) {
          if (Array.isArray(cat.items) && cat.items.length > 0) {
            map[String(cat.id)] = cat.items;
            all.push(...cat.items);
          }
        }
        setRawCategories(cached.categories);
        setCategoryItemsMap(map);
        setAllMovies(all);
        setLoading(false);
        setError(null);
        // Save in in-memory store
        if (typeof setMoviesStore === 'function') {
          setMoviesStore({
            playlistId: currentTargetId,
            categories: cached.categories,
            allMovies: all,
            categoryMap: map,
          });
        }
        return;
      } else if (isM3U) {
        // M3U playlist with 0 movies is a valid empty state, not a connection failure
        setRawCategories([]);
        setCategoryItemsMap({});
        setAllMovies([]);
        setLoading(false);
        setError(null);
        return;
      }
    }

    // Fetch Categories and Streams IN PARALLEL for Xtream
    if (creds.serverUrl && creds.username && creds.password) {
      setLoading(true);
      const fetchPromise = (async () => {
        try {
          const [cats, streams] = await Promise.all([
            xtreamGetVodCategories(creds.serverUrl, creds.username, creds.password),
            xtreamGetVodStreams(creds.serverUrl, creds.username, creds.password),
          ]);

          // Stale response guard: if playlist switched during network fetch, discard completely
          if (activePlaylistIdRef.current !== currentTargetId) {
            return;
          }

          const validCats = Array.isArray(cats) ? cats : [];
          const validStreams = Array.isArray(streams) ? streams : [];

          // Pre-index category map in O(N) time for instant O(1) tab & category switches
          const map = {};
          for (const s of validStreams) {
            const cid = String(s.categoryId || 'all_other');
            if (!map[cid]) map[cid] = [];
            map[cid].push(s);
          }

          setRawCategories(validCats);
          setAllMovies(validStreams);
          setCategoryItemsMap(map);

          // Update context & in-memory cache with playlistId
          if (typeof setMoviesStore === 'function') {
            setMoviesStore({
              playlistId: currentTargetId,
              categories: validCats,
              allMovies: validStreams,
              categoryMap: map,
            });
          }

          if (typeof setMoviesData === 'function') {
            setMoviesData({
              playlistId: currentTargetId,
              type: 'movies',
              source: 'xtream',
              categories: validCats,
              serverUrl: creds.serverUrl,
              username: creds.username,
              password: creds.password,
              total: validStreams.length,
              syncedAt: Date.now(),
            });
          }
        } catch (err) {
          if (activePlaylistIdRef.current === currentTargetId) {
            console.warn('[MOVIES] Parallel fetch error:', err.message);
            if (isProviderExpiredError(err)) {
              if (typeof showPlaylistExpiredDialog === 'function') {
                showPlaylistExpiredDialog({
                  playlistId: currentTargetId,
                  playlistName: activePlaylist?.name,
                  reason: 'expired',
                });
              }
            } else {
              setError(err.message || 'Failed to load movies.');
            }
          }
        } finally {
          if (activePlaylistIdRef.current === currentTargetId) {
            setLoading(false);
          }
          inFlightMoviesMap.delete(currentTargetId);
        }
      })();

      inFlightMoviesMap.set(currentTargetId, fetchPromise);
      await fetchPromise;
    } else {
      if (activePlaylistIdRef.current === currentTargetId) {
        if (isM3U) {
          setRawCategories([]);
          setCategoryItemsMap({});
          setAllMovies([]);
          setError(null);
        } else {
          setError('No IPTV playlist connected. Scan the QR code in Settings.');
        }
        setLoading(false);
      }
    }
  }, [setMoviesStore, setMoviesData, playlistConfig, showPlaylistExpiredDialog, activePlaylist?.name]);

  // Load movies on mount or when active playlist changes (guaranteed no circular loop)
  const prevPlaylistIdRef = useRef(activePlaylistId);
  useEffect(() => {
    const isNewPlaylist = prevPlaylistIdRef.current && prevPlaylistIdRef.current !== activePlaylistId;
    prevPlaylistIdRef.current = activePlaylistId;

    if (isNewPlaylist) {
      setSelectedCategoryId('ALL');
      setSearchQuery('');
      setDisplayLimit(20);
      const store = moviesStoreRef.current;
      if (
        store?.loaded &&
        store?.playlistId &&
        String(store.playlistId) === String(activePlaylistId) &&
        store?.allMovies?.length > 0
      ) {
        setRawCategories(store.categories || []);
        setAllMovies(store.allMovies || []);
        setCategoryItemsMap(store.categoryMap || {});
        setLoading(false);
      } else {
        // Clear previous playlist data immediately so no stale data is visible
        setRawCategories([]);
        setAllMovies([]);
        setCategoryItemsMap({});
        loadMovies(true);
      }
    } else {
      loadMovies(false);
    }
  }, [activePlaylistId, loadMovies]);

  // Category select handler (instant O(1) lookup)
  const handleCategorySelect = useCallback((catId) => {
    setSelectedCategoryId(String(catId));
    setSearchQuery('');
    setDisplayLimit(30);
    gridListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // Progressively load full category (1000+ videos) on-demand from disk cache or Xtream API
  useEffect(() => {
    if (!selectedCategoryId || selectedCategoryId === 'ALL') {
      return;
    }

    const catId = String(selectedCategoryId);
    if (fullyLoadedCategoriesRef.current.has(catId)) {
      return;
    }

    const currentItems = categoryItemsMapRef.current[catId] || [];
    const catMeta = filteredCategories.find((c) => String(c.id) === catId);
    const expectedCount = Number(catMeta?.itemCount) || 0;

    // If already has expected count and not just the 30-item initial slice
    if (expectedCount > 0 && currentItems.length >= expectedCount && currentItems.length > 30) {
      fullyLoadedCategoriesRef.current.add(catId);
      return;
    }

    let isCancelled = false;
    setLoadingCategory(true);

    (async () => {
      try {
        const pid = activePlaylistIdRef.current;
        // 1. Check disk cache (fast, 10-20ms)
        const cachedItems = await getCategoryMovies(catId, true, pid);
        if (isCancelled) return;

        if (Array.isArray(cachedItems) && cachedItems.length > currentItems.length) {
          setCategoryItemsMap((prev) => ({
            ...prev,
            [catId]: cachedItems,
          }));

          if (typeof setMoviesStore === 'function') {
            setMoviesStore({
              categoryMap: {
                ...(moviesStoreRef.current?.categoryMap || {}),
                [catId]: cachedItems,
              },
            });
          }

          setAllMovies((prevAll) => {
            const seen = new Set(prevAll.map((m) => String(m.id || m.streamId)));
            const fresh = cachedItems.filter((m) => !seen.has(String(m.id || m.streamId)));
            return fresh.length > 0 ? [...prevAll, ...fresh] : prevAll;
          });

          if (expectedCount <= 0 || cachedItems.length >= expectedCount || cachedItems.length > 30) {
            fullyLoadedCategoriesRef.current.add(catId);
            setLoadingCategory(false);
            return;
          }
        }

        // 2. Fallback to Xtream API if cache missing or incomplete
        const creds = credentialsRef.current;
        if (creds?.serverUrl && creds?.username && creds?.password) {
          const networkStreams = await xtreamGetVodStreams(
            creds.serverUrl,
            creds.username,
            creds.password,
            catId
          );
          if (isCancelled) return;

          if (Array.isArray(networkStreams) && networkStreams.length > 0) {
            setCategoryItemsMap((prev) => ({
              ...prev,
              [catId]: networkStreams,
            }));

            await cacheCategoryMovies(catId, networkStreams, pid);

            if (typeof setMoviesStore === 'function') {
              setMoviesStore({
                categoryMap: {
                  ...(moviesStoreRef.current?.categoryMap || {}),
                  [catId]: networkStreams,
                },
              });
            }

            setAllMovies((prevAll) => {
              const seen = new Set(prevAll.map((m) => String(m.id || m.streamId)));
              const fresh = networkStreams.filter((m) => !seen.has(String(m.id || m.streamId)));
              return fresh.length > 0 ? [...prevAll, ...fresh] : prevAll;
            });

            fullyLoadedCategoriesRef.current.add(catId);
          }
        }
      } catch (err) {
        console.warn(`[MOVIES] Failed to load full category ${catId}:`, err?.message);
      } finally {
        if (!isCancelled) {
          setLoadingCategory(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [selectedCategoryId, filteredCategories, setMoviesStore]);

  // Progressively load category caches for 'ALL' tab as user scrolls
  const loadNextCategoriesForALL = useCallback(async () => {
    if (selectedCategoryId !== 'ALL' && selectedCategoryId) return;
    const pendingCats = filteredCategories.filter(
      (c) => c.id !== 'ALL' && !fullyLoadedCategoriesRef.current.has(String(c.id))
    );
    if (pendingCats.length === 0) return;

    const nextBatch = pendingCats.slice(0, 3);
    for (const cat of nextBatch) {
      const cid = String(cat.id);
      fullyLoadedCategoriesRef.current.add(cid);
      try {
        const cached = await getCategoryMovies(cid, true, activePlaylistIdRef.current);
        if (Array.isArray(cached) && cached.length > 0) {
          setCategoryItemsMap((prev) => ({ ...prev, [cid]: cached }));
          setAllMovies((prevAll) => {
            const seen = new Set(prevAll.map((m) => String(m.id || m.streamId)));
            const fresh = cached.filter((m) => !seen.has(String(m.id || m.streamId)));
            return fresh.length > 0 ? [...prevAll, ...fresh] : prevAll;
          });
        }
      } catch (_e) {}
    }
  }, [selectedCategoryId, filteredCategories]);

  // Movies in category or debounced global search
  const movies = useMemo(() => {
    const isLocked = adultPinEnabled && !adultUnlocked;

    // 1. Debounced Global Search
    if (debouncedQuery.length > 0) {
      const q = debouncedQuery;
      const seen = new Set();
      const results = [];
      for (const m of allMovies) {
        if (!m || seen.has(m.id || m.streamId)) continue;
        const nameMatch = m.name && m.name.toLowerCase().includes(q);
        const titleMatch = m.title && m.title.toLowerCase().includes(q);
        const yearMatch = m.year && String(m.year).includes(q);
        if (nameMatch || titleMatch || yearMatch) {
          if (isLocked && isMovieAdultItem(m)) continue;
          seen.add(m.id || m.streamId);
          results.push(m);
        }
      }
      return results;
    }

    // 2. All Movies
    if (selectedCategoryId === 'ALL' || !selectedCategoryId) {
      if (isLocked) {
        return allMovies.filter((m) => !isMovieAdultItem(m));
      }
      return allMovies;
    }

    // 3. Category lookup: Instant O(1) from indexed map
    const catItems = categoryItemsMap[String(selectedCategoryId)];
    if (catItems && catItems.length > 0) {
      return catItems;
    }

    return [];
  }, [debouncedQuery, selectedCategoryId, allMovies, categoryItemsMap, adultPinEnabled, adultUnlocked, isMovieAdultItem]);

  // Virtualized page slice for smooth 60fps scrolling
  const visibleMovies = useMemo(() => {
    return movies.slice(0, displayLimit);
  }, [movies, displayLimit]);

  // Eager prefetch removed to conserve network bandwidth and avoid frame drops

  const handleEndReached = useCallback(() => {
    setDisplayLimit((prev) => {
      if (prev < movies.length) {
        return Math.min(prev + 30, movies.length);
      }
      return prev;
    });

    if ((selectedCategoryId === 'ALL' || !selectedCategoryId) && visibleMovies.length >= movies.length - 15) {
      loadNextCategoriesForALL();
    }
  }, [movies.length, selectedCategoryId, visibleMovies.length, loadNextCategoriesForALL]);

  const renderListFooter = useCallback(() => {
    if (loadingCategory) {
      return (
        <View style={styles.listFooter}>
          <ActivityIndicator size="small" color={Colors.brand.primary} />
          <Text style={styles.listFooterText}>Loading videos...</Text>
        </View>
      );
    }
    if (visibleMovies.length < movies.length) {
      return (
        <View style={styles.listFooter}>
          <ActivityIndicator size="small" color={Colors.brand.primary} />
        </View>
      );
    }
    return <View style={styles.footerSpacing} />;
  }, [loadingCategory, visibleMovies.length, movies.length]);

  // Play Movie with unified source pipeline
  const handleMoviePress = useCallback(async (movie) => {
    if (isExpired) return;
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

    const resolved = resolveMediaSource({
      type: 'movie',
      item: movie,
      credentials: creds,
    });

    if (!resolved.url) {
      console.warn('[MOVIES] Cannot play movie without stream URL');
      return;
    }

    // Non-blocking history record — does not delay player startup
    addRecentlyWatched(
      {
        id: String(movie.id || movie.streamId),
        type: 'movie',
        name: resolved.title,
        poster: resolved.poster,
        url: resolved.url,
        streamId: String(resolved.streamId || movie.id || movie.streamId),
        containerExtension: resolved.extension || 'mp4',
      },
      activePlaylistId,
    ).catch(() => {});

    router.push({
      pathname: '/player',
      params: {
        url: resolved.url,
        title: resolved.title,
        type: 'movie',
        poster: resolved.poster || '',
        streamId: String(resolved.streamId || movie.id || movie.streamId || ''),
        extension: resolved.extension || 'mp4',
        selectedAt: String(Date.now()),
      },
    });
  }, [credentials, activePlaylistId, router]);

  const handleToggleFav = useCallback((movie, e) => {
    e?.stopPropagation?.();
    toggleFavorite({
      id: String(movie.id || movie.streamId),
      type: 'movie',
      title: movie.name || movie.title,
      image: movie.poster || movie.stream_icon || movie.movie_image || '',
      streamId: movie.streamId || movie.id,
      categoryId: movie.categoryId,
      containerExtension: movie.containerExtension || 'mp4',
      url: movie.url,
      year: movie.year,
    });
  }, [toggleFavorite]);

  const categoryKeyExtractor = useCallback(
    (item, index) => {
      const catId = item?.id != null ? String(item.id) : (item?.category_id != null ? String(item.category_id) : `cat_${index}`);
      return `${activePlaylistId || 'default'}:movie_cat:${catId}`;
    },
    [activePlaylistId]
  );

  const movieKeyExtractor = useCallback(
    (item, index) => {
      const mId = item?.streamId != null ? String(item.streamId) : (item?.id != null ? String(item.id) : (item?.stream_id != null ? String(item.stream_id) : `idx_${index}`));
      return `${activePlaylistId || 'default'}:movie:${mId}`;
    },
    [activePlaylistId]
  );

  const CATEGORY_ITEM_HEIGHT = 46;
  const CATEGORY_ITEM_MARGIN = 6;
  const CATEGORY_ROW_TOTAL = CATEGORY_ITEM_HEIGHT + CATEGORY_ITEM_MARGIN; // 52

  const getCategoryItemLayout = useCallback(
    (_data, index) => ({
      length: CATEGORY_ROW_TOTAL,
      offset: CATEGORY_ROW_TOTAL * index,
      index,
    }),
    []
  );

  const isSearching = Boolean(searchQuery);
  const activeCategoryId = currentCategory?.id;

  const renderCategoryItem = useCallback(({ item }) => {
    if (!item) return null;
    const itemId = String(item.id != null ? item.id : '');
    const isActive = !isSearching && String(activeCategoryId) === itemId;
    const count = item.itemCount != null
      ? item.itemCount
      : (itemId === 'ALL'
          ? allMovies.length
          : (categoryItemsMapRef.current[itemId]?.length || 0));

    return (
      <CategoryCard
        item={item}
        isActive={isActive}
        itemCount={count}
        onSelect={handleCategorySelect}
        adultPinEnabled={adultPinEnabled}
        adultUnlocked={adultUnlocked}
      />
    );
  }, [isSearching, activeCategoryId, allMovies.length, handleCategorySelect, adultPinEnabled, adultUnlocked]);

  const renderMovieItem = useCallback(({ item }) => {
    const isFav = isFavorite('movie', item.id || item.streamId);
    return (
      <MediaCard
        item={item}
        type="movie"
        isFav={isFav}
        serverUrl={credentials?.serverUrl}
        onPress={handleMoviePress}
        onToggleFav={handleToggleFav}
      />
    );
  }, [isFavorite, credentials?.serverUrl, handleMoviePress, handleToggleFav]);

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
              accessibilityLabel="Go back"
            >
              <BackArrowIcon size={16} color={Colors.brand.primary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>

        <PlaylistExpiredView title="Movies Expired" />
      </View>
    );
  }

  // State 1: Full Loading State (Render Screen Shell + Shimmer Skeleton, NO SPINNER!)
  if ((loading || allMovies.length === 0) && filteredCategories.length === 0 && !error) {
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
          <View style={styles.searchWrapper}>
            <AnimatedSearchBar
              value=""
              onChangeText={() => {}}
              placeholders={['Search movies...']}
            />
          </View>
          <View style={styles.headerRight}>
            <PlaylistHeaderActions />
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

        <ShimmerProvider>
          <View style={styles.contentSplit}>
            <View style={styles.columnCategories}>
              <CategorySkeletonList count={7} />
            </View>
            <View style={styles.columnGrid}>
              <MovieSkeletonGrid count={10} />
            </View>
          </View>
        </ShimmerProvider>
      </View>
    );
  }

  // State 2: Error State
  if (error && filteredCategories.length === 0) {
    return (
      <View style={[styles.container, safePadding]}>
        <View style={styles.header}>
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View style={styles.headerRight}>
            <PlaylistHeaderActions />
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => safeBack(router)}
              activeOpacity={0.8}
            >
              <BackArrowIcon size={16} color={Colors.brand.primary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
        <EmptyState
          title="Failed to load movies"
          message={error}
          actionLabel="Retry"
          onAction={() => loadMovies(true)}
        />
      </View>
    );
  }

  // State 3: Success with 0 categories
  if (!loading && filteredCategories.length === 0) {
    return (
      <View style={[styles.container, safePadding]}>
        <View style={styles.header}>
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <View style={styles.headerRight}>
            <PlaylistHeaderActions />
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => safeBack(router)}
              activeOpacity={0.8}
            >
              <BackArrowIcon size={16} color={Colors.brand.primary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
        <EmptyState
          title="No movies found"
          message="Reload your playlist in Settings to load Movies."
          actionLabel="Go to Settings"
          onAction={() => router.push('/settings')}
        />
      </View>
    );
  }

  // State 4: Success with categories and movies
  return (
    <View style={[styles.container, safePadding]}>
      {/* Top Header Toolbar with Animated Search */}
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
            onChangeText={(txt) => {
              setSearchQuery(txt);
              setDisplayLimit(30);
              gridListRef.current?.scrollToOffset({ offset: 0, animated: false });
            }}
            onClear={() => {
              setSearchQuery('');
              setDisplayLimit(30);
              gridListRef.current?.scrollToOffset({ offset: 0, animated: false });
            }}
            placeholders={[
              'Search movies...',
              'Search by title or year...',
              'Find 4K, Action, Comedy...',
            ]}
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

      {/* Main 2-Section Split View */}
      <View style={styles.contentSplit}>
        {/* Left Column: Categories (~22% width) */}
        <View style={styles.columnCategories}>
          <FlatList
            data={filteredCategories}
            extraData={activeCategoryId}
            keyExtractor={categoryKeyExtractor}
            showsVerticalScrollIndicator={false}
            initialNumToRender={16}
            maxToRenderPerBatch={15}
            windowSize={9}
            updateCellsBatchingPeriod={50}
            removeClippedSubviews={false}
            scrollEventThrottle={16}
            getItemLayout={getCategoryItemLayout}
            contentContainerStyle={styles.categoriesListContent}
            renderItem={renderCategoryItem}
            {...(Platform.OS === 'ios' ? {
              contentInsetAdjustmentBehavior: 'never',
              automaticallyAdjustContentInsets: false,
            } : {})}
          />
        </View>

        {/* Right Area: 5-Column Grid of Movie Posters (~78% width) */}
        <View style={styles.columnGrid}>
          {searchQuery ? (
            <View style={styles.searchHeaderBox}>
              <Text style={styles.searchHeaderText}>
                Search Results ({movies.length})
              </Text>
            </View>
          ) : null}

          {/* Adult PIN Protection in Videos Section */}
          {!searchQuery && currentCategory?.isAdult && adultPinEnabled && !adultUnlocked ? (
            <AdultPinLockView
              categoryName={currentCategory.name}
              onSuccess={unlockAdult}
            />
          ) : (
            <>
              {!searchQuery && currentCategory?.isAdult && adultPinEnabled && adultUnlocked ? (
                <View style={styles.unlockedCategoryBanner}>
                  <View style={styles.unlockedBannerLeft}>
                    <UnlockIcon size={14} color="#34D399" />
                    <Text style={styles.unlockedBannerText}>18+ Adult Content Unlocked</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.lockAdultBtn}
                    onPress={lockAdult}
                    activeOpacity={0.8}
                    accessibilityLabel="Lock 18+ content"
                  >
                    <LockIcon size={12} color="#FFFFFF" />
                    <Text style={styles.lockAdultBtnText}>Lock Category</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {loading && !error ? (
                <ShimmerProvider>
                  <MovieSkeletonGrid count={10} />
                </ShimmerProvider>
              ) : (
                <FlatList
                  ref={gridListRef}
                  data={visibleMovies}
                  keyExtractor={movieKeyExtractor}
                  numColumns={5}
                  showsVerticalScrollIndicator={false}
                  initialNumToRender={15}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  updateCellsBatchingPeriod={40}
                  removeClippedSubviews={Platform.OS === 'android'}
                  columnWrapperStyle={styles.gridRow}
                  contentContainerStyle={styles.gridContent}
                  onEndReached={handleEndReached}
                  onEndReachedThreshold={0.5}
                  ListFooterComponent={renderListFooter}
                  ListEmptyComponent={
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyText}>
                        {searchQuery ? 'No matching movies found' : 'No movies in this category'}
                      </Text>
                    </View>
                  }
                  renderItem={renderMovieItem}
                  {...(Platform.OS === 'ios' ? {
                    contentInsetAdjustmentBehavior: 'never',
                    automaticallyAdjustContentInsets: false,
                  } : {})}
                />
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// Category Card Component (Memoized)
const CategoryCard = React.memo(
  function CategoryCard({ item, isActive, itemCount, onSelect, adultPinEnabled, adultUnlocked }) {
    const catId = item?.id != null ? String(item.id) : '';
    const catName = String(item?.name || item?.category_name || 'Category');
    const safeCount = typeof itemCount === 'number' && !isNaN(itemCount)
      ? itemCount
      : (itemCount ? String(itemCount) : 0);
    const isAdult = Boolean(item?.isAdult);
    const isLocked = isAdult && adultPinEnabled && !adultUnlocked;

    const handlePress = useCallback(() => {
      if (onSelect && catId) {
        onSelect(catId);
      }
    }, [onSelect, catId]);

    return (
      <TouchableOpacity
        style={[
          styles.categoryCard,
          isActive && styles.categoryCardActive,
          isAdult && styles.categoryCardAdult,
        ]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <View style={styles.categoryTitleRow}>
          <Text style={styles.categoryTitle} numberOfLines={1} ellipsizeMode="tail">
            {catName}
          </Text>
          {isAdult && (
            <View style={[styles.adultBadge, isLocked ? styles.adultBadgeLocked : styles.adultBadgeUnlocked]}>
              {isLocked ? (
                <>
                  <LockIcon size={10} color="#A1A1AA" />
                  <Text style={styles.adultBadgeTextLocked}>18+</Text>
                </>
              ) : (
                <>
                  <UnlockIcon size={10} color="#34D399" />
                  <Text style={styles.adultBadgeTextUnlocked}>18+</Text>
                </>
              )}
            </View>
          )}
        </View>
        <View style={styles.categoryCountRow}>
          <Text style={styles.categoryCount}>
            Total: {safeCount}
          </Text>
          {isLocked && (
            <Text style={styles.categoryLockHint}>Locked</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  },
  (prev, next) => {
    return (
      prev.isActive === next.isActive &&
      prev.itemCount === next.itemCount &&
      prev.adultPinEnabled === next.adultPinEnabled &&
      prev.adultUnlocked === next.adultUnlocked &&
      prev.onSelect === next.onSelect &&
      prev.item?.id === next.item?.id &&
      prev.item?.name === next.item?.name &&
      prev.item?.isAdult === next.item?.isAdult
    );
  }
);

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
    marginBottom: 6,
    gap: 12,
  },
  headerLeft: {
    flexShrink: 0,
  },
  searchWrapper: {
    flex: 1,
    maxWidth: 420,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 120,
    height: 32,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 6,
    flexShrink: 0,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  searchHeaderBox: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#1A1A20',
    borderRadius: 6,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFFFFF',
  },
  searchHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  contentSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
    minHeight: 0,
  },
  columnCategories: {
    flex: 0.22,
    height: '100%',
  },
  categoriesListContent: {
    paddingRight: 2,
    paddingBottom: 8,
  },
  categoryCard: {
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1.2,
    borderColor: Colors.border.default,
    paddingHorizontal: 10,
    height: 46,
    marginBottom: 6,
    justifyContent: 'center',
  },
  categoryCardActive: {
    backgroundColor: Colors.background.cardActive,
    borderColor: Colors.brand.primary,
    borderWidth: 1.2,
  },
  categoryTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  categoryCount: {
    fontSize: 10,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },
  columnGrid: {
    flex: 0.78,
    height: '100%',
  },
  gridContent: {
    gap: 10,
    paddingRight: 2,
    paddingBottom: 10,
  },
  gridRow: {
    gap: 8,
    justifyContent: 'flex-start',
  },
  emptyBox: {
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.text.tertiary,
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  categoryCardAdult: {
    borderColor: '#3F3F46',
  },
  categoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 2,
  },
  categoryCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: 1,
  },
  adultBadgeLocked: {
    backgroundColor: '#27272A',
    borderColor: '#3F3F46',
  },
  adultBadgeUnlocked: {
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    borderColor: 'rgba(52, 211, 153, 0.3)',
  },
  adultBadgeTextLocked: {
    color: '#D4D4D8',
    fontSize: 9,
    fontWeight: '700',
  },
  adultBadgeTextUnlocked: {
    color: '#34D399',
    fontSize: 9,
    fontWeight: '700',
  },
  categoryLockHint: {
    fontSize: 9,
    color: '#A1A1AA',
    fontWeight: '500',
  },
  unlockedCategoryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#18181B',
    borderColor: '#27272A',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
  },
  unlockedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unlockedBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D4D4D8',
  },
  lockAdultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#27272A',
    borderColor: '#3F3F46',
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  lockAdultBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  listFooter: {
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  listFooterText: {
    fontSize: 12,
    color: Colors.text.tertiary,
    fontWeight: '500',
  },
  footerSpacing: {
    height: 20,
  },
});
