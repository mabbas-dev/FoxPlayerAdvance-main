import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Animated,
  useWindowDimensions,
  Easing,
  BackHandler,
  StatusBar,
  Platform,
} from 'react-native';
import { useRouter, useIsFocused, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer } from 'expo-video';
import { useApp } from '../state/AppContext';
import EmbeddedVideoPlayer from '../components/EmbeddedVideoPlayer';
import { resolveStreamSource, normalizePlaybackSource, logLiveChannelDebug } from '../utils/mediaSourcePipeline';
import { getPlatformPlayerOptions } from '../utils/playerConfig';
let ExpoImage = null;
try {
  const mod = require('expo-image');
  if (mod && (mod.Image || mod.default)) ExpoImage = mod.Image || mod.default;
} catch (_e) {
  ExpoImage = null;
}
import CachedImage from '../components/CachedImage';
import EmptyState from '../components/EmptyState';
import AnimatedSearchBar from '../components/AnimatedSearchBar';
import AdultPinLockView from '../components/AdultPinLockView';
import { isAdultContent } from '../services/m3uParser';
import { normalizeImageUrl } from '../utils/imageHelpers';
import Colors from '../constants/colors';
import { BackArrowIcon, HeartIcon, LockIcon, UnlockIcon } from '../components/Icons';
import PlaylistHeaderActions from '../components/PlaylistHeaderActions';
import PlaylistExpiredView from '../components/PlaylistExpiredView';
import { safeBack } from '../utils/navigation';
import {
  ShimmerProvider,
  LiveSkeletonLayout,
} from '../components/Shimmer';

