import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  AppState,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import Colors from '../constants/colors';
import { API_BASE_URL } from '../constants/index.js';
import BrokenVideoView from '../components/BrokenVideoView';
import PlayerErrorToast from '../components/PlayerErrorToast';
import GlobalToast from '../components/GlobalToast';
import PlayerControls from '../components/PlayerControls';
import BufferingIndicator from '../components/BufferingIndicator';
import PlayerGestureOverlay from '../components/PlayerGestureOverlay';
import usePlayerBrightness from '../hooks/usePlayerBrightness';
import usePlayerVolume from '../hooks/usePlayerVolume';
import {
  mapStreamError,
  classifyPlayerError,
  getErrorDisplayDetails,
  evaluatePlayerErrorPopupPolicy,
  isConfirmedServerError,
  isFatalNativePlayerError,
  logClassifiedPlayerError,
  ERROR_POPUP_CATEGORY,
} from '../utils/playerErrorMapper';
import {
  validateStreamSource,
  detectContentType,
  normalizePlaybackSource,
  DEFAULT_IPTV_USER_AGENT,
} from '../utils/mediaSourcePipeline.js';
import {
  getPlatformPlayerOptions,
  getPlatformBufferOptions,
  getPlatformVideoViewProps,
  getPlatformVlcOptions,
  prepareStreamUrlForPlatform,
  getStreamFallbackUrl,
  logPlayerDiagnostic,
} from '../utils/playerConfig.js';
import {
  collectPlaybackMediaTracks,
  normalizeAudioTrackList,
  normalizeSubtitleTrackList,
} from '../utils/mediaTracks.js';
import { PlaybackController } from '../playback/PlaybackController.js';
import { getPlatformPlayer } from '../playback/PlatformPlayer.js';
import { PLAYBACK_STATE, ENGINE_TYPE, ENGINE_MODE, ENGINE_SWITCH_REASON, ENGINE_LABELS } from '../playback/playbackTypes.js';
import { DualPlaybackCoordinator } from '../playback/engines/DualPlaybackCoordinator.js';
import UnifiedVideoSurface from '../playback/components/UnifiedVideoSurface.js';
import PlaybackEngineModal from '../components/PlaybackEngineModal.js';
import { readCache, writeCache } from '../storage/cacheStorage.js';
import {
  getPlayerSettings,
  savePlayerSettings,
  subscribePlayerSettings,
  probeVlcNativeAvailability,
  validateEngineSelection,
} from '../playback/playerSettings.js';
import { safeBack, getRouteParam } from '../utils/navigation';
import { setSeriesReturnHighlight } from '../utils/seriesReturnHighlight.js';
import { addRecentlyWatched, updateRecentlyWatchedProgress } from '../storage/userStorage';
import { measureAndLogLayout } from '../utils/layoutDiagnostics';
import {
  applySubtitleFontSizeForPlayback,
  applyNativeSubtitleFontSize,
  reapplyNativeSubtitleSizeWithRetries,
} from '../utils/subtitleAppearance.js';
import SeriesNextEpisodeOverlay from '../components/SeriesNextEpisodeOverlay.js';
import {
  loadSeriesDetailForPlayback,
  findNextEpisodeEntry,
  formatNextEpisodeLabel,
  resolveNextEpisodePlayback,
  extractEpisodeStreamIdFromUrl,
} from '../utils/seriesEpisodeNav.js';

let vlcModule = null;
try {
  const vlcProbe = probeVlcNativeAvailability();
  if (vlcProbe.available) {
    vlcModule = require('rn-vlc-plyr');
  }
} catch (_e) {
  vlcModule = null;
}

const SPEEDS    = [1.0, 1.25, 1.5, 2.0];
const FIT_MODES = ['contain', 'cover', 'fill'];
const UP_NEXT_PREVIEW_BEFORE_END_SEC = 10;
/** Leave preview zone (rewind) — clears "Not now" snooze and hides card */
const UP_NEXT_LEAVE_PREVIEW_SEC = 10.75;

