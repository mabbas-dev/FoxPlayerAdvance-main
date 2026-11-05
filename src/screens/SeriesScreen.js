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
  BackHandler,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { consumeSeriesReturnHighlight } from '../utils/seriesReturnHighlight.js';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import { addRecentlyWatched } from '../storage/userStorage';
import {
  xtreamGetSeriesCategories,
  xtreamGetSeries,
  xtreamGetSeriesInfo,
} from '../services/xtreamService';
import {
  getCachedSeries,
  getCachedConfig,
  getCategorySeries,
  cacheCategorySeries,
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
import { Colors } from '../constants/colors';
import { CONFIG_TYPES } from '../constants';
import { isProviderExpiredError } from '../services/networkErrors';
import { BackArrowIcon, HeartIcon, PlayIcon, LockIcon, UnlockIcon } from '../components/Icons';
import PlaylistHeaderActions from '../components/PlaylistHeaderActions';
import PlaylistExpiredView from '../components/PlaylistExpiredView';
import { safeBack, getRouteParam } from '../utils/navigation';
import {
  ShimmerProvider,
  CategorySkeletonList,
  SeriesSkeletonGrid,
  EpisodeDetailSkeleton,
} from '../components/Shimmer';

// In-flight request lock map to prevent duplicate simultaneous requests per playlist
const inFlightSeriesMap = new Map();

async function resolveSeriesPlaylistCreds(activePlaylistId, credentials, seriesData) {
  let creds = { ...(credentials || {}) };
  if (creds.serverUrl && creds.username && creds.password) {
    return creds;
  }
  const cachedCfg = activePlaylistId ? await getCachedConfig(activePlaylistId) : null;
  const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
  return {
    serverUrl: creds.serverUrl || cfg.server_url || cfg.serverUrl || seriesData?.serverUrl || '',
    username: creds.username || cfg.username || seriesData?.username || '',
    password: creds.password || cfg.password || seriesData?.password || '',
  };
}

function estimateCachedSeriesTotal(cached) {
  const direct = Number(cached?.total);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const categories = Array.isArray(cached?.categories) ? cached.categories : [];
  let sum = 0;
  for (const cat of categories) {
    if (Number(cat?.itemCount) > 0) {
      sum += Number(cat.itemCount);
    } else if (Array.isArray(cat?.items)) {
      sum += cat.items.length;
    }
  }
  return sum;
}

/** In-memory detail session so returning from player does not refetch seasons/episodes */
const seriesDetailMemoryCache = new Map();

function readSeriesDetailSession(playlistId, seriesId) {
  if (!seriesId) return null;
  return seriesDetailMemoryCache.get(`${String(playlistId || 'default')}:${String(seriesId)}`) || null;
}

function writeSeriesDetailSession(playlistId, seriesId, session) {
  if (!seriesId || !session?.detail?.seasons?.length) return;
  seriesDetailMemoryCache.set(`${String(playlistId || 'default')}:${String(seriesId)}`, session);
}

export default function SeriesScreen() {
  const {
    seriesData,
    seriesStore,
    setSeriesStore,
    adultPinEnabled,
    adultUnlocked,
    unlockAdult,
    lockAdult,
    playlistConfig,
    setSeriesData,
    isFavorite,
    toggleFavorite,
    activePlaylistId,
    activePlaylist,
    showPlaylistExpiredDialog,
    isExpired,
  } = useApp();
  const router = useRouter();
  const searchParams = useLocalSearchParams();
  const seriesId = getRouteParam(searchParams.seriesId);
  const episodeStreamId = getRouteParam(searchParams.episodeStreamId);
  const routeCategoryId = getRouteParam(searchParams.categoryId);
  const focusAt = getRouteParam(searchParams.focusAt);
  const returnTo = getRouteParam(searchParams.returnTo);
  const autoPlayEpisode = getRouteParam(searchParams.autoPlayEpisode) === '1';
  const resumeSecondsRoute = getRouteParam(searchParams.resumeSeconds);
  const insets = useSafeAreaInsets();

  const dismissedRouteSeriesIdRef = useRef('');
  const autoPlayTriggeredRef = useRef(false);
  const selectedSeriesRef = useRef(null);
  const seriesDetailRef = useRef(null);
  const lastAppliedFocusAtRef = useRef('');

  // Initialize directly from in-memory cache if already loaded for CURRENT playlist (0ms latency on tab switch)
  const isPreloaded = Boolean(
    seriesStore?.loaded &&
    seriesStore?.playlistId &&
    String(seriesStore.playlistId) === String(activePlaylistId) &&
    seriesStore?.allSeries?.length > 0
  );
  const [loading, setLoading]                       = useState(!isPreloaded);
  const [error, setError]                           = useState(null);
  const [rawCategories, setRawCategories]           = useState(isPreloaded ? (seriesStore?.categories || []) : []);
  const [selectedCategoryId, setSelectedCategoryId] = useState('ALL');
  const [categoryItemsMap, setCategoryItemsMap]     = useState(isPreloaded ? (seriesStore?.categoryMap || {}) : {});
  const [allSeries, setAllSeries]                   = useState(isPreloaded ? (seriesStore?.allSeries || []) : []);
  const [displayLimit, setDisplayLimit]             = useState(30);
  const [searchQuery, setSearchQuery]               = useState('');
  const [debouncedQuery, setDebouncedQuery]         = useState('');
  const [loadingCategory, setLoadingCategory]       = useState(false);

  const gridListRef = useRef(null);
  const episodesListRef = useRef(null);
  const [highlightEpisodeStreamId, setHighlightEpisodeStreamId] = useState(null);
  const fullyLoadedCategoriesRef = useRef(new Set());
  const categoryItemsMapRef = useRef(categoryItemsMap);
  useEffect(() => {
    categoryItemsMapRef.current = categoryItemsMap;
  }, [categoryItemsMap]);

  useEffect(() => {
    fullyLoadedCategoriesRef.current = new Set();
  }, [activePlaylistId]);

  // Series Detail State
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [seriesDetail, setSeriesDetail]     = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [loadingDetail, setLoadingDetail]   = useState(false);
  const [detailError, setDetailError]       = useState(null);

  useEffect(() => {
    selectedSeriesRef.current = selectedSeries;
  }, [selectedSeries]);

  useEffect(() => {
    seriesDetailRef.current = seriesDetail;
  }, [seriesDetail]);

  useEffect(() => {
    if (!selectedSeries || !seriesDetail?.seasons?.length) return;
    const sid = String(selectedSeries.seriesId || selectedSeries.id || '');
    if (!sid) return;
    writeSeriesDetailSession(activePlaylistId, sid, {
      detail: seriesDetail,
      selectedSeason,
    });
  }, [selectedSeries, seriesDetail, selectedSeason, activePlaylistId]);

  // Debounce search query to keep typing responsive at 60fps
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim().toLowerCase());
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Resolve IPTV credentials safely from AppContext or cached config
  const credentials = useMemo(() => {
    const cfg = playlistConfig?.config || playlistConfig?.configuration || playlistConfig || {};
    const serverUrl = cfg.server_url || cfg.serverUrl || seriesData?.serverUrl || '';
    const username = cfg.username || seriesData?.username || '';
    const password = cfg.password || seriesData?.password || '';
    return { serverUrl, username, password };
  }, [playlistConfig, seriesData]);

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
      const allCount = seriesData?.total || (totalFromCats > 0 ? totalFromCats : allSeries.length);
      return [
        { id: 'ALL', name: 'All Series', isAdult: false, itemCount: allCount },
        ...list,
      ];
    }
    return [];
  }, [rawCategories, allSeries.length, seriesData?.total]);

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

  // Helper to determine if a series item is adult
  const isSeriesAdultItem = useCallback((s) => {
    if (!s) return false;
    return Boolean(
      s.isAdult ||
      adultCategoryIds.has(String(s.categoryId)) ||
      isAdultContent(s.name || s.title || '', '')
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
  const seriesStoreRef = useRef(seriesStore);
  useEffect(() => {
    seriesStoreRef.current = seriesStore;
  }, [seriesStore]);

  const activePlaylistIdRef = useRef(activePlaylistId);
  useEffect(() => {
    activePlaylistIdRef.current = activePlaylistId;
  }, [activePlaylistId]);

  const credentialsRef = useRef(credentials);
  useEffect(() => {
    credentialsRef.current = credentials;
  }, [credentials]);

  // Synchronize when seriesStore is updated in AppContext for CURRENT playlist
  useEffect(() => {
    if (
      seriesStore?.loaded &&
      seriesStore?.playlistId &&
      String(seriesStore.playlistId) === String(activePlaylistId) &&
      seriesStore?.allSeries?.length > 0
    ) {
      const timer = setTimeout(() => {
        setRawCategories(seriesStore.categories || []);
        setAllSeries(seriesStore.allSeries || []);
        setCategoryItemsMap(seriesStore.categoryMap || {});
        setLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [seriesStore, activePlaylistId]);

  // Parallel data loading pipeline with deduplication, playlist isolation, and stale request protection
  const loadSeries = useCallback(async (forceRefresh = false) => {
    const currentTargetId = activePlaylistIdRef.current;
    if (!currentTargetId) return;

    const store = seriesStoreRef.current;
    // 1. If already loaded in memory store for THIS playlist and not forced, use instantly
    if (
      !forceRefresh &&
      store?.loaded &&
      store?.playlistId &&
      String(store.playlistId) === String(currentTargetId) &&
      store?.allSeries?.length > 0
    ) {
      if (activePlaylistIdRef.current === currentTargetId) {
        setRawCategories(store.categories);
        setAllSeries(store.allSeries);
        setCategoryItemsMap(store.categoryMap);
        setLoading(false);
      }
      return;
    }

    // 2. Prevent duplicate in-flight requests for THIS playlist
    if (inFlightSeriesMap.has(currentTargetId)) {
      try {
        await inFlightSeriesMap.get(currentTargetId);
      } catch (_e) {}
      return;
    }

    setError(null);

    // Resolve credentials and configuration
    const cachedCfg = await getCachedConfig(currentTargetId);
    const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
    const isM3U = cachedCfg?.type === CONFIG_TYPES.M3U || cfg.type === CONFIG_TYPES.M3U || playlistConfig?.type === CONFIG_TYPES.M3U;
    const creds = await resolveSeriesPlaylistCreds(
      currentTargetId,
      credentialsRef.current,
      seriesData,
    );
    credentialsRef.current = creds;

    // Check disk cache first for instant render if in-memory was empty
    if (!forceRefresh || isM3U) {
      const cached = await getCachedSeries(true, currentTargetId);
      if (activePlaylistIdRef.current !== currentTargetId) return; // Stale check
      if (cached?.categories && cached.categories.length > 0) {
        const map = {};
        const all = [];
        const seenIds = new Set();
        for (const cat of cached.categories) {
          const catId = String(cat.id != null ? cat.id : cat.category_id ?? '').trim();
          if (!catId) continue;
          let items = Array.isArray(cat.items) ? cat.items : [];
          if (items.length === 0) {
            try {
              const diskItems = await getCategorySeries(catId, true, currentTargetId);
              if (Array.isArray(diskItems) && diskItems.length > 0) {
                items = diskItems;
              }
            } catch (_e) {}
          }
          if (items.length > 0) {
            map[catId] = items;
            for (const s of items) {
              const sid = String(s.id || s.seriesId || '');
              if (!sid || seenIds.has(sid)) continue;
              seenIds.add(sid);
              all.push(s);
            }
          }
        }

        const expectedTotal = estimateCachedSeriesTotal(cached);

        if (all.length > 0) {
          setRawCategories(cached.categories);
          setCategoryItemsMap(map);
          setAllSeries(all);
          setLoading(false);
          setError(null);
          if (typeof setSeriesStore === 'function') {
            setSeriesStore({
              playlistId: currentTargetId,
              categories: cached.categories,
              allSeries: all,
              categoryMap: map,
            });
          }
          return;
        }

        if (expectedTotal === 0) {
          setRawCategories(cached.categories);
          setCategoryItemsMap({});
          setAllSeries([]);
          setLoading(false);
          setError(null);
          if (typeof setSeriesStore === 'function') {
            setSeriesStore({
              playlistId: currentTargetId,
              categories: cached.categories,
              allSeries: [],
              categoryMap: {},
            });
          }
          return;
        }

        // Categories cached but series rows missing/stale — refetch from provider
        if (activePlaylistIdRef.current === currentTargetId) {
          setRawCategories(cached.categories);
          setError(null);
        }
      } else if (isM3U) {
        // M3U playlist with 0 series is a valid state
        setRawCategories([]);
        setCategoryItemsMap({});
        setAllSeries([]);
        setLoading(false);
        setError(null);
        return;
      }
    }

    // Fetch Categories and Series IN PARALLEL for Xtream
    if (creds.serverUrl && creds.username && creds.password) {
      setLoading(true);
      const fetchPromise = (async () => {
        try {
          const [cats, list] = await Promise.all([
            xtreamGetSeriesCategories(creds.serverUrl, creds.username, creds.password),
            xtreamGetSeries(creds.serverUrl, creds.username, creds.password),
          ]);

          // Stale response guard: if playlist switched during network fetch, discard completely
          if (activePlaylistIdRef.current !== currentTargetId) {
            return;
          }

          const validCats = Array.isArray(cats) ? cats : [];
          const validSeries = Array.isArray(list) ? list : [];

          // Pre-index category map in O(N) time for instant O(1) tab & category switches
          const map = {};
          for (const s of validSeries) {
            const cid = String(s.categoryId || 'all_other');
            if (!map[cid]) map[cid] = [];
            map[cid].push(s);
            if (Array.isArray(s.categoryIds)) {
              for (const otherCid of s.categoryIds) {
                if (otherCid !== cid) {
                  if (!map[otherCid]) map[otherCid] = [];
                  map[otherCid].push(s);
                }
              }
            }
          }

          setRawCategories(validCats);
          setAllSeries(validSeries);
          setCategoryItemsMap(map);

          // Update context & in-memory cache with playlistId
          if (typeof setSeriesStore === 'function') {
            setSeriesStore({
              playlistId: currentTargetId,
              categories: validCats,
              allSeries: validSeries,
              categoryMap: map,
            });
          }

          if (typeof setSeriesData === 'function') {
            setSeriesData({
              playlistId: currentTargetId,
              type: 'series',
              source: 'xtream',
              categories: validCats,
              serverUrl: creds.serverUrl,
              username: creds.username,
              password: creds.password,
              total: validSeries.length,
              syncedAt: Date.now(),
            });
          }
        } catch (err) {
          if (activePlaylistIdRef.current === currentTargetId) {
            console.warn('[SERIES] Parallel fetch error:', err.message);
            if (isProviderExpiredError(err)) {
              if (typeof showPlaylistExpiredDialog === 'function') {
                showPlaylistExpiredDialog({
                  playlistId: currentTargetId,
                  playlistName: activePlaylist?.name,
                  reason: 'expired',
                });
              }
            } else {
              setError(err.message || 'Failed to load series.');
            }
          }
        } finally {
          if (activePlaylistIdRef.current === currentTargetId) {
            setLoading(false);
          }
          inFlightSeriesMap.delete(currentTargetId);
        }
      })();

      inFlightSeriesMap.set(currentTargetId, fetchPromise);
      await fetchPromise;
    } else {
      if (activePlaylistIdRef.current === currentTargetId) {
        if (isM3U) {
          setRawCategories([]);
          setCategoryItemsMap({});
          setAllSeries([]);
          setError(null);
        } else {
          setError('No IPTV playlist connected. Scan the QR code in Settings.');
        }
        setLoading(false);
      }
    }
  }, [setSeriesStore, setSeriesData, playlistConfig, showPlaylistExpiredDialog, activePlaylist?.name, seriesData]);

  // Load series on mount or when active playlist changes (guaranteed no circular loop)
  const prevPlaylistIdRef = useRef(activePlaylistId);
  useEffect(() => {
    const isNewPlaylist = prevPlaylistIdRef.current && prevPlaylistIdRef.current !== activePlaylistId;
    prevPlaylistIdRef.current = activePlaylistId;

    if (isNewPlaylist) {
      setSelectedSeries(null);
      setSelectedSeason(null);
      setSeriesDetail(null);
      setSelectedCategoryId('ALL');
      setSearchQuery('');
      setDisplayLimit(20);
      const store = seriesStoreRef.current;
      if (
        store?.loaded &&
        store?.playlistId &&
        String(store.playlistId) === String(activePlaylistId) &&
        store?.allSeries?.length > 0
      ) {
        setRawCategories(store.categories || []);
        setAllSeries(store.allSeries || []);
        setCategoryItemsMap(store.categoryMap || {});
        setLoading(false);
      } else {
        // Clear previous playlist data immediately so no stale data is visible
        setRawCategories([]);
        setAllSeries([]);
        setCategoryItemsMap({});
        loadSeries(true);
      }
    } else {
      loadSeries(false);
    }
  }, [activePlaylistId, loadSeries]);

  const emptySeriesRecoveryRef = useRef(false);
  useEffect(() => {
    emptySeriesRecoveryRef.current = false;
  }, [activePlaylistId]);

  // Stale cache: categories without rows — force a provider refetch once
  useEffect(() => {
    if (emptySeriesRecoveryRef.current || loading) return;
    if (!activePlaylistId || rawCategories.length === 0 || allSeries.length > 0) return;
    emptySeriesRecoveryRef.current = true;
    loadSeries(true);
  }, [activePlaylistId, rawCategories.length, allSeries.length, loading, loadSeries]);

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
        const cachedItems = await getCategorySeries(catId, true, pid);
        if (isCancelled) return;

        if (Array.isArray(cachedItems) && cachedItems.length > currentItems.length) {
          setCategoryItemsMap((prev) => ({
            ...prev,
            [catId]: cachedItems,
          }));

          if (typeof setSeriesStore === 'function') {
            setSeriesStore({
              categoryMap: {
                ...(seriesStoreRef.current?.categoryMap || {}),
                [catId]: cachedItems,
              },
            });
          }

          setAllSeries((prevAll) => {
            const seen = new Set(prevAll.map((s) => String(s.id || s.seriesId)));
            const fresh = cachedItems.filter((s) => !seen.has(String(s.id || s.seriesId)));
            return fresh.length > 0 ? [...prevAll, ...fresh] : prevAll;
          });

          if (expectedCount <= 0 || cachedItems.length >= expectedCount || cachedItems.length > 30) {
            fullyLoadedCategoriesRef.current.add(catId);
            setLoadingCategory(false);
            return;
          }
        }

        // 2. Fallback to Xtream API if cache missing or incomplete
        const creds = await resolveSeriesPlaylistCreds(
          pid,
          credentialsRef.current,
          seriesData,
        );
        credentialsRef.current = creds;
        if (creds?.serverUrl && creds?.username && creds?.password) {
          const networkSeries = await xtreamGetSeries(
            creds.serverUrl,
            creds.username,
            creds.password,
            catId
          );
          if (isCancelled) return;

          if (Array.isArray(networkSeries) && networkSeries.length > 0) {
            setCategoryItemsMap((prev) => ({
              ...prev,
              [catId]: networkSeries,
            }));

            await cacheCategorySeries(catId, networkSeries, pid);

            if (typeof setSeriesStore === 'function') {
              setSeriesStore({
                categoryMap: {
                  ...(seriesStoreRef.current?.categoryMap || {}),
                  [catId]: networkSeries,
                },
              });
            }

            setAllSeries((prevAll) => {
              const seen = new Set(prevAll.map((s) => String(s.id || s.seriesId)));
              const fresh = networkSeries.filter((s) => !seen.has(String(s.id || s.seriesId)));
              return fresh.length > 0 ? [...prevAll, ...fresh] : prevAll;
            });

            fullyLoadedCategoriesRef.current.add(catId);
          }
        }
      } catch (err) {
        console.warn(`[SERIES] Failed to load full category ${catId}:`, err?.message);
      } finally {
        if (!isCancelled) {
          setLoadingCategory(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [selectedCategoryId, filteredCategories, setSeriesStore, seriesData]);

  // Progressively load category caches for 'ALL' tab as user scrolls
  const loadNextCategoriesForALL = useCallback(async () => {
    if (selectedCategoryId !== 'ALL' && selectedCategoryId) return;
    const pendingCats = filteredCategories.filter(
      (c) => c.id !== 'ALL' && !fullyLoadedCategoriesRef.current.has(String(c.id))
    );
    if (pendingCats.length === 0) return;

    const nextBatch = pendingCats.slice(0, 3);
    const pid = activePlaylistIdRef.current;
    const creds = await resolveSeriesPlaylistCreds(pid, credentialsRef.current, seriesData);
    credentialsRef.current = creds;

    for (const cat of nextBatch) {
      const cid = String(cat.id);
      try {
        let items = await getCategorySeries(cid, true, pid);
        if ((!Array.isArray(items) || items.length === 0) && creds?.serverUrl && creds?.username && creds?.password) {
          items = await xtreamGetSeries(creds.serverUrl, creds.username, creds.password, cid);
          if (Array.isArray(items) && items.length > 0) {
            await cacheCategorySeries(cid, items, pid);
          }
        }
        if (Array.isArray(items) && items.length > 0) {
          fullyLoadedCategoriesRef.current.add(cid);
          setCategoryItemsMap((prev) => ({ ...prev, [cid]: items }));
          setAllSeries((prevAll) => {
            const seen = new Set(prevAll.map((s) => String(s.id || s.seriesId)));
            const fresh = items.filter((s) => !seen.has(String(s.id || s.seriesId)));
            return fresh.length > 0 ? [...prevAll, ...fresh] : prevAll;
          });
        }
      } catch (_e) {}
    }
  }, [selectedCategoryId, filteredCategories, seriesData]);

  useEffect(() => {
    if (loading || selectedCategoryId !== 'ALL') return;
    if (rawCategories.length === 0 || allSeries.length > 0) return;
    loadNextCategoriesForALL();
  }, [loading, selectedCategoryId, rawCategories.length, allSeries.length, loadNextCategoriesForALL]);

  // Series in category or debounced global search
  const series = useMemo(() => {
    const isLocked = adultPinEnabled && !adultUnlocked;

    // 1. Debounced Global Search
    if (debouncedQuery.length > 0) {
      const q = debouncedQuery;
      const seen = new Set();
      const results = [];
      for (const s of allSeries) {
        if (!s || seen.has(s.id)) continue;
        const nameMatch = (s.name || s.title || '').toLowerCase().includes(q);
        const yearMatch = s.year && String(s.year).includes(q);
        if (nameMatch || yearMatch) {
          if (isLocked && isSeriesAdultItem(s)) continue;
          seen.add(s.id);
          results.push(s);
        }
      }
      return results;
    }

    // 2. All Series
    if (selectedCategoryId === 'ALL' || !selectedCategoryId) {
      if (isLocked) {
        return allSeries.filter((s) => !isSeriesAdultItem(s));
      }
      return allSeries;
    }

    // 3. Category lookup: Instant O(1) from indexed map
    const catItems = categoryItemsMap[String(selectedCategoryId)];
    if (catItems && catItems.length > 0) {
      return catItems;
    }

    return [];
  }, [debouncedQuery, selectedCategoryId, allSeries, categoryItemsMap, adultPinEnabled, adultUnlocked, isSeriesAdultItem]);

  // Virtualized page slice for smooth scrolling
  const visibleSeries = useMemo(() => {
    return series.slice(0, displayLimit);
  }, [series, displayLimit]);

  // Eager prefetch removed to conserve network bandwidth and avoid frame drops

  const handleEndReached = useCallback(() => {
    setDisplayLimit((prev) => {
      if (prev < series.length) {
        return Math.min(prev + 30, series.length);
      }
      return prev;
    });

    if ((selectedCategoryId === 'ALL' || !selectedCategoryId) && visibleSeries.length >= series.length - 15) {
      loadNextCategoriesForALL();
    }
  }, [series.length, selectedCategoryId, visibleSeries.length, loadNextCategoriesForALL]);

  const renderListFooter = useCallback(() => {
    if (loadingCategory) {
      return (
        <View style={styles.listFooter}>
          <ActivityIndicator size="small" color={Colors.brand.primary} />
          <Text style={styles.listFooterText}>Loading videos...</Text>
        </View>
      );
    }
    if (visibleSeries.length < series.length) {
      return (
        <View style={styles.listFooter}>
          <ActivityIndicator size="small" color={Colors.brand.primary} />
        </View>
      );
    }
    return <View style={styles.footerSpacing} />;
  }, [loadingCategory, visibleSeries.length, series.length]);

  const episodeMatchesStreamId = useCallback((episode, targetId) => {
    if (!episode || targetId == null || targetId === '') return false;
    const id = String(targetId);
    const candidates = [
      episode.id,
      episode.streamId,
      episode.stream_id,
      episode.episodeId,
      episode.episode_id,
    ];
    return candidates.some((c) => c != null && String(c) === id);
  }, []);

  const focusEpisodeInDetail = useCallback(
    (detail, targetStreamId) => {
      if (!targetStreamId || !detail?.seasons?.length) return;
      for (const season of detail.seasons) {
        const episodes = Array.isArray(season.episodes) ? season.episodes : [];
        const index = episodes.findIndex((ep) => episodeMatchesStreamId(ep, targetStreamId));
        if (index >= 0) {
          setSelectedSeason(season);
          setHighlightEpisodeStreamId(String(targetStreamId));
          const scrollToEpisode = () => {
            try {
              episodesListRef.current?.scrollToIndex({
                index,
                animated: true,
                viewPosition: 0.35,
              });
            } catch (_e) {}
          };
          requestAnimationFrame(() => {
            setTimeout(scrollToEpisode, 280);
            setTimeout(scrollToEpisode, 720);
          });
          return;
        }
      }
    },
    [episodeMatchesStreamId],
  );

  // Open Series Detail
  const handleSeriesPress = useCallback(async (sItem) => {
    if (isExpired) return;

    const incomingKey = String(sItem.seriesId || sItem.id || '');
    const openKey = String(
      selectedSeriesRef.current?.seriesId || selectedSeriesRef.current?.id || '',
    );
    if (
      incomingKey &&
      openKey === incomingKey &&
      seriesDetailRef.current?.seasons?.length > 0
    ) {
      setSelectedSeries((prev) => ({ ...(prev || {}), ...sItem }));
      setDetailError(null);
      setLoadingDetail(false);
      return;
    }

    const cachedSession = readSeriesDetailSession(activePlaylistId, incomingKey);
    if (cachedSession?.detail?.seasons?.length) {
      setSelectedSeries(sItem);
      setSeriesDetail(cachedSession.detail);
      setSelectedSeason(cachedSession.selectedSeason || cachedSession.detail.seasons[0]);
      setDetailError(null);
      setLoadingDetail(false);
      return;
    }

    setSelectedSeries(sItem);
    setDetailError(null);
    setSeriesDetail(null);
    setSelectedSeason(null);
    setHighlightEpisodeStreamId(null);

    const catId = sItem.categoryId ?? sItem.category_id;
    if (catId != null && String(catId).trim() !== '') {
      setSelectedCategoryId(String(catId));
    }

    // If series already contains parsed seasons & episodes (e.g. M3U playlist), populate directly
    if (Array.isArray(sItem.seasons) && sItem.seasons.length > 0) {
      const detail = {
        info: {
          name: sItem.name || sItem.title || 'Series',
          cover: sItem.poster || sItem.cover || null,
          plot: sItem.plot || sItem.description || '',
          genre: sItem.group || sItem.categoryId || '',
          rating: sItem.rating || null,
        },
        seasons: sItem.seasons,
        episodes: sItem.episodes || {},
      };
      setSeriesDetail(detail);
      setSelectedSeason(sItem.seasons[0]);
      if (focusAt && episodeStreamId) {
        focusEpisodeInDetail(detail, episodeStreamId);
      }
      return;
    }

    // Resolve credentials safely from series item, credentials, or cached config
    let serverUrl = sItem.serverUrl || credentials.serverUrl;
    let username = sItem.username || credentials.username;
    let password = sItem.password || credentials.password;

    if (!serverUrl || !username) {
      const cachedCfg = await getCachedConfig(activePlaylistId);
      const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
      serverUrl = cfg.server_url || cfg.serverUrl || '';
      username = cfg.username || '';
      password = cfg.password || '';
    }

    const seriesId = sItem.seriesId || sItem.id;

    if (serverUrl && username && seriesId) {
      setLoadingDetail(true);
      try {
        console.log(`[SERIES] Opening series: ${seriesId}`);
        const detail = await xtreamGetSeriesInfo(
          serverUrl,
          username,
          password,
          seriesId
        );
        setSeriesDetail(detail);
        if (detail?.seasons?.length > 0) {
          setSelectedSeason(detail.seasons[0]);
        }
        if (focusAt && episodeStreamId) {
          focusEpisodeInDetail(detail, episodeStreamId);
        }
      } catch (e) {
        setDetailError(e.message || 'Unable to load series details.');
      } finally {
        setLoadingDetail(false);
      }
    } else {
      setDetailError('Missing IPTV server credentials to load series info.');
    }
  }, [
    isExpired,
    credentials,
    activePlaylistId,
    episodeStreamId,
    focusAt,
    focusEpisodeInDetail,
  ]);

  const launchEpisodePlayback = useCallback(
    async (episode, { resumeSeconds: resumeOverride } = {}) => {
      if (isExpired || !selectedSeries) return;

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

      const seriesTitle = selectedSeries.name || selectedSeries.title || 'Series';
      const seasonLabel = selectedSeason ? `S${selectedSeason.seasonNumber}` : '';
      const epNum = episode.episodeNumber || episode.episodeNum || '';
      const epLabel = epNum !== '' ? `E${epNum}` : '';
      const epTitle = episode.title || (epNum !== '' ? `Episode ${epNum}` : 'Episode');
      const fullTitle = `${seriesTitle} ${seasonLabel}${epLabel ? epLabel + ': ' : ' - '}${epTitle}`.trim();

      const resolved = resolveMediaSource({
        type: 'series',
        item: {
          ...episode,
          name: fullTitle,
          url: episode.url,
          serverUrl: selectedSeries.serverUrl || creds.serverUrl,
          username: selectedSeries.username || creds.username,
          password: selectedSeries.password || creds.password,
          poster: episode.thumbnail || episode.poster || selectedSeries.poster,
        },
        credentials: creds,
      });

      if (!resolved.url) {
        console.warn('[SERIES] Cannot play episode without stream URL');
        return;
      }

      addRecentlyWatched(
        {
          id: String(resolved.streamId || episode.id || episode.streamId),
          type: 'series',
          seriesId: String(selectedSeries.id || selectedSeries.seriesId || selectedSeries.stream_id),
          categoryId: selectedSeries.categoryId ?? selectedSeries.category_id,
          name: resolved.title,
          poster: resolved.poster,
          url: resolved.url,
          streamId: String(resolved.streamId || ''),
          containerExtension: resolved.extension || 'mp4',
        },
        activePlaylistId,
      ).catch(() => {});

      const epStreamKey = String(
        resolved.streamId || episode.id || episode.streamId || episode.stream_id || '',
      );
      const seriesKey = String(
        selectedSeries.id || selectedSeries.seriesId || selectedSeries.stream_id || '',
      );
      const catKey = selectedSeries.categoryId ?? selectedSeries.category_id;
      const resumeVal =
        resumeOverride != null && resumeOverride !== ''
          ? resumeOverride
          : resumeSecondsRoute;

      router.push({
        pathname: '/player',
        params: {
          url: resolved.url,
          title: resolved.title,
          type: 'series',
          poster: resolved.poster || '',
          streamId: epStreamKey,
          extension: resolved.extension || 'mp4',
          selectedAt: String(Date.now()),
          recentEntryId: epStreamKey,
          backTarget: 'series',
          seriesId: seriesKey,
          episodeStreamId: epStreamKey,
          ...(catKey != null && String(catKey).trim() !== ''
            ? { categoryId: String(catKey) }
            : {}),
          ...(returnTo ? { returnTo } : {}),
          ...(resumeVal && Number(resumeVal) > 3 ? { resumeSeconds: String(resumeVal) } : {}),
        },
      });
    },
    [
      isExpired,
      selectedSeries,
      selectedSeason,
      credentials,
      activePlaylistId,
      router,
      returnTo,
      resumeSecondsRoute,
    ],
  );

  const handleEpisodePress = useCallback(
    (episode) => {
      launchEpisodePlayback(episode);
    },
    [launchEpisodePlayback],
  );

  useEffect(() => {
    if (routeCategoryId && String(routeCategoryId).trim() !== '') {
      setSelectedCategoryId(String(routeCategoryId));
    }
  }, [routeCategoryId, activePlaylistId]);

  useEffect(() => {
    if (!focusAt || !episodeStreamId || !seriesDetail?.seasons?.length || !selectedSeries) return;
    if (!autoPlayEpisode) {
      autoPlayTriggeredRef.current = false;
    }
    if (lastAppliedFocusAtRef.current === String(focusAt)) return;
    lastAppliedFocusAtRef.current = String(focusAt);
    focusEpisodeInDetail(seriesDetail, episodeStreamId);
  }, [episodeStreamId, seriesDetail, selectedSeries, focusAt, autoPlayEpisode, focusEpisodeInDetail]);

  useFocusEffect(
    useCallback(() => {
      if (!selectedSeries || !seriesDetail?.seasons?.length) return undefined;
      const seriesKey = String(selectedSeries.id || selectedSeries.seriesId || '');
      if (!seriesKey) return undefined;

      const epToHighlight = consumeSeriesReturnHighlight(seriesKey);
      if (!epToHighlight) return undefined;

      const timer = setTimeout(() => {
        focusEpisodeInDetail(seriesDetail, epToHighlight);
      }, 120);
      return () => clearTimeout(timer);
    }, [selectedSeries, seriesDetail, focusEpisodeInDetail]),
  );

  useEffect(() => {
    if (!autoPlayEpisode || autoPlayTriggeredRef.current || loadingDetail) return;
    if (!episodeStreamId || !seriesDetail?.seasons?.length || !selectedSeries) return;

    for (const season of seriesDetail.seasons) {
      const episodes = Array.isArray(season.episodes) ? season.episodes : [];
      const episode = episodes.find((ep) => episodeMatchesStreamId(ep, episodeStreamId));
      if (episode) {
        autoPlayTriggeredRef.current = true;
        focusEpisodeInDetail(seriesDetail, episodeStreamId);
        const resume =
          resumeSecondsRoute && Number(resumeSecondsRoute) > 3 ? resumeSecondsRoute : undefined;
        setTimeout(() => {
          launchEpisodePlayback(episode, { resumeSeconds: resume });
        }, 480);
        return;
      }
    }
  }, [
    autoPlayEpisode,
    episodeStreamId,
    seriesDetail,
    selectedSeries,
    loadingDetail,
    resumeSecondsRoute,
    episodeMatchesStreamId,
    focusEpisodeInDetail,
    launchEpisodePlayback,
  ]);

  // Auto-open series when navigated with seriesId param (e.g. from Favorites)
  useEffect(() => {
    if (!seriesId) {
      dismissedRouteSeriesIdRef.current = '';
      autoPlayTriggeredRef.current = false;
      return;
    }
    if (dismissedRouteSeriesIdRef.current === seriesId) return;

    if (seriesId && (!selectedSeries || String(selectedSeries.id || selectedSeries.seriesId) !== String(seriesId))) {
      let found = allSeries.find((s) => String(s.id || s.seriesId) === String(seriesId));
      if (!found) {
        for (const items of Object.values(categoryItemsMap)) {
          if (Array.isArray(items)) {
            found = items.find((s) => String(s.id || s.seriesId) === String(seriesId));
            if (found) break;
          }
        }
      }
      if (!found) {
        found = { id: String(seriesId), seriesId: String(seriesId) };
      }
      if (routeCategoryId && String(routeCategoryId).trim() !== '') {
        found = {
          ...found,
          categoryId: routeCategoryId,
          category_id: routeCategoryId,
        };
      }
      const timer = setTimeout(() => {
        handleSeriesPress(found);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [seriesId, selectedSeries, allSeries, categoryItemsMap, handleSeriesPress, routeCategoryId]);

  const handleToggleFav = useCallback((sItem, e) => {
    e?.stopPropagation?.();
    toggleFavorite({
      id: String(sItem.id || sItem.seriesId),
      type: 'series',
      title: sItem.name || sItem.title,
      image: sItem.poster || sItem.cover || '',
      seriesId: sItem.seriesId || sItem.id,
      categoryId: sItem.categoryId,
      year: sItem.year,
    });
  }, [toggleFavorite]);

  const closeSeriesDetail = useCallback(() => {
    setSelectedSeries(null);
    setSeriesDetail(null);
    setSelectedSeason(null);
    setHighlightEpisodeStreamId(null);
    autoPlayTriggeredRef.current = false;
  }, []);

  const handleBack = useCallback(() => {
    if (selectedSeries) {
      const routeSeriesKey =
        seriesId || String(selectedSeries.id || selectedSeries.seriesId || '');

      if (returnTo === 'recently-watched') {
        dismissedRouteSeriesIdRef.current = routeSeriesKey;
        closeSeriesDetail();
        router.replace('/recently-watched');
        return;
      }

      if (seriesId || focusAt || episodeStreamId) {
        dismissedRouteSeriesIdRef.current = routeSeriesKey;
        closeSeriesDetail();
        router.replace('/(tabs)/series');
        return;
      }

      closeSeriesDetail();
      return;
    }
    safeBack(router);
  }, [
    selectedSeries,
    seriesId,
    focusAt,
    episodeStreamId,
    returnTo,
    router,
    closeSeriesDetail,
  ]);

  useEffect(() => {
    if (!selectedSeries) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [selectedSeries, handleBack]);

  const categoryKeyExtractor = useCallback(
    (item, index) => {
      const catId = item?.id != null ? String(item.id) : (item?.category_id != null ? String(item.category_id) : `cat_${index}`);
      return `${activePlaylistId || 'default'}:series_cat:${catId}`;
    },
    [activePlaylistId]
  );

  const seriesKeyExtractor = useCallback(
    (item, index) => {
      const sId = item?.seriesId != null ? String(item.seriesId) : (item?.id != null ? String(item.id) : (item?.series_id != null ? String(item.series_id) : `idx_${index}`));
      return `${activePlaylistId || 'default'}:series:${sId}`;
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
          ? allSeries.length
          : (categoryItemsMapRef.current[itemId]?.length || 0));

    return (
      <SeriesCategoryCard
        item={item}
        isActive={isActive}
        itemCount={count}
        onSelect={handleCategorySelect}
        adultPinEnabled={adultPinEnabled}
        adultUnlocked={adultUnlocked}
      />
    );
  }, [isSearching, activeCategoryId, allSeries.length, handleCategorySelect, adultPinEnabled, adultUnlocked]);

  const renderSeriesItem = useCallback(({ item }) => {
    const isFav = isFavorite('series', item.id || item.seriesId);
    return (
      <MediaCard
        item={item}
        type="series"
        isFav={isFav}
        serverUrl={credentials?.serverUrl}
        onPress={handleSeriesPress}
        onToggleFav={handleToggleFav}
      />
    );
  }, [isFavorite, credentials?.serverUrl, handleSeriesPress, handleToggleFav]);

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
              onPress={handleBack}
              activeOpacity={0.8}
              accessibilityLabel="Back"
            >
              <BackArrowIcon size={16} color={Colors.brand.primary} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>

        <PlaylistExpiredView title="Series Expired" />
      </View>
    );
  }

  // State 1: Full Loading State (Render Screen Shell + Shimmer Skeleton, NO SPINNER!)
  if ((loading || allSeries.length === 0) && filteredCategories.length === 0 && !error) {
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
              placeholders={['Search series...']}
            />
          </View>
          <View style={styles.headerRight}>
            <PlaylistHeaderActions />
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleBack}
              activeOpacity={0.8}
              accessibilityLabel="Back"
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
              <SeriesSkeletonGrid count={10} />
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
          title="Failed to load series"
          message={error}
          actionLabel="Retry"
          onAction={() => loadSeries(true)}
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
          title="No series found"
          message="Reload your playlist in Settings to load Series."
          actionLabel="Go to Settings"
          onAction={() => router.push('/settings')}
        />
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

        {!selectedSeries ? (
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
                'Search series...',
                'Search drama, anime, sitcoms...',
                'Find TV shows by name...',
              ]}
            />
          </View>
        ) : (
          <View style={styles.headerTitleBox}>
            <Text style={styles.headerTitleText} numberOfLines={1}>
              {selectedSeries.name || selectedSeries.title}
            </Text>
          </View>
        )}

        <View style={styles.headerRight}>
          <PlaylistHeaderActions />
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            activeOpacity={0.8}
            accessibilityLabel="Back"
          >
            <BackArrowIcon size={16} color={Colors.brand.primary} />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content: Either Series Grid OR Season/Episode Detail */}
      {!selectedSeries ? (
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

          {/* Right Area: 5-Column Grid of Series Posters (~78% width) */}
          <View style={styles.columnGrid}>
            {searchQuery ? (
              <View style={styles.searchHeaderBox}>
                <Text style={styles.searchHeaderText}>
                  Search Results ({series.length})
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
                    <SeriesSkeletonGrid count={10} />
                  </ShimmerProvider>
                ) : (
                  <FlatList
                    ref={gridListRef}
                    data={visibleSeries}
                    keyExtractor={seriesKeyExtractor}
                    numColumns={5}
                    showsVerticalScrollIndicator={false}
                    initialNumToRender={15}
                    maxToRenderPerBatch={10}
                    windowSize={5}
                    updateCellsBatchingPeriod={40}
                    removeClippedSubviews={Platform.OS === 'android'}
                    onEndReachedThreshold={0.5}
                    onEndReached={handleEndReached}
                    ListFooterComponent={renderListFooter}
                    columnWrapperStyle={styles.gridRow}
                    contentContainerStyle={styles.gridContent}
                    ListEmptyComponent={
                      <View style={styles.emptyBox}>
                        <Text style={styles.emptyText}>
                          {searchQuery ? 'No matching series found' : 'No series in this category'}
                        </Text>
                      </View>
                    }
                    renderItem={renderSeriesItem}
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
      ) : (
        /* Season & Episode Detail View */
        <View style={styles.detailViewContainer}>
          {loadingDetail ? (
            <ShimmerProvider>
              <EpisodeDetailSkeleton />
            </ShimmerProvider>
          ) : detailError ? (
            <View style={styles.errorDetailBox}>
              <Text style={styles.errorDetailText}>{detailError}</Text>
              <TouchableOpacity
                style={styles.retryDetailBtn}
                onPress={() => handleSeriesPress(selectedSeries)}
                activeOpacity={0.8}
              >
                <Text style={styles.retryDetailBtnText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.detailSplit}>
              {/* Left Column: Series Info & Seasons */}
              <View style={styles.detailLeftColumn}>
                <View style={styles.seriesHeaderInfo}>
                  <Text style={styles.detailSeriesTitle} numberOfLines={2}>
                    {selectedSeries.name || selectedSeries.title}
                  </Text>
                  {selectedSeries.genre ? (
                    <Text style={styles.detailGenre} numberOfLines={1}>
                      {selectedSeries.genre}
                    </Text>
                  ) : null}
                  {seriesDetail?.plot || selectedSeries.plot || selectedSeries.description ? (
                    <Text style={styles.detailPlot} numberOfLines={3} ellipsizeMode="tail">
                      {seriesDetail?.plot || selectedSeries.plot || selectedSeries.description}
                    </Text>
                  ) : null}
                </View>

                {/* Season Tabs */}
                <Text style={styles.seasonsHeader}>SEASONS</Text>
                <FlatList
                  data={seriesDetail?.seasons || []}
                  keyExtractor={(item) => String(item.seasonNumber)}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.seasonsListContent}
                  ListEmptyComponent={
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyText}>No seasons available</Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const isSeasonActive = selectedSeason?.seasonNumber === item.seasonNumber;
                    return (
                      <TouchableOpacity
                        style={[
                          styles.seasonCard,
                          isSeasonActive && styles.seasonCardActive,
                        ]}
                        onPress={() => setSelectedSeason(item)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.seasonTitle, isSeasonActive && styles.seasonTitleActive]}>
                          {item.name || `Season ${item.seasonNumber}`}
                        </Text>
                        <Text style={styles.seasonEpisodeCount}>
                          {item.episodes?.length || 0} Episodes
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                  {...(Platform.OS === 'ios' ? {
                    contentInsetAdjustmentBehavior: 'never',
                    automaticallyAdjustContentInsets: false,
                  } : {})}
                />
              </View>

              {/* Right Column: Episodes List */}
              <View style={styles.detailRightColumn}>
                <Text style={styles.episodesHeader}>
                  EPISODES ({selectedSeason?.episodes?.length || 0})
                </Text>
                <FlatList
                  ref={episodesListRef}
                  data={selectedSeason?.episodes || []}
                  keyExtractor={(item) => `episode:${String(item.id || item.episodeId || item.streamId || item.stream_id)}`}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.episodesListContent}
                  onScrollToIndexFailed={(info) => {
                    setTimeout(() => {
                      try {
                        episodesListRef.current?.scrollToIndex({
                          index: info.index,
                          animated: true,
                          viewPosition: 0.35,
                        });
                      } catch (_e) {}
                    }, 400);
                  }}
                  ListEmptyComponent={
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyText}>No episodes available for this season</Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const isHighlighted = highlightEpisodeStreamId
                      ? episodeMatchesStreamId(item, highlightEpisodeStreamId)
                      : false;
                    return (
                    <TouchableOpacity
                      style={[styles.episodeCard, isHighlighted && styles.episodeCardActive]}
                      onPress={() => handleEpisodePress(item)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.episodeThumbnailBox}>
                        <CachedImage
                          uri={item.thumbnail || item.poster || item.info?.movie_image}
                          item={item}
                          serverUrl={credentials?.serverUrl}
                          contentId={item.id}
                          type="episode"
                          style={styles.episodeThumbnail}
                          borderRadius={6}
                        />
                        <View style={styles.episodePlayOverlay}>
                          <PlayIcon size={12} color="#FFFFFF" />
                        </View>
                      </View>
                      <View style={styles.episodeInfo}>
                        <Text style={styles.episodeTitle} numberOfLines={1} ellipsizeMode="tail">
                          {item.episodeNumber ? `Ep ${item.episodeNumber}: ` : ''}{item.title}
                        </Text>
                        <View style={styles.episodeMetaRow}>
                          {item.duration ? (
                            <Text style={styles.episodeDuration}>{item.duration}</Text>
                          ) : null}
                        </View>
                      </View>
                    </TouchableOpacity>
                    );
                  }}
                  {...(Platform.OS === 'ios' ? {
                    contentInsetAdjustmentBehavior: 'never',
                    automaticallyAdjustContentInsets: false,
                  } : {})}
                />
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// Series Category Card Component (Memoized)
const SeriesCategoryCard = React.memo(
  function SeriesCategoryCard({ item, isActive, itemCount, onSelect, adultPinEnabled, adultUnlocked }) {
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
  headerTitleBox: {
    flex: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  headerTitleText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  logo: {
    width: 120,
    height: 32,
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
    paddingVertical: 5,
    gap: 6,
    flexShrink: 0,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.text.secondary,
    fontWeight: '600',
  },
  loadingCategoryText: {
    fontSize: 12,
    color: Colors.text.secondary,
    marginTop: 6,
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
  // Detail View Styles
  detailViewContainer: {
    flex: 1,
    minHeight: 0,
    marginBottom: 4,
  },
  loadingDetailBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingDetailText: {
    fontSize: 14,
    color: Colors.text.secondary,
    fontWeight: '600',
  },
  errorDetailBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  errorDetailText: {
    fontSize: 14,
    color: Colors.status.error,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryDetailBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
  },
  retryDetailBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },
  detailSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    height: '100%',
  },
  detailLeftColumn: {
    flex: 0.35,
    height: '100%',
  },
  seriesHeaderInfo: {
    backgroundColor: Colors.background.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  detailSeriesTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  detailGenre: {
    fontSize: 11,
    color: Colors.text.secondary,
    fontWeight: '600',
    marginBottom: 6,
  },
  detailPlot: {
    fontSize: 11,
    color: Colors.text.tertiary,
    lineHeight: 16,
  },
  seasonsHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text.secondary,
    letterSpacing: 1,
    marginBottom: 6,
  },
  seasonsListContent: {
    gap: 6,
    paddingRight: 2,
    paddingBottom: 8,
  },
  seasonCard: {
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  seasonCardActive: {
    backgroundColor: Colors.background.cardActive,
    borderColor: Colors.brand.primary,
    borderWidth: 1.2,
  },
  seasonTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text.secondary,
    marginBottom: 2,
  },
  seasonTitleActive: {
    color: '#FFFFFF',
  },
  seasonEpisodeCount: {
    fontSize: 11,
    color: Colors.text.tertiary,
  },
  detailRightColumn: {
    flex: 0.65,
    height: '100%',
  },
  episodesHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text.secondary,
    letterSpacing: 1,
    marginBottom: 6,
  },
  episodesListContent: {
    gap: 6,
    paddingRight: 2,
    paddingBottom: 10,
  },
  episodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    padding: 10,
    gap: 10,
  },
  episodeCardActive: {
    backgroundColor: Colors.background.cardActive,
    borderColor: Colors.brand.primary,
    borderWidth: 1.2,
  },
  episodeThumbnailBox: {
    width: 52,
    height: 36,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Colors.background.card,
  },
  episodeThumbnail: {
    width: '100%',
    height: '100%',
  },
  episodePlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodePlayIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodeInfo: {
    flex: 1,
  },
  episodeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  episodeDuration: {
    fontSize: 10,
    color: Colors.text.tertiary,
  },
  episodeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  episodeFormatBadge: {
    borderRadius: 3,
    borderWidth: 1,
    borderColor: Colors.brand.primary,
    paddingHorizontal: 4,
    paddingVertical: 0.5,
  },
  episodeFormatText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
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