export default function LiveScreen() {
  const {
    liveData,
    adultPinEnabled,
    adultUnlocked,
    unlockAdult,
    lockAdult,
    isFavorite,
    toggleFavorite,
    activePlaylistId,
    playbackSessionId,
    isConfigured,
    playlistConfig,
    isExpired,
  } = useApp();
  const router = useRouter();
  const {
    channelId,
    streamId,
    channelName,
    url,
    logo,
    categoryId,
    containerExtension,
    selectedAt,
  } = useLocalSearchParams();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isPortrait = windowHeight > windowWidth;

  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [playingChannel, setPlayingChannel]         = useState(null);
  const [searchQuery, setSearchQuery]               = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [isPlayerDismissed, setIsPlayerDismissed]   = useState(false);
  const [isSectionActive, setIsSectionActive]       = useState(true);

  // Debounce search query to prevent laggy keystrokes and UI freezes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim().toLowerCase());
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Centralized stream source normalization for currently selected channel
  const resolvedChannel = useMemo(() => {
    if (!playingChannel) return null;
    const creds = playlistConfig?.config || playlistConfig || {};
    return normalizePlaybackSource({
      type: 'live',
      item: playingChannel,
      credentials: creds,
    }, { platform: Platform.OS });
  }, [playingChannel, playlistConfig]);

  const [playerKey, setPlayerKey]                   = useState(0);

  const handleRecreatePlayer = useCallback(() => {
    setPlayerKey((k) => k + 1);
  }, []);

  // Stable single player instance shared across both MINI & EXPANDED presentations
  const livePlayer = useVideoPlayer(null, (p) => {
    const opts = getPlatformPlayerOptions({ type: 'live', isLive: true });
    p.loop = false; // Live streams must never loop
    p.timeUpdateEventInterval = opts.timeUpdateEventInterval;
    p.staysActiveInBackground = opts.staysActiveInBackground;
    if (opts.audioMixingMode) {
      p.audioMixingMode = opts.audioMixingMode;
    }
    p.muted = false;
    p.volume = 1.0;
    if (opts.bufferOptions) {
      p.bufferOptions = opts.bufferOptions;
    }
  }, { playerKey });

  useEffect(() => {
    if (playingChannel && resolvedChannel) {
      logLiveChannelDebug(playingChannel, resolvedChannel);
    }
  }, [playingChannel, resolvedChannel]);

  // Player Presentation State Machine: 'MINI' | 'MAXIMIZING' | 'MAX' | 'MINIMIZING' (Single Source of Truth)
  const [presentationState, setPresentationState]   = useState('MINI');
  const presentationRef                             = useRef('MINI');

  // miniBounds is only used for the MAXIMIZING/MINIMIZING animation.
  // It is measured on-demand (once, when user taps expand) — NOT polled continuously.
  // In MINI mode the player is a direct flex child of columnPlayer, so no coords are needed.
  const [miniBounds, setMiniBounds] = useState(null);
  const columnPlayerRef             = useRef(null);

  const safePadding = useMemo(() => ({
    paddingTop: 4,
    paddingBottom: Math.max(insets.bottom, 4),
    paddingLeft: Math.max(insets.left, 16),
    paddingRight: Math.max(insets.right, 16),
  }), [insets.bottom, insets.left, insets.right]);

  // Measure exact screen coords of columnPlayer at expand-tap time.
  // Called once per expand, at a moment when layout is stable (no animation running).
  const captureMiniBoundsForExpand = useCallback(() => {
    return new Promise((resolve) => {
      const fallbackBounds = {
        x: Math.round(isPortrait ? safePadding.paddingLeft : windowWidth * 0.5),
        y: Math.round(safePadding.paddingTop + 60),
        width: Math.round(isPortrait ? (windowWidth - safePadding.paddingLeft - safePadding.paddingRight) : (windowWidth * 0.5 - safePadding.paddingRight)),
        height: Math.round(isPortrait ? 186 : (windowHeight - safePadding.paddingTop - safePadding.paddingBottom)),
      };

      if (!columnPlayerRef.current || !columnPlayerRef.current.measureInWindow) {
        resolve(fallbackBounds);
        return;
      }
      try {
        columnPlayerRef.current.measureInWindow((x, y, width, height) => {
          if (typeof width !== 'number' || width < 40 || typeof height !== 'number' || height < 40) {
            resolve(fallbackBounds);
            return;
          }
          const safeRight  = Math.max(insets.right,  0);
          const safeBottom = Math.max(insets.bottom, 4);
          const bounds = {
            x: Math.round(x),
            y: Math.round(y),
            width:  Math.round(Math.min(width,  windowWidth  - safeRight  - Math.round(x))),
            height: Math.round(Math.min(height, windowHeight - safeBottom - Math.round(y))),
          };
          resolve(bounds);
        });
      } catch (_e) {
        resolve(fallbackBounds);
      }
    });
  }, [insets.right, insets.bottom, windowWidth, windowHeight, isPortrait, safePadding]);


  // Animated values for smooth morphing transition (runs purely on container UI, video keeps playing)
  const animProgress   = useRef(new Animated.Value(0)).current; // 0 = mini, 1 = expanded
  const scrimOpacity   = useRef(new Animated.Value(0)).current;
  const topAnimRef     = useRef(new Animated.Value(1));
  const centerAnimRef  = useRef(new Animated.Value(1));
  const bottomAnimRef  = useRef(new Animated.Value(1));

  // Authoritative rule for Live TV lifecycle:
  // When leaving the Live TV section (switching tabs, navigating to Home/Movies/Series, back navigation),
  // isSectionActive becomes false, stopping playback, clearing active channel, and releasing stream resources.
  // This guarantees returning to Live TV always starts idle without auto-loading any video.
  useFocusEffect(
    useCallback(() => {
      setIsSectionActive(true);
      return () => {
        setIsSectionActive(false);
        setPresentationState('MINI');
        presentationRef.current = 'MINI';
        animProgress.setValue(0);
        scrimOpacity.setValue(0);
        topAnimRef.current.setValue(1);
        centerAnimRef.current.setValue(1);
        bottomAnimRef.current.setValue(1);
        setPlayingChannel(null);
        consumedChannelIdRef.current = null;
        consumedSelectedAtRef.current = null;
        setIsPlayerDismissed(false);
        if (livePlayer) {
          livePlayer._activeUri = null;
          try {
            livePlayer.pause();
            livePlayer.muted = true;
            if (typeof livePlayer.replaceAsync === 'function') {
              livePlayer.replaceAsync(null);
            } else if (typeof livePlayer.replace === 'function') {
              livePlayer.replace(null);
            }
          } catch (_e) {}
        }
      };
    }, [animProgress, scrimOpacity, livePlayer])
  );

  // Categories (strictly scoped to activePlaylistId)
  const categories = useMemo(() => {
    if (!liveData?.categories) return [];
    if (liveData?.playlistId && activePlaylistId && String(liveData.playlistId) !== String(activePlaylistId)) {
      return [];
    }
    return liveData.categories.map((cat) => {
      const isAdult = Boolean(
        cat.isAdult ||
        cat.is_adult === 1 ||
        cat.is_adult === '1' ||
        cat.adult === 1 ||
        cat.adult === true ||
        isAdultContent(cat.name || cat.category_name || '', '')
      );
      return {
        ...cat,
        isAdult,
      };
    });
  }, [liveData, activePlaylistId]);

  // Current category displayed in list
  const currentCategory = useMemo(() => {
    if (!categories.length) return null;
    if (!selectedCategoryId) return categories[0];
    return categories.find((c) => String(c.id) === String(selectedCategoryId)) || categories[0];
  }, [categories, selectedCategoryId]);

  // Channels in current category or debounced global search (snappy 60fps)
  const channels = useMemo(() => {
    const isLocked = adultPinEnabled && !adultUnlocked;

    if (debouncedSearchQuery.length > 0) {
      const q = debouncedSearchQuery;
      const results = [];
      for (const cat of categories) {
        if (isLocked && cat.isAdult) continue;
        const catChannels = cat.channels || cat.items || [];
        for (const ch of catChannels) {
          if (!ch?.name) continue;
          if (ch.name.toLowerCase().includes(q)) {
            if (isLocked && (ch.isAdult || isAdultContent(ch.name, ''))) continue;
            results.push(ch);
            if (results.length >= 250) break;
          }
        }
        if (results.length >= 250) break;
      }
      return results;
    }

    if (!currentCategory) return [];
    return currentCategory.channels || currentCategory.items || [];
  }, [categories, currentCategory, debouncedSearchQuery, adultPinEnabled, adultUnlocked]);

  // Category selection ONLY updates the visible list — NEVER autoplays or alters active playback
  const handleCategorySelect = useCallback((catId) => {
    setSelectedCategoryId(catId);
    setSearchQuery('');
  }, []);

  const channelSessionRef = useRef(0);

  // Explicit user action starts playback — immediately pauses previous channel to release connection
  const handleChannelSelect = useCallback((channel) => {
    if (isExpired || !channel) return;
    const currentId = playingChannel ? (playingChannel.id ?? playingChannel.streamId ?? playingChannel.stream_id) : null;
    const newId = channel ? (channel.id ?? channel.streamId ?? channel.stream_id) : null;
    if (currentId != null && newId != null && String(currentId) === String(newId)) {
      // Channel is already active; do not restart or trigger reload churn
      return;
    }
    const channelIdKey = newId || `ch_${Date.now()}`;
    const sessionId = `live_${channelIdKey}_${Date.now()}_${++channelSessionRef.current}`;

    // Pause active player to release stream connection slot and prevent audio bleed
    if (livePlayer) {
      livePlayer._foxSessionId = sessionId;
      livePlayer._playerState = 'LOADING';
      livePlayer._hasEverPlayed = false;
      try {
        livePlayer.pause();
        livePlayer.muted = false;
        livePlayer.volume = 1.0;
      } catch (_e) {}
    }

    setIsPlayerDismissed(false);
    const channelWithTimestamp = {
      ...channel,
      sessionId,
      selectedAt: Date.now(),
    };
    setPlayingChannel(channelWithTimestamp);
  }, [isExpired, playingChannel, livePlayer]);


  const consumedChannelIdRef = useRef(null);
  const consumedSelectedAtRef = useRef(null);

  // Auto-select channel ONLY when explicitly navigated with a fresh channelId param (e.g. from Favorites)
  useEffect(() => {
    const isFresh = selectedAt
      ? selectedAt !== consumedSelectedAtRef.current
      : channelId && channelId !== consumedChannelIdRef.current;

    if (!channelId || !isFresh) return;

    let found = null;
    let targetCatId = null;

    if (categories.length > 0) {
      // 1. Try search in matching categoryId first if provided
      if (categoryId) {
        const cat = categories.find((c) => String(c.id) === String(categoryId));
        if (cat) {
          const catChannels = cat.channels || cat.items || [];
          const match = catChannels.find((c) => {
            const cid = c.id ?? c.streamId ?? c.stream_id;
            const sid = c.streamId ?? c.stream_id;
            return (
              (cid != null && String(cid) === String(channelId)) ||
              (streamId && sid != null && String(sid) === String(streamId))
            );
          });
          if (match) {
            found = match;
            targetCatId = cat.id;
          }
        }
      }

      // 2. Search all categories by ID or streamId
      if (!found) {
        for (const cat of categories) {
          const catChannels = cat.channels || cat.items || [];
          const match = catChannels.find((c) => {
            const cid = c.id ?? c.streamId ?? c.stream_id;
            const sid = c.streamId ?? c.stream_id;
            return (
              (cid != null && String(cid) === String(channelId)) ||
              (streamId && sid != null && String(sid) === String(streamId))
            );
          });
          if (match) {
            found = match;
            targetCatId = cat.id;
            break;
          }
        }
      }

      // 3. Fallback search by URL or Channel Name if IDs differ across providers
      if (!found && (url || channelName)) {
        for (const cat of categories) {
          const catChannels = cat.channels || cat.items || [];
          const match = catChannels.find((c) => {
            if (url && c.url && String(c.url) === String(url)) return true;
            if (channelName && c.name && String(c.name).trim().toLowerCase() === String(channelName).trim().toLowerCase()) return true;
            return false;
          });
          if (match) {
            found = match;
            targetCatId = cat.id;
            break;
          }
        }
      }
    }

    // 4. Fallback synthetic channel if not found in categories
    if (!found) {
      if (categories.length === 0 && !url && !streamId) {
        return;
      }
      found = {
        id: channelId,
        streamId: streamId || channelId,
        stream_id: streamId || channelId,
        name: channelName || 'Live Channel',
        logo: logo || '',
        stream_icon: logo || '',
        url: url || '',
        categoryId: categoryId || null,
        containerExtension: containerExtension || 'ts',
      };
    }

    consumedChannelIdRef.current = channelId;
    consumedSelectedAtRef.current = selectedAt || channelId;

    if (targetCatId) {
      setSelectedCategoryId(targetCatId);
    } else if (categoryId) {
      setSelectedCategoryId(categoryId);
    }

    const channelIdKey = found.id ?? found.streamId ?? found.stream_id ?? channelId;
    const sessionId = `live_${channelIdKey}_${Date.now()}_${++channelSessionRef.current}`;

    // Pause active player to release stream connection slot and prevent audio bleed
    if (livePlayer) {
      livePlayer._foxSessionId = sessionId;
      livePlayer._playerState = 'LOADING';
      livePlayer._hasEverPlayed = false;
      try {
        livePlayer.pause();
        livePlayer.muted = false;
        livePlayer.volume = 1.0;
      } catch (_e) {}
    }

    setIsPlayerDismissed(false);
    found.sessionId = sessionId;
    setPlayingChannel({ ...found, selectedAt: Date.now() });
  }, [channelId, streamId, channelName, url, logo, categoryId, containerExtension, selectedAt, categories, livePlayer]);

  const handleToggleFav = useCallback(
    (channel, e) => {
      e?.stopPropagation?.();
      const channelIdKey = channel.id ?? channel.streamId ?? channel.stream_id ?? '';
      toggleFavorite({
        id: String(channelIdKey),
        streamId: channel.streamId ?? channel.stream_id ?? channelIdKey,
        type: 'live',
        title: channel.name,
        name: channel.name,
        image: channel.logo || channel.stream_icon || '',
        logo: channel.logo || channel.stream_icon || '',
        url: channel.url || '',
        categoryId: channel.categoryId || selectedCategoryId,
        containerExtension: channel.containerExtension || channel.container_extension || 'ts',
      });
    },
    [toggleFavorite, selectedCategoryId]
  );

  const refreshMiniBounds = useCallback(async () => {
    const bounds = await captureMiniBoundsForExpand();
    if (bounds) {
      setMiniBounds(bounds);
    }
    return bounds;
  }, [captureMiniBoundsForExpand]);

  const handleColumnPlayerLayout = useCallback(() => {
    if (
      presentationRef.current === 'MINI' ||
      presentationRef.current === 'MINIMIZING' ||
      presentationRef.current === 'MAXIMIZING'
    ) {
      refreshMiniBounds();
    }
  }, [refreshMiniBounds]);

  useEffect(() => {
    if (playingChannel && !isPlayerDismissed && isSectionActive) {
      refreshMiniBounds();
    }
  }, [playingChannel, isPlayerDismissed, isSectionActive, refreshMiniBounds]);

  const expandToFull = useCallback(async () => {
    if (presentationRef.current !== 'MINI') return;

    const bounds = (await refreshMiniBounds()) || miniBounds || {
      x: 0,
      y: 0,
      width: windowWidth,
      height: windowHeight,
    };
    setMiniBounds(bounds);

    presentationRef.current = 'MAXIMIZING';
    setPresentationState('MAXIMIZING');

    topAnimRef.current.setValue(1);
    centerAnimRef.current.setValue(1);
    bottomAnimRef.current.setValue(1);

    Animated.parallel([
      Animated.timing(animProgress, {
        toValue: 1,
        duration: 420,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: false,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      presentationRef.current = 'MAX';
      setPresentationState('MAX');
    });
  }, [animProgress, scrimOpacity, miniBounds, refreshMiniBounds, windowWidth, windowHeight]);

  const contractToMini = useCallback(async () => {
    if (presentationRef.current !== 'MAX') return;
    await refreshMiniBounds();
    presentationRef.current = 'MINIMIZING';
    setPresentationState('MINIMIZING');

    Animated.parallel([
      Animated.timing(animProgress, {
        toValue: 0,
        duration: 380,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: false,
      }),
      Animated.timing(scrimOpacity, {
        toValue: 0,
        duration: 340,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      presentationRef.current = 'MINI';
      setPresentationState('MINI');
      refreshMiniBounds();
    });
  }, [animProgress, scrimOpacity, refreshMiniBounds]);

  // Handle hardware Android back button when expanded
  useEffect(() => {
    const onBackPress = () => {
      if (presentationRef.current === 'MAX' || presentationRef.current === 'MAXIMIZING') {
        contractToMini();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [contractToMini]);

  // Reset live stream state immediately when switching playlists, session resets, unconfigured, or expired
  const prevPlaylistIdRef = useRef(activePlaylistId);
  const prevSessionRef = useRef(playbackSessionId);
  useEffect(() => {
    const playlistChanged = prevPlaylistIdRef.current && prevPlaylistIdRef.current !== activePlaylistId;
    const sessionChanged = prevSessionRef.current && prevSessionRef.current !== playbackSessionId;
    const noConfig = !isConfigured || !activePlaylistId;

    if (playlistChanged || sessionChanged || noConfig || isExpired) {
      if (livePlayer) {
        livePlayer._activeUri = null;
        try {
          livePlayer.pause();
          livePlayer.muted = true;
          if (typeof livePlayer.replaceAsync === 'function') {
            livePlayer.replaceAsync(null);
          } else if (typeof livePlayer.replace === 'function') {
            livePlayer.replace(null);
          }
        } catch (_e) {}
      }
      setPlayingChannel(null);
      if (playlistChanged || sessionChanged || noConfig) {
        setSelectedCategoryId(null);
        setSearchQuery('');
      }
      if (presentationRef.current === 'MAX') {
        contractToMini();
      }
    }
    prevPlaylistIdRef.current = activePlaylistId;
    prevSessionRef.current = playbackSessionId;
  }, [activePlaylistId, playbackSessionId, isConfigured, isExpired, contractToMini, livePlayer]);

  const isPlayerExpanded = presentationState === 'MAX' || presentationState === 'MAXIMIZING';
  const liveControlsMode = presentationState === 'MINI' ? 'mini' : 'expanded';

  const handleCloseLivePlayer = useCallback(() => {
    if (livePlayer) {
      livePlayer._activeUri = null;
      try {
        livePlayer.pause();
        if (typeof livePlayer.replaceAsync === 'function') {
          livePlayer.replaceAsync(null);
        } else if (typeof livePlayer.replace === 'function') {
          livePlayer.replace(null);
        }
      } catch (_e) {}
    }
    setIsPlayerDismissed(true);
    setPlayingChannel(null);
  }, [livePlayer]);

  const playerContainerStyle = useMemo(() => {
    if (!miniBounds) {
      return [styles.fullscreenPlayerContainer, { opacity: 0 }];
    }
    const z = isPlayerExpanded ? 9999 : 35;
    return {
      position: 'absolute',
      opacity: 1,
      left: animProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [miniBounds.x, 0],
      }),
      top: animProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [miniBounds.y, 0],
      }),
      width: animProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [miniBounds.width, windowWidth],
      }),
      height: animProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [miniBounds.height, windowHeight],
      }),
      borderRadius: animProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [14, 0],
      }),
      transform: [
        {
          scale: animProgress.interpolate({
            inputRange: [0, 0.65, 1],
            outputRange: [1, 1.012, 1],
          }),
        },
      ],
      zIndex: z,
      elevation: z,
      backgroundColor: '#000000',
      overflow: 'hidden',
      borderWidth: animProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
      borderColor: 'rgba(255, 255, 255, 0.08)',
    };
  }, [miniBounds, animProgress, windowWidth, windowHeight, isPlayerExpanded]);


  const categoryKeyExtractor = useCallback((item) => `${activePlaylistId}:live_cat:${item.id}`, [activePlaylistId]);
  const channelKeyExtractor = useCallback((item) => `${activePlaylistId}:live:${String(item.streamId || item.id || item.stream_id)}`, [activePlaylistId]);

  const CHANNEL_ITEM_HEIGHT = 48;
  const CHANNEL_ITEM_MARGIN = 6;
  const CHANNEL_ROW_TOTAL = CHANNEL_ITEM_HEIGHT + CHANNEL_ITEM_MARGIN; // 54
  const getChannelItemLayout = useCallback(
    (_data, index) => ({
      length: CHANNEL_ROW_TOTAL,
      offset: CHANNEL_ROW_TOTAL * index,
      index,
    }),
    []
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
    const isActive = !isSearching && activeCategoryId === item.id;
    const itemCount = (item.channels || item.items || []).length;
    return (
      <CategoryItem
        category={item}
        count={itemCount}
        isActive={isActive}
        isPortrait={isPortrait}
        adultPinEnabled={adultPinEnabled}
        adultUnlocked={adultUnlocked}
        onPress={handleCategorySelect}
      />
    );
  }, [isSearching, activeCategoryId, isPortrait, adultPinEnabled, adultUnlocked, handleCategorySelect]);

  const activePlayingId = playingChannel?.id;

  const renderChannelItem = useCallback(({ item }) => {
    const isActive = activePlayingId === item.id;
    const isFav = isFavorite('live', item.id);
    return (
      <ChannelItem
        channel={item}
        isActive={isActive}
        isFav={isFav}
        onPress={handleChannelSelect}
        onToggleFav={handleToggleFav}
      />
    );
  }, [activePlayingId, isFavorite, handleChannelSelect, handleToggleFav]);

  // State 0: Playlist Expired (Render clean, minimal PlaylistExpiredView within normal screen layout)
  if (isExpired) {
    return (
      <View style={styles.screenRoot}>
        <StatusBar hidden={true} />
        <View style={[styles.mainLayout, safePadding]}>
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

          <PlaylistExpiredView title="Live TV Expired" />
        </View>
      </View>
    );
  }

  // State 1: Content loading / uninitialized (Render Screen Shell + Shimmer Skeleton, NO SPINNER!)
  const isLiveMismatch = Boolean(liveData?.playlistId && activePlaylistId && String(liveData.playlistId) !== String(activePlaylistId));
  if (!liveData || isLiveMismatch) {
    return (
      <View style={styles.screenRoot}>
        <View style={[styles.mainLayout, safePadding]}>
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
                placeholders={['Search live channels...']}
              />
            </View>
            <View style={styles.headerRight}>
              <PlaylistHeaderActions />
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => safeBack(router)}
                activeOpacity={0.8}
                accessibilityLabel="Back"
              >
                <BackArrowIcon size={16} color={Colors.brand.primary} />
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ShimmerProvider>
            <LiveSkeletonLayout isPortrait={isPortrait} />
          </ShimmerProvider>
        </View>
      </View>
    );
  }

  // State 2: Success with 0 channels
  if (categories.length === 0) {
    return (
      <View style={styles.screenRoot}>
        <View style={[styles.mainLayout, safePadding]}>
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
            title="No channels found"
            message="Reload your playlist in Settings to load LIVE channels."
            actionLabel="Go to Settings"
            onAction={() => router.push('/settings')}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screenRoot}>
      <StatusBar hidden={true} />

      {/* Main Layout Layer (safePadding applied HERE, not on screenRoot) */}
      <View style={[styles.mainLayout, safePadding]}>
        {/* Top Header Toolbar with Animated Search */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
              source={require('../../assets/inside-app-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Prominent Animated Search Bar */}
          <View style={styles.searchWrapper}>
            <AnimatedSearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              onClear={() => setSearchQuery('')}
              placeholders={[
                'Search live channels...',
                'Search sports, news, cinema...',
                'Type channel name...',
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

        {/* Responsive Content Split */}
        <View
          style={[styles.contentSplit, isPortrait && styles.contentSplitPortrait]}
        >
          {/* Column 1: Categories */}
          <View style={[styles.columnCategories, isPortrait && styles.columnCategoriesPortrait]}>
            <FlatList
              data={categories}
              extraData={activeCategoryId}
              keyExtractor={categoryKeyExtractor}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              horizontal={isPortrait}
              initialNumToRender={16}
              maxToRenderPerBatch={15}
              windowSize={9}
              updateCellsBatchingPeriod={50}
              removeClippedSubviews={false}
              scrollEventThrottle={16}
              getItemLayout={isPortrait ? undefined : getCategoryItemLayout}
              contentContainerStyle={
                isPortrait ? styles.categoriesListContentHorizontal : styles.categoriesListContent
              }
              renderItem={renderCategoryItem}
              {...(Platform.OS === 'ios' ? {
                contentInsetAdjustmentBehavior: 'never',
                automaticallyAdjustContentInsets: false,
                directionalLockEnabled: true,
              } : {})}
            />
          </View>

          {/* Column 2: Channels */}
          <View style={[styles.columnChannels, isPortrait && styles.columnChannelsPortrait]}>
            {searchQuery ? (
              <View style={styles.searchHeaderBox}>
                <Text style={styles.searchHeaderText}>
                  Search Results ({channels.length})
                </Text>
              </View>
            ) : null}

            {/* Adult PIN Protection in Channels Section */}
            {!searchQuery && currentCategory?.isAdult && adultPinEnabled && !adultUnlocked ? (
              <AdultPinLockView
                categoryName={currentCategory.name}
                onSuccess={unlockAdult}
                compact={true}
              />
            ) : (
              <>
                {!searchQuery && currentCategory?.isAdult && adultPinEnabled && adultUnlocked ? (
                  <View style={styles.unlockedCategoryBanner}>
                    <View style={styles.unlockedBannerLeft}>
                      <UnlockIcon size={12} color="#34D399" />
                      <Text style={styles.unlockedBannerText}>18+ Unlocked</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.lockAdultBtn}
                      onPress={lockAdult}
                      activeOpacity={0.8}
                    >
                      <LockIcon size={10} color="#FFFFFF" />
                      <Text style={styles.lockAdultBtnText}>Lock</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <FlatList
                  data={channels}
                  extraData={activePlayingId}
                  keyExtractor={channelKeyExtractor}
                  showsVerticalScrollIndicator={false}
                  initialNumToRender={16}
                  maxToRenderPerBatch={15}
                  windowSize={9}
                  updateCellsBatchingPeriod={50}
                  removeClippedSubviews={false}
                  scrollEventThrottle={16}
                  getItemLayout={getChannelItemLayout}
                  contentContainerStyle={styles.channelsListContent}
                  ListEmptyComponent={
                    <View style={styles.emptyChannelsBox}>
                      <Text style={styles.emptyChannelsText}>
                        {searchQuery ? 'No matching channels' : 'No channels in this category'}
                      </Text>
                    </View>
                  }
                  renderItem={renderChannelItem}
                  {...(Platform.OS === 'ios' ? {
                    contentInsetAdjustmentBehavior: 'never',
                    automaticallyAdjustContentInsets: false,
                  } : {})}
                />
              </>
            )}
          </View>

          {/* Column 3: Live TV Player Slot
               – MINI:              EmbeddedVideoPlayer renders INLINE as flex child (no coords needed)
               – MAXIMIZING/MAX/MINIMIZING: dark placeholder — absolute overlay covers this slot */}
          <View
            ref={columnPlayerRef}
            style={[styles.columnPlayer, isPortrait && styles.columnPlayerPortrait]}
            onLayout={handleColumnPlayerLayout}
          >
            {(!playingChannel || isPlayerDismissed) ? (
              <View style={styles.idlePlayerSlot}>
                <View style={styles.idleIconCircle}>
                  <Image
                    source={require('../../assets/inside-app-logo.png')}
                    style={styles.idleLogo}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.idleTitle}>No Channel Selected</Text>
                <Text style={styles.idleSubtitle}>
                  Select any channel from the list to start watching
                </Text>
              </View>
            ) : (
              <View style={styles.anchorPlaceholder} pointerEvents="none" />
            )}
          </View>
        </View>
      </View>

      {/* Dim Scrim — Fades in over application during Transition / Expanded Mode */}
      {presentationState !== 'MINI' && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            styles.dimScrim,
            { opacity: scrimOpacity },
          ]}
        />
      )}

      {!isPlayerDismissed && isSectionActive && playingChannel && resolvedChannel ? (
        <Animated.View
          pointerEvents="box-none"
          style={playerContainerStyle}
        >
          <EmbeddedVideoPlayer
            key={`live-surface-${playerKey}`}
            url={resolvedChannel?.uri || playingChannel.url}
            source={resolvedChannel?.playerSource}
            resolvedSource={resolvedChannel}
            title={playingChannel.name}
            channel={playingChannel}
            streamId={String(resolvedChannel?.streamId || playingChannel.id || playingChannel.streamId || '')}
            extension={resolvedChannel?.extension || playingChannel.containerExtension || 'ts'}
            mode={liveControlsMode}
            player={livePlayer}
            onExpand={expandToFull}
            onMinimize={contractToMini}
            onClose={handleCloseLivePlayer}
            isFocused={isSectionActive}
            insets={insets}
            topAnim={topAnimRef.current}
            centerAnim={centerAnimRef.current}
            bottomAnim={bottomAnimRef.current}
            recreatePlayer={handleRecreatePlayer}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

// Category Row Component (Memoized)
const CategoryItem = React.memo(
  function CategoryItem({ category, count, isActive, isPortrait, adultPinEnabled, adultUnlocked, onPress }) {
    const handlePress = useCallback(() => {
      if (onPress) onPress(category.id);
    }, [onPress, category.id]);

    const isAdult = Boolean(category?.isAdult);
    const isLocked = isAdult && adultPinEnabled && !adultUnlocked;

    return (
      <TouchableOpacity
        style={[
          styles.categoryCard,
          isPortrait && styles.categoryCardPortrait,
          isActive && styles.categoryCardActive,
          isAdult && styles.categoryCardAdult,
        ]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <View style={styles.categoryTitleRow}>
          <Text style={styles.categoryTitle} numberOfLines={1} ellipsizeMode="tail">
            {category.name}
          </Text>
          {isAdult && (
            <View style={[styles.adultBadge, isLocked ? styles.adultBadgeLocked : styles.adultBadgeUnlocked]}>
              {isLocked ? (
                <>
                  <LockIcon size={9} color="#A1A1AA" />
                  <Text style={styles.adultBadgeTextLocked}>18+</Text>
                </>
              ) : (
                <>
                  <UnlockIcon size={9} color="#34D399" />
                  <Text style={styles.adultBadgeTextUnlocked}>18+</Text>
                </>
              )}
            </View>
          )}
        </View>
        <View style={styles.categoryCountRow}>
          <Text style={styles.categoryCount}>
            Total: {count}
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
      prev.count === next.count &&
      prev.isPortrait === next.isPortrait &&
      prev.adultPinEnabled === next.adultPinEnabled &&
      prev.adultUnlocked === next.adultUnlocked &&
      prev.onPress === next.onPress &&
      prev.category?.id === next.category?.id &&
      prev.category?.name === next.category?.name &&
      prev.category?.isAdult === next.category?.isAdult
    );
  }
);

// Channel Row Component (Memoized)
const ChannelItem = React.memo(
  function ChannelItem({
    channel,
    isActive,
    isFav,
    onPress,
    onToggleFav,
  }) {
    const handlePress = useCallback(() => {
      if (onPress) onPress(channel);
    }, [onPress, channel]);

    return (
      <TouchableOpacity
        style={[
          styles.channelCard,
          isActive && styles.channelCardActive,
        ]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <View style={styles.channelLogoBox}>
          <CachedImage
            uri={channel.logo}
            item={channel}
            contentId={channel.id || channel.stream_id || channel.streamId}
            style={styles.channelLogo}
            type="live"
            title={channel.name}
            borderRadius={6}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.channelName} numberOfLines={1} ellipsizeMode="tail">
          {channel.name}
        </Text>
        <TouchableOpacity
          style={styles.channelFavBtn}
          onPress={(e) => onToggleFav && onToggleFav(channel, e)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={`Favorite ${channel.name}`}
        >
          <HeartIcon
            size={16}
            color={isFav ? Colors.brand.primary : Colors.text.tertiary}
            filled={isFav}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  },
  (prev, next) => {
    return (
      prev.channel === next.channel &&
      prev.isActive === next.isActive &&
      prev.isFav === next.isFav &&
      prev.onPress === next.onPress &&
      prev.onToggleFav === next.onToggleFav
    );
  }
);

const styles = StyleSheet.create({
  // Root container with ZERO padding so absolute children (fullscreen player) occupy 100% of the screen
  screenRoot: {
    flex: 1,
    backgroundColor: Colors.background.primary,
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    height: '100%',
  },
  mainLayout: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 4,
    gap: 12,
  },
  headerLeft: {
    flexShrink: 0,
  },
  logo: {
    width: 115,
    height: 30,
  },
  searchWrapper: {
    flex: 1,
    maxWidth: 320,
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
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  contentSplit: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
    minHeight: 0,
  },
  contentSplitPortrait: {
    flexDirection: 'column',
    gap: 6,
    overflow: 'hidden',
  },
  columnCategories: {
    flex: 0.23,
    height: '100%',
  },
  columnCategoriesPortrait: {
    flex: 0,
    height: 44,
    marginBottom: 2,
  },
  categoriesListContent: {
    paddingRight: 2,
    paddingBottom: 8,
  },
  categoriesListContentHorizontal: {
    paddingRight: 8,
    alignItems: 'center',
  },
  categoryCard: {
    backgroundColor: Colors?.surface?.elevated || Colors.background.card,
    borderRadius: 8,
    borderWidth: 1.2,
    borderColor: Colors.border.default,
    paddingHorizontal: 10,
    height: 46,
    marginBottom: 6,
    justifyContent: 'center',
  },
  categoryCardPortrait: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    height: 38,
    marginBottom: 0,
    marginRight: 6,
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
  columnChannels: {
    flex: 0.27,
    height: '100%',
  },
  columnChannelsPortrait: {
    flex: 1,
    width: '100%',
    minHeight: 0,
  },
  searchHeaderBox: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  searchHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.brand.primary,
    letterSpacing: 0.5,
  },
  channelsListContent: {
    paddingRight: 2,
    paddingBottom: 8,
  },
  channelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors?.surface?.elevated || Colors.background.card,
    borderRadius: 8,
    borderWidth: 1.2,
    borderColor: Colors.border.default,
    paddingHorizontal: 6,
    height: 48,
    marginBottom: 6,
    gap: 8,
  },
  channelCardActive: {
    backgroundColor: Colors.background.cardActive,
    borderColor: Colors.brand.primary,
    borderWidth: 1.2,
  },
  channelFavBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  channelLogoBox: {
    width: 34,
    height: 34,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
  },
  channelLogo: {
    width: '100%',
    height: '100%',
    borderRadius: 6,
  },
  channelLogoFallback: {
    backgroundColor: Colors.background.cardActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLogoInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  channelName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyChannelsBox: {
    padding: 20,
    alignItems: 'center',
  },
  emptyChannelsText: {
    fontSize: 12,
    color: Colors.text.tertiary,
  },
  columnPlayer: {
    flex: 0.50,
    height: '100%',
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
  },
  columnPlayerPortrait: {
    width: '100%',
    height: 186,
    flexShrink: 0,
    position: 'relative',
    borderRadius: 14,
    overflow: 'hidden',
    // No marginTop — gap on contentSplitPortrait handles spacing
  },
  idlePlayerSlot: {
    flex: 1,
    backgroundColor: Colors.background.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    overflow: 'hidden',
  },
  idleIconCircle: {
    width: 80,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    opacity: 0.85,
  },
  idleLogo: {
    width: 80,
    height: 32,
  },
  idleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  idleSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.text.tertiary,
    textAlign: 'center',
    maxWidth: 240,
    lineHeight: 16,
  },
  anchorPlaceholder: {
    flex: 1,
    backgroundColor: Colors.background.primary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  dimScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    zIndex: 50,
  },
  // Fullscreen container: explicitly covers 100% of the screen with ZERO leftover mini constraints
  fullscreenPlayerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    borderRadius: 0,
    margin: 0,
    padding: 0,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: '#000000',
    overflow: 'hidden',
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
    fontSize: 8,
    fontWeight: '700',
  },
  adultBadgeTextUnlocked: {
    color: '#34D399',
    fontSize: 8,
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
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
  },
  unlockedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  unlockedBannerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D4D4D8',
  },
  lockAdultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#27272A',
    borderColor: '#3F3F46',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  lockAdultBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
});