export default function PlayerScreen() {
  const searchParams = useLocalSearchParams();
  const url = getRouteParam(searchParams.url);
  const title = getRouteParam(searchParams.title);
  const type = getRouteParam(searchParams.type);
  const streamId = getRouteParam(searchParams.streamId);
  const extension = getRouteParam(searchParams.extension);
  const poster = getRouteParam(searchParams.poster);
  const selectedAt = getRouteParam(searchParams.selectedAt);
  const resumeSeconds = getRouteParam(searchParams.resumeSeconds);
  const recentEntryId = getRouteParam(searchParams.recentEntryId);
  const backTarget = getRouteParam(searchParams.backTarget);
  const backSeriesId = getRouteParam(searchParams.seriesId);
  const episodeStreamId = getRouteParam(searchParams.episodeStreamId);
  const backCategoryId = getRouteParam(searchParams.categoryId);
  const returnTo = getRouteParam(searchParams.returnTo);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { playbackSessionId, playlistConfig, showPlaylistExpiredDialog, activePlaylistId, activePlaylist, isExpired } = useApp();

  const isLive = type === 'live' || type === 'channel';
  const isSeriesPlayback = Boolean(
    !isLive && (type === 'series' || (backTarget === 'series' && backSeriesId)),
  );
  const pendingResumeSecondsRef = useRef(
    !isLive && resumeSeconds ? Math.max(0, parseFloat(String(resumeSeconds)) || 0) : 0,
  );
  const recentProgressIdRef = useRef(
    recentEntryId ? String(recentEntryId) : (streamId ? String(streamId) : null),
  );
  const resumeAppliedRef = useRef(false);

  const viewportRef = useRef(null);
  const videoSurfaceRef = useRef(null);
  const unifiedOverlayRef = useRef(null);
  const controlsContainerRef = useRef(null);

  // Dual Playback Engine state - respect stored user settings immediately on mount
  const isMkvStream = Boolean(
    extension === 'mkv' ||
    (/\.mkv(\?.*)?$/i.test(url || ''))
  );
  const isTsStream = Boolean(
    extension === 'ts' ||
    (/\.ts(\?.*)?$/i.test(url || '')) ||
    (url || '').includes('output=ts') ||
    isLive
  );
  const initialSettings = getPlayerSettings();
  const initialEnginePref = initialSettings.preferredEngine || ENGINE_MODE.AUTO;
  const initialVlcAvailable = Boolean(probeVlcNativeAvailability().available);
  const [engineMode, setEngineMode]                 = useState(initialEnginePref);
  const [activeEngineType, setActiveEngineType]     = useState(() => {
    if (initialEnginePref === ENGINE_MODE.VLC && initialVlcAvailable) {
      return ENGINE_TYPE.VLC;
    }
    if (initialEnginePref === ENGINE_MODE.NATIVE) {
      return ENGINE_TYPE.NATIVE;
    }
    // AUTO mode:
    // 1. Both iOS and Android require VLC for MKV container streams.
    // 2. On iOS, Apple AVPlayer cannot demux raw MPEG-TS (.ts) over plain HTTP.
    // When VLC is available in AUTO mode, route .ts streams directly to VLC on iOS just like HotPlayer!
    if (initialVlcAvailable && (isMkvStream || (Platform.OS === 'ios' && isLive && isTsStream))) {
      return ENGINE_TYPE.VLC;
    }
    return ENGINE_TYPE.NATIVE;
  });
  const [showEngineModal, setShowEngineModal]       = useState(false);
  const handleOpenEngineModal                       = useCallback(() => setShowEngineModal(true), []);
  const [isSwitchingEngine, setIsSwitchingEngine]   = useState(false);
  const vlcAttemptsRef                              = useRef(0);
  const nativeAttemptsRef                           = useRef(0);

  // State machine: 'LOADING' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ERROR'
  const [playerState, setPlayerState]               = useState('LOADING');
  const [isBufferingUI, setIsBufferingUI]           = useState(true);
  const [errorMessage, setErrorMessage]             = useState(null);
  const [errorDetails, setErrorDetails]             = useState(null);
  const [toastMessage, setToastMessage]             = useState(null);
  const [showToast, setShowToast]                   = useState(false);
  const [toastType, setToastType]                   = useState('error');
  const toastTypeRef                                = useRef('error');
  useEffect(() => {
    toastTypeRef.current = toastType;
  }, [toastType]);
  const switchWatchdogRef                           = useRef(null);
  const pendingVlcResumeTimeRef                     = useRef(null);
  const [controlsVisible, setControlsVisible]       = useState(true);
  const [contentFit, setContentFit]                 = useState('contain');
  const [currentTime, setCurrentTime]               = useState(0);
  const currentTimeRef                              = useRef(0);
  const lastRenderedTimeRef                         = useRef(0);
  const [duration, setDuration]                     = useState(0);
  const [playbackSpeedIndex, setPlaybackSpeedIndex] = useState(0);
  const [seekFeedback, setSeekFeedback]             = useState(null);
  const [hasFirstFrame, setHasFirstFrame]           = useState(false);
  const [gestureHud, setGestureHud]                 = useState(null);
  const [availableAudioTracks, setAvailableAudioTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack]     = useState(null);
  const [availableSubtitleTracks, setAvailableSubtitleTracks] = useState([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack]     = useState(null);
  const [subtitleSize, setSubtitleSize]                 = useState(() => {
    const { normalizeSubtitleSizeId } = require('../playback/playerSettings.js');
    return normalizeSubtitleSizeId(getPlayerSettings()?.subtitleSize);
  });
  const subtitleSizeRef                                 = useRef(subtitleSize);
  const userSelectedSubtitleRef                         = useRef(false);

  useEffect(() => {
    const unsub = subscribePlayerSettings?.((newSettings) => {
      if (newSettings?.subtitleSize) {
        setSubtitleSize(newSettings.subtitleSize);
        subtitleSizeRef.current = newSettings.subtitleSize;
        applySubtitleFontSizeForPlayback({
          newSize: newSettings.subtitleSize,
          activeEngineType: activeEngineTypeRef.current,
          vlcPlayer,
        });
      }
    });
    return () => unsub?.();
  }, [vlcPlayer]);

  // Stable mutable refs — only read inside event-handlers / effects, never during render
  const playbackIntentRef   = useRef('PLAYING'); // Tracks genuine user playback intent ('PLAYING' | 'PAUSED')
  const playerStateRef      = useRef(playerState);
  const isSeekingRef        = useRef(false);
  const pendingSeekTimeRef  = useRef(null);
  const seekTimeoutRef      = useRef(null);
  const seekCounterRef      = useRef(0);
  const seekTargetTimeRef   = useRef(null);
  const isSeekingSettlingRef = useRef(false);
  const seekTargetTimestampRef = useRef(0);
  const seekWatchdogRef     = useRef(null);
  const wasPlayingBeforeSeekRef = useRef(true);
  const completeSeekRef     = useRef(null);
  const durationRef         = useRef(0);
  const userPausedRef       = useRef(false);
  const hasEverPlayedRef    = useRef(false);
  const isSwitchingEngineRef = useRef(false);
  const activeEngineTypeRef = useRef(activeEngineType);
  const currentUrlRef        = useRef(null);
  const requestCounterRef    = useRef(0);
  const isReplacingSourceRef = useRef(false);
  const loadTimeoutRef       = useRef(null);
  const verifyPlaybackRef    = useRef(null);
  const attemptedFallbackUrlsRef = useRef(new Set());
  const fallbackAttemptedRef = useRef(false);
  const bufferTimerRef      = useRef(null);
  const bufferStartRef      = useRef(0);
  const controlsTimeout     = useRef(null);
  const controlsVisibleRef  = useRef(controlsVisible);
  const lastTapRef          = useRef({ time: 0, side: null });
  const lastErrorRef        = useRef(null);
  const lastToastedAttemptIdRef = useRef(null);
  const lastPlaybackTimeRef = useRef(-1);
  const lastAdvanceTimeRef  = useRef(0);
  const isTogglingPlayRef   = useRef(false);
  const isRetryingRef       = useRef(false);
  const hasEndedRef         = useRef(false);
  const seriesEndHandledRef = useRef(false);
  const vodEndTriggeredRef = useRef(false);
  const nextEpisodeLookupStartedRef = useRef(false);
  const upNextSnoozedRef = useRef(false);
  const nextEpisodeOfferVisibleRef = useRef(false);
  const upNextEpochRef = useRef(0);
  const upNextSeekOriginRef = useRef(null);
  const nextEpisodePayloadRef = useRef(null);
  const fetchNextEpisodeOfferRef = useRef(async () => {});
  const syncUpNextPlaybackRef = useRef(() => {});
  const checkNearEndForSeriesOfferRef = useRef(() => {});
  const syncUpNextAfterSeekRef = useRef(() => {});
  const [nextEpisodeOffer, setNextEpisodeOffer] = useState(null);
  const seekFeedbackAnimRef = useRef(new Animated.Value(0));
  const controlsOpacityRef  = useRef(new Animated.Value(1));
  const timingRef            = useRef({
    t0_tap: 0,
    t1_source: 0,
    t2_player: 0,
    t3_assigned: 0,
    t4_loading: 0,
    t5_ready: 0,
    t6_firstFrame: 0,
    t7_play: 0,
    t8_playing: 0,
    assigned: 0,
    ready: 0,
    firstPlay: 0,
  });

  useEffect(() => {
    playerStateRef.current = playerState;
  }, [playerState]);

  useEffect(() => {
    activeEngineTypeRef.current = activeEngineType;
  }, [activeEngineType]);

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  // Stable Animated.Value references — extracted here so JSX doesn't access .current during render
  // eslint-disable-next-line react-hooks/refs
  const seekFeedbackAnim = seekFeedbackAnimRef.current;
  // eslint-disable-next-line react-hooks/refs
  const controlsOpacity  = controlsOpacityRef.current;

  const seekFeedbackScale = useMemo(() => {
    return seekFeedbackAnim.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  }, [seekFeedbackAnim]);

  // Debounced buffering state manager — prevents rapid flicker on network pulses
  const setDebouncedBuffering = useCallback((buffering) => {
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }

    if (buffering) {
      // Small 120ms debounce when entering buffer to absorb micro-stalls
      bufferTimerRef.current = setTimeout(() => {
        bufferStartRef.current = Date.now();
        setIsBufferingUI(true);
      }, 120);
    } else {
      // Hold for at least 350ms before hiding so the animation doesn't flash
      const elapsed = Date.now() - bufferStartRef.current;
      const minDisplayMs = 350;
      const remaining = Math.max(0, minDisplayMs - elapsed);

      bufferTimerRef.current = setTimeout(() => {
        setIsBufferingUI(false);
      }, remaining);
    }
  }, []);

  // Confirm active playback and clear all buffering/loading indicators
  const confirmPlaybackActive = useCallback((opReqId = null) => {
    if (opReqId !== null && opReqId !== requestCounterRef.current) {
      return;
    }
    if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
      return;
    }

    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
    hasEverPlayedRef.current = true;
    setHasFirstFrame(true);
    playerStateRef.current = 'PLAYING';
    setPlayerState('PLAYING');
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    setIsBufferingUI(false);
    setDebouncedBuffering(false);
  }, [setDebouncedBuffering]);

  // Centralized playback source normalization
  const normalized = useMemo(() => {
    const creds = playlistConfig?.config || playlistConfig || {};
    return normalizePlaybackSource({
      type,
      item: {
        url,
        title,
        poster,
        streamId,
        containerExtension: extension,
      },
      credentials: creds,
    }, { platform: Platform.OS });
  }, [url, title, type, streamId, extension, poster, playlistConfig]);

  const sanitizedUrl = normalized.uri;
  const validation = useMemo(() => ({
    isValid: normalized.isValid,
    uri: normalized.uri,
    error: normalized.validationError,
  }), [normalized]);

  const handleSelectSubtitleSize = useCallback((newSize) => {
    const { normalizeSubtitleSizeId } = require('../playback/playerSettings.js');
    const size = normalizeSubtitleSizeId(newSize);
    if (!size) return;
    setSubtitleSize(size);
    subtitleSizeRef.current = size;
    savePlayerSettings({ subtitleSize: size }).catch(() => {});
    applySubtitleFontSizeForPlayback({
      newSize: size,
      activeEngineType: activeEngineTypeRef.current,
      vlcPlayer,
    });
  }, [vlcPlayer]);

  useEffect(() => {
    applyNativeSubtitleFontSize(subtitleSizeRef.current || subtitleSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply saved size once on mount
  }, []);
  const contentType = normalized.contentType;
  const playerSource = useMemo(() => {
    if (normalized?.playerSource) return normalized.playerSource;
    if (!validation.isValid || !validation.uri) return null;
    return {
      uri: validation.uri,
      ...(contentType && contentType !== 'auto' ? { contentType } : {}),
      headers: normalized?.headers || { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
      metadata: {
        title: title || 'Fox Player',
        ...(poster ? { artwork: poster } : {}),
      },
    };
  }, [normalized, validation, contentType, title, poster]);

  // Initialize expo-video player with stable null source to avoid render-cycle churn
  const player = useVideoPlayer(null, (p) => {
    const opts = getPlatformPlayerOptions({ type, isLive });
    p.loop = opts.loop;
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
  });

  // Lazily initialized VLC player instance — ONLY constructed if VLC engine is actually activated.
  // Prevents allocating 100MB+ C++ LibVLC memory and blocking the main thread on Native playback.
  const [vlcPlayer, setVlcPlayer] = useState(() => {
    if (activeEngineType !== ENGINE_TYPE.VLC) return null;
    try {
      const probe = probeVlcNativeAvailability();
      if (!probe.available) return null;
      let mod = vlcModule;
      if (!mod) {
        try {
          mod = require('rn-vlc-plyr');
        } catch (_e) {}
      }
      if (mod && typeof mod.createVlcPlayer === 'function') {
        return mod.createVlcPlayer();
      }
    } catch (err) {
      logPlayerDiagnostic('vlcPlayerInitError', { error: err?.message });
    }
    return null;
  });

  const getOrCreateVlcPlayer = useCallback(() => {
    if (vlcPlayer) return vlcPlayer;
    try {
      const probe = probeVlcNativeAvailability();
      if (!probe.available) return null;
      let mod = vlcModule;
      if (!mod) {
        try {
          mod = require('rn-vlc-plyr');
        } catch (_e) {}
      }
      if (mod && typeof mod.createVlcPlayer === 'function') {
        const instance = mod.createVlcPlayer();
        setVlcPlayer(instance);
        return instance;
      }
    } catch (err) {
      logPlayerDiagnostic('vlcPlayerInitError', { error: err?.message });
    }
    return null;
  }, [vlcPlayer]);

  useEffect(() => {
    return () => {
      if (vlcPlayer) {
        try {
          vlcPlayer.stop();
          if (typeof vlcPlayer.release === 'function') {
            vlcPlayer.release();
          }
        } catch (_e) {}
      }
    };
  }, [vlcPlayer]);

  const applyPendingResume = useCallback(() => {
    if (isLive || resumeAppliedRef.current) return;
    const target = pendingResumeSecondsRef.current;
    if (!target || target < 3) return;
    const dur = durationRef.current || 0;
    if (dur > 30 && target >= dur - 20) {
      resumeAppliedRef.current = true;
      return;
    }
    try {
      if (activeEngineTypeRef.current === ENGINE_TYPE.VLC && vlcPlayer) {
        const ms = Math.round(target * 1000);
        vlcPlayer.seek(ms);
        resumeAppliedRef.current = true;
        return;
      }
      if (player && typeof player.currentTime === 'number') {
        player.currentTime = target;
        currentTimeRef.current = target;
        setCurrentTime(target);
        resumeAppliedRef.current = true;
      }
    } catch (_e) {}
  }, [isLive, player, vlcPlayer]);

  const persistPlaybackProgress = useCallback(() => {
    if (isLive || !activePlaylistId || !recentProgressIdRef.current) return;
    const pos = currentTimeRef.current || 0;
    const dur = durationRef.current || duration || 0;
    if (pos < 3 || dur < 30) return;
    const isSeriesPlayback = type === 'series' || backTarget === 'series';
    updateRecentlyWatchedProgress(activePlaylistId, {
      id: recentProgressIdRef.current,
      type: isSeriesPlayback ? 'series' : 'movie',
      name: title || '',
      poster: poster || '',
      url: url || '',
      streamId: streamId ? String(streamId) : recentProgressIdRef.current,
      containerExtension: extension || 'mp4',
      positionSec: pos,
      durationSec: dur,
      ...(isSeriesPlayback && backSeriesId ? { seriesId: String(backSeriesId) } : {}),
      ...(isSeriesPlayback && backCategoryId ? { categoryId: String(backCategoryId) } : {}),
    }).catch(() => {});
  }, [
    isLive,
    activePlaylistId,
    type,
    title,
    poster,
    url,
    streamId,
    extension,
    duration,
    backTarget,
    backSeriesId,
    backCategoryId,
  ]);

  useEffect(() => {
    seriesEndHandledRef.current = false;
    vodEndTriggeredRef.current = false;
    nextEpisodeLookupStartedRef.current = false;
    upNextSnoozedRef.current = false;
    nextEpisodeOfferVisibleRef.current = false;
    upNextEpochRef.current += 1;
    setNextEpisodeOffer(null);
    nextEpisodePayloadRef.current = null;
  }, [url, episodeStreamId, streamId]);

  const playNextEpisodeNow = useCallback(() => {
    const payload = nextEpisodePayloadRef.current;
    if (!payload?.resolved) {
      setNextEpisodeOffer(null);
      return;
    }
    const { resolved } = payload;
    nextEpisodeOfferVisibleRef.current = false;
    setNextEpisodeOffer(null);
    seriesEndHandledRef.current = false;
    vodEndTriggeredRef.current = false;
    hasEndedRef.current = false;
    userPausedRef.current = false;
    playbackIntentRef.current = 'PLAYING';

    addRecentlyWatched(
      {
        id: resolved.episodeStreamId,
        type: 'series',
        seriesId: resolved.seriesId,
        categoryId: resolved.categoryId,
        name: resolved.title,
        poster: resolved.poster,
        url: resolved.url,
        streamId: resolved.streamId,
        containerExtension: resolved.extension || 'mp4',
        positionSec: 0,
      },
      activePlaylistId,
    ).catch(() => {});

    router.replace({
      pathname: '/player',
      params: {
        url: resolved.url,
        title: resolved.title,
        type: 'series',
        poster: resolved.poster || '',
        streamId: resolved.streamId,
        extension: resolved.extension || 'mp4',
        selectedAt: String(Date.now()),
        recentEntryId: resolved.episodeStreamId,
        backTarget: 'series',
        seriesId: resolved.seriesId,
        episodeStreamId: resolved.episodeStreamId,
        ...(resolved.categoryId != null && String(resolved.categoryId).trim() !== ''
          ? { categoryId: String(resolved.categoryId) }
          : {}),
        ...(returnTo ? { returnTo } : {}),
      },
    });
  }, [activePlaylistId, router, returnTo]);

  const dismissNextEpisodeOffer = useCallback(() => {
    upNextSnoozedRef.current = true;
    nextEpisodeOfferVisibleRef.current = false;
    setNextEpisodeOffer(null);
  }, []);

  const publishUpNextOffer = useCallback((episodeFinished) => {
    const offer = nextEpisodePayloadRef.current?.offer;
    if (!offer) return;
    nextEpisodeOfferVisibleRef.current = true;
    setNextEpisodeOffer((prev) => {
      if (
        prev &&
        prev.episodeFinished === Boolean(episodeFinished) &&
        prev.episodeLabel === offer.episodeLabel &&
        prev.seriesTitle === offer.seriesTitle
      ) {
        return prev;
      }
      return { ...offer, episodeFinished: Boolean(episodeFinished) };
    });
  }, []);

  const hideUpNextOfferUi = useCallback(() => {
    if (!nextEpisodeOfferVisibleRef.current) return;
    nextEpisodeOfferVisibleRef.current = false;
    setNextEpisodeOffer(null);
  }, []);

  const resumeAfterEndedRewind = useCallback(() => {
    if (!vodEndTriggeredRef.current && !hasEndedRef.current) return;
    vodEndTriggeredRef.current = false;
    hasEndedRef.current = false;
    userPausedRef.current = false;
    playbackIntentRef.current = 'PLAYING';
    wasPlayingBeforeSeekRef.current = true;
  }, []);

  const getUpNextRemainingSec = useCallback((currSec, durSec) => {
    const dur = durSec > 0 ? durSec : durationRef.current || 0;
    if (!dur) return null;
    const pos = Number.isFinite(currSec) ? currSec : currentTimeRef.current || 0;
    return Math.max(0, dur - pos);
  }, []);

  const fetchAndShowNextEpisodeOffer = useCallback(async (episodeFinished = false) => {
    if (!isSeriesPlayback) return;

    const remainingNow = getUpNextRemainingSec(currentTimeRef.current, durationRef.current);
    const inPreviewWindow = remainingNow != null && remainingNow <= UP_NEXT_PREVIEW_BEFORE_END_SEC;
    const shouldShow = Boolean(episodeFinished) || inPreviewWindow;

    if (nextEpisodePayloadRef.current?.offer) {
      if (!shouldShow || upNextSnoozedRef.current) return;
      if (episodeFinished) persistPlaybackProgress();
      publishUpNextOffer(episodeFinished);
      return;
    }

    if (nextEpisodeLookupStartedRef.current) return;
    nextEpisodeLookupStartedRef.current = true;
    const epoch = upNextEpochRef.current;

    const currentEpId =
      episodeStreamId ||
      streamId ||
      recentEntryId ||
      extractEpisodeStreamIdFromUrl(url);
    const seriesKey = backSeriesId;
    if (!seriesKey || !activePlaylistId) {
      nextEpisodeLookupStartedRef.current = false;
      return;
    }

    const loaded = await loadSeriesDetailForPlayback(activePlaylistId, seriesKey, {
      categoryId: backCategoryId,
    });
    if (epoch !== upNextEpochRef.current) {
      nextEpisodeLookupStartedRef.current = false;
      return;
    }
    if (!loaded?.seasons?.length) {
      nextEpisodeLookupStartedRef.current = false;
      return;
    }

    const nextEntry = findNextEpisodeEntry(
      { seasons: loaded.seasons },
      currentEpId,
      { playbackUrl: url },
    );
    if (!nextEntry) {
      nextEpisodeLookupStartedRef.current = false;
      return;
    }

    const cfg = playlistConfig?.config || playlistConfig?.configuration || playlistConfig || {};
    const resolved = resolveNextEpisodePlayback({
      entry: nextEntry,
      seriesMeta: loaded.seriesMeta,
      credentials: {
        serverUrl: cfg.server_url || cfg.serverUrl || '',
        username: cfg.username || '',
        password: cfg.password || '',
      },
    });
    if (!resolved?.url) {
      nextEpisodeLookupStartedRef.current = false;
      return;
    }

    if (epoch !== upNextEpochRef.current) {
      nextEpisodeLookupStartedRef.current = false;
      return;
    }

    const offer = {
      seriesTitle: loaded.seriesMeta?.name || loaded.seriesMeta?.title || '',
      episodeLabel: formatNextEpisodeLabel(nextEntry),
      posterUri:
        nextEntry.episode.thumbnail ||
        nextEntry.episode.poster ||
        resolved.poster ||
        poster,
      posterItem: nextEntry.episode,
      serverUrl: loaded.seriesMeta?.serverUrl || cfg.server_url || cfg.serverUrl || '',
    };
    nextEpisodePayloadRef.current = { resolved, nextEntry, seriesMeta: loaded.seriesMeta, offer };

    const remainingAfter = getUpNextRemainingSec(currentTimeRef.current, durationRef.current);
    const stillShow = Boolean(episodeFinished) || (
      remainingAfter != null && remainingAfter <= UP_NEXT_PREVIEW_BEFORE_END_SEC
    );
    if (!stillShow || upNextSnoozedRef.current) return;
    if (episodeFinished) persistPlaybackProgress();
    publishUpNextOffer(episodeFinished);
  }, [
    isSeriesPlayback,
    persistPlaybackProgress,
    publishUpNextOffer,
    getUpNextRemainingSec,
    episodeStreamId,
    streamId,
    recentEntryId,
    backSeriesId,
    backCategoryId,
    activePlaylistId,
    playlistConfig,
    poster,
    url,
  ]);

  const syncUpNextPlaybackPosition = useCallback((currSec, durSec, { episodeFinished = false } = {}) => {
    if (isLive || !isSeriesPlayback) return;
    const dur = durSec > 0 ? durSec : durationRef.current;
    if (!dur || dur < UP_NEXT_PREVIEW_BEFORE_END_SEC + 3) return;

    const remaining = getUpNextRemainingSec(currSec, dur);
    if (remaining == null) return;

    if (remaining > UP_NEXT_LEAVE_PREVIEW_SEC) {
      upNextSnoozedRef.current = false;
      hideUpNextOfferUi();
      return;
    }

    if (remaining > UP_NEXT_PREVIEW_BEFORE_END_SEC) {
      hideUpNextOfferUi();
      if (remaining <= UP_NEXT_PREVIEW_BEFORE_END_SEC + 2) {
        fetchNextEpisodeOfferRef.current?.(false);
      }
      return;
    }

    const finished = Boolean(episodeFinished)
      || vodEndTriggeredRef.current
      || hasEndedRef.current
      || remaining <= 1.0;

    if (upNextSnoozedRef.current) return;

    fetchNextEpisodeOfferRef.current?.(finished);
  }, [isLive, isSeriesPlayback, getUpNextRemainingSec, hideUpNextOfferUi]);

  const handleVodPlaybackEnded = useCallback(() => {
    if (isLive || !isSeriesPlayback) return;
    if (vodEndTriggeredRef.current) return;
    vodEndTriggeredRef.current = true;
    logPlayerDiagnostic('vodPlaybackEnded', { type, engine: activeEngineTypeRef.current });
    hasEndedRef.current = true;
    playbackIntentRef.current = 'PAUSED';
    userPausedRef.current = true;
    playerStateRef.current = 'PAUSED';
    setPlayerState('PAUSED');
    if (durationRef.current > 0) {
      setCurrentTime(durationRef.current);
    }
    if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
    setIsBufferingUI(false);
    syncUpNextPlaybackPosition(
      durationRef.current,
      durationRef.current,
      { episodeFinished: true },
    );
  }, [isLive, isSeriesPlayback, type, syncUpNextPlaybackPosition]);

  const checkNearEndForSeriesOffer = useCallback((currSec, durSec) => {
    if (isSeekingRef.current || isSeekingSettlingRef.current) return;
    if (!hasEverPlayedRef.current) return;
    syncUpNextPlaybackPosition(currSec, durSec);
  }, [syncUpNextPlaybackPosition]);

  const syncUpNextAfterSeek = useCallback((targetSec) => {
    if (!isSeriesPlayback) return;
    const endedByPlayback = vodEndTriggeredRef.current || hasEndedRef.current;
    syncUpNextPlaybackPosition(targetSec, durationRef.current);
    if (endedByPlayback && getUpNextRemainingSec(targetSec, durationRef.current) > 1.5) {
      resumeAfterEndedRewind();
    }
  }, [isSeriesPlayback, syncUpNextPlaybackPosition, getUpNextRemainingSec, resumeAfterEndedRewind]);

  useEffect(() => {
    fetchNextEpisodeOfferRef.current = fetchAndShowNextEpisodeOffer;
  }, [fetchAndShowNextEpisodeOffer]);

  useEffect(() => {
    syncUpNextPlaybackRef.current = syncUpNextPlaybackPosition;
  }, [syncUpNextPlaybackPosition]);

  useEffect(() => {
    checkNearEndForSeriesOfferRef.current = checkNearEndForSeriesOffer;
  }, [checkNearEndForSeriesOffer]);

  useEffect(() => {
    syncUpNextAfterSeekRef.current = syncUpNextAfterSeek;
  }, [syncUpNextAfterSeek]);

  useEffect(() => {
    if (isLive) return undefined;
    const timer = setInterval(() => {
      if (hasEverPlayedRef.current) {
        persistPlaybackProgress();
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      persistPlaybackProgress();
    };
  }, [isLive, persistPlaybackProgress]);

  useEffect(() => {
    if (isLive || !activePlaylistId || !recentProgressIdRef.current) return;
    const isSeriesPlayback = type === 'series' || backTarget === 'series';
    addRecentlyWatched(
      {
        id: recentProgressIdRef.current,
        type: isSeriesPlayback ? 'series' : 'movie',
        name: title || '',
        poster: poster || '',
        url: url || '',
        streamId: streamId ? String(streamId) : recentProgressIdRef.current,
        containerExtension: extension || 'mp4',
        positionSec: pendingResumeSecondsRef.current || 0,
        ...(isSeriesPlayback && backSeriesId ? { seriesId: String(backSeriesId) } : {}),
        ...(isSeriesPlayback && backCategoryId ? { categoryId: String(backCategoryId) } : {}),
      },
      activePlaylistId,
    ).catch(() => {});
  }, [
    isLive,
    activePlaylistId,
    type,
    title,
    poster,
    url,
    streamId,
    extension,
    backTarget,
    backSeriesId,
    backCategoryId,
  ]);

  // Seamless Dual Engine Switcher
  const switchEngine = useCallback(async (targetEngineType, reason = ENGINE_SWITCH_REASON.MANUAL_SWITCH) => {
    if (activeEngineType === targetEngineType && playerStateRef.current === 'PLAYING') return;

    if (switchWatchdogRef.current) {
      clearTimeout(switchWatchdogRef.current);
      switchWatchdogRef.current = null;
    }

    isSwitchingEngineRef.current = true;
    setIsSwitchingEngine(true);
    // Keep hasFirstFrame intact during engine switch so outgoing frame stays visible without black flash
    playerStateRef.current = 'LOADING';
    setPlayerState('LOADING');
    setIsBufferingUI(true);
    setDebouncedBuffering(true);

    const fromEngine = activeEngineType;
    logPlayerDiagnostic('engineSwitch', { from: fromEngine, to: targetEngineType, reason });

    // Capture accurate ground-truth resume timestamp before pausing outgoing engine
    let resumeTime = currentTimeRef.current || 0;
    if (fromEngine === ENGINE_TYPE.NATIVE && player) {
      try {
        if (typeof player.currentTime === 'number' && player.currentTime > 0) {
          resumeTime = player.currentTime;
        }
        player.pause();
        player.muted = true;
      } catch (_e) {}
    } else if (fromEngine === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        // Pause and mute instead of stop/source-clear to keep last frame in texture buffer
        vlcPlayer.pause();
        vlcPlayer.muted = true;
      } catch (_e) {}
    }

    try {
      setActiveEngineType(targetEngineType);
      activeEngineTypeRef.current = targetEngineType;

      const streamUri = (targetEngineType === ENGINE_TYPE.VLC ? (url || validation.uri || sanitizedUrl) : (validation.uri || sanitizedUrl || url));

      if (targetEngineType === ENGINE_TYPE.VLC) {
        const vlcProbe = probeVlcNativeAvailability();
        const activeVlc = vlcPlayer || getOrCreateVlcPlayer();
        if (!vlcProbe.available || !activeVlc) {
          logPlayerDiagnostic('engineSwitchBlockedVlcUnavailable', { reason: vlcProbe.reason });
          setToastType('error');
          setToastMessage('VLC engine is unavailable in this build');
          setShowToast(true);
          setTimeout(() => setShowToast(false), 2400);
          setActiveEngineType(ENGINE_TYPE.NATIVE);
          activeEngineTypeRef.current = ENGINE_TYPE.NATIVE;
          setIsSwitchingEngine(false);
          isSwitchingEngineRef.current = false;
          return;
        }

        vlcAttemptsRef.current++;
        if (activeVlc && streamUri) {
          try {
            if (resumeTime > 0 && !isLive) {
              pendingVlcResumeTimeRef.current = resumeTime;
            } else {
              pendingVlcResumeTimeRef.current = null;
            }
            activeVlc.muted = false;
            activeVlc.volume = Math.round((volumeRef.current || 1.0) * 100);
            activeVlc.autoPlay = true;
            activeVlc.source = {
              uri: streamUri,
              userAgent: DEFAULT_IPTV_USER_AGENT,
              vlcOptions: getPlatformVlcOptions({ isLive, subtitleSize: subtitleSizeRef.current || subtitleSize }),
              title: title || 'Live Stream',
            };
            try { activeVlc.play(); } catch (_e) {}

            setToastType('switch');
            setToastMessage('Switched to VLC Player Engine');
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2400);
          } catch (_vlcErr) {
            logPlayerDiagnostic('vlcStartError', { error: _vlcErr.message });
          }
        }
      } else {
        nativeAttemptsRef.current++;
        if (player && playerSource) {
          try {
            player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
            player.volume = volumeRef.current || 1.0;
            if (typeof player.replaceAsync === 'function') {
              const switchTargetSource = playerSource;
              player.replaceAsync(switchTargetSource).then(() => {
                player.play();
                if (resumeTime > 0 && !isLive) {
                  try { player.currentTime = resumeTime; } catch (_e) {}
                }
              }).catch(() => {});
            } else {
              player.replace(playerSource);
              player.play();
              if (resumeTime > 0 && !isLive) {
                try { player.currentTime = resumeTime; } catch (_e) {}
              }
            }
            setToastType('switch');
            setToastMessage('Switched to Native Player Engine');
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2400);
          } catch (_natErr) {}
        }
      }
    } catch (_switchErr) {
      logPlayerDiagnostic('engineSwitchError', { error: _switchErr?.message });
    } finally {
      // Safety watchdog: clear switching lock after 8s if incoming engine stalls
      switchWatchdogRef.current = setTimeout(() => {
        isSwitchingEngineRef.current = false;
        setIsSwitchingEngine(false);
        if (activeEngineTypeRef.current === ENGINE_TYPE.NATIVE && vlcPlayer) {
          try { vlcPlayer.stop(); } catch (_e) {}
        }
      }, 8000);
    }
  }, [activeEngineType, player, vlcPlayer, getOrCreateVlcPlayer, validation.uri, sanitizedUrl, url, playerSource, title, isLive, setDebouncedBuffering]);

  // Synchronize stream source to VLC engine whenever activeEngineType is VLC and vlcPlayer is ready
  useEffect(() => {
    if (activeEngineType !== ENGINE_TYPE.VLC || !vlcPlayer) return;
    const streamUri = validation.uri || sanitizedUrl || url;
    if (!streamUri) return;

    if (!vlcPlayer.source || vlcPlayer.source?.uri !== streamUri) {
      try {
        logPlayerDiagnostic('vlcSourceSync', { uri: streamUri });
        playerStateRef.current = 'LOADING';
        setPlayerState('LOADING');
        setIsBufferingUI(true);
        setDebouncedBuffering(true);
        if (!isSwitchingEngineRef.current) {
          setHasFirstFrame(false);
        }
        vlcPlayer.muted = false;
        vlcPlayer.volume = Math.round((volumeRef.current || 1.0) * 100);
        vlcPlayer.autoPlay = true;
        vlcPlayer.source = {
          uri: streamUri,
          userAgent: DEFAULT_IPTV_USER_AGENT,
          vlcOptions: getPlatformVlcOptions({ isLive, subtitleSize: subtitleSizeRef.current || subtitleSize }),
          title: title || 'Live Stream',
        };
        try { vlcPlayer.play(); } catch (_e) {}
        // Pause and mute native player while VLC is active to prevent hardware codec collisions
        try {
          if (player) {
            player.pause();
            player.muted = true;
          }
        } catch (_e) {}
      } catch (_vlcErr) {
        logPlayerDiagnostic('vlcSourceSyncError', { error: _vlcErr?.message });
      }
    }
  }, [vlcPlayer, activeEngineType, validation.uri, sanitizedUrl, url, isLive, title, player, setDebouncedBuffering]);

  // Bind VLC player lifecycle event listeners
  useEffect(() => {
    if (!vlcPlayer) return;
    const subs = [];
    try {
      if (typeof vlcPlayer.addOnStatusChangeListener === 'function') {
        const sub = vlcPlayer.addOnStatusChangeListener((status) => {
          if (activeEngineType !== ENGINE_TYPE.VLC) return;
          logPlayerDiagnostic('vlcStatusChange', { status });
          if (status === 'playing') {
            if (isSwitchingEngineRef.current) {
              isSwitchingEngineRef.current = false;
              setIsSwitchingEngine(false);
              if (switchWatchdogRef.current) {
                clearTimeout(switchWatchdogRef.current);
                switchWatchdogRef.current = null;
              }
              if (player) {
                try { player.pause(); } catch (_e) {}
              }
              if (pendingVlcResumeTimeRef.current > 0 && !isLive) {
                const targetMs = Math.round(pendingVlcResumeTimeRef.current * 1000);
                pendingVlcResumeTimeRef.current = null;
                setTimeout(() => {
                  try { vlcPlayer.seek(targetMs); } catch (_e) {}
                }, 100);
              }
            }
            hasEverPlayedRef.current = true;
            setHasFirstFrame(true);
            playerStateRef.current = 'PLAYING';
            setPlayerState('PLAYING');
            if (bufferTimerRef.current) {
              clearTimeout(bufferTimerRef.current);
              bufferTimerRef.current = null;
            }
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
            setErrorMessage(null);
            if (toastTypeRef.current === 'error') {
              setShowToast(false);
              setToastMessage(null);
            }
            confirmPlaybackActive(requestCounterRef.current);
          } else if (status === 'buffering' || status === 'opening') {
            if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
            const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
            playerStateRef.current = nextState;
            setPlayerState(nextState);
            setIsBufferingUI(true);
            setDebouncedBuffering(true);
          } else if (status === 'paused') {
            if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
            playerStateRef.current = 'PAUSED';
            setPlayerState('PAUSED');
            setIsBufferingUI(false);
          } else if (status === 'stopped' || status === 'ended') {
            if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
            const dur = durationRef.current;
            const pos = currentTimeRef.current;
            const reachedEnd =
              status === 'ended' ||
              (dur > 15 && pos >= Math.max(0, dur - 3));
            if (reachedEnd && !isLive) {
              handleVodPlaybackEnded();
            }
            if (!userPausedRef.current && playerStateRef.current === 'PLAYING') {
              playerStateRef.current = 'PAUSED';
              setPlayerState('PAUSED');
            }
          } else if (status === 'error') {
            if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
            logPlayerDiagnostic('vlcErrorReceived', { status });
            if (engineMode === ENGINE_MODE.AUTO && nativeAttemptsRef.current < 1) {
              switchEngine(ENGINE_TYPE.NATIVE, ENGINE_SWITCH_REASON.AUTO_FALLBACK);
            } else {
              playerStateRef.current = 'ERROR';
              setPlayerState('ERROR');
              setErrorDetails({
                heading: 'Playback Error',
                message: 'The video stream could not be decoded by VLC.',
                canRetry: true,
              });
              setErrorMessage('VLC playback failed');
              setIsBufferingUI(false);
            }
          }
        });
        if (sub?.remove) subs.push(() => sub.remove());
      }

      if (typeof vlcPlayer.addOnLoadedListener === 'function') {
        const sub = vlcPlayer.addOnLoadedListener((loadedInfo) => {
          if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
          const durSec = (loadedInfo.duration || 0) / 1000;
          if (durSec > 1.0) {
            setDuration(durSec);
            durationRef.current = durSec;
            applyPendingResume();
          }
          if (loadedInfo.audioTracks?.length) {
            const aud = normalizeAudioTrackList(loadedInfo.audioTracks);
            setAvailableAudioTracks(aud);
            setSelectedAudioTrack((prev) => prev || aud.find((t) => t.isDefault || t.default) || aud[0]);
          }
          if (loadedInfo.subtitleTracks?.length) {
            setAvailableSubtitleTracks(normalizeSubtitleTrackList(loadedInfo.subtitleTracks));
          }
          if (!userSelectedSubtitleRef.current) {
            try {
              if (typeof vlcPlayer.setSubtitleTrack === 'function') {
                vlcPlayer.setSubtitleTrack(-1);
              } else if (typeof vlcPlayer.selectSubtitleTrack === 'function') {
                vlcPlayer.selectSubtitleTrack(-1);
              }
            } catch (_e) {}
            setSelectedSubtitleTrack(null);
          }
          confirmPlaybackActive(requestCounterRef.current);
        });
        if (sub?.remove) subs.push(() => sub.remove());
      }

      if (typeof vlcPlayer.addOnTimeUpdateListener === 'function') {
        const sub = vlcPlayer.addOnTimeUpdateListener((event) => {
          if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
          const currSec = (event.currentTime || 0) / 1000;
          const durSec = (event.duration || 0) / 1000;
          if (currSec > 0 && !hasEverPlayedRef.current) {
            confirmPlaybackActive(requestCounterRef.current);
          }
          if (isSeekingSettlingRef.current && seekTargetTimeRef.current !== null) {
            const target = seekTargetTimeRef.current;
            const elapsed = Date.now() - (seekTargetTimestampRef.current || 0);
            const hasReachedTarget = Math.abs(currSec - target) <= 2.5;
            if (hasReachedTarget) {
              if (completeSeekRef.current) {
                completeSeekRef.current(seekCounterRef.current, currSec);
              }
            } else if (elapsed < 1400) {
              // Ignore stale pre-seek reports from VLC decoder while it is catching up
              return;
            } else {
              if (completeSeekRef.current) {
                completeSeekRef.current(seekCounterRef.current, currSec);
              }
            }
          }
          currentTimeRef.current = currSec;
          if (!isLive && (controlsVisibleRef.current || isSeekingSettlingRef.current)) {
            if (Math.abs(currSec - (lastRenderedTimeRef.current || 0)) >= 0.25 || isSeekingSettlingRef.current) {
              lastRenderedTimeRef.current = currSec;
              setCurrentTime(currSec);
            }
          }
          if (durSec > 1.0 && Math.abs(durSec - durationRef.current) > 1.0) {
            durationRef.current = durSec;
            setDuration(durSec);
          }
          checkNearEndForSeriesOfferRef.current?.(currSec, durSec);
          if (currSec > 0 && !hasFirstFrame) {
            setHasFirstFrame(true);
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          }
        });
        if (sub?.remove) subs.push(() => sub.remove());
      }

      if (typeof vlcPlayer.addOnTracksChangeListener === 'function') {
        const sub = vlcPlayer.addOnTracksChangeListener((tracks) => {
          if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
          if (tracks?.audioTracks?.length) {
            const aud = normalizeAudioTrackList(tracks.audioTracks);
            setAvailableAudioTracks(aud);
            const activeSel = tracks.selectedAudioTrack != null
              ? (aud.find((t) => String(t.id) === String(tracks.selectedAudioTrack)) || tracks.selectedAudioTrack)
              : (aud.find((t) => t.isDefault || t.default) || aud[0]);
            setSelectedAudioTrack(activeSel);
          }
          if (tracks?.subtitleTracks) {
            setAvailableSubtitleTracks(normalizeSubtitleTrackList(tracks.subtitleTracks));
          }
          if (userSelectedSubtitleRef.current && tracks?.selectedSubtitleTrack) {
            setSelectedSubtitleTrack(tracks.selectedSubtitleTrack);
          }
        });
        if (sub?.remove) subs.push(() => sub.remove());
      }

      if (typeof vlcPlayer.addOnErrorListener === 'function') {
        const sub = vlcPlayer.addOnErrorListener((err) => {
          if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
          logPlayerDiagnostic('vlcPlaybackError', { playbackEngine: 'vlc', error: err });
          if (engineMode === ENGINE_MODE.AUTO && nativeAttemptsRef.current < 1) {
            switchEngine(ENGINE_TYPE.NATIVE, ENGINE_SWITCH_REASON.AUTO_FALLBACK);
          } else {
            triggerErrorState(new Error(err?.message || 'VLC engine playback failed.'));
          }
        });
        if (sub?.remove) subs.push(() => sub.remove());
      }
    } catch (_e) {}

    return () => {
      subs.forEach((unsub) => {
        try { unsub(); } catch (_e) {}
      });
    };
  }, [vlcPlayer, activeEngineType, engineMode, isLive, switchEngine, setDebouncedBuffering, confirmPlaybackActive, applyPendingResume, hasFirstFrame, triggerErrorState, handleVodPlaybackEnded]);

  // Load and subscribe to persisted engine preference
  useEffect(() => {
    const unsub = subscribePlayerSettings((settings) => {
      if (settings?.preferredEngine) {
        setEngineMode(settings.preferredEngine);
        const probe = probeVlcNativeAvailability();
        let target = activeEngineType;
        if (settings.preferredEngine === ENGINE_MODE.VLC && probe.available) {
          target = ENGINE_TYPE.VLC;
        } else if (settings.preferredEngine === ENGINE_MODE.NATIVE) {
          target = ENGINE_TYPE.NATIVE;
        } else if (settings.preferredEngine === ENGINE_MODE.AUTO) {
          target = (probe.available && isMkvStream) ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
        }
        if (target !== activeEngineType) {
          switchEngine(target, ENGINE_SWITCH_REASON.SETTINGS_SYNC);
        }
      }
    });
    return unsub;
  }, [switchEngine, activeEngineType, isMkvStream]);

  // Screen brightness management with lifecycle restoration
  const { brightness, setBrightness } = usePlayerBrightness();

  const volumeRef = useRef(1.0);
  const isMutedRef = useRef(false);
  const hardwareHudTimerRef = useRef(null);

  const handleVolumeChange = useCallback((newVol, info) => {
    if (info?.source === 'hardware') {
      setGestureHud({
        type: 'volume',
        value: newVol,
        visible: true,
      });
      if (hardwareHudTimerRef.current) {
        clearTimeout(hardwareHudTimerRef.current);
      }
      hardwareHudTimerRef.current = setTimeout(() => {
        setGestureHud(null);
      }, 1200);
    }
  }, []);

  // Media volume management synchronized with player
  const {
    volume,
    setVolume,
    isMuted,
    toggleMute: toggleVolumeMute,
    notifyGestureStart,
    notifyGestureEnd,
  } = usePlayerVolume({
    player,
    onVolumeChange: handleVolumeChange,
  });

  volumeRef.current = volume;
  isMutedRef.current = isMuted;

  // Platform Playback Controller instance
  const platformDriver = useMemo(() => getPlatformPlayer(Platform.OS), []);
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = new PlaybackController({
      platform: Platform.OS,
      driver: platformDriver,
    });
  }
  const controller = controllerRef.current;

  // Attach player to PlaybackController and configure platform buffer options
  useEffect(() => {
    if (player) {
      try {
        controller.attachPlayer(player, { type, isLive });
        const opts = getPlatformPlayerOptions({ type, isLive });
        player.staysActiveInBackground = false;
        const currentVol = volumeRef.current;
        if (typeof currentVol === 'number' && !isNaN(currentVol)) {
          player.volume = currentVol;
          player.muted = Boolean(isMutedRef.current || currentVol === 0);
        } else {
          player.muted = false;
          player.volume = 1.0;
        }
        if (opts.bufferOptions) {
          player.bufferOptions = opts.bufferOptions;
        }
      } catch (_e) {}
    }
  }, [player, controller, type, isLive]);

  // Synchronize duration immediately as soon as player metadata is available
  useEffect(() => {
    if (!isLive && player?.duration && isFinite(player.duration) && !isNaN(player.duration) && player.duration > 0) {
      setDuration(player.duration);
    }
  }, [isLive, player, player?.duration]);

  // Teardown when leaving screen
  useEffect(() => {
    return () => {
      if (player) {
        try {
          player.pause();
          player.muted = true;
          if (typeof player.replaceAsync === 'function') {
            player.replaceAsync(null);
          } else if (typeof player.replace === 'function') {
            player.replace(null);
          }
        } catch (_e) {}
      }
    };
  }, [player]);

  // Teardown and exit immediately if active playlist switches during playback
  const initialSessionRef = useRef(playbackSessionId);
  useEffect(() => {
    if (initialSessionRef.current && initialSessionRef.current !== playbackSessionId) {
      try {
        player?.pause?.();
        player.muted = true;
      } catch (_e) {}
      safeBack(router);
    }
  }, [playbackSessionId, player, router]);

  // Handle AppState changes: immediately pause when minimized/backgrounded, and resume when foregrounded if active
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        if (
          playbackIntentRef.current === 'PLAYING' &&
          !userPausedRef.current &&
          player &&
          !player.playing &&
          player.status === 'readyToPlay'
        ) {
          try {
            player.play();
          } catch (_e) {}
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (player) {
          try {
            player.pause();
          } catch (_e) {}
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [player]);



  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const triggerErrorState = useCallback((rawError) => {
    // Suppress all transient playback errors during engine switching handoff
    if (isSwitchingEngineRef.current) return;
    const classified = classifyPlayerError(rawError);
    if (classified.category === 'CANCELLED') return;
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);

    const popupPolicy = evaluatePlayerErrorPopupPolicy(rawError, {
      isNativeEvent: player?.status === 'error',
    });

    const currentAttemptId = requestCounterRef.current;

    // Phase 8 Diagnostic logging
    logClassifiedPlayerError({
      platform: Platform.OS,
      activePlaybackSessionId: currentAttemptId,
      errorCategory: popupPolicy.popupCategory,
      errorOrigin: player?.status === 'error' ? 'native_player' : 'application',
      actualHttpStatus: popupPolicy.httpStatus,
      nativeErrorCode: popupPolicy.nativeErrorCode,
      popupDisplayed: popupPolicy.shouldShowPopup,
      decisionReason: popupPolicy.decisionReason,
    });

    // Guard: Only confirmed terminal failures may transition playerState to ERROR
    const isConfirmedServer = isConfirmedServerError(rawError);
    const isFatalNative = isFatalNativePlayerError(rawError, { isNativeEvent: player?.status === 'error' });
    const isInvalidSource = classified.category === 'INVALID_URL' || (!validation?.isValid && Boolean(url));
    fallbackAttemptedRef.current = Boolean(fallbackAttemptedRef.current || attemptedFallbackUrlsRef.current.size >= 1);
    const isTerminalFailure = isConfirmedServer || isFatalNative || isInvalidSource || (classified.isFatal && fallbackAttemptedRef.current);

    if (!isTerminalFailure) {
      logPlayerDiagnostic('nonTerminalErrorSuppressed', {
        error: rawError?.message || String(rawError),
        category: classified.category,
        attemptId: currentAttemptId,
      });
      return;
    }

    playerStateRef.current = 'ERROR';
    setPlayerState('ERROR');
    const details = getErrorDisplayDetails(rawError);
    setErrorDetails(details);
    const userMsg = details.exactError || details.message || 'Unable to play this stream.';
    setErrorMessage(userMsg);
    setDebouncedBuffering(false);
    setIsBufferingUI(false);
    logPlayerDiagnostic('playbackError', {
      category: details.category,
      technical: details.technicalMessage,
      exactError: details.exactError,
      errorCode: details.errorCode,
      type,
      attemptId: currentAttemptId,
      popupCategory: popupPolicy.popupCategory,
      shouldShowPopup: popupPolicy.shouldShowPopup,
    });

    // Deduplicate toast: exactly one toast per attempt generation ID, ONLY when popup is authorized
    if (lastToastedAttemptIdRef.current !== currentAttemptId && popupPolicy.shouldShowPopup) {
      lastToastedAttemptIdRef.current = currentAttemptId;
      setToastType('error');
      setToastMessage('Failed');
      setShowToast(true);
    }
  }, [setDebouncedBuffering, type, player, validation, url]);


  // Handle fallback or transition to error with stale operation guard
  const handleFallbackOrError = useCallback((err, failedUrl, opId = null) => {
    if (isSwitchingEngineRef.current) return;
    if (opId !== null && opId !== requestCounterRef.current) {
      // Stale operation: ignore error from obsolete stream request
      return;
    }
    const classified = classifyPlayerError(err);
    if (classified.category === 'CANCELLED') {
      // Cancellation errors are non-fatal lifecycle transitions
      return;
    }

    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);

    // Automatic Dual-Engine Fallback:
    // If native engine failed on a recoverable/switchable error, switch to VLC engine automatically (if VLC is available)
    const isSwitchable = DualPlaybackCoordinator.isSwitchableError(classified);
    const vlcProbe = probeVlcNativeAvailability();
    if (
      engineMode === ENGINE_MODE.AUTO &&
      activeEngineType === ENGINE_TYPE.NATIVE &&
      vlcAttemptsRef.current < 1 &&
      vlcProbe.available &&
      isSwitchable
    ) {
      logPlayerDiagnostic('autoSwitchingToVlcEngine', {
        error: classified.message,
        category: classified.category,
        opId,
      });
      switchEngine(ENGINE_TYPE.VLC, ENGINE_SWITCH_REASON.AUTO_FALLBACK);
      return;
    }

    const attemptedUrls = attemptedFallbackUrlsRef.current;
    if (failedUrl) {
      attemptedUrls.add(failedUrl);
    }

    if (attemptedUrls.size <= 3 && classified.isFatal) {
      const fallbackUrl = getStreamFallbackUrl(failedUrl, {
        isLive,
        platform: Platform.OS,
        originalExtension: extension,
        attemptedUrls: Array.from(attemptedUrls),
      });

      // On iOS, do NOT fallback to raw .ts directly because AVPlayer cannot decode progressive .ts over HTTP
      const isRawTsOnIos = Platform.OS === 'ios' && isLive && fallbackUrl && /\.ts(\?.*)?$/i.test(fallbackUrl);

      if (fallbackUrl && !attemptedUrls.has(fallbackUrl) && !isRawTsOnIos) {
        attemptedUrls.add(fallbackUrl);
        currentUrlRef.current = fallbackUrl;
        playerStateRef.current = 'RETRYING';
        setPlayerState('RETRYING');
        setDebouncedBuffering(true);
        setIsBufferingUI(true);
        logPlayerDiagnostic('fallbackAttempt', { fallbackUrl, attemptCount: attemptedUrls.size, type, platform: Platform.OS });
        // Diagnostics watchdog for fallback attempt — NEVER triggers premature false fatal error
        loadTimeoutRef.current = setTimeout(() => {
          if (opId === null || opId === requestCounterRef.current) {
            logPlayerDiagnostic('fallbackConnectSlow', { opId, platform: Platform.OS });
          }
        }, 6000);

        try {
          const nextContentType = fallbackUrl.includes('.m3u8') ? 'hls' : 'progressive';
          const fallbackSource = {
            uri: fallbackUrl,
            ...(nextContentType !== 'auto' ? { contentType: nextContentType } : {}),
            headers: playerSource?.headers || { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
            metadata: playerSource?.metadata,
          };
          if (typeof player?.replaceAsync === 'function') {
            player.replaceAsync(fallbackSource).then(() => {
              if (opId === null || opId === requestCounterRef.current) {
                if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
                  try { player?.play(); } catch (_e) {}
                }
              }
            }).catch((err2) => {
              if (opId === null || opId === requestCounterRef.current) {
                handleFallbackOrError(err2, fallbackUrl, opId);
              }
            });
          } else {
            player?.replace(fallbackSource);
            if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
              try { player?.play(); } catch (_e) {}
            }
          }
          return;
        } catch (_e) {}
      }
    }

    triggerErrorState(err);
  }, [isLive, playerSource, triggerErrorState, type, player, engineMode, activeEngineType, switchEngine, setDebouncedBuffering, extension]);

  // Unified auto-play initiation with verification watchdog
  const initiateAutoPlayback = useCallback((opReqId = null) => {
    const currentReqId = requestCounterRef.current;
    if (opReqId !== null && opReqId !== currentReqId) {
      return;
    }
    if (!player || playerStateRef.current === 'ERROR' || userPausedRef.current || playbackIntentRef.current === 'PAUSED' || isSeekingRef.current || isSeekingSettlingRef.current) {
      return;
    }

    timingRef.current.t7_play = Date.now();
    try {
      player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
      player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
      player.play();
    } catch (_e) {}

    if (player.playing) {
      confirmPlaybackActive(currentReqId);
    }

    if (verifyPlaybackRef.current) {
      clearTimeout(verifyPlaybackRef.current);
      verifyPlaybackRef.current = null;
    }
    verifyPlaybackRef.current = setTimeout(() => {
      if (
        currentReqId === requestCounterRef.current &&
        playbackIntentRef.current === 'PLAYING' &&
        !userPausedRef.current &&
        playerStateRef.current !== 'ERROR' &&
        player
      ) {
        if (player.status === 'readyToPlay' && !player.playing) {
          logPlayerDiagnostic('vodAutoPlayVerificationRetry', { reqId: currentReqId, status: player.status, platform: Platform.OS });
          try {
            player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
            player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
            player.play();
          } catch (_e) {}
          if (player.playing) {
            confirmPlaybackActive(currentReqId);
          }
        }
      }
    }, 200);
  }, [player, confirmPlaybackActive]);

  // Handle URL/source change with atomic state reset and race condition prevention
  useEffect(() => {
    if (!player) return;

    if (!validation.isValid || !playerSource) {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (currentUrlRef.current !== null) {
        currentUrlRef.current = null;
        try {
          player.pause();
          if (typeof player.replaceAsync === 'function') {
            player.replaceAsync(null);
          } else {
            player.replace(null);
          }
        } catch (_e) {}
      }
      playerStateRef.current = 'ERROR';
      setPlayerState('ERROR');
      const details = getErrorDisplayDetails(validation.error || 'Unable to play this stream.');
      setErrorDetails(details);
      setErrorMessage(details.message);
      setDebouncedBuffering(false);
      setIsBufferingUI(false);
      return;
    }

    const nextUri = validation.uri;
    if (nextUri === currentUrlRef.current && player.status !== 'idle') {
      if (playerStateRef.current === 'ERROR') {
        return;
      }
      if (hasEverPlayedRef.current) {
        return;
      }
    }
    currentUrlRef.current = nextUri;
    attemptedFallbackUrlsRef.current.clear();
    const reqId = ++requestCounterRef.current;
    lastToastedAttemptIdRef.current = null;

    hasEverPlayedRef.current = false;
    setHasFirstFrame(false);
    lastPlaybackTimeRef.current = -1;
    lastAdvanceTimeRef.current = Date.now();
    // Atomic reset of player state — instant blackout with loader
    playerStateRef.current = 'LOADING';
    setPlayerState('LOADING');
    setCurrentTime(0);
    setDuration(0);
    setErrorMessage(null);
    setErrorDetails(null);
    setAvailableAudioTracks([]);
    setSelectedAudioTrack(null);
    setAvailableSubtitleTracks([]);
    setSelectedSubtitleTrack(null);
    userSelectedSubtitleRef.current = false;
    lastErrorRef.current = null;
    setShowToast(false);
    setToastMessage(null);
    userPausedRef.current = false;
    playbackIntentRef.current = 'PLAYING';
    pendingSeekTimeRef.current = null;
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    bufferStartRef.current = Date.now();
    setIsBufferingUI(true);
    timingRef.current.assigned = Date.now();

    // Connect watchdog: 12s configurable startup timeout with automatic VLC fallback
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      if (reqId === requestCounterRef.current && (playerStateRef.current === 'LOADING' || playerStateRef.current === 'BUFFERING' || playerStateRef.current === 'RETRYING')) {
        logPlayerDiagnostic('playbackConnectSlow', {
          reqId,
          isLive,
          elapsedMs: 12000,
          platform: Platform.OS,
        });
        const vlcProbe = probeVlcNativeAvailability();
        if (engineMode === ENGINE_MODE.AUTO && activeEngineType === ENGINE_TYPE.NATIVE && vlcAttemptsRef.current < 1 && vlcProbe.available) {
          logPlayerDiagnostic('startupTimeoutSwitchingToVLC', { reqId, platform: Platform.OS });
          switchEngine(ENGINE_TYPE.VLC, ENGINE_SWITCH_REASON.STARTUP_TIMEOUT);
        } else if (engineMode === ENGINE_MODE.AUTO && activeEngineType === ENGINE_TYPE.NATIVE) {
          logPlayerDiagnostic('startupTimeoutVlcUnavailableSkippingFallback', { reqId, reason: vlcProbe.reason });
        } else if (activeEngineType === ENGINE_TYPE.VLC) {
          if (engineMode === ENGINE_MODE.AUTO && nativeAttemptsRef.current < 1) {
            logPlayerDiagnostic('startupTimeoutSwitchingToNative', { reqId, platform: Platform.OS });
            switchEngine(ENGINE_TYPE.NATIVE, ENGINE_SWITCH_REASON.STARTUP_TIMEOUT);
          } else {
            triggerErrorState(new Error('Playback startup timed out on VLC engine.'));
          }
        }
      }
    }, 12000);

    try {
      const now = Date.now();
      timingRef.current.t0_tap = selectedAt ? Number(selectedAt) : (timingRef.current.t0_tap || now);
      timingRef.current.t1_source = now;
      timingRef.current.t2_player = now;
      timingRef.current.t3_assigned = now;

      logPlayerDiagnostic('loadStarted', {
        url: nextUri,
        type,
        extension,
        platform: Platform.OS,
        contentType,
        reqId,
      });

      if (activeEngineType === ENGINE_TYPE.VLC) {
        const targetVlc = vlcPlayer || getOrCreateVlcPlayer();
        if (targetVlc) {
          try {
            const streamUri = nextUri || sanitizedUrl || url;
            targetVlc.muted = false;
            targetVlc.volume = Math.round((volumeRef.current || 1.0) * 100);
            targetVlc.autoPlay = true;
            targetVlc.source = {
              uri: streamUri,
              userAgent: DEFAULT_IPTV_USER_AGENT,
              vlcOptions: getPlatformVlcOptions({ isLive, subtitleSize: subtitleSizeRef.current || subtitleSize }),
              title: title || 'Fox Player',
            };
            try { targetVlc.play(); } catch (_e) {}
            try {
              if (player) {
                player.pause();
                player.muted = true;
                if (typeof player.replaceAsync === 'function') {
                  player.replaceAsync(null).catch(() => {});
                } else if (typeof player.replace === 'function') {
                  player.replace(null);
                }
              }
            } catch (_e) {}
          } catch (_vlcErr) {
            logPlayerDiagnostic('vlcInitialLoadError', { error: _vlcErr?.message });
          }
        }
        return;
      }

      isReplacingSourceRef.current = true;
      if (typeof player.replaceAsync === 'function') {
        player.replaceAsync(playerSource).then(() => {
          isReplacingSourceRef.current = false;
          if (reqId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
            timingRef.current.t7_play = Date.now();
            try {
              player.muted = false;
              player.volume = volume || 1.0;
              player.play();
            } catch (_e) {}
            if (player.status === 'readyToPlay' || player.playing) {
              hasEverPlayedRef.current = true;
              setHasFirstFrame(true);
              playerStateRef.current = 'PLAYING';
              setPlayerState('PLAYING');
              if (bufferTimerRef.current) {
                clearTimeout(bufferTimerRef.current);
                bufferTimerRef.current = null;
              }
              setIsBufferingUI(false);
              setDebouncedBuffering(false);
            }
            initiateAutoPlayback(reqId);
          }
        }).catch((err) => {
          isReplacingSourceRef.current = false;
          if (reqId === requestCounterRef.current) {
            logPlayerDiagnostic('loadError', { error: err?.message, url: nextUri, reqId });
            handleFallbackOrError(err, nextUri, reqId);
          }
        });
      } else {
        player.replace(playerSource);
        isReplacingSourceRef.current = false;
        if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          timingRef.current.t7_play = Date.now();
          try {
            player.muted = false;
            player.volume = volume || 1.0;
            player.play();
          } catch (_e) {}
          if (player.playing && hasEverPlayedRef.current && hasFirstFrame) {
            playerStateRef.current = 'PLAYING';
            setPlayerState('PLAYING');
            if (bufferTimerRef.current) {
              clearTimeout(bufferTimerRef.current);
              bufferTimerRef.current = null;
            }
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          }
          initiateAutoPlayback(reqId);
        }
      }
    } catch (err) {
      isReplacingSourceRef.current = false;
      if (reqId === requestCounterRef.current) {
        logPlayerDiagnostic('loadError', { error: err?.message, url: nextUri, reqId });
        handleFallbackOrError(err, nextUri, reqId);
      }
    }
  }, [validation, playerSource, isLive, player, triggerErrorState, setDebouncedBuffering, type, extension, handleFallbackOrError, contentType, initiateAutoPlayback, confirmPlaybackActive, activeEngineType, vlcPlayer]);

  // Clean teardown on unmount
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      if (seekWatchdogRef.current) clearTimeout(seekWatchdogRef.current);
      try { player?.pause(); } catch (_e) {}
    };
  }, [player]);

  // Safely stop and tear down playback if active playlist becomes expired during playback
  useEffect(() => {
    if (isExpired) {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      if (seekWatchdogRef.current) clearTimeout(seekWatchdogRef.current);
      try {
        player?.pause();
        if (typeof player?.replaceAsync === 'function') {
          player.replaceAsync(null);
        } else {
          player?.replace(null);
        }
      } catch (_e) {}
      setPlayerState('ERROR');
      setErrorDetails({
        heading: 'Unable to Play Video',
        message: 'Playlist subscription has expired. Please renew or switch playlist.',
        explanation: 'Your subscription for this playlist is no longer active.',
        canRetry: false,
      });
      setErrorMessage('Playlist subscription has expired. Please renew or switch playlist.');
      setDebouncedBuffering(false);
    }
  }, [isExpired, player, setDebouncedBuffering]);

  // Track status and playback events (attached once per player instance)
  useEffect(() => {
    if (!player) return;

    const subStatus = player.addListener('statusChange', ({ status, error }) => {
      logPlayerDiagnostic('statusChange', { status, error: error?.message });

      // Guard: if already in fatal error or active engine is not native, ignore status updates
      if (playerStateRef.current === 'ERROR' || activeEngineTypeRef.current !== ENGINE_TYPE.NATIVE || isSwitchingEngineRef.current) {
        return;
      }

      if (status === 'error' || (status === 'idle' && error)) {
        if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        if (player.playing && hasEverPlayedRef.current) {
          // Player is actually playing; ignore non-fatal track warning
          return;
        }
        handleFallbackOrError(error || new Error('Video playback error occurred'), currentUrlRef.current, requestCounterRef.current);
      } else if (
        status === 'idle' &&
        !userPausedRef.current &&
        playbackIntentRef.current === 'PLAYING' &&
        !isReplacingSourceRef.current &&
        currentUrlRef.current
      ) {
        // Player transitioned to idle during stream load; log diagnostic and avoid terminal error
        logPlayerDiagnostic('playerIdleTransition', { url: currentUrlRef.current, reqId: requestCounterRef.current, type });
      } else if (status === 'readyToPlay') {
        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        timingRef.current.ready = Date.now();
        timingRef.current.t5_ready = Date.now();
        if (!isLive && player.duration && isFinite(player.duration) && !isNaN(player.duration) && player.duration > 0) {
          durationRef.current = player.duration;
          setDuration(player.duration);
          applyPendingResume();
        }

        if (playbackIntentRef.current === 'PAUSED' || userPausedRef.current) {
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
          if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
          setIsBufferingUI(false);
        } else if (player.playing) {
          playerStateRef.current = 'PLAYING';
          setPlayerState('PLAYING');
          confirmPlaybackActive(requestCounterRef.current);
        } else if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          timingRef.current.t7_play = Date.now();
          try {
            player.muted = false;
            player.volume = volume || 1.0;
            player.play();
          } catch (_e) {}
          if (player.playing && hasEverPlayedRef.current && hasFirstFrame) {
            playerStateRef.current = 'PLAYING';
            setPlayerState('PLAYING');
            if (bufferTimerRef.current) {
              clearTimeout(bufferTimerRef.current);
              bufferTimerRef.current = null;
            }
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          } else {
            setIsBufferingUI(true);
          }
          try {
            if (player?.availableAudioTracks?.length) {
              setAvailableAudioTracks(player.availableAudioTracks);
              setSelectedAudioTrack(player?.audioTrack || player.availableAudioTracks.find((t) => t.isDefault || t.default) || player.availableAudioTracks[0]);
            }
            if (player?.availableSubtitleTracks?.length) setAvailableSubtitleTracks(player.availableSubtitleTracks);
            if (!userSelectedSubtitleRef.current) {
              try { player.subtitleTrack = null; } catch (_e) {}
              setSelectedSubtitleTrack(null);
            } else {
              setSelectedSubtitleTrack(player?.subtitleTrack || null);
            }
          } catch (_e) {}
          initiateAutoPlayback(requestCounterRef.current);
        }
      } else if (status === 'loading') {
        timingRef.current.t4_loading = Date.now();
        if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          if (player.playing && hasEverPlayedRef.current) return;
          const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
          playerStateRef.current = nextState;
          setPlayerState(nextState);
          setDebouncedBuffering(true);
        }
      }
    });

    const subPlaying = player.addListener('playingChange', ({ isPlaying }) => {
      logPlayerDiagnostic('playingChange', { isPlaying });

      // Guard: if already in fatal error or active engine is not native, ignore playing changes
      if (playerStateRef.current === 'ERROR' || activeEngineTypeRef.current !== ENGINE_TYPE.NATIVE) {
        return;
      }

      if (isPlaying) {
        if (isSwitchingEngineRef.current) {
          isSwitchingEngineRef.current = false;
          setIsSwitchingEngine(false);
          if (switchWatchdogRef.current) {
            clearTimeout(switchWatchdogRef.current);
            switchWatchdogRef.current = null;
          }
          if (vlcPlayer) {
            try { vlcPlayer.stop(); } catch (_e) {}
          }
        }

        if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
        setErrorMessage(null);
        lastErrorRef.current = null;
        if (toastTypeRef.current === 'error') {
          setShowToast(false);
          setToastMessage(null);
        }

        if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
          try { player.pause(); } catch (_e) {}
          return;
        }

        confirmPlaybackActive(requestCounterRef.current);

        const now = Date.now();
        if (!timingRef.current.firstPlay && timingRef.current.assigned) {
          timingRef.current.firstPlay = now;
          timingRef.current.t6_firstFrame = now;
          timingRef.current.t8_playing = now;
          const elapsed = now - timingRef.current.assigned;
          const t0_to_t3 = timingRef.current.t3_assigned ? (timingRef.current.t3_assigned - timingRef.current.t0_tap) : 0;
          const t3_to_t5 = (timingRef.current.t5_ready && timingRef.current.t3_assigned) ? (timingRef.current.t5_ready - timingRef.current.t3_assigned) : 0;
          const t5_to_t6 = (timingRef.current.t6_firstFrame && timingRef.current.t5_ready) ? (timingRef.current.t6_firstFrame - timingRef.current.t5_ready) : 0;

          logPlayerDiagnostic('vodTimelineMilestones', {
            startupMs: elapsed,
            t0_to_t3_ms: t0_to_t3,
            t3_to_t5_readyMs: t3_to_t5,
            t5_to_t6_firstFrameMs: t5_to_t6,
            type,
            platform: Platform.OS,
          });
        }
      } else if (playerStateRef.current !== 'ERROR') {
        if (playbackIntentRef.current === 'PAUSED' || userPausedRef.current) {
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
          if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
          setIsBufferingUI(false);
        } else if (player?.status === 'readyToPlay') {
          if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
            initiateAutoPlayback(requestCounterRef.current);
          }
        } else {
          const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
          playerStateRef.current = nextState;
          setPlayerState(nextState);
          if (hasEverPlayedRef.current) {
            setDebouncedBuffering(true);
          } else {
            setIsBufferingUI(true);
          }
        }
      }
    });

    const subSourceLoad = player.addListener?.('sourceLoad', (payload) => {
      timingRef.current.sourceLoaded = Date.now();
      const loadElapsed = timingRef.current.sourceLoaded - (timingRef.current.assigned || timingRef.current.sourceLoaded);
      logPlayerDiagnostic('sourceLoad', { loadTimeMs: loadElapsed, type, platform: Platform.OS });
      try {
        const audTracks = normalizeAudioTrackList(
          payload?.availableAudioTracks || player?.availableAudioTracks || []
        );
        if (audTracks.length) {
          setAvailableAudioTracks(audTracks);
          const active = player?.audioTrack || audTracks.find((t) => t.isDefault || t.default) || audTracks[0];
          setSelectedAudioTrack(active);
        } else {
          setSelectedAudioTrack(player?.audioTrack || null);
        }
        const subTracks = normalizeSubtitleTrackList(
          payload?.availableSubtitleTracks || player?.availableSubtitleTracks || []
        );
        if (subTracks.length) {
          setAvailableSubtitleTracks(subTracks);
        }
        if (!userSelectedSubtitleRef.current) {
          try { player.subtitleTrack = null; } catch (_e) {}
          setSelectedSubtitleTrack(null);
        } else {
          setSelectedSubtitleTrack(player?.subtitleTrack || null);
        }
        reapplyNativeSubtitleSizeWithRetries(subtitleSizeRef.current);
      } catch (_e) {}
    });

    const subAudioTracks = player.addListener?.('availableAudioTracksChange', ({ availableAudioTracks: tracks }) => {
      logPlayerDiagnostic('availableAudioTracksChange', { count: tracks?.length || 0 });
      const trackList = normalizeAudioTrackList(Array.isArray(tracks) ? tracks : []);
      setAvailableAudioTracks(trackList);
      if (trackList.length > 0) {
        setSelectedAudioTrack((prev) => prev || player?.audioTrack || trackList.find((t) => t.isDefault || t.default) || trackList[0]);
      }
    });

    const subAudioTrackChange = player.addListener?.('audioTrackChange', ({ audioTrack: track }) => {
      logPlayerDiagnostic('audioTrackChange', { label: track?.label, lang: track?.language });
      setSelectedAudioTrack(track || null);
    });

    const subSubtitleTracks = player.addListener?.('availableSubtitleTracksChange', ({ availableSubtitleTracks: tracks }) => {
      logPlayerDiagnostic('availableSubtitleTracksChange', { count: tracks?.length || 0 });
      setAvailableSubtitleTracks(normalizeSubtitleTrackList(Array.isArray(tracks) ? tracks : []));
      reapplyNativeSubtitleSizeWithRetries(subtitleSizeRef.current);
    });

    const subSubtitleTrackChange = player.addListener?.('subtitleTrackChange', ({ subtitleTrack: track }) => {
      logPlayerDiagnostic('subtitleTrackChange', { label: track?.label, lang: track?.language });
      if (userSelectedSubtitleRef.current) {
        setSelectedSubtitleTrack(track || null);
      }
      reapplyNativeSubtitleSizeWithRetries(subtitleSizeRef.current);
    });

    const subError = player.addListener?.('error', (err) => {
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      if (playerStateRef.current === 'ERROR') return;
      logPlayerDiagnostic('playerError', { error: err?.error?.message || err?.message });
      handleFallbackOrError(err?.error || err, currentUrlRef.current, requestCounterRef.current);
    });

    const subPlaybackError = player.addListener?.('playbackError', (err) => {
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      if (playerStateRef.current === 'ERROR') return;
      logPlayerDiagnostic('playbackErrorEvent', { error: err?.error?.message || err?.message });
      handleFallbackOrError(err?.error || err, currentUrlRef.current, requestCounterRef.current);
    });

    const subTime = player.addListener('timeUpdate', ({ currentTime: curr }) => {
      // 1. If user is dragging seekbar thumb, do not update UI from native ticks
      if (isSeekingRef.current) return;

      // 2. Guard against fatal error
      if (playerStateRef.current === 'ERROR') return;

      const safeCurr = Math.max(0, curr || 0);

      // 3. Stale event suppression during seeking & seek completion convergence
      if (isSeekingSettlingRef.current && seekTargetTimeRef.current !== null) {
        const target = seekTargetTimeRef.current;
        const hasReachedTarget = Math.abs(safeCurr - target) <= 2.2 || (target > 0 && safeCurr >= target - 0.5);
        if (hasReachedTarget) {
          if (completeSeekRef.current) {
            completeSeekRef.current(seekCounterRef.current, safeCurr);
          }
        } else {
          // Stale tick before seek completion — suppress so thumb doesn't jump back
          return;
        }
      }

      // 4. Guard against updating when intentionally paused and not seeking
      if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') return;

      // 4. Glitch protection against transient CMTimeZero from AVPlayer
      if (safeCurr === 0 && lastPlaybackTimeRef.current > 1.5 && hasEverPlayedRef.current) {
        return;
      }

      // 5. Update UI position — only when controls are visible and on second boundaries or seek
      const lastSec = Math.floor(lastRenderedTimeRef.current || 0);
      const newSec = Math.floor(safeCurr);
      currentTimeRef.current = safeCurr;

      if (!isLive && (controlsVisibleRef.current || isSeekingSettlingRef.current)) {
        if (newSec !== lastSec || isSeekingSettlingRef.current) {
          lastRenderedTimeRef.current = safeCurr;
          setCurrentTime(safeCurr);
        }
      }

      // 6. Synchronize duration if valid
      if (!isLive && player.duration && isFinite(player.duration) && !isNaN(player.duration) && player.duration > 0 && Math.abs(player.duration - durationRef.current) > 0.5) {
        durationRef.current = player.duration;
        setDuration(player.duration);
      }

      // 7. Track advancement vs stall
      const prev = lastPlaybackTimeRef.current;
      const isAdvancing = prev >= 0 ? (safeCurr - prev > 0.03 || (safeCurr > 0.05 && prev === 0)) : (safeCurr > 0.05);
      const now = Date.now();

      if (isAdvancing) {
        lastPlaybackTimeRef.current = safeCurr;
        lastAdvanceTimeRef.current = now;
      } else if (prev < 0) {
        lastPlaybackTimeRef.current = safeCurr;
        lastAdvanceTimeRef.current = now;
      }

      // If native player is currently in 'loading' status and NOT playing, it is actively buffering
      if (player?.status === 'loading' && !player?.playing) {
        if (hasEverPlayedRef.current && playerStateRef.current !== 'BUFFERING') {
          playerStateRef.current = 'BUFFERING';
          setPlayerState('BUFFERING');
          setDebouncedBuffering(true);
        }
        return;
      }

      // If native player is not playing, do not mark as playing
      if (player && typeof player.playing === 'boolean' && !player.playing) {
        if (player.status === 'readyToPlay' && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          initiateAutoPlayback(requestCounterRef.current);
        }
        return;
      }

      if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
        if (!hasEverPlayedRef.current) {
          if (isAdvancing || safeCurr > 0.05 || player?.playing) {
            confirmPlaybackActive(requestCounterRef.current);
          }
        } else {
          if (isAdvancing && playerStateRef.current !== 'PLAYING') {
            confirmPlaybackActive(requestCounterRef.current);
          } else if (!isAdvancing && playerStateRef.current === 'PLAYING' && lastAdvanceTimeRef.current > 0 && (now - lastAdvanceTimeRef.current > 1400)) {
            // Mid-stream stall detected: time has ceased progressing for > 1.4s
            playerStateRef.current = 'BUFFERING';
            setPlayerState('BUFFERING');
            setDebouncedBuffering(true);
          } else if (!isAdvancing && playerStateRef.current === 'BUFFERING' && lastAdvanceTimeRef.current > 0 && (now - lastAdvanceTimeRef.current > 14000)) {
            // Persistent mid-stream stall exceeding 14s — remain buffering without triggering false terminal error
            logPlayerDiagnostic('midStreamBufferingProlonged', { elapsedStallMs: now - lastAdvanceTimeRef.current, url: currentUrlRef.current, type });
          }
        }
      }

      if (!isLive) {
        checkNearEndForSeriesOfferRef.current?.(
          safeCurr,
          durationRef.current || player.duration || 0,
        );
      }
    });

    const subPlayToEnd = player.addListener?.('playToEnd', () => {
      logPlayerDiagnostic('playToEnd', { type, duration: durationRef.current });
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (verifyPlaybackRef.current) clearTimeout(verifyPlaybackRef.current);
      handleVodPlaybackEnded();
    });

    // Immediate auto-play check: if player is ALREADY in readyToPlay status when listener attaches
    if (
      player?.status === 'readyToPlay' &&
      playbackIntentRef.current === 'PLAYING' &&
      !userPausedRef.current &&
      playerStateRef.current !== 'ERROR'
    ) {
      try {
        player.muted = false;
        player.volume = volume || 1.0;
        player.play();
      } catch (_e) {}
      hasEverPlayedRef.current = true;
      setHasFirstFrame(true);
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
      initiateAutoPlayback(requestCounterRef.current);
    }

    return () => {
      subStatus?.remove();
      subPlaying?.remove();
      subSourceLoad?.remove?.();
      subAudioTracks?.remove?.();
      subAudioTrackChange?.remove?.();
      subSubtitleTracks?.remove?.();
      subSubtitleTrackChange?.remove?.();
      subError?.remove?.();
      subPlaybackError?.remove?.();
      subTime?.remove();
      subPlayToEnd?.remove?.();
    };
  }, [player, triggerErrorState, setDebouncedBuffering, type, handleFallbackOrError, isLive, initiateAutoPlayback, confirmPlaybackActive, applyPendingResume, handleVodPlaybackEnded]);

  // Duplicate VLC listener removed - unified into primary listener above

  const handleBeforeOpenTrackModal = useCallback(() => {
    const snapshot = collectPlaybackMediaTracks({
      activeEngineType,
      player,
      vlcPlayer,
      fallbackAudioTracks: availableAudioTracks,
      fallbackSubtitleTracks: availableSubtitleTracks,
      selectedAudioTrack,
      selectedSubtitleTrack,
    });
    setAvailableAudioTracks(snapshot.availableAudioTracks);
    setAvailableSubtitleTracks(snapshot.availableSubtitleTracks);
    setSelectedAudioTrack(snapshot.selectedAudioTrack);
    setSelectedSubtitleTrack(snapshot.selectedSubtitleTrack);
    return snapshot;
  }, [
    activeEngineType,
    vlcPlayer,
    player,
    availableAudioTracks,
    availableSubtitleTracks,
    selectedAudioTrack,
    selectedSubtitleTrack,
  ]);

  const handleSelectAudioTrack = useCallback((track, trackIndex = null) => {
    if (!track) return;

    const targetIndex = trackIndex ?? track?._originalIndex ?? null;

    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        const vlcTracks = vlcPlayer.audioTracks || [];
        let trackId = null;

        if (typeof track === 'number') {
          trackId = track;
        } else if (track.id != null && !isNaN(Number(track.id))) {
          trackId = Number(track.id);
        } else if (targetIndex !== null && vlcTracks[targetIndex]?.id != null) {
          trackId = Number(vlcTracks[targetIndex].id);
        } else if (vlcTracks.length > 0) {
          const match = vlcTracks.find((vt) => (
            vt.name === track.name ||
            vt.name === track.label ||
            (track.language && vt.name?.toLowerCase().includes(track.language.toLowerCase()))
          ));
          if (match && match.id != null) {
            trackId = Number(match.id);
          } else {
            trackId = Number(vlcTracks[0].id);
          }
        }

        if (trackId !== null && !isNaN(trackId) && trackId >= 0) {
          if (typeof vlcPlayer.setAudioTrack === 'function') {
            vlcPlayer.setAudioTrack(trackId);
          } else if (typeof vlcPlayer.selectAudioTrack === 'function') {
            vlcPlayer.selectAudioTrack(trackId);
          }
        }

        setSelectedAudioTrack(track);

        // Guarantee volume and playback continue seamlessly without pause
        if (vlcPlayer.muted) vlcPlayer.muted = false;
        if (!vlcPlayer.playing && playerStateRef.current === 'PLAYING' && !userPausedRef.current) {
          try { vlcPlayer.play(); } catch (_e) {}
        }
      } catch (err) {
        logPlayerDiagnostic('vlcSelectAudioTrackError', { error: err?.message });
      }
      return;
    }

    if (!player) return;
    try {
      const nativeTracks = player.availableAudioTracks || availableAudioTracks || [];
      let nativeTrackToApply = null;

      // 1. Direct index lookup (100% reliable across identical language tags)
      if (targetIndex !== null && nativeTracks[targetIndex]) {
        nativeTrackToApply = nativeTracks[targetIndex];
      }
      // 2. Exact object identity
      else if (nativeTracks.includes(track)) {
        nativeTrackToApply = track;
      }
      // 3. ID match (Android ExoPlayer format.id)
      else if (track.id != null && nativeTracks.length > 0) {
        nativeTrackToApply = nativeTracks.find((t) => t.id != null && String(t.id) === String(track.id));
      }
      // 4. Exact label and language match (iOS AVPlayer)
      if (!nativeTrackToApply && track.label && track.language && nativeTracks.length > 0) {
        nativeTrackToApply = nativeTracks.find((t) => t.label === track.label && t.language === track.language);
      }
      // 5. Label match
      if (!nativeTrackToApply && (track.label || track.name) && nativeTracks.length > 0) {
        const lbl = track.label || track.name;
        nativeTrackToApply = nativeTracks.find((t) => t.label === lbl || t.name === lbl);
      }

      // DO NOT fall back to nativeTracks[0] if user selected a different track!
      const targetTrack = nativeTrackToApply || track;

      if (targetTrack) {
        track = targetTrack;
        player.audioTrack = track;
        setSelectedAudioTrack(track);
      } else {
        setSelectedAudioTrack(track);
      }

      // CRITICAL: Ensure audio volume stays on and playback continues seamlessly without pause
      if (player.muted) {
        player.muted = false;
      }
      if (!player.playing && playerStateRef.current === 'PLAYING' && !userPausedRef.current) {
        try { player.play(); } catch (_e) {}
      }

      logPlayerDiagnostic('selectAudioTrack', { label: targetTrack?.label, language: targetTrack?.language, id: targetTrack?.id });
    } catch (err) {
      logPlayerDiagnostic('selectAudioTrackError', { error: err?.message });
    }
  }, [player, activeEngineType, vlcPlayer, availableAudioTracks]);

  const handleSelectSubtitleTrack = useCallback((track, trackIndex = null) => {
    userSelectedSubtitleRef.current = Boolean(track);
    const targetIndex = trackIndex ?? track?._originalIndex ?? null;

    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        let trackId = -1;
        if (track) {
          const vlcSubs = vlcPlayer.subtitleTracks || [];
          if (track.id != null && !isNaN(Number(track.id))) {
            trackId = Number(track.id);
          } else if (targetIndex !== null && vlcSubs[targetIndex]?.id != null) {
            trackId = Number(vlcSubs[targetIndex].id);
          } else if (typeof track === 'number') {
            trackId = track;
          }
        }

        if (typeof vlcPlayer.setSubtitleTrack === 'function') {
          vlcPlayer.setSubtitleTrack(trackId);
        } else if (typeof vlcPlayer.selectSubtitleTrack === 'function') {
          vlcPlayer.selectSubtitleTrack(trackId);
        }
        setSelectedSubtitleTrack(track);
        logPlayerDiagnostic('selectSubtitleTrackVLC', { playbackEngine: 'vlc', trackId });
      } catch (err) {
        logPlayerDiagnostic('selectSubtitleTrackVLCError', { error: err?.message });
      }
      return;
    }

    if (!player) return;
    try {
      if (!track) {
        player.subtitleTrack = null;
        setSelectedSubtitleTrack(null);
        logPlayerDiagnostic('selectSubtitleTrack', { disabled: true });
        return;
      }

      const nativeSubs = player.availableSubtitleTracks || availableSubtitleTracks || [];
      let nativeSubToApply = null;

      // 1. Direct index lookup
      if (targetIndex !== null && nativeSubs[targetIndex]) {
        nativeSubToApply = nativeSubs[targetIndex];
      }
      // 2. Exact object identity
      else if (nativeSubs.includes(track)) {
        nativeSubToApply = track;
      }
      // 3. ID match (Android)
      else if (track.id != null && nativeSubs.length > 0) {
        nativeSubToApply = nativeSubs.find((s) => s.id != null && String(s.id) === String(track.id));
      }
      // 4. Label & language match (iOS)
      if (!nativeSubToApply && track.label && track.language && nativeSubs.length > 0) {
        nativeSubToApply = nativeSubs.find((s) => s.label === track.label && s.language === track.language);
      }
      // 5. Language match
      if (!nativeSubToApply && track.language && nativeSubs.length > 0) {
        nativeSubToApply = nativeSubs.find((s) => s.language?.toLowerCase() === track.language?.toLowerCase());
      }

      const subToApply = nativeSubToApply || track;
      track = subToApply;
      player.subtitleTrack = track;
      setSelectedSubtitleTrack(track);
      reapplyNativeSubtitleSizeWithRetries(subtitleSizeRef.current);
      logPlayerDiagnostic('selectSubtitleTrack', { label: track?.label, language: track?.language, id: track?.id });
    } catch (err) {
      logPlayerDiagnostic('selectSubtitleTrackError', { error: err?.message });
    }
  }, [player, activeEngineType, vlcPlayer, availableSubtitleTracks]);

  const isGestureActiveRef = useRef(false);

  const cancelAutoHideTimer = useCallback(() => {
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
      controlsTimeout.current = null;
    }
  }, []);

  const hideControlsUI = useCallback(() => {
    if (isSeekingRef.current || isGestureActiveRef.current || playerStateRef.current === 'PAUSED') {
      return;
    }
    cancelAutoHideTimer();
    controlsVisibleRef.current = false;
    setControlsVisible(false);
    controlsOpacityRef.current.stopAnimation();
    Animated.timing(controlsOpacityRef.current, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [cancelAutoHideTimer]);

  // Auto-hide timer (~3.0 s of inactivity during playback)
  const resetHideTimer = useCallback(() => {
    cancelAutoHideTimer();
    if (
      playerStateRef.current === 'PLAYING' &&
      controlsVisibleRef.current &&
      !isSeekingRef.current &&
      !isGestureActiveRef.current
    ) {
      controlsTimeout.current = setTimeout(() => {
        hideControlsUI();
      }, 3000);
    }
  }, [cancelAutoHideTimer, hideControlsUI]);

  const showControlsUI = useCallback(() => {
    controlsVisibleRef.current = true;
    setControlsVisible(true);
    if (!isLive && currentTimeRef.current > 0) {
      setCurrentTime(currentTimeRef.current);
    }
    controlsOpacityRef.current.stopAnimation();
    Animated.timing(controlsOpacityRef.current, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    resetHideTimer();
  }, [isLive, resetHideTimer]);

  const toggleControls = useCallback(() => {
    if (controlsVisibleRef.current) {
      hideControlsUI();
    } else {
      showControlsUI();
    }
  }, [hideControlsUI, showControlsUI]);

  const handleGestureStart = useCallback(() => {
    isGestureActiveRef.current = true;
    cancelAutoHideTimer();
    if (typeof notifyGestureStart === 'function') {
      notifyGestureStart();
    }
  }, [cancelAutoHideTimer, notifyGestureStart]);

  const handleGestureEnd = useCallback(() => {
    isGestureActiveRef.current = false;
    if (typeof notifyGestureEnd === 'function') {
      notifyGestureEnd();
    }
    if (controlsVisibleRef.current && playerStateRef.current === 'PLAYING') {
      resetHideTimer();
    }
  }, [resetHideTimer, notifyGestureEnd]);

  // Ensure controls are immediately visible upon mounting or source change
  useEffect(() => {
    cancelAutoHideTimer();
    controlsVisibleRef.current = true;
    setControlsVisible(true);
    controlsOpacityRef.current.stopAnimation();
    controlsOpacityRef.current.setValue(1);
  }, [url, cancelAutoHideTimer]);

  useEffect(() => {
    if (playerState === 'PAUSED') {
      cancelAutoHideTimer();
      controlsVisibleRef.current = true;
      setControlsVisible(true);
      controlsOpacityRef.current.stopAnimation();
      Animated.timing(controlsOpacityRef.current, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
    } else if (playerState === 'LOADING' || playerState === 'BUFFERING' || playerState === 'RETRYING') {
      cancelAutoHideTimer();
      controlsVisibleRef.current = true;
      setControlsVisible(true);
      controlsOpacityRef.current.stopAnimation();
      controlsOpacityRef.current.setValue(1);
    } else if (playerState === 'PLAYING') {
      if (controlsVisibleRef.current) {
        resetHideTimer();
      }
    }
    return () => {
      cancelAutoHideTimer();
    };
  }, [playerState, cancelAutoHideTimer, resetHideTimer]);

  const triggerSeekFeedback = useCallback((text) => {
    setSeekFeedback((prev) => ({ text, key: (prev?.key || 0) + 1 }));
    // Only mutate inside callback (event-handler context) — not during render
    seekFeedbackAnimRef.current.setValue(0);
    Animated.sequence([
      Animated.timing(seekFeedbackAnimRef.current, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(400),
      Animated.timing(seekFeedbackAnimRef.current, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setSeekFeedback(null));
  }, []);

  const completeSeek = useCallback((opId, actualTime) => {
    if (opId !== seekCounterRef.current) return;
    if (!isSeekingSettlingRef.current && !isSeekingRef.current) return;

    isSeekingSettlingRef.current = false;
    isSeekingRef.current = false;
    pendingSeekTimeRef.current = null;
    seekTargetTimeRef.current = null;
    if (seekWatchdogRef.current) {
      clearTimeout(seekWatchdogRef.current);
      seekWatchdogRef.current = null;
    }
    upNextSeekOriginRef.current = null;
    syncUpNextAfterSeekRef.current?.(actualTime);

    logPlayerDiagnostic('seekSettled', {
      seekOpId: opId,
      actualTime,
      wasPlaying: wasPlayingBeforeSeekRef.current,
      userPaused: userPausedRef.current,
    });

    if (wasPlayingBeforeSeekRef.current && !userPausedRef.current && playerStateRef.current !== 'ERROR') {
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      playbackIntentRef.current = 'PLAYING';
      if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
        try { vlcPlayer.play(); } catch (_e) {}
      } else {
        try {
          player.play();
        } catch (_e) {}
      }
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
      confirmPlaybackActive(requestCounterRef.current);
    } else {
      playerStateRef.current = 'PAUSED';
      setPlayerState('PAUSED');
      playbackIntentRef.current = 'PAUSED';
      if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
        try { vlcPlayer.pause(); } catch (_e) {}
      } else {
        try {
          player.pause();
        } catch (_e) {}
      }
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
    }
  }, [player, confirmPlaybackActive, setDebouncedBuffering, activeEngineType, vlcPlayer]);
  completeSeekRef.current = completeSeek;

  const executeSeek = useCallback((targetTime, source = 'scrubber') => {
    if (!player || type === 'live') return;
    const isVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer;
    try {
      hasEndedRef.current = false;
      const dur = duration || (player ? player.duration : 0) || 0;
      let safeTime = Math.max(0, targetTime);
      if (dur > 1 && safeTime >= dur - 0.05) {
        safeTime = Math.max(0, dur - 0.15);
      }
      if (dur > 0) {
        safeTime = Math.min(dur, safeTime);
      }

      // Record playback intent before seek started (only on initial seek action)
      if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
        const wasPlaying = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (isVlc ? (playerStateRef.current === 'PLAYING') : Boolean(player?.playing));
        wasPlayingBeforeSeekRef.current = wasPlaying;
      }

      // 1. Immediately pause native player so old video/audio NEVER continues playing
      try {
        if (isVlc) {
          // Do not pause VLC, seeking while playing allows seamless frame handover
        } else {
          player.pause();
        }
      } catch (_e) {}

      const seekOpId = ++seekCounterRef.current;
      seekTargetTimeRef.current = safeTime;
      seekTargetTimestampRef.current = Date.now();
      isSeekingSettlingRef.current = true;
      pendingSeekTimeRef.current = safeTime;

      logPlayerDiagnostic('seekRequested', {
        seekOpId,
        targetTime: safeTime,
        source,
        wasPlaying: wasPlayingBeforeSeekRef.current,
        platform: Platform.OS,
        engine: isVlc ? 'VLC' : 'NATIVE',
      });

      if (seekWatchdogRef.current) {
        clearTimeout(seekWatchdogRef.current);
        seekWatchdogRef.current = null;
      }

      setCurrentTime(safeTime);
      const seekOrigin = upNextSeekOriginRef.current != null
        ? upNextSeekOriginRef.current
        : (currentTimeRef.current || 0);
      if (upNextSeekOriginRef.current == null) {
        upNextSeekOriginRef.current = seekOrigin;
      }
      currentTimeRef.current = safeTime;
      lastRenderedTimeRef.current = safeTime;
      lastPlaybackTimeRef.current = safeTime;
      lastAdvanceTimeRef.current = Date.now();
      syncUpNextAfterSeekRef.current?.(safeTime);

      // Enter buffering state immediately: shows buffering indicator and hides Play/Pause
      playerStateRef.current = 'BUFFERING';
      setPlayerState('BUFFERING');
      setDebouncedBuffering(true);
      setIsBufferingUI(true);

      // Apply the seek to active player
      if (isVlc) {
        if (typeof vlcPlayer.seek === 'function') {
          vlcPlayer.seek(Math.round(safeTime * 1000));
        }
      } else if (player) {
        player.currentTime = safeTime;
      }

      // Watchdog timeout fallback to settle seek if position reporting is delayed
      seekWatchdogRef.current = setTimeout(() => {
        if (seekOpId === seekCounterRef.current && (isSeekingSettlingRef.current || isSeekingRef.current)) {
          logPlayerDiagnostic('seekSettledTimeout', { seekOpId, targetTime: safeTime });
          completeSeek(seekOpId, safeTime);
        }
      }, 1600);
    } catch (_e) {}
  }, [player, duration, type, setDebouncedBuffering, completeSeek, activeEngineType, vlcPlayer]);

  const handleSeek = useCallback((targetTime) => {
    executeSeek(targetTime, 'scrubber');
  }, [executeSeek]);

  const handleSeekingChange = useCallback((seeking) => {
    const isVlc = activeEngineTypeRef.current === ENGINE_TYPE.VLC && vlcPlayer;
    if (seeking) {
      if (upNextSeekOriginRef.current == null) {
        upNextSeekOriginRef.current = currentTimeRef.current || 0;
      }
      if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
        const wasPlaying = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (isVlc ? (playerStateRef.current === 'PLAYING') : Boolean(player?.playing));
        wasPlayingBeforeSeekRef.current = wasPlaying;
      }
      isSeekingRef.current = true;
      try {
        if (isVlc) {
          // Do not pause VLC during touch drag to prevent decoder buffer flushes
        } else {
          player?.pause();
        }
      } catch (_e) {}
      cancelAutoHideTimer();
    } else {
      isSeekingRef.current = false;
      resetHideTimer();
    }
  }, [player, cancelAutoHideTimer, resetHideTimer, activeEngineType, vlcPlayer]);

  const handleRewind = useCallback(() => {
    const isVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer;
    if ((!player && !isVlc) || type === 'live') return;
    try {
      const cur = isSeekingSettlingRef.current && seekTargetTimeRef.current !== null
        ? seekTargetTimeRef.current
        : (isVlc ? currentTime : (typeof player?.currentTime === 'number' ? player.currentTime : (currentTimeRef.current || 0)));
      const target = Math.max(0, cur - 10);
      executeSeek(target, 'rewind');
      triggerSeekFeedback('↶ 10s');
      showControlsUI();
    } catch (_e) {}
  }, [player, type, executeSeek, showControlsUI, triggerSeekFeedback, activeEngineType, vlcPlayer, currentTime]);

  const handleForward = useCallback(() => {
    const isVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer;
    if ((!player && !isVlc) || type === 'live') return;
    try {
      const cur = isSeekingSettlingRef.current && seekTargetTimeRef.current !== null
        ? seekTargetTimeRef.current
        : (isVlc ? currentTime : (typeof player?.currentTime === 'number' ? player.currentTime : (currentTimeRef.current || 0)));
      const dur = duration || (player ? player.duration : 0) || 0;
      const target = dur > 0 ? Math.min(dur, cur + 10) : cur + 10;
      executeSeek(target, 'forward');
      triggerSeekFeedback('10s ↷');
      showControlsUI();
    } catch (_e) {}
  }, [player, duration, type, executeSeek, showControlsUI, triggerSeekFeedback, activeEngineType, vlcPlayer, currentTime]);

  const handleTouchZone = (side) => {
    const now  = Date.now();
    const last = lastTapRef.current;
    if (now - last.time < 320 && last.side === side) {
      if (side === 'left') {
        handleRewind();
      } else {
        handleForward();
      }
      lastTapRef.current = { time: 0, side: null };
    } else {
      lastTapRef.current = { time: now, side };
      toggleControls();
    }
  };

  const handleRetry = useCallback(() => {
    if (isRetryingRef.current) return;
    isRetryingRef.current = true;
    setTimeout(() => { isRetryingRef.current = false; }, 1200);

    attemptedFallbackUrlsRef.current.clear();
    hasEverPlayedRef.current = false;
    hasEndedRef.current = false;
    setHasFirstFrame(false);
    userSelectedSubtitleRef.current = false;
    setSelectedSubtitleTrack(null);
    setAvailableAudioTracks([]);
    setAvailableSubtitleTracks([]);
    lastPlaybackTimeRef.current = -1;
    lastAdvanceTimeRef.current = Date.now();
    currentUrlRef.current = url;
    const reqId = ++requestCounterRef.current;
    lastToastedAttemptIdRef.current = null;
    playerStateRef.current = 'LOADING';
    setPlayerState('LOADING');
    setErrorMessage(null);
    setErrorDetails(null);
    lastErrorRef.current = null;
    setShowToast(false);
    setToastMessage(null);
    userPausedRef.current = false;
    playbackIntentRef.current = 'PLAYING';
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    bufferStartRef.current = Date.now();
    setIsBufferingUI(true);
    setDebouncedBuffering(true);
    timingRef.current.assigned = Date.now();

    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      if (reqId === requestCounterRef.current && (playerStateRef.current === 'LOADING' || playerStateRef.current === 'BUFFERING' || playerStateRef.current === 'RETRYING')) {
        logPlayerDiagnostic('retryConnectSlow', {
          reqId,
          platform: Platform.OS,
          decisionReason: 'Suppressed: slow retry kept in LOADING/BUFFERING state without fatal popup',
        });
      }
    }, isLive ? 25000 : 30000);

    try {
      if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
        const streamUri = url || validation.uri || sanitizedUrl;
        vlcPlayer.muted = false;
        vlcPlayer.volume = Math.round((volumeRef.current || 1.0) * 100);
        vlcPlayer.autoPlay = true;
        vlcPlayer.source = {
          uri: streamUri,
          userAgent: DEFAULT_IPTV_USER_AGENT,
          vlcOptions: getPlatformVlcOptions({ isLive, subtitleSize: subtitleSizeRef.current || subtitleSize }),
          title: title || 'Fox Player',
        };
        try { vlcPlayer.play(); } catch (_e) {}
        return;
      }

      if (player && url) {
        if (typeof player.replaceAsync === 'function') {
          player.replaceAsync(playerSource || url).then(() => {
            if (reqId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
              try { player.play(); } catch (_e) {}
            }
          }).catch((err) => {
            if (reqId === requestCounterRef.current) {
              triggerErrorState(err);
            }
          });
        } else {
          player.replace(playerSource || url);
          if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
            try { player.play(); } catch (_e) {}
          }
        }
      }
    } catch (err) {
      triggerErrorState(err);
    }
  }, [player, url, playerSource, triggerErrorState, isLive, handleFallbackOrError, setDebouncedBuffering, activeEngineType, vlcPlayer, validation.uri, sanitizedUrl, title]);

  const handleBack = useCallback(() => {
    userPausedRef.current = true;
    playbackIntentRef.current = 'PAUSED';
    try { player?.pause(); } catch (_e) {}
    try { vlcPlayer?.pause(); vlcPlayer?.stop(); } catch (_e) {}
    persistPlaybackProgress();

    if (backSeriesId && (backTarget === 'series' || type === 'series')) {
      const epHighlight =
        episodeStreamId || streamId || recentEntryId || '';
      if (epHighlight) {
        setSeriesReturnHighlight({
          seriesId: backSeriesId,
          episodeStreamId: String(epHighlight),
        });
      }
      if (router.canGoBack?.()) {
        router.back();
      } else {
        router.replace({
          pathname: '/(tabs)/series',
          params: {
            seriesId: backSeriesId,
            episodeStreamId: epHighlight ? String(epHighlight) : '',
            focusAt: epHighlight ? String(Date.now()) : '',
            autoPlayEpisode: '0',
            ...(backCategoryId ? { categoryId: backCategoryId } : {}),
            ...(returnTo ? { returnTo } : {}),
          },
        });
      }
      return;
    }

    safeBack(router);
  }, [
    router,
    player,
    vlcPlayer,
    persistPlaybackProgress,
    backTarget,
    backSeriesId,
    type,
    episodeStreamId,
    streamId,
    recentEntryId,
    backCategoryId,
    returnTo,
  ]);

  const togglePlay = useCallback(() => {
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      if (isTogglingPlayRef.current) return;
      isTogglingPlayRef.current = true;
      setTimeout(() => { isTogglingPlayRef.current = false; }, 250);

      const isCurrentlyPlaying = playerState === 'PLAYING';
      if (isCurrentlyPlaying) {
        userPausedRef.current = true;
        playbackIntentRef.current = 'PAUSED';
        try { vlcPlayer.pause(); } catch (_e) {}
        playerStateRef.current = 'PAUSED';
        setPlayerState('PAUSED');
      } else {
        userPausedRef.current = false;
        playbackIntentRef.current = 'PLAYING';
        try { vlcPlayer.play(); } catch (_e) {}
        playerStateRef.current = 'PLAYING';
        setPlayerState('PLAYING');
      }
      resetHideTimer();
      return;
    }

    if (!player) return;
    if (isTogglingPlayRef.current) return;
    isTogglingPlayRef.current = true;
    setTimeout(() => { isTogglingPlayRef.current = false; }, 250);

    if (hasEndedRef.current) {
      hasEndedRef.current = false;
      userPausedRef.current = false;
      playbackIntentRef.current = 'PLAYING';
      lastAdvanceTimeRef.current = Date.now();
      try {
        player.currentTime = 0;
        player.play();
      } catch (_e) {}
      setCurrentTime(0);
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      setIsBufferingUI(false);
      resetHideTimer();
      return;
    }

    const shouldPause = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (typeof player.playing === 'boolean' ? player.playing : false) || playerState === 'PLAYING';

    if (shouldPause) {
      userPausedRef.current = true;
      playbackIntentRef.current = 'PAUSED';
      try { player.pause(); } catch (_e) {}
      playerStateRef.current = 'PAUSED';
      setPlayerState('PAUSED');
      if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
      setIsBufferingUI(false);
    } else {
      userPausedRef.current = false;
      playbackIntentRef.current = 'PLAYING';
      lastAdvanceTimeRef.current = Date.now();
      try { player.play(); } catch (_e) {}
      if (player.status === 'readyToPlay' && player.playing) {
        playerStateRef.current = 'PLAYING';
        setPlayerState('PLAYING');
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
        setIsBufferingUI(false);
      } else {
        const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
        playerStateRef.current = nextState;
        setPlayerState(nextState);
        setDebouncedBuffering(true);
      }
      resetHideTimer();
    }
  }, [player, playerState, setDebouncedBuffering, resetHideTimer, activeEngineType, vlcPlayer]);

  const toggleMute = useCallback(() => {
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        const nextMuted = !isMuted;
        vlcPlayer.muted = nextMuted;
        if (typeof vlcPlayer.setMuted === 'function') {
          vlcPlayer.setMuted(nextMuted);
        } else if (typeof vlcPlayer.setVolume === 'function') {
          vlcPlayer.setVolume(nextMuted ? 0 : 100);
        }
      } catch (_e) {}
    }
    toggleVolumeMute();
    showControlsUI();
  }, [activeEngineType, vlcPlayer, isMuted, toggleVolumeMute, showControlsUI]);

  const cycleFitMode = useCallback(() => {
    setContentFit((prev) => {
      const idx = FIT_MODES.indexOf(prev);
      return FIT_MODES[(idx + 1) % FIT_MODES.length];
    });
    showControlsUI();
  }, [showControlsUI]);

  const cycleSpeed = useCallback(() => {
    const nextIdx   = (playbackSpeedIndex + 1) % SPEEDS.length;
    const nextSpeed = SPEEDS[nextIdx];
    setPlaybackSpeedIndex(nextIdx);
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        vlcPlayer.rate = nextSpeed;
        if (typeof vlcPlayer.setRate === 'function') {
          vlcPlayer.setRate(nextSpeed);
        }
      } catch (_e) {}
    } else {
      try { if (player) player.playbackRate = nextSpeed; } catch (_e) {}
    }
    showControlsUI();
  }, [playbackSpeedIndex, player, activeEngineType, vlcPlayer, showControlsUI]);

  const handleFirstFrameRender = useCallback(() => {
    confirmPlaybackActive(requestCounterRef.current);
    if (isSwitchingEngineRef.current) {
      isSwitchingEngineRef.current = false;
      setIsSwitchingEngine(false);
      if (switchWatchdogRef.current) {
        clearTimeout(switchWatchdogRef.current);
        switchWatchdogRef.current = null;
      }
      if (activeEngineTypeRef.current === ENGINE_TYPE.NATIVE && vlcPlayer) {
        try { vlcPlayer.stop(); } catch (_e) {}
      } else if (activeEngineTypeRef.current === ENGINE_TYPE.VLC && player) {
        try { player.pause(); } catch (_e) {}
      }
    }
    const now = Date.now();
    timingRef.current.t6_firstFrame = now;
    timingRef.current.t7_firstFrame = now;
    if (verifyPlaybackRef.current) {
      clearTimeout(verifyPlaybackRef.current);
      verifyPlaybackRef.current = null;
    }
    setHasFirstFrame(true);
    hasEverPlayedRef.current = true;
    try {
      if (player) {
        player.muted = false;
        player.volume = volumeRef.current || 1.0;
      }
    } catch (_e) {}

    if (playerStateRef.current !== 'PAUSED' && !userPausedRef.current) {
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
    }

    const t0 = timingRef.current.t0_tap || timingRef.current.assigned || now;
    const totalLatency = now - t0;
    const t0_to_t1 = timingRef.current.t1_source ? (timingRef.current.t1_source - t0) : 0;
    const t1_to_t3 = (timingRef.current.t3_assigned && timingRef.current.t1_source) ? (timingRef.current.t3_assigned - timingRef.current.t1_source) : 0;
    const t3_to_t5 = (timingRef.current.t5_ready && timingRef.current.t3_assigned) ? (timingRef.current.t5_ready - timingRef.current.t3_assigned) : 0;
    const t5_to_t8 = (timingRef.current.t8_playing && timingRef.current.t5_ready) ? (timingRef.current.t8_playing - timingRef.current.t5_ready) : 0;
    const t8_to_t7 = timingRef.current.t8_playing ? (now - timingRef.current.t8_playing) : 0;

    logPlayerDiagnostic('playbackStartupTimings', {
      totalSelectionToFirstFrameMs: totalLatency,
      t0_selection_to_url_ms: t0_to_t1,
      t1_url_to_assigned_ms: t1_to_t3,
      t3_assigned_to_ready_ms: t3_to_t5,
      t5_ready_to_playback_ms: t5_to_t8,
      t8_playback_to_first_frame_ms: t8_to_t7,
      type,
      platform: Platform.OS,
    });
  }, [type, setDebouncedBuffering, player]);

  const isPlaying = (playerState === 'PLAYING' || playerState === 'LOADING' || playerState === 'BUFFERING' || playerState === 'RETRYING') && playerState !== 'PAUSED' && playerState !== 'ERROR';
  const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR' && (
    playerState === 'LOADING' ||
    playerState === 'BUFFERING' ||
    playerState === 'RETRYING' ||
    (isBufferingUI && playerState !== 'PLAYING')
  );

  const videoViewProps = useMemo(() => getPlatformVideoViewProps({ contentFit, isMini: false }), [contentFit]);

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Video Viewport (bounded container) */}
      <View style={styles.videoViewport}>
        <View
          ref={viewportRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          onLayout={(e) => measureAndLogLayout('PlayerScreen:videoViewport', viewportRef, e.nativeEvent.layout, insets)}
        />
        {/* Layer 1: Unified Dual Playback Video Surface */}
        <View
          ref={videoSurfaceRef}
          style={[StyleSheet.absoluteFill, styles.videoSurface]}
          pointerEvents="none"
          onLayout={(e) => measureAndLogLayout('PlayerScreen:videoSurface', videoSurfaceRef, e.nativeEvent.layout, insets)}
        >
          <UnifiedVideoSurface
            style={StyleSheet.absoluteFill}
            activeEngineType={activeEngineType}
            nativePlayer={player}
            vlcPlayer={vlcPlayer}
            contentFit={contentFit}
            isMini={false}
            isSwitching={isSwitchingEngine}
            allowsPictureInPicture
            onFirstFrameRender={handleFirstFrameRender}
            {...videoViewProps}
          />
        </View>

        {/* Unified Interactive Overlay Layer */}
        {playerState !== 'ERROR' && (
          <View style={styles.unifiedOverlay} pointerEvents="box-none">
            <View
              ref={unifiedOverlayRef}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              onLayout={(e) => measureAndLogLayout('PlayerScreen:unifiedOverlay', unifiedOverlayRef, e.nativeEvent.layout, insets)}
            />
            {/* Layer 2: VLC-Style Master Gesture Overlay (Brightness on Left, Volume on Right) */}
            <PlayerGestureOverlay
              brightness={brightness}
              setBrightness={setBrightness}
              volume={volume}
              setVolume={setVolume}
              onSingleTap={toggleControls}
              onDoubleTapLeft={handleRewind}
              onDoubleTapRight={handleForward}
              onGestureStart={handleGestureStart}
              onGestureEnd={handleGestureEnd}
              disabled={playerState === 'ERROR'}
              controlsVisible={controlsVisible}
              insets={insets}
              onHudChange={setGestureHud}
            />

            {/* Layer 7: Unified 3-Zone Player Controls */}
            <View
              ref={controlsContainerRef}
              style={styles.controlsContainer}
              pointerEvents={controlsVisible ? 'box-none' : 'none'}
              onLayout={(e) => measureAndLogLayout('PlayerScreen:controlsContainer', controlsContainerRef, e.nativeEvent.layout, insets)}
            >
              <PlayerControls
                opacityAnim={controlsOpacity}
                isPlaying={isPlaying}
                onTogglePlay={togglePlay}
                title={title}
                type={type || 'movie'}
                isLive={isLive}
                canSeek={!isLive}
                currentTime={currentTime}
                duration={isLive ? 0 : duration}
                onSeek={handleSeek}
                onSeekingChange={handleSeekingChange}
                onRewind={handleRewind}
                onForward={handleForward}
                isMuted={isMuted}
                onToggleMute={toggleMute}
                playbackSpeed={SPEEDS[playbackSpeedIndex]}
                onCycleSpeed={cycleSpeed}
                contentFit={contentFit}
                onCycleFit={cycleFitMode}
                onBack={handleBack}
                onBackdropPress={toggleControls}
                insets={insets}
                isMini={false}
                streamId={streamId}
                extension={extension}
                url={url}
                poster={poster}
                isBuffering={isWaitingForMedia}
                bufferingLabel={playerState === 'RETRYING' ? 'Connecting fallback stream...' : (playerState === 'LOADING' ? 'Connecting stream...' : 'Buffering...')}
                gestureHud={gestureHud}
                availableAudioTracks={availableAudioTracks}
                selectedAudioTrack={selectedAudioTrack}
                onSelectAudioTrack={handleSelectAudioTrack}
                availableSubtitleTracks={availableSubtitleTracks}
                selectedSubtitleTrack={selectedSubtitleTrack}
                onSelectSubtitleTrack={handleSelectSubtitleTrack}
                subtitleSize={subtitleSize}
                onSelectSubtitleSize={handleSelectSubtitleSize}
                onBeforeOpenTrackModal={handleBeforeOpenTrackModal}
                activeEngineType={activeEngineType}
                engineMode={engineMode}
                onOpenEngineModal={undefined}
              />
            </View>
          </View>
        )}

        {/* Layer 4: Seek HUD Feedback Badge */}
        {seekFeedback && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.seekFeedbackBox,
              {
                opacity: seekFeedbackAnim,
                transform: [{ scale: seekFeedbackScale }],
              },
            ]}
          >
            <Text style={styles.seekFeedbackText}>{seekFeedback.text}</Text>
          </Animated.View>
        )}

        {/* Layer 4.5: Independent Buffering & Loading Overlay */}
        {playerState !== 'ERROR' && playerState !== 'PAUSED' && (
          <View style={styles.bufferingOverlay} pointerEvents="none">
            <View style={styles.bufferingCenterBox}>
              <BufferingIndicator
                visible={isWaitingForMedia && playerState !== 'PAUSED'}
                size={54}
                strokeWidth={3.8}
                isMini={false}
                showLabel={true}
                labelText={playerState === 'RETRYING' ? 'Connecting fallback stream...' : (playerState === 'LOADING' ? 'Connecting stream...' : 'Buffering...')}
              />
            </View>
          </View>
        )}

        {playerState === 'ERROR' && (
          <BrokenVideoView
            title={errorDetails?.heading || 'Unable to Play Video'}
            heading={errorDetails?.heading || 'Unable to Play Video'}
            errorMessage={errorDetails?.exactError || errorDetails?.message || errorMessage || 'Something went wrong while playing this video.'}
            message={errorDetails?.message || errorMessage || 'Something went wrong while playing this video.'}
            exactError={errorDetails?.exactError}
            errorCode={errorDetails?.errorCode}
            explanation={errorDetails?.explanation || 'This video may be temporarily unavailable. Please try again.'}
            canRetry={errorDetails ? errorDetails.canRetry : true}
            onRetry={handleRetry}
            onBack={handleBack}
            onSwitchEngine={
              (activeEngineType === ENGINE_TYPE.VLC || probeVlcNativeAvailability().available)
                ? () => {
                    try {
                      const target = activeEngineType === ENGINE_TYPE.NATIVE ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
                      switchEngine(target, ENGINE_SWITCH_REASON.USER_RETRY);
                    } catch (_e) {}
                  }
                : null
            }
            switchEngineLabel={activeEngineType === ENGINE_TYPE.NATIVE ? 'Try Playing with VLC Engine' : 'Try Playing with Native Engine'}
            isMini={false}
            insets={insets}
          />
        )}
      </View>

      {/* Layer 6: Error / Switch Toast */}
      <PlayerErrorToast
        message={toastMessage}
        type={toastType}
        visible={showToast}
        onDismiss={() => {
          setShowToast(false);
          setToastMessage(null);
        }}
        bottomOffset={controlsVisible ? 110 : 36}
      />

      {/* Layer 8: Global Toast notifications */}
      <GlobalToast bottomOffset={controlsVisible ? 110 : 36} />

      {/* Layer 9: Dual Playback Engine Selection Modal */}
      <PlaybackEngineModal
        visible={showEngineModal}
        activeEngineType={activeEngineType}
        engineMode={engineMode}
        isSwitching={isSwitchingEngine}
        onSelectMode={async (mode) => {
          try {
            setEngineMode(mode);
            await savePlayerSettings({ preferredEngine: mode });
            const vlcAvail = probeVlcNativeAvailability().available;
            let target = activeEngineType;
            if (mode === ENGINE_MODE.VLC) {
              target = ENGINE_TYPE.VLC;
            } else if (mode === ENGINE_MODE.NATIVE) {
              target = ENGINE_TYPE.NATIVE;
            } else if (mode === ENGINE_MODE.AUTO) {
              target = (vlcAvail && (isMkvStream || (Platform.OS === 'ios' && isLive && isTsStream))) ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
            }
            if (target !== activeEngineType) {
              await switchEngine(target, ENGINE_SWITCH_REASON.MANUAL_SWITCH);
            }
          } catch (_e) {}
        }}
        onClose={() => setShowEngineModal(false)}
        onDismiss={() => setShowEngineModal(false)}
      />

      <SeriesNextEpisodeOverlay
          visible={Boolean(nextEpisodeOffer)}
          episodeFinished={Boolean(nextEpisodeOffer?.episodeFinished)}
          seriesTitle={nextEpisodeOffer?.seriesTitle || ''}
          episodeLabel={nextEpisodeOffer?.episodeLabel || 'Next episode'}
          posterUri={nextEpisodeOffer?.posterUri}
          posterItem={nextEpisodeOffer?.posterItem}
          serverUrl={nextEpisodeOffer?.serverUrl}
          onPlayNow={playNextEpisodeNow}
          onCancel={dismissNextEpisodeOffer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  gestureRow: {
    flex: 1,
    flexDirection: 'row',
  },
  gestureHalf: {
    flex: 1,
    height: '100%',
  },
  seekFeedbackBox: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    backgroundColor: 'rgba(18, 18, 20, 0.94)',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: Colors.brand.primary,
    zIndex: 25,
  },
  seekFeedbackText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  videoSurface: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  bufferingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
    elevation: 40,
  },
  bufferingCenterBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlsContainer: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    zIndex: 30,
    elevation: 30,
  },
  videoViewport: {
    ...StyleSheet.absoluteFillObject,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  unifiedOverlay: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    zIndex: 20,
    elevation: 20,
  },
});
