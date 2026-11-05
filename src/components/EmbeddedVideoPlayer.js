import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  AppState,
  Platform,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Colors from '../constants/colors';
import { useApp } from '../state/AppContext';
import { API_BASE_URL } from '../constants/index.js';
import BrokenVideoView from './BrokenVideoView';
import PlayerErrorToast from './PlayerErrorToast';
import PlayerControls from './PlayerControls';
import BufferingIndicator from './BufferingIndicator';
import PlayerGestureOverlay from './PlayerGestureOverlay';
import usePlayerBrightness from '../hooks/usePlayerBrightness';
import usePlayerVolume from '../hooks/usePlayerVolume';
import {
  classifyPlayerError,
  getErrorDisplayDetails,
  evaluatePlayerErrorPopupPolicy,
  logClassifiedPlayerError,
  isConfirmedServerError,
  isFatalNativePlayerError,
  ERROR_POPUP_CATEGORY,
} from '../utils/playerErrorMapper';
import {
  validateStreamSource,
  detectContentType,
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
  applyActiveEngineAudio,
  resumeActiveEnginePlayback,
  cancelPostResumeAudioSync,
  silenceNativeCompanionPlayer,
} from '../utils/activeEngineAudio.js';
import {
  applyFixedSubtitles,
  reapplyFixedNativeSubtitleStyleWithRetries,
} from '../utils/subtitleAppearance.js';
import {
  collectPlaybackMediaTracks,
  normalizeAudioTrackList,
  normalizeSubtitleTrackList,
} from '../utils/mediaTracks.js';
import { PlaybackController } from '../playback/PlaybackController.js';
import { getPlatformPlayer } from '../playback/PlatformPlayer.js';
import { ENGINE_TYPE, ENGINE_MODE, ENGINE_SWITCH_REASON } from '../playback/playbackTypes.js';
import { DualPlaybackCoordinator } from '../playback/engines/DualPlaybackCoordinator.js';
import UnifiedVideoSurface from '../playback/components/UnifiedVideoSurface.js';
import PlaybackEngineModal from './PlaybackEngineModal.js';
import { readCache, writeCache } from '../storage/cacheStorage.js';
import {
  getPlayerSettings,
  savePlayerSettings,
  subscribePlayerSettings,
  probeVlcNativeAvailability,
  validateEngineSelection,
} from '../playback/playerSettings.js';
import { measureAndLogLayout } from '../utils/layoutDiagnostics';

let vlcModule = null;
try {
  const vlcProbe = probeVlcNativeAvailability();
  if (vlcProbe.available) {
    vlcModule = require('rn-vlc-plyr');
  }
} catch (_e) {
  vlcModule = null;
}

/**
 * FOX PLAYER — Unified Live TV & Media Player Component
 *
 * Supports both 'mini' and 'expanded' modes seamlessly using the SAME underlying VideoView/player instance.
 * Optimized for iOS Live TV:
 * 1. Race-safe channel switching with monotonic session tokens.
 * 2. Instant previous stream pause to release audio slots and avoid background playback.
 * 3. AVPlayer cancellation (-999) error suppression on channel change.
 * 4. Stale timer/watchdog invalidation per media session.
 * 5. Clean blackout layer until first native video frame renders (eliminates frame ghosting).
 * 6. Responsive controls with progress bar and DVR seeking support.
 * 7. Buffering indicator synchronization that never overlays uninterrupted video.
 */
export default function EmbeddedVideoPlayer({
  url,
  source = null,
  resolvedSource = null,
  title,
  channel = null,
  streamId = '',
  extension = '',
  mode = 'mini', // 'mini' | 'expanded'
  onExpand,
  onMinimize,
  onClose,
  isFocused = true,
  insets = { top: 0, bottom: 0, left: 0, right: 0 },
  topAnim = null,
  centerAnim = null,
  bottomAnim = null,
  player: externalPlayer = null,
  recreatePlayer = null,
}) {
  const { showPlaylistExpiredDialog, activePlaylistId, activePlaylist } = useApp() || {};
  const isMini = mode === 'mini';

  const viewportRef = useRef(null);
  const videoSurfaceRef = useRef(null);
  const unifiedOverlayRef = useRef(null);
  const controlsContainerRef = useRef(null);

  // Extract raw URI from multiple input shapes
  const rawUri = resolvedSource?.uri || (typeof source === 'string' ? source : source?.uri) || url || '';
  const currentStreamId = streamId || channel?.id || channel?.streamId || resolvedSource?.streamId || '';
  
  // Single-pass platform stream preparation (preserves authentic direct streams)
  const sanitizedUri = useMemo(() => {
    const candidateUri = resolvedSource?.uri || rawUri;
    return prepareStreamUrlForPlatform(candidateUri, {
      type: 'live',
      extension: extension || resolvedSource?.extension || '',
      streamId: currentStreamId,
    });
  }, [rawUri, extension, currentStreamId, resolvedSource?.uri, resolvedSource?.extension]);

  // Strict Source Validation: NEVER pass null, undefined, empty, or placeholder strings to native player
  const validation = useMemo(() => {
    if (resolvedSource && resolvedSource.isValid && resolvedSource.uri) {
      return { isValid: true, error: null, uri: resolvedSource.uri };
    }
    return validateStreamSource(sanitizedUri);
  }, [resolvedSource, sanitizedUri]);

  // Explicit content type detection (e.g. 'hls', 'progressive', 'auto')
  const contentType = useMemo(() => {
    if (resolvedSource?.contentType && resolvedSource.contentType !== 'auto') {
      return resolvedSource.contentType;
    }
    return detectContentType(validation.uri || sanitizedUri, { type: 'live', extension });
  }, [resolvedSource, validation.uri, sanitizedUri, extension]);

  // Normalized VideoSourceObject for expo-video
  const playerSource = useMemo(() => {
    if (resolvedSource?.playerSource) return resolvedSource.playerSource;
    if (!validation.isValid || !validation.uri) return null;
    const streamHeaders = resolvedSource?.headers || {
      'User-Agent': DEFAULT_IPTV_USER_AGENT,
    };
    return {
      uri: validation.uri,
      ...(contentType !== 'auto' ? { contentType } : {}),
      headers: streamHeaders,
      metadata: {
        title: title || channel?.name || 'Live Channel',
        ...(channel?.logo ? { artwork: channel.logo } : {}),
      },
    };
  }, [resolvedSource, validation, contentType, title, channel]);

  // Extract initial error state from externalPlayer if shared across mini/max transitions
  const initialError = (externalPlayer && externalPlayer._playbackError && externalPlayer._errorUri === sanitizedUri)
    ? externalPlayer._playbackError
    : null;

  const isSameStreamAsExternal = externalPlayer && externalPlayer._activeUri === sanitizedUri;
  const initialPlayerState = initialError
    ? 'ERROR'
    : (!validation.isValid
        ? 'ERROR'
        : (isSameStreamAsExternal && externalPlayer._playerState ? externalPlayer._playerState : 'LOADING')
      );

  const initialHasPlayed = isSameStreamAsExternal ? Boolean(externalPlayer?._hasEverPlayed) : false;
  const initialIsBuffering = initialError
    ? false
    : (!validation.isValid
        ? false
        : (initialPlayerState === 'LOADING' || initialPlayerState === 'BUFFERING' || initialPlayerState === 'RETRYING')
      );

  // State machine: 'LOADING' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ERROR' | 'RETRYING'
  const [playerState, setPlayerState]         = useState(initialPlayerState);
  const [isBufferingUI, setIsBufferingUI]     = useState(initialIsBuffering);
  const [errorMessage, setErrorMessage]       = useState(initialError ? initialError.userMessage : (validation.isValid ? null : 'Stream unavailable'));
  const [errorDetails, setErrorDetails]       = useState(initialError ? getErrorDisplayDetails(initialError) : null);
  const [toastMessage, setToastMessage]       = useState(null);
  const [showToast, setShowToast]             = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [contentFit, setContentFit]           = useState('contain');
  const [seekFeedback, setSeekFeedback]       = useState(null);
  const [hasFirstFrame, setHasFirstFrame]     = useState(initialHasPlayed);
  const [currentTime, setCurrentTime]         = useState(0);
  const [duration, setDuration]               = useState(0);
  const [gestureHud, setGestureHud]           = useState(null);
  const [availableAudioTracks, setAvailableAudioTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack]     = useState(null);
  const [availableSubtitleTracks, setAvailableSubtitleTracks] = useState([]);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack]     = useState(null);
  const userSelectedSubtitleRef                         = useRef(false);

  // Stable mutable refs for race-condition safety
  const playbackIntentRef   = useRef(initialPlayerState === 'PAUSED' ? 'PAUSED' : 'PLAYING');
  const playerStateRef      = useRef(playerState);
  const userPausedRef       = useRef(initialPlayerState === 'PAUSED');
  const pausedAtRef         = useRef(0);
  const isFocusedRef        = useRef(isFocused);
  const isSeekingRef        = useRef(false);
  const controlsVisibleRef  = useRef(controlsVisible);
  const currentTimeRef      = useRef(0);
  const lastRenderedTimeRef = useRef(0);
  const durationRef         = useRef(0);

  const isAlreadyActiveOnExternal = Boolean(externalPlayer && externalPlayer._activeUri && externalPlayer._activeUri === sanitizedUri);
  const currentUrlRef        = useRef(isAlreadyActiveOnExternal ? sanitizedUri : null);
  const requestCounterRef    = useRef(0);
  const activeSessionIdRef   = useRef(channel?.sessionId || null);
  const isReplacingSourceRef = useRef(false);
  const replaceQueueRef      = useRef(Promise.resolve());
  const autoRecoveryAttemptedRef = useRef(false);
  const readinessPollerRef   = useRef(null);
  const watchdogTimerRef     = useRef(null);
  const loadTimeoutRef       = useRef(null);
  const stallTimeoutRef      = useRef(null);
  const verifyPlaybackRef    = useRef(null);
  const hasEverPlayedRef     = useRef(initialHasPlayed);
  const midStreamStallTimerRef = useRef(null);
  const midStreamPollerRef     = useRef(null);
  const midStreamBufferStartRef = useRef(0);
  const midStreamRecoveryStageRef = useRef('NONE');
  const midStreamReloadAttemptedForEpisodeRef = useRef(false);
  const lastMidStreamReloadTimeRef = useRef(0);
  const attemptedFallbackUrlsRef = useRef(new Set());
  const fallbackAttemptedRef = useRef(false);
  const bufferTimerRef      = useRef(null);
  const bufferStartRef      = useRef(0);
  const lastToastedAttemptIdRef = useRef(externalPlayer?._lastToastedAttemptId || null);
  const lastPlaybackTimeRef = useRef(-1);
  const lastAdvanceTimeRef  = useRef(0);
  const isTogglingPlayRef   = useRef(false);
  const manualResumeUntilRef = useRef(0);
  const isRetryingRef       = useRef(false);
  const isSeekingSettlingRef = useRef(false);
  const seekTargetTimeRef   = useRef(null);
  const seekCounterRef      = useRef(0);
  const seekWatchdogRef     = useRef(null);
  const wasPlayingBeforeSeekRef = useRef(false);
  const completeSeekRef     = useRef(null);
  const controlsTimeout     = useRef(null);
  const lastTapRef          = useRef({ time: 0, side: null });
  const lastErrorRef        = useRef(null);
  const seekFeedbackAnimRef = useRef(new Animated.Value(0));
  const controlsOpacityRef  = useRef(new Animated.Value(1));
  const timingRef           = useRef({
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
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  // LIVE TV: Initialize stable player instance (created ONCE via null source to avoid render-cycle churn)
  const internalPlayer = useVideoPlayer(null, (p) => {
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
  });

  const player = externalPlayer || internalPlayer;

  // Dual Playback Engine state - respect stored user settings immediately on mount
  const isMkvStream = Boolean(
    extension === 'mkv' ||
    (/\.mkv(\?.*)?$/i.test(sanitizedUri || ''))
  );
  const isTsStream = Boolean(
    extension === 'ts' ||
    (/\.ts(\?.*)?$/i.test(rawUri || '')) ||
    (rawUri || '').includes('output=ts') ||
    channel?.containerExtension === 'ts'
  );
  const initialSettings = getPlayerSettings();
  const initialEnginePref = initialSettings.preferredEngine || ENGINE_MODE.AUTO;
  const initialVlcAvailable = Boolean(probeVlcNativeAvailability().available);
  const [engineMode, setEngineMode]               = useState(initialEnginePref);
  const [activeEngineType, setActiveEngineType]   = useState(() => {
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
    if (initialVlcAvailable && (isMkvStream || (Platform.OS === 'ios' && isTsStream))) {
      return ENGINE_TYPE.VLC;
    }
    return ENGINE_TYPE.NATIVE;
  });
  const [showEngineModal, setShowEngineModal]     = useState(false);
  const handleOpenEngineModal                     = useCallback(() => setShowEngineModal(true), []);
  const vlcAttemptsRef                            = useRef(0);
  const nativeAttemptsRef                         = useRef(0);
  const activeEngineTypeRef                       = useRef(activeEngineType);
  const [isSwitchingEngine, setIsSwitchingEngine] = useState(false);
  const isSwitchingEngineRef                      = useRef(false);
  const switchWatchdogRef                         = useRef(null);
  const pendingVlcResumeTimeRef                   = useRef(null);
  const [toastType, setToastType]                 = useState('error');
  const toastTypeRef                              = useRef('error');
  useEffect(() => {
    toastTypeRef.current = toastType;
  }, [toastType]);
  const seekTargetTimestampRef                    = useRef(0);
  const pendingSeekTimeRef                        = useRef(null);

  useEffect(() => {
    activeEngineTypeRef.current = activeEngineType;
  }, [activeEngineType]);

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
      logPlayerDiagnostic('embeddedVlcPlayerInitError', { error: err?.message });
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
      logPlayerDiagnostic('embeddedVlcPlayerInitError', { error: err?.message });
    }
    return null;
  }, [vlcPlayer, setVlcPlayer]);

  const vlcPlayerRef = useRef(vlcPlayer);
  useEffect(() => {
    vlcPlayerRef.current = vlcPlayer;
  }, [vlcPlayer]);

  useEffect(() => {
    applyFixedSubtitles({ activeEngineType: activeEngineTypeRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed captions once on mount
  }, []);

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

  // Synchronize stream source to VLC engine whenever activeEngineType is VLC and vlcPlayer is ready
  useEffect(() => {
    if (activeEngineType !== ENGINE_TYPE.VLC || !vlcPlayer) return;
    const streamUri = rawUri || validation.uri || sanitizedUri;
    if (!streamUri) return;

    if (!vlcPlayer.source || vlcPlayer.source?.uri !== streamUri) {
      try {
        playerStateRef.current = 'LOADING';
        setPlayerState('LOADING');
        setIsBufferingUI(true);
        setDebouncedBuffering(true);
        if (!isSwitchingEngineRef.current) {
          setHasFirstFrame(false);
        }
        vlcPlayer.muted = false;
        vlcPlayer.autoPlay = true;
        vlcPlayer.source = {
          uri: streamUri,
          userAgent: DEFAULT_IPTV_USER_AGENT,
          vlcOptions: getPlatformVlcOptions({ isLive: true }),
          title: title || channel?.name || 'Live Channel',
        };
        try { vlcPlayer.play(); } catch (_e) {}
        try {
          silenceNativeCompanionPlayer(player);
        } catch (_e) {}
      } catch (_vlcErr) {}
    }
  }, [vlcPlayer, activeEngineType, validation.uri, sanitizedUri, title, channel, player, setDebouncedBuffering]);

  // Bind VLC player event listeners
  useEffect(() => {
    if (!vlcPlayer) return;
    const subs = [];
    try {
      if (typeof vlcPlayer.addOnStatusChangeListener === 'function') {
        const sub = vlcPlayer.addOnStatusChangeListener((status) => {
          if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC) return;
          if (status === 'playing') {
            applyActiveEngineAudio({
              activeEngineType: ENGINE_TYPE.VLC,
              vlcPlayer,
              nativePlayer: player,
              volume: volumeRef.current,
              isMuted: isMutedRef.current,
              muteInactiveNative: false,
            });
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
              if (pendingVlcResumeTimeRef.current > 0) {
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
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
            setErrorMessage(null);
            if (toastTypeRef.current === 'error') {
              setShowToast(false);
              setToastMessage(null);
            }
            confirmPlaybackActive(requestCounterRef.current);
          } else if (status === 'buffering' || status === 'opening') {
            if (isSwitchingEngineRef.current) return;
            const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
            playerStateRef.current = nextState;
            setPlayerState(nextState);
            setIsBufferingUI(true);
            setDebouncedBuffering(true);
          } else if (status === 'paused') {
            if (isSwitchingEngineRef.current) return;
            playerStateRef.current = 'PAUSED';
            setPlayerState('PAUSED');
            setIsBufferingUI(false);
          } else if (status === 'error') {
            if (isSwitchingEngineRef.current) return;
            playerStateRef.current = 'ERROR';
            setPlayerState('ERROR');
            setIsBufferingUI(false);
          }
        });
        if (sub?.remove) subs.push(() => sub.remove());
      }

      if (typeof vlcPlayer.addOnTimeUpdateListener === 'function') {
        const sub = vlcPlayer.addOnTimeUpdateListener((event) => {
          if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC) return;
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
              // Ignore stale pre-seek PTS ticks emitted while LibVLC is demuxing the new position
              return;
            }
          }
          currentTimeRef.current = currSec;
          const lastSec = lastRenderedTimeRef.current || 0;
          if (controlsVisibleRef.current || isSeekingSettlingRef.current) {
            if (Math.abs(currSec - lastSec) >= 0.25 || isSeekingSettlingRef.current) {
              lastRenderedTimeRef.current = currSec;
              setCurrentTime(currSec);
            }
          }
          if (durSec > 1.0 && Math.abs(durSec - durationRef.current) > 1.0) {
            durationRef.current = durSec;
            setDuration(durSec);
          }
          if (currSec > 0 && !hasFirstFrame) {
            setHasFirstFrame(true);
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          }
        });
        if (sub?.remove) subs.push(() => sub.remove());
      }

      if (typeof vlcPlayer.addOnLoadedListener === 'function') {
        const sub = vlcPlayer.addOnLoadedListener((loadedInfo) => {
          if (activeEngineTypeRef.current !== ENGINE_TYPE.VLC || isSwitchingEngineRef.current) return;
          const durSec = (loadedInfo.duration || 0) / 1000;
          if (durSec > 0) setDuration(durSec);
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
          applyFixedSubtitles({ activeEngineType: ENGINE_TYPE.VLC });
          confirmPlaybackActive(requestCounterRef.current);
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
          logPlayerDiagnostic('embeddedVlcPlaybackError', { playbackEngine: 'vlc', error: err });
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
  }, [vlcPlayer, engineMode, switchEngine, setDebouncedBuffering, confirmPlaybackActive, hasFirstFrame, triggerErrorState]);

  // Seamless dual engine switcher
  const switchEngine = useCallback(async (targetEngineType, reason = ENGINE_SWITCH_REASON.MANUAL_SWITCH) => {
    if (activeEngineTypeRef.current === targetEngineType && playerStateRef.current === 'PLAYING') return;

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

    const fromEngine = activeEngineTypeRef.current;
    logPlayerDiagnostic('embeddedEngineSwitch', { from: fromEngine, to: targetEngineType, reason });

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

      if (targetEngineType === ENGINE_TYPE.VLC) {
        const vlcProbe = probeVlcNativeAvailability();
        const activeVlc = vlcPlayer || getOrCreateVlcPlayer();
        if (!vlcProbe.available || !activeVlc) {
          logPlayerDiagnostic('embeddedEngineSwitchBlockedVlcUnavailable', { reason: vlcProbe.reason });
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
        const vlcUri = resolvedSource?.rawUrl || resolvedSource?.originalUrl || rawUri || sanitizedUri;
        if (activeVlc && vlcUri) {
          try {
            if (resumeTime > 0) {
              pendingVlcResumeTimeRef.current = resumeTime;
            } else {
              pendingVlcResumeTimeRef.current = null;
            }
            activeVlc.muted = false;
            activeVlc.autoPlay = true;
            activeVlc.source = {
              uri: vlcUri,
              userAgent: DEFAULT_IPTV_USER_AGENT,
              vlcOptions: getPlatformVlcOptions({ isLive: true }),
              title: title || channel?.name || 'Live Channel',
            };
            try { activeVlc.play(); } catch (_e) {}

            setToastType('switch');
            setToastMessage('Switched to VLC Player Engine');
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2400);
          } catch (_vlcErr) {}
        }
      } else {
        if (player && playerSource) {
          try {
            player.muted = false;
            if (typeof player.replaceAsync === 'function') {
              player.replaceAsync(playerSource).then(() => {
                player.play();
                if (resumeTime > 0) {
                  try { player.currentTime = resumeTime; } catch (_e) {}
                }
              }).catch(() => {});
            } else {
              player.replace(playerSource);
              player.play();
              if (resumeTime > 0) {
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
      logPlayerDiagnostic('embeddedEngineSwitchError', { error: _switchErr?.message });
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
  }, [player, vlcPlayer, getOrCreateVlcPlayer, sanitizedUri, playerSource, title, channel, setDebouncedBuffering]);

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
          target = (probe.available && (isMkvStream || (Platform.OS === 'ios' && isTsStream))) ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
        }
        if (target !== activeEngineType) {
          switchEngine(target, ENGINE_SWITCH_REASON.SETTINGS_SYNC);
        }
      }
    });
    return unsub;
  }, [switchEngine, activeEngineType, isMkvStream, isTsStream]);

  // Screen brightness management with lifecycle restoration (active in expanded mode)
  const { brightness, setBrightness } = usePlayerBrightness({ enabled: !isMini });

  const hardwareHudTimerRef = useRef(null);

  const handleVolumeChange = useCallback((newVol, info) => {
    applyActiveEngineAudio({
      activeEngineType: activeEngineTypeRef.current,
      vlcPlayer: vlcPlayerRef.current,
      nativePlayer: player,
      volume: newVol,
      isMuted: newVol === 0 || isMutedRef.current,
    });
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
  }, [player]);

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
    getShouldSyncToPlayer: () => activeEngineTypeRef.current === ENGINE_TYPE.NATIVE,
  });
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (activeEngineType !== ENGINE_TYPE.VLC || !vlcPlayer) return;
    applyActiveEngineAudio({
      activeEngineType: ENGINE_TYPE.VLC,
      vlcPlayer,
      nativePlayer: player,
      volume,
      isMuted,
      muteInactiveNative: false,
    });
  }, [activeEngineType, vlcPlayer, player, volume, isMuted]);

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
        controller.attachPlayer(player, { type: 'live', isLive: true });
        const bufferOpts = getPlatformBufferOptions({ type: 'live', isLive: true, platform: Platform.OS });
        const opts = getPlatformPlayerOptions({ type: 'live', isLive: true });
        player.staysActiveInBackground = false;
        const currentVol = volumeRef.current;
        if (typeof currentVol === 'number' && !isNaN(currentVol)) {
          player.volume = currentVol;
          player.muted = Boolean(isMutedRef.current || currentVol === 0);
        } else {
          player.muted = false;
          player.volume = 1.0;
        }
        if (bufferOpts || opts.bufferOptions) {
          player.bufferOptions = bufferOpts || opts.bufferOptions;
        }
      } catch (_e) {}
    }
  }, [player, controller]);

  // Handle AppState changes — pauses immediately on background/inactive, and resumes on active if focused
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        if (
          isFocusedRef?.current &&
          playbackIntentRef.current === 'PLAYING' &&
          !userPausedRef.current
        ) {
          const activeVlc = vlcPlayerRef.current;
          if (activeEngineTypeRef.current === ENGINE_TYPE.VLC && activeVlc && !activeVlc.playing) {
            resumeActiveEnginePlayback({
              activeEngineType: ENGINE_TYPE.VLC,
              vlcPlayer: activeVlc,
              nativePlayer: player,
              volume: volumeRef.current,
              isMuted: isMutedRef.current,
            });
          } else if (
            player &&
            !player.playing &&
            player.status === 'readyToPlay'
          ) {
            resumeActiveEnginePlayback({
              activeEngineType: ENGINE_TYPE.NATIVE,
              nativePlayer: player,
              volume: volumeRef.current,
              isMuted: isMutedRef.current,
            });
          }
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (player) {
          try {
            player.pause();
          } catch (_e) {}
        }
        const activeVlc = vlcPlayerRef.current;
        if (activeEngineTypeRef.current === ENGINE_TYPE.VLC && activeVlc) {
          try {
            activeVlc.pause();
          } catch (_e) {}
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
    };
  }, [player]);

  // Debounced buffering state manager — eliminates rapid flicker
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const setDebouncedBuffering = useCallback((buffering) => {
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }

    if (buffering) {
      bufferTimerRef.current = setTimeout(() => {
        bufferStartRef.current = Date.now();
        setIsBufferingUI(true);
      }, 100);
    } else {
      const elapsed = Date.now() - bufferStartRef.current;
      const minDisplayMs = 280;
      const remaining = Math.max(0, minDisplayMs - elapsed);

      bufferTimerRef.current = setTimeout(() => {
        setIsBufferingUI(false);
      }, remaining);
    }
  }, []);

  const cancelMidStreamRecovery = useCallback(() => {
    if (midStreamStallTimerRef.current) {
      clearTimeout(midStreamStallTimerRef.current);
      midStreamStallTimerRef.current = null;
    }
    if (midStreamPollerRef.current) {
      clearInterval(midStreamPollerRef.current);
      midStreamPollerRef.current = null;
    }
    if (midStreamBufferStartRef.current > 0) {
      const durationMs = Date.now() - midStreamBufferStartRef.current;
      logPlayerDiagnostic('liveMidPlaybackBufferingRecovered', {
        streamId,
        reqId: requestCounterRef.current,
        platform: Platform.OS,
        durationMs,
        stage: midStreamRecoveryStageRef.current,
      });
    }
    midStreamBufferStartRef.current = 0;
    midStreamRecoveryStageRef.current = 'NONE';
    midStreamReloadAttemptedForEpisodeRef.current = false;
  }, [streamId]);

  const clearAllWatchdogs = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (stallTimeoutRef.current) {
      clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
    }
    if (verifyPlaybackRef.current) {
      clearTimeout(verifyPlaybackRef.current);
      verifyPlaybackRef.current = null;
    }
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    if (readinessPollerRef.current) {
      clearInterval(readinessPollerRef.current);
      readinessPollerRef.current = null;
    }
    if (midStreamStallTimerRef.current) {
      clearTimeout(midStreamStallTimerRef.current);
      midStreamStallTimerRef.current = null;
    }
    if (midStreamPollerRef.current) {
      clearInterval(midStreamPollerRef.current);
      midStreamPollerRef.current = null;
    }
    midStreamBufferStartRef.current = 0;
    midStreamRecoveryStageRef.current = 'NONE';
    midStreamReloadAttemptedForEpisodeRef.current = false;
  }, []);

  // Confirm active playback and dismiss all buffering/loading UI
  const confirmPlaybackActive = useCallback((opReqId = null) => {
    if (opReqId !== null && opReqId !== requestCounterRef.current) {
      return;
    }
    if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
      return;
    }

    cancelMidStreamRecovery();
    clearAllWatchdogs();
    hasEverPlayedRef.current = true;
    setHasFirstFrame(true);
    playerStateRef.current = 'PLAYING';
    setPlayerState('PLAYING');
    if (externalPlayer) {
      externalPlayer._playerState = 'PLAYING';
      externalPlayer._hasEverPlayed = true;
    }
    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    setIsBufferingUI(false);
    setDebouncedBuffering(false);

    // Apply steady-state buffer options on iOS for mid-stream stability and stall minimization
    if (Platform.OS === 'ios' && player) {
      try {
        const steadyOpts = getPlatformBufferOptions({
          type: 'live',
          isLive: true,
          platform: 'ios',
          enableStallRecovery: true,
        });
        if (steadyOpts) {
          player.bufferOptions = steadyOpts;
        }
      } catch (_e) {}
    }

    logPlayerDiagnostic('livePlaybackActiveConfirmed', { reqId: opReqId || requestCounterRef.current, streamId, platform: Platform.OS });
  }, [clearAllWatchdogs, cancelMidStreamRecovery, externalPlayer, setDebouncedBuffering, streamId, player]);

  // Active poller to catch readyToPlay / playing state immediately on iOS AVPlayer
  const startReadinessPoller = useCallback((opReqId) => {
    if (readinessPollerRef.current) {
      clearInterval(readinessPollerRef.current);
      readinessPollerRef.current = null;
    }
    let pollCount = 0;
    readinessPollerRef.current = setInterval(() => {
      pollCount++;
      if (opReqId !== requestCounterRef.current || pollCount > 32) {
        if (readinessPollerRef.current) {
          clearInterval(readinessPollerRef.current);
          readinessPollerRef.current = null;
        }
        return;
      }
      if (!player) return;

      if (player.status === 'readyToPlay' || player.playing) {
        if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current && playerStateRef.current !== 'ERROR') {
          if (!player.playing) {
            try {
              player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
              player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
              player.play();
            } catch (_e) {}
          }
          if (player.playing || (player.currentTime || 0) > 0.05) {
            confirmPlaybackActive(opReqId);
            if (readinessPollerRef.current) {
              clearInterval(readinessPollerRef.current);
              readinessPollerRef.current = null;
            }
          }
        }
      }
    }, 250);
  }, [player, confirmPlaybackActive]);

  // Active watchdog: bounded auto-recovery (1 attempt at 9s) and timeout to ERROR at 18s (eliminates infinite spinner)
  const armActiveRecoveryWatchdog = useCallback((opReqId, targetSource) => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }

    watchdogTimerRef.current = setTimeout(() => {
      if (
        opReqId !== requestCounterRef.current ||
        userPausedRef.current ||
        playbackIntentRef.current === 'PAUSED' ||
        playerStateRef.current === 'PLAYING' ||
        playerStateRef.current === 'ERROR' ||
        player?.playing ||
        hasEverPlayedRef.current
      ) {
        return;
      }

      if (!autoRecoveryAttemptedRef.current) {
        autoRecoveryAttemptedRef.current = true;
        logPlayerDiagnostic('liveAutoRecoveryInitiated', {
          reqId: opReqId,
          streamId,
          platform: Platform.OS,
          status: player?.status,
        });

        // Safe bounded auto-recovery via serialized queue
        replaceQueueRef.current = replaceQueueRef.current.then(async () => {
          if (opReqId !== requestCounterRef.current) return;
          try {
            try { player?.pause(); } catch (_e) {}
            if (Platform.OS === 'ios' && typeof player?.replaceAsync === 'function') {
              try {
                await player.replaceAsync(null);
                await new Promise((resolve) => setTimeout(resolve, 40));
              } catch (_e) {}
            }
            if (opReqId !== requestCounterRef.current) return;
            if (typeof player?.replaceAsync === 'function') {
              await player.replaceAsync(targetSource);
            } else {
              player?.replace(targetSource);
            }
            if (opReqId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
              try { player?.play(); } catch (_e) {}
            }
          } catch (recoveryErr) {
            logPlayerDiagnostic('liveAutoRecoveryError', { reqId: opReqId, error: recoveryErr?.message });
          }
        });

        // Bounded second window: if still not playing after another 9s, transition out of loading to error
        watchdogTimerRef.current = setTimeout(() => {
          if (
            opReqId !== requestCounterRef.current ||
            userPausedRef.current ||
            playbackIntentRef.current === 'PAUSED' ||
            playerStateRef.current === 'PLAYING' ||
            playerStateRef.current === 'ERROR' ||
            player?.playing ||
            hasEverPlayedRef.current
          ) {
            return;
          }

          logPlayerDiagnostic('livePlaybackWatchdogExhausted', {
            reqId: opReqId,
            streamId,
            platform: Platform.OS,
            status: player?.status,
          });

          const vlcProbe = probeVlcNativeAvailability();
          if (engineMode === ENGINE_MODE.AUTO && activeEngineType === ENGINE_TYPE.NATIVE && vlcAttemptsRef.current < 1 && vlcProbe.available) {
            logPlayerDiagnostic('embeddedStartupTimeoutSwitchingToVlc', { opReqId });
            switchEngine(ENGINE_TYPE.VLC, ENGINE_SWITCH_REASON.STARTUP_TIMEOUT);
            return;
          }

          clearAllWatchdogs();
          playerStateRef.current = 'ERROR';
          setPlayerState('ERROR');
          const timeoutMsg = 'Stream took too long to respond. The channel may be offline or buffering heavily.';
          setErrorMessage(timeoutMsg);
          setErrorDetails({
            message: timeoutMsg,
            code: 'STREAM_TIMEOUT',
          });
          setDebouncedBuffering(false);
          setIsBufferingUI(false);
          if (externalPlayer) {
            externalPlayer._playerState = 'ERROR';
            externalPlayer._errorMessage = timeoutMsg;
          }
        }, 9000);
      }
    }, 9000);
  }, [player, streamId, clearAllWatchdogs, externalPlayer, setDebouncedBuffering]);

  // Unified auto-play initiation with verification watchdog
  const initiateAutoPlayback = useCallback((opReqId = null) => {
    const currentReqId = requestCounterRef.current;
    if (opReqId !== null && opReqId !== currentReqId) {
      return;
    }
    if (activeEngineTypeRef.current !== ENGINE_TYPE.NATIVE) {
      return;
    }
    if (Date.now() < manualResumeUntilRef.current) {
      return;
    }
    if (!player || playerStateRef.current === 'ERROR' || userPausedRef.current || playbackIntentRef.current === 'PAUSED' || isSeekingRef.current || isSeekingSettlingRef.current) {
      return;
    }

    timingRef.current.t7_play = Date.now();
    applyActiveEngineAudio({
      activeEngineType: ENGINE_TYPE.NATIVE,
      nativePlayer: player,
      volume: volumeRef.current,
      isMuted: isMutedRef.current,
    });
    try {
      player.play();
    } catch (_e) {}

    if (player.playing) {
      confirmPlaybackActive(currentReqId);
    }

    // Auto-playback verification check: if player is readyToPlay but not playing after 200ms, re-assert play()
    if (verifyPlaybackRef.current) {
      clearTimeout(verifyPlaybackRef.current);
      verifyPlaybackRef.current = null;
    }
    verifyPlaybackRef.current = setTimeout(() => {
      if (
        currentReqId === requestCounterRef.current &&
        activeEngineTypeRef.current === ENGINE_TYPE.NATIVE &&
        Date.now() >= manualResumeUntilRef.current &&
        playbackIntentRef.current === 'PLAYING' &&
        !userPausedRef.current &&
        playerStateRef.current !== 'ERROR' &&
        player
      ) {
        if (player.status === 'readyToPlay' && !player.playing) {
          logPlayerDiagnostic('autoPlayVerificationRetry', { reqId: currentReqId, status: player.status, platform: Platform.OS });
          applyActiveEngineAudio({
            activeEngineType: ENGINE_TYPE.NATIVE,
            nativePlayer: player,
            volume: volumeRef.current,
            isMuted: isMutedRef.current,
          });
          try {
            player.play();
          } catch (_e) {}
          if (player.playing) {
            confirmPlaybackActive(currentReqId);
          }
        }
      }
    }, 200);
  }, [player, confirmPlaybackActive]);

  const triggerErrorState = useCallback((rawError, opId = null) => {
    // Suppress all transient playback errors during engine switching handoff
    if (isSwitchingEngineRef.current) return;
    if (opId !== null && opId !== requestCounterRef.current) {
      // Discard stale error from older channel session
      return;
    }
    const classified = classifyPlayerError(rawError);
    if (classified.category === 'CANCELLED') {
      // Cancellation errors are non-fatal lifecycle transitions
      return;
    }

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
    const isInvalidSource = classified.category === 'INVALID_URL' || (!validation?.isValid && Boolean(rawUri));
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

    clearAllWatchdogs();
    playerStateRef.current = 'ERROR';
    setPlayerState('ERROR');
    const details = getErrorDisplayDetails(rawError);
    setErrorDetails(details);
    const userMsg = details.message || classified.userMessage || 'Unable to play this stream.';
    setErrorMessage(userMsg);
    setDebouncedBuffering(false);
    setIsBufferingUI(false);
    if (externalPlayer) {
      externalPlayer._playerState = 'ERROR';
      externalPlayer._playbackError = classified;
      externalPlayer._errorDetails = details;
      externalPlayer._errorUri = currentUrlRef.current;
      externalPlayer._errorMessage = userMsg;
      externalPlayer._attemptId = currentAttemptId;
    }
    logPlayerDiagnostic('livePlaybackError', {
      category: classified.category,
      technical: classified.technicalMessage,
      streamId,
      attemptId: currentAttemptId,
      platform: Platform.OS,
      popupCategory: popupPolicy.popupCategory,
      shouldShowPopup: popupPolicy.shouldShowPopup,
    });

    // Deduplicate toast: exactly one toast per playback attempt, ONLY when popup is authorized
    const alreadyToastedForAttempt = (lastToastedAttemptIdRef.current === currentAttemptId) ||
      (externalPlayer && externalPlayer._lastToastedAttemptId === currentAttemptId);

    if (!alreadyToastedForAttempt && popupPolicy.shouldShowPopup) {
      lastToastedAttemptIdRef.current = currentAttemptId;
      if (externalPlayer) {
        externalPlayer._lastToastedAttemptId = currentAttemptId;
      }
      setToastType('error');
      setToastMessage('Failed');
      setShowToast(true);
    }
  }, [setDebouncedBuffering, streamId, clearAllWatchdogs, externalPlayer, player, validation, rawUri]);

  // Handle fallback or transition to error with strict stale operation guard
  const handleFallbackOrError = useCallback((err, failedUrl, opId = null) => {
    if (isSwitchingEngineRef.current) return;
    if (opId !== null && opId !== requestCounterRef.current) {
      // Stale operation: ignore error from obsolete channel/source
      return;
    }
    const classified = classifyPlayerError(err);
    if (classified.category === 'CANCELLED') {
      return;
    }

    clearAllWatchdogs();

    const isSwitchable = DualPlaybackCoordinator.isSwitchableError(classified);
    const vlcProbe = probeVlcNativeAvailability();
    if (
      engineMode === ENGINE_MODE.AUTO &&
      activeEngineType === ENGINE_TYPE.NATIVE &&
      vlcAttemptsRef.current < 1 &&
      vlcProbe.available &&
      isSwitchable
    ) {
      logPlayerDiagnostic('embeddedAutoSwitchingToVlc', {
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
        isLive: true,
        platform: Platform.OS,
        originalExtension: extension,
        attemptedUrls: Array.from(attemptedUrls),
      });
      // On iOS, do NOT fallback to raw .ts directly because AVPlayer cannot decode progressive .ts over HTTP
      const isRawTsOnIos = Platform.OS === 'ios' && fallbackUrl && /\.ts(\?.*)?$/i.test(fallbackUrl);
      if (fallbackUrl && !attemptedUrls.has(fallbackUrl) && !isRawTsOnIos) {
        attemptedUrls.add(fallbackUrl);
        currentUrlRef.current = fallbackUrl;
        if (externalPlayer) {
          externalPlayer._activeUri = fallbackUrl;
          externalPlayer._playerState = 'RETRYING';
        }
        playerStateRef.current = 'RETRYING';
        setPlayerState('RETRYING');
        setDebouncedBuffering(true);
        setIsBufferingUI(true);
        logPlayerDiagnostic('liveFallbackAttempt', { fallbackUrl, attemptCount: attemptedUrls.size, streamId, platform: Platform.OS, opId });
        
        // Diagnostics watchdog for fallback attempt — NEVER triggers premature false fatal error
        loadTimeoutRef.current = setTimeout(() => {
          if (opId === null || opId === requestCounterRef.current) {
            logPlayerDiagnostic('fallbackConnectSlow', { opId, platform: Platform.OS, streamId });
          }
        }, 7000);

        try {
          const fallbackSource = {
            uri: fallbackUrl,
            contentType: fallbackUrl.includes('.m3u8') ? 'hls' : 'progressive',
            headers: playerSource?.headers || { 'User-Agent': DEFAULT_IPTV_USER_AGENT },
            metadata: playerSource?.metadata,
          };
          if (typeof player?.replaceAsync === 'function') {
            player.replaceAsync(fallbackSource).then(() => {
              if (opId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
                initiateAutoPlayback(opId);
                if (player?.status === 'readyToPlay' || player?.playing) {
                  confirmPlaybackActive(opId);
                }
              }
            }).catch((err2) => {
              if (opId === requestCounterRef.current) {
                handleFallbackOrError(err2, fallbackUrl, opId);
              }
            });
          } else {
            player?.replace(fallbackSource);
            if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
              initiateAutoPlayback(opId);
              if (player?.status === 'readyToPlay' || player?.playing) {
                confirmPlaybackActive(opId);
              }
            }
          }
          return;
        } catch (_e) {}
      }
    }
    triggerErrorState(err, opId);
  }, [player, streamId, triggerErrorState, playerSource, externalPlayer, setDebouncedBuffering, clearAllWatchdogs, initiateAutoPlayback, confirmPlaybackActive, extension]);

  // Mid-Stream Watchdog: Multi-stage bounded recovery for mid-playback buffering and stalls
  const armMidStreamRecoveryWatchdog = useCallback((opReqId, targetSource) => {
    if (opReqId !== requestCounterRef.current || userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
      return;
    }

    // Record episode start if not already active
    if (midStreamBufferStartRef.current === 0) {
      midStreamBufferStartRef.current = Date.now();
      midStreamRecoveryStageRef.current = 'STAGE_A';
      logPlayerDiagnostic('liveMidPlaybackBufferingStarted', {
        streamId,
        reqId: opReqId,
        platform: Platform.OS,
        status: player?.status,
        playing: player?.playing,
        bufferedPosition: player?.bufferedPosition,
        currentTime: player?.currentTime,
      });
    }

    if (midStreamStallTimerRef.current) {
      clearTimeout(midStreamStallTimerRef.current);
      midStreamStallTimerRef.current = null;
    }

    // Stage A (0 to 4500ms): Passive Recovery
    // Allow native player with waitsToMinimizeStalling: true to buffer media and recover naturally.
    midStreamStallTimerRef.current = setTimeout(() => {
      if (
        opReqId !== requestCounterRef.current ||
        userPausedRef.current ||
        playbackIntentRef.current === 'PAUSED' ||
        playerStateRef.current === 'PLAYING' ||
        playerStateRef.current === 'ERROR' ||
        player?.playing ||
        isSeekingRef.current ||
        isSeekingSettlingRef.current
      ) {
        return;
      }

      // Transition to Stage C: Safe native recovery
      midStreamRecoveryStageRef.current = 'STAGE_C';
      logPlayerDiagnostic('liveMidPlaybackStageC_Entered', {
        streamId,
        reqId: opReqId,
        platform: Platform.OS,
        status: player?.status,
        bufferedPosition: player?.bufferedPosition,
        currentTime: player?.currentTime,
      });

      // Stage B check: Did player enter native error status?
      if (player?.status === 'error') {
        const classified = classifyPlayerError(player.error);
        if (classified.category !== 'CANCELLED') {
          handleFallbackOrError(player.error, currentUrlRef.current, opReqId);
          return;
        }
      }

      // Stage C: Safe gentle re-assertion of player.play()
      try {
        player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
        player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
        player.play();
      } catch (_e) {}

      // Lightweight readiness poller (up to 4s) to catch when buffer refills
      if (midStreamPollerRef.current) clearInterval(midStreamPollerRef.current);
      let pollerTicks = 0;
      midStreamPollerRef.current = setInterval(() => {
        pollerTicks++;
        if (
          opReqId !== requestCounterRef.current ||
          userPausedRef.current ||
          playbackIntentRef.current === 'PAUSED' ||
          player?.playing ||
          pollerTicks > 18
        ) {
          if (midStreamPollerRef.current) {
            clearInterval(midStreamPollerRef.current);
            midStreamPollerRef.current = null;
          }
          if (player?.playing) {
            confirmPlaybackActive(opReqId);
          }
          return;
        }

        if (player?.status === 'readyToPlay' || (player?.bufferedPosition || 0) > (player?.currentTime || 0)) {
          try {
            player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
            player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
            player.play();
          } catch (_e) {}
        }
      }, 250);

      // Stage D (at 9500ms): Genuine Stall Detection & Controlled Single Reload
      midStreamStallTimerRef.current = setTimeout(() => {
        if (
          opReqId !== requestCounterRef.current ||
          userPausedRef.current ||
          playbackIntentRef.current === 'PAUSED' ||
          playerStateRef.current === 'PLAYING' ||
          playerStateRef.current === 'ERROR' ||
          player?.playing ||
          isSeekingRef.current ||
          isSeekingSettlingRef.current
        ) {
          return;
        }

        if (midStreamPollerRef.current) {
          clearInterval(midStreamPollerRef.current);
          midStreamPollerRef.current = null;
        }

        const now = Date.now();
        const canReload = !midStreamReloadAttemptedForEpisodeRef.current &&
          (now - lastMidStreamReloadTimeRef.current > 25000);

        if (canReload) {
          midStreamReloadAttemptedForEpisodeRef.current = true;
          lastMidStreamReloadTimeRef.current = now;
          midStreamRecoveryStageRef.current = 'STAGE_D';

          logPlayerDiagnostic('liveBufferingProlonged', {
            streamId,
            reqId: opReqId,
            platform: Platform.OS,
            durationMs: 12000,
          });

          logPlayerDiagnostic('liveMidPlaybackStageD_ControlledReload', {
            streamId,
            reqId: opReqId,
            platform: Platform.OS,
            status: player?.status,
          });

          // Perform ONE controlled source reload through serialized replace queue
          replaceQueueRef.current = replaceQueueRef.current.then(async () => {
            if (opReqId !== requestCounterRef.current) return;
            if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') return;

            try {
              try { player?.pause(); } catch (_e) {}
              if (Platform.OS === 'ios' && typeof player?.replaceAsync === 'function') {
                try {
                  await player.replaceAsync(null);
                  await new Promise((resolve) => setTimeout(resolve, 40));
                } catch (_e) {}
              }
              if (opReqId !== requestCounterRef.current) return;
              if (typeof player?.replaceAsync === 'function') {
                await player.replaceAsync(targetSource);
              } else {
                player?.replace(targetSource);
              }
              if (opReqId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
                try {
                  player.muted = Boolean(isMutedRef.current || volumeRef.current === 0);
                  player.volume = (typeof volumeRef.current === 'number' && !isNaN(volumeRef.current)) ? volumeRef.current : 1.0;
                  player.play();
                } catch (_e) {}
              }
            } catch (reloadErr) {
              logPlayerDiagnostic('liveMidPlaybackStageD_Error', { reqId: opReqId, error: reloadErr?.message });
            }
          });
        }

        // Stage E (at 15500ms): Exhausted Recovery — Transition out of loading to ERROR with manual retry
        midStreamStallTimerRef.current = setTimeout(() => {
          if (
            opReqId !== requestCounterRef.current ||
            userPausedRef.current ||
            playbackIntentRef.current === 'PAUSED' ||
            playerStateRef.current === 'PLAYING' ||
            playerStateRef.current === 'ERROR' ||
            player?.playing
          ) {
            return;
          }

          midStreamRecoveryStageRef.current = 'STAGE_E';
          logPlayerDiagnostic('liveMidPlaybackStageE_Exhausted', {
            streamId,
            reqId: opReqId,
            platform: Platform.OS,
            status: player?.status,
            totalDurationMs: Date.now() - (midStreamBufferStartRef.current || Date.now()),
          });

          clearAllWatchdogs();
          playerStateRef.current = 'ERROR';
          setPlayerState('ERROR');
          const stallMsg = 'Live stream stalled or signal lost. Tap to retry or choose another channel.';
          setErrorMessage(stallMsg);
          setErrorDetails({
            message: stallMsg,
            code: 'LIVE_STREAM_STALL',
          });
          setDebouncedBuffering(false);
          setIsBufferingUI(false);
          if (externalPlayer) {
            externalPlayer._playerState = 'ERROR';
            externalPlayer._errorMessage = stallMsg;
          }
        }, 6000);
      }, 5000);
    }, 4500);
  }, [player, streamId, handleFallbackOrError, clearAllWatchdogs, externalPlayer, setDebouncedBuffering, confirmPlaybackActive]);

  // Handle source change with atomic session reset and race condition prevention
  useEffect(() => {
    if (!player) return;

    // Handle invalid source gracefully without passing it to native player
    if (!validation.isValid || !playerSource) {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
      if (currentUrlRef.current !== null) {
        currentUrlRef.current = null;
        if (externalPlayer) {
          externalPlayer._activeUri = null;
          externalPlayer._playbackError = null;
          externalPlayer._errorUri = null;
          externalPlayer._playerState = 'ERROR';
        }
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
      setErrorMessage('Stream unavailable');
      setDebouncedBuffering(false);
      setIsBufferingUI(false);
      return;
    }

    const nextUri = validation.uri;
    const nextSessionId = channel?.sessionId || nextUri;

    // Check if this exact stream session is ALREADY active on this player instance
    if (
      (nextUri === currentUrlRef.current || (externalPlayer && externalPlayer._activeUri === nextUri)) &&
      currentUrlRef.current !== null &&
      activeSessionIdRef.current === nextSessionId
    ) {
      if (player.status === 'error' || playerStateRef.current === 'ERROR' || (externalPlayer && externalPlayer._playbackError && externalPlayer._errorUri === nextUri)) {
        currentUrlRef.current = nextUri;
        playerStateRef.current = 'ERROR';
        setPlayerState('ERROR');
        setErrorMessage(externalPlayer?._playbackError?.userMessage || errorMessage || 'Unable to play this stream.');
        setDebouncedBuffering(false);
        setIsBufferingUI(false);
        return;
      }
      currentUrlRef.current = nextUri;
      if (hasEverPlayedRef.current || (externalPlayer && externalPlayer._hasEverPlayed)) {
        if (!userPausedRef.current && playbackIntentRef.current === 'PLAYING') {
          if (!player.playing) {
            try {
              player.muted = false;
              player.volume = volume || 1.0;
              player.play();
            } catch (_e) {}
            initiateAutoPlayback(requestCounterRef.current);
          } else {
            confirmPlaybackActive(requestCounterRef.current);
          }
          playerStateRef.current = 'PLAYING';
          setPlayerState('PLAYING');
          setDebouncedBuffering(false);
          setIsBufferingUI(false);
        } else {
          const nextState = (player.playing && !userPausedRef.current) ? 'PLAYING' : 'PAUSED';
          playerStateRef.current = nextState;
          setPlayerState(nextState);
          setDebouncedBuffering(false);
          setIsBufferingUI(false);
        }
      } else {
        // Stream session is already active on player but hasn't completed initial playback yet
        if (!userPausedRef.current && playbackIntentRef.current === 'PLAYING') {
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
            if (externalPlayer) {
              externalPlayer._playerState = 'PLAYING';
              externalPlayer._hasEverPlayed = true;
            }
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
            initiateAutoPlayback(requestCounterRef.current);
          } else {
            playerStateRef.current = 'LOADING';
            setPlayerState('LOADING');
            setIsBufferingUI(true);
            initiateAutoPlayback(requestCounterRef.current);
          }
        }
      }
      return;
    }



    // Immediately pause active player to release stream connection slot and prevent audio bleed
    try {
      player.pause();
    } catch (_e) {}

    currentUrlRef.current = nextUri;
    activeSessionIdRef.current = nextSessionId;
    const reqId = ++requestCounterRef.current;
    lastToastedAttemptIdRef.current = null;

    if (externalPlayer) {
      externalPlayer._activeUri = nextUri;
      externalPlayer._playbackError = null;
      externalPlayer._errorUri = null;
      externalPlayer._playerState = 'LOADING';
      externalPlayer._hasEverPlayed = false;
      externalPlayer._attemptId = reqId;
      externalPlayer._lastToastedAttemptId = null;
      externalPlayer._foxSessionId = nextSessionId;
    }

    attemptedFallbackUrlsRef.current.clear();
    autoRecoveryAttemptedRef.current = false;
    hasEverPlayedRef.current = false;
    setHasFirstFrame(false);
    lastPlaybackTimeRef.current = -1;
    lastAdvanceTimeRef.current = Date.now();
    setCurrentTime(0);
    setDuration(0);
    isSeekingRef.current = false;
    clearAllWatchdogs();

    if (Platform.OS === 'ios' && player) {
      try {
        const startupBufferOpts = getPlatformBufferOptions({
          type: 'live',
          isLive: true,
          platform: 'ios',
          enableStallRecovery: false,
        });
        if (startupBufferOpts) {
          player.bufferOptions = startupBufferOpts;
        }
      } catch (_e) {}
    }

    // Atomic reset of player state — instant blackout with centered connecting spinner
    playerStateRef.current = 'LOADING';
    setPlayerState('LOADING');
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
    try { player.muted = false; } catch (_e) {}

    if (bufferTimerRef.current) {
      clearTimeout(bufferTimerRef.current);
      bufferTimerRef.current = null;
    }
    bufferStartRef.current = Date.now();
    setIsBufferingUI(true);
    timingRef.current.assigned = Date.now();

    // Start readiness poller and active recovery watchdog
    startReadinessPoller(reqId);
    armActiveRecoveryWatchdog(reqId, playerSource);

    // Watchdog for stream connect diagnostics (25s to accommodate multi-hop proxy resolution)
    // NEVER triggers false fatal error or error popup on slow connection; player stays in loading/buffering
    loadTimeoutRef.current = setTimeout(() => {
      if (reqId === requestCounterRef.current && (playerStateRef.current === 'LOADING' || playerStateRef.current === 'BUFFERING' || playerStateRef.current === 'RETRYING')) {
        logPlayerDiagnostic('liveStreamConnectSlow', {
          streamId,
          reqId,
          platform: Platform.OS,
          url: nextUri,
          durationMs: 25000,
        });
      }
    }, 25000);

    const now = Date.now();
    timingRef.current.t0_tap = channel?.selectedAt || now;
    timingRef.current.t1_source = now;
    timingRef.current.t2_player = now;
    timingRef.current.t3_assigned = now;

    logPlayerDiagnostic('liveLoadStarted', {
      url: nextUri,
      streamId,
      platform: Platform.OS,
      contentType,
      reqId,
      sessionId: nextSessionId,
    });

    isReplacingSourceRef.current = true;

    // Serialize source replacement through promise queue to prevent native deadlock and concurrent replaceAsync calls
    replaceQueueRef.current = replaceQueueRef.current.then(async () => {
      // Check if superseded before starting operation
      if (reqId !== requestCounterRef.current) {
        isReplacingSourceRef.current = false;
        logPlayerDiagnostic('liveSwitchSupersededBeforeStart', { reqId, latestReqId: requestCounterRef.current });
        return;
      }

      if (activeEngineType === ENGINE_TYPE.VLC) {
        const targetVlc = vlcPlayer || getOrCreateVlcPlayer();
        const vlcUri = resolvedSource?.rawUrl || resolvedSource?.originalUrl || rawUri || nextUri;
        if (targetVlc && vlcUri) {
          try {
            targetVlc.source = {
              uri: vlcUri,
              userAgent: DEFAULT_IPTV_USER_AGENT,
              vlcOptions: getPlatformVlcOptions({ isLive: true }),
              title: title || channel?.name || 'Live Channel',
            };
            targetVlc.autoPlay = true;
            targetVlc.play();
            try {
              if (player) {
                player.pause();
                player.muted = true;
              }
            } catch (_e) {}
            hasEverPlayedRef.current = true;
            setHasFirstFrame(true);
            playerStateRef.current = 'PLAYING';
            setPlayerState('PLAYING');
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          } catch (_e) {}
        }
        isReplacingSourceRef.current = false;
        return;
      }

      try {
        // iOS: Cleanly detach previous source by replacing with null first.
        // This resets dangerousPropertiesStore.ownerIsReplacing, cancels in-flight loader tasks,
        // and detaches AVPlayerItem before the new stream arrives.
        if (Platform.OS === 'ios' && typeof player.replaceAsync === 'function') {
          try {
            await player.replaceAsync(null);
            // Yield 40ms to allow iOS main thread to execute clearCurrentItem block
            await new Promise((resolve) => setTimeout(resolve, 40));
          } catch (_e) {
            // Harmless cancellation during detach
          }
        }

        // Check if superseded during detach
        if (reqId !== requestCounterRef.current) {
          isReplacingSourceRef.current = false;
          logPlayerDiagnostic('liveSwitchSupersededAfterDetach', { reqId, latestReqId: requestCounterRef.current });
          return;
        }

        if (typeof player.replaceAsync === 'function') {
          await player.replaceAsync(playerSource);
        } else {
          player.replace(playerSource);
        }

        isReplacingSourceRef.current = false;

        // Check if superseded after replace completed
        if (reqId !== requestCounterRef.current) {
          logPlayerDiagnostic('liveSwitchSupersededAfterReplace', { reqId, latestReqId: requestCounterRef.current });
          return;
        }

        logPlayerDiagnostic('liveSourceReplacedSuccessfully', {
          reqId,
          streamId,
          status: player.status,
          playing: player.playing,
        });

        if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
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
            if (externalPlayer) {
              externalPlayer._playerState = 'PLAYING';
              externalPlayer._hasEverPlayed = true;
            }
            if (bufferTimerRef.current) {
              clearTimeout(bufferTimerRef.current);
              bufferTimerRef.current = null;
            }
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          }
          initiateAutoPlayback(reqId);
        }
      } catch (err) {
        isReplacingSourceRef.current = false;
        if (reqId === requestCounterRef.current) {
          const classified = classifyPlayerError(err);
          if (classified.category !== 'CANCELLED') {
            logPlayerDiagnostic('liveLoadError', { error: err?.message, url: nextUri, reqId });
            handleFallbackOrError(err, nextUri, reqId);
          }
        }
      }
    });
  }, [validation, playerSource, player, triggerErrorState, setDebouncedBuffering, streamId, handleFallbackOrError, contentType, externalPlayer, clearAllWatchdogs, channel?.sessionId, initiateAutoPlayback, confirmPlaybackActive, startReadinessPoller, armActiveRecoveryWatchdog]);

  // Handle focus / screen navigation: completely stop and clear source when leaving
  useEffect(() => {
    if (!player) return;
    try {
      if (!isFocused) {
        clearAllWatchdogs();
        player.pause();
        player.muted = true;
        if (typeof player.replaceAsync === 'function') {
          player.replaceAsync(null);
        } else if (typeof player.replace === 'function') {
          player.replace(null);
        }
      } else if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current && playerStateRef.current !== 'ERROR') {
        player.muted = false;
        player.play();
      }
    } catch (_e) {}
  }, [isFocused, player, clearAllWatchdogs]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearAllWatchdogs();
      if (!externalPlayer) {
        if (!externalPlayer && internalPlayer) {
          try {
            internalPlayer.pause();
            internalPlayer.muted = true;
          } catch (_e) {}
        }
      }
    };
  }, [externalPlayer, internalPlayer, clearAllWatchdogs]);

  // Player status & playback events (attached once per player instance)
  useEffect(() => {
    if (!player) return;

    const subStatus = player.addListener('statusChange', ({ status, error }) => {
      logPlayerDiagnostic('liveStatusChange', { status, error: error?.message, streamId, reqId: requestCounterRef.current });

      // Guard: if already in fatal error for current stream or engine not native or switching, ignore status updates
      if (playerStateRef.current === 'ERROR' || activeEngineTypeRef.current !== ENGINE_TYPE.NATIVE || isSwitchingEngineRef.current) {
        return;
      }

      if (status === 'error') {
        const classified = classifyPlayerError(error);
        if (classified.category === 'CANCELLED') {
          // Cancellation errors from AVPlayer (Code -999) during channel switching are harmless
          return;
        }
        if (player.playing && (player.currentTime || 0) > 0) {
          // Genuinely playing with advancing time; ignore non-fatal auxiliary track warning
          return;
        }
        clearAllWatchdogs();
        handleFallbackOrError(error, currentUrlRef.current, requestCounterRef.current);
      } else if (status === 'readyToPlay') {
        timingRef.current.ready = Date.now();
        timingRef.current.t5_ready = Date.now();

        if (playbackIntentRef.current === 'PAUSED' || userPausedRef.current) {
          clearAllWatchdogs();
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
          if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
          setIsBufferingUI(false);
        } else if (player.playing) {
          // Native player is actively outputting frames; do not override with LOADING or BUFFERING
          playerStateRef.current = 'PLAYING';
          setPlayerState('PLAYING');
          confirmPlaybackActive(requestCounterRef.current);
        } else if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          // Native player has loaded enough data and is ready to play — start playback immediately!
          timingRef.current.t7_play = Date.now();
          try {
            player.muted = false;
            player.volume = volume || 1.0;
            player.play();
          } catch (_e) {}

          clearAllWatchdogs();
          hasEverPlayedRef.current = true;
          setHasFirstFrame(true);
          playerStateRef.current = 'PLAYING';
          setPlayerState('PLAYING');
          if (externalPlayer) {
            externalPlayer._playerState = 'PLAYING';
            externalPlayer._hasEverPlayed = true;
          }
          if (bufferTimerRef.current) {
            clearTimeout(bufferTimerRef.current);
            bufferTimerRef.current = null;
          }
          setIsBufferingUI(false);
          setDebouncedBuffering(false);
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

          logPlayerDiagnostic('liveAutoPlayOnReady', {
            streamId,
            platform: Platform.OS,
            reqId: requestCounterRef.current,
            status,
          });

          initiateAutoPlayback(requestCounterRef.current);
        }
      } else if (status === 'loading') {
        timingRef.current.t4_loading = Date.now();
        if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          if (player.playing) {
            // Native player is actively outputting frames; background segment fetch does not stall playback
            return;
          }
          const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
          playerStateRef.current = nextState;
          setPlayerState(nextState);
          setDebouncedBuffering(true);
          if (hasEverPlayedRef.current) {
            armMidStreamRecoveryWatchdog(requestCounterRef.current, playerSource);
          }
        }
      }
    });

    const subPlaying = player.addListener('playingChange', ({ isPlaying: nativePlaying }) => {
      logPlayerDiagnostic('livePlayingChange', { isPlaying: nativePlaying, streamId, reqId: requestCounterRef.current });

      if (playerStateRef.current === 'ERROR' || activeEngineTypeRef.current !== ENGINE_TYPE.NATIVE) {
        return;
      }

      if (nativePlaying) {
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
        clearAllWatchdogs();
        setErrorMessage(null);
        lastErrorRef.current = null;
        if (toastTypeRef.current === 'error') {
          setShowToast(false);
          setToastMessage(null);
        }
        setErrorDetails(null);

        if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
          try { player.pause(); } catch (_e) {}
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
          if (externalPlayer) externalPlayer._playerState = 'PAUSED';
          setIsBufferingUI(false);
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

          logPlayerDiagnostic('liveTimelineMilestones', {
            startupMs: elapsed,
            t0_to_t3_ms: t0_to_t3,
            t3_to_t5_readyMs: t3_to_t5,
            t5_to_t6_firstFrameMs: t5_to_t6,
            streamId,
            platform: Platform.OS,
          });
        }
      } else {
        if (playbackIntentRef.current === 'PAUSED' || userPausedRef.current) {
          cancelMidStreamRecovery();
          if (stallTimeoutRef.current) clearTimeout(stallTimeoutRef.current);
          playerStateRef.current = 'PAUSED';
          setPlayerState('PAUSED');
          if (externalPlayer) externalPlayer._playerState = 'PAUSED';
          if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
          setIsBufferingUI(false);
        } else if (hasEverPlayedRef.current) {
          // Mid-stream stall or buffer underrun while intent is PLAYING
          playerStateRef.current = 'BUFFERING';
          setPlayerState('BUFFERING');
          if (externalPlayer) externalPlayer._playerState = 'BUFFERING';
          setDebouncedBuffering(true);
          armMidStreamRecoveryWatchdog(requestCounterRef.current, playerSource);
          if (player?.status === 'readyToPlay' && !isSeekingRef.current && !isSeekingSettlingRef.current) {
            initiateAutoPlayback(requestCounterRef.current);
          }
        } else {
          // Initial channel load / connect
          if (player?.status === 'readyToPlay') {
            if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
              initiateAutoPlayback(requestCounterRef.current);
            }
          } else {
            playerStateRef.current = 'LOADING';
            setPlayerState('LOADING');
            if (externalPlayer) externalPlayer._playerState = 'LOADING';
            setIsBufferingUI(true);
          }
        }
      }
    });

    const subTimeUpdate = player.addListener?.('timeUpdate', ({ currentTime: rawCurrentTime }) => {
      if (activeEngineTypeRef.current !== ENGINE_TYPE.NATIVE) return;

      // 1. If dragging seekbar thumb, do not update UI from native ticks
      if (isSeekingRef.current) {
        return;
      }

      if (playerStateRef.current === 'ERROR') {
        return;
      }

      const curr = typeof rawCurrentTime === 'number' ? rawCurrentTime : (player?.currentTime || 0);

      // Stale event suppression during seeking & seek completion convergence
      if (isSeekingSettlingRef.current && seekTargetTimeRef.current !== null) {
        const target = seekTargetTimeRef.current;
        const hasReachedTarget = Math.abs(curr - target) <= 2.2 || (target > 0 && curr >= target - 0.5);
        if (hasReachedTarget) {
          if (completeSeekRef.current) {
            completeSeekRef.current(seekCounterRef.current, curr);
          }
        } else {
          return;
        }
      }

      if (userPausedRef.current || playbackIntentRef.current === 'PAUSED') {
        return;
      }

      // Glitch protection against transient CMTimeZero from AVPlayer during stream playback
      if (curr === 0 && (lastPlaybackTimeRef.current || 0) > 1.5 && hasEverPlayedRef.current) {
        return;
      }

      const prev = lastPlaybackTimeRef.current;
      const isAdvancing = prev >= 0 ? (curr - prev > 0.03 || (curr > 0.05 && prev === 0)) : (curr > 0.05);
      const now = Date.now();

      if (isAdvancing) {
        lastPlaybackTimeRef.current = curr;
        lastAdvanceTimeRef.current = now;
      } else if (prev < 0) {
        lastPlaybackTimeRef.current = curr;
        lastAdvanceTimeRef.current = now;
      }

      // Synchronize time & duration with seekbar only when controls are visible in expanded mode or settling a seek
      currentTimeRef.current = curr;
      if (!isSeekingRef.current && (isSeekingSettlingRef.current || (controlsVisibleRef.current && mode === 'expanded'))) {
        const lastSec = Math.floor(lastRenderedTimeRef.current || 0);
        const currentSec = Math.floor(curr);
        if (currentSec !== lastSec || isSeekingSettlingRef.current) {
          lastRenderedTimeRef.current = curr;
          setCurrentTime(curr);
          const dur = typeof player?.duration === 'number' ? player.duration : 0;
          if (dur > 0 && isFinite(dur)) {
            setDuration(dur);
          }
        }
      }

      // If native player is currently in 'loading' status and NOT playing, it is actively buffering
      if (player?.status === 'loading' && !player?.playing) {
        if (hasEverPlayedRef.current && playerStateRef.current !== 'BUFFERING') {
          playerStateRef.current = 'BUFFERING';
          setPlayerState('BUFFERING');
          if (externalPlayer) externalPlayer._playerState = 'BUFFERING';
          setDebouncedBuffering(true);
        }
        return;
      }

      if (player && typeof player.playing === 'boolean' && !player.playing) {
        if (player.status === 'readyToPlay' && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          initiateAutoPlayback(requestCounterRef.current);
        }
        return;
      }

      if (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
        if (!hasEverPlayedRef.current) {
          if (isAdvancing || curr > 0.05 || player?.playing) {
            confirmPlaybackActive(requestCounterRef.current);
          }
        } else {
          if (verifyPlaybackRef.current) {
            clearTimeout(verifyPlaybackRef.current);
            verifyPlaybackRef.current = null;
          }
          if (stallTimeoutRef.current) {
            clearTimeout(stallTimeoutRef.current);
            stallTimeoutRef.current = null;
          }

          if (isAdvancing && playerStateRef.current !== 'PLAYING') {
            confirmPlaybackActive(requestCounterRef.current);
          } else if (!isAdvancing && playerStateRef.current === 'PLAYING' && lastAdvanceTimeRef.current > 0 && (now - lastAdvanceTimeRef.current > 1400)) {
            if (player?.status === 'loading' || (typeof player?.playing === 'boolean' && !player.playing)) {
              playerStateRef.current = 'BUFFERING';
              setPlayerState('BUFFERING');
              if (externalPlayer) externalPlayer._playerState = 'BUFFERING';
              setDebouncedBuffering(true);
              armMidStreamRecoveryWatchdog(requestCounterRef.current, playerSource);
            }
          }
        }
      }
    });

    const subSourceLoad = player.addListener?.('sourceLoad', () => {
      const payload = arguments[0];
      timingRef.current.sourceLoaded = Date.now();
      const loadElapsed = timingRef.current.sourceLoaded - (timingRef.current.assigned || timingRef.current.sourceLoaded);
      logPlayerDiagnostic('liveSourceLoad', { loadTimeMs: loadElapsed, streamId, platform: Platform.OS });
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
        reapplyFixedNativeSubtitleStyleWithRetries();
      } catch (_e) {}

      if (
        (player?.status === 'readyToPlay' || player?.playing) &&
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
        if (externalPlayer) {
          externalPlayer._playerState = 'PLAYING';
          externalPlayer._hasEverPlayed = true;
        }
        if (bufferTimerRef.current) {
          clearTimeout(bufferTimerRef.current);
          bufferTimerRef.current = null;
        }
        setIsBufferingUI(false);
        setDebouncedBuffering(false);
        initiateAutoPlayback(requestCounterRef.current);
      }
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
      reapplyFixedNativeSubtitleStyleWithRetries();
    });

    const subSubtitleTrackChange = player.addListener?.('subtitleTrackChange', ({ subtitleTrack: track }) => {
      logPlayerDiagnostic('subtitleTrackChange', { label: track?.label, lang: track?.language });
      if (userSelectedSubtitleRef.current) {
        setSelectedSubtitleTrack(track || null);
      }
      reapplyFixedNativeSubtitleStyleWithRetries();
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
        player.volume = volumeRef.current || 1.0;
        player.play();
      } catch (_e) {}
      hasEverPlayedRef.current = true;
      setHasFirstFrame(true);
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (externalPlayer) {
        externalPlayer._playerState = 'PLAYING';
        externalPlayer._hasEverPlayed = true;
      }
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
      subTimeUpdate?.remove?.();
    };
  }, [player, triggerErrorState, setDebouncedBuffering, streamId, handleFallbackOrError, clearAllWatchdogs, externalPlayer, initiateAutoPlayback, confirmPlaybackActive]);

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

        if (vlcPlayer.muted) vlcPlayer.muted = false;
        if (!vlcPlayer.playing && playerStateRef.current === 'PLAYING' && !userPausedRef.current) {
          try { vlcPlayer.play(); } catch (_e) {}
        }
      } catch (err) {
        logPlayerDiagnostic('selectAudioTrackVLCError', { error: err?.message });
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

    if (activeEngineType === ENGINE_TYPE.VLC) {
      const activeVlc = vlcPlayerRef.current || vlcPlayer || getOrCreateVlcPlayer();
      if (!activeVlc) return;
      try {
        let trackId = -1;
        if (track) {
          const vlcSubs = activeVlc.subtitleTracks || [];
          if (track.id != null && !isNaN(Number(track.id))) {
            trackId = Number(track.id);
          } else if (targetIndex !== null && vlcSubs[targetIndex]?.id != null) {
            trackId = Number(vlcSubs[targetIndex].id);
          } else if (typeof track === 'number') {
            trackId = track;
          }
        }

        if (typeof activeVlc.setSubtitleTrack === 'function') {
          activeVlc.setSubtitleTrack(trackId);
        } else if (typeof activeVlc.selectSubtitleTrack === 'function') {
          activeVlc.selectSubtitleTrack(trackId);
        }
        setSelectedSubtitleTrack(track);
        applyFixedSubtitles({ activeEngineType: ENGINE_TYPE.VLC });
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
      reapplyFixedNativeSubtitleStyleWithRetries();
      logPlayerDiagnostic('selectSubtitleTrack', { label: track?.label, language: track?.language, id: track?.id });
    } catch (err) {
      logPlayerDiagnostic('selectSubtitleTrackError', { error: err?.message });
    }
  }, [player, activeEngineType, vlcPlayer, getOrCreateVlcPlayer, availableSubtitleTracks]);

  const isGestureActiveRef = useRef(false);
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  const cancelAutoHideTimer = useCallback(() => {
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current);
      controlsTimeout.current = null;
    }
  }, []);

  const hideControlsUI = useCallback(() => {
    if (isSeekingRef.current || isGestureActiveRef.current || playerStateRef.current === 'PAUSED') return;
    cancelAutoHideTimer();
    controlsVisibleRef.current = false;
    setControlsVisible(false);
    Animated.timing(controlsOpacityRef.current, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [cancelAutoHideTimer]);

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
      }, isMini ? 3000 : 3200);
    }
  }, [isMini, cancelAutoHideTimer, hideControlsUI]);

  const showControlsUI = useCallback(() => {
    controlsVisibleRef.current = true;
    setControlsVisible(true);
    if (mode === 'expanded' && currentTimeRef.current > 0) {
      setCurrentTime(currentTimeRef.current);
    }
    Animated.timing(controlsOpacityRef.current, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    resetHideTimer();
  }, [mode, resetHideTimer]);

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
  }, [sanitizedUri, cancelAutoHideTimer]);

  useEffect(() => {
    if (playerState === 'PAUSED') {
      cancelAutoHideTimer();
      controlsVisibleRef.current = true;
      setControlsVisible(true);
      controlsOpacityRef.current.stopAnimation();
      controlsOpacityRef.current.setValue(1);
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

  // Synchronize controls lifecycle across Mini <-> Max mode transitions
  useEffect(() => {
    cancelAutoHideTimer();
    setControlsVisible(true);
    controlsOpacityRef.current.setValue(1);

    if (playerStateRef.current === 'PLAYING') {
      resetHideTimer();
    }
  }, [isMini, resetHideTimer]);

  const togglePlay = useCallback(() => {
    if (isTogglingPlayRef.current) return;
    isTogglingPlayRef.current = true;
    setTimeout(() => { isTogglingPlayRef.current = false; }, 250);

    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      const isCurrentlyPlaying = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || playerState === 'PLAYING';
      if (isCurrentlyPlaying) {
        cancelPostResumeAudioSync();
        manualResumeUntilRef.current = 0;
        userPausedRef.current = true;
        playbackIntentRef.current = 'PAUSED';
        try { vlcPlayer.pause(); } catch (_e) {}
        playerStateRef.current = 'PAUSED';
        setPlayerState('PAUSED');
        if (externalPlayer) externalPlayer._playerState = 'PAUSED';
        setIsBufferingUI(false);
        setDebouncedBuffering(false);
        setControlsVisible(true);
        controlsOpacityRef.current.setValue(1);
      } else {
        userPausedRef.current = false;
        playbackIntentRef.current = 'PLAYING';
        manualResumeUntilRef.current = Date.now() + 900;
        resumeActiveEnginePlayback({
          activeEngineType: ENGINE_TYPE.VLC,
          vlcPlayer,
          nativePlayer: player,
          volume: volumeRef.current,
          isMuted: isMutedRef.current,
        }, {
          isStillActive: () => playbackIntentRef.current === 'PLAYING' && !userPausedRef.current,
        });
        playerStateRef.current = 'PLAYING';
        setPlayerState('PLAYING');
        if (externalPlayer) externalPlayer._playerState = 'PLAYING';
        setIsBufferingUI(false);
        setDebouncedBuffering(false);
        resetHideTimer();
      }
      return;
    }

    if (!player) return;

    const shouldPause = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (typeof player.playing === 'boolean' ? player.playing : false) || playerState === 'PLAYING';

    if (shouldPause) {
      cancelPostResumeAudioSync();
      manualResumeUntilRef.current = 0;
      userPausedRef.current = true;
      playbackIntentRef.current = 'PAUSED';
      pausedAtRef.current = Date.now();
      try {
        player.pause();
      } catch (_e) {}
      playerStateRef.current = 'PAUSED';
      setPlayerState('PAUSED');
      if (externalPlayer) externalPlayer._playerState = 'PAUSED';
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
      setControlsVisible(true);
      controlsOpacityRef.current.setValue(1);
    } else {
      userPausedRef.current = false;
      playbackIntentRef.current = 'PLAYING';
      manualResumeUntilRef.current = Date.now() + 900;

      // On iOS Live TV: if paused for > 10s, reload live source so AVPlayer catches live edge without segment 404/stall
      const pausedDuration = pausedAtRef.current ? (Date.now() - pausedAtRef.current) : 0;
      if (Platform.OS === 'ios' && pausedDuration > 10000 && playerSource) {
        setPlayerState('BUFFERING');
        setDebouncedBuffering(true);
        if (typeof player.replaceAsync === 'function') {
          player.replaceAsync(playerSource).then(() => {
            if (!userPausedRef.current && playbackIntentRef.current === 'PLAYING') {
              resumeActiveEnginePlayback({
                activeEngineType: ENGINE_TYPE.NATIVE,
                nativePlayer: player,
                volume: volumeRef.current,
                isMuted: isMutedRef.current,
              }, {
                isStillActive: () => playbackIntentRef.current === 'PLAYING' && !userPausedRef.current,
              });
            }
          }).catch(() => {
            resumeActiveEnginePlayback({
              activeEngineType: ENGINE_TYPE.NATIVE,
              nativePlayer: player,
              volume: volumeRef.current,
              isMuted: isMutedRef.current,
            }, {
              isStillActive: () => playbackIntentRef.current === 'PLAYING' && !userPausedRef.current,
            });
          });
          return;
        }
      }

      resumeActiveEnginePlayback({
        activeEngineType: ENGINE_TYPE.NATIVE,
        nativePlayer: player,
        volume: volumeRef.current,
        isMuted: isMutedRef.current,
      }, {
        isStillActive: () => playbackIntentRef.current === 'PLAYING' && !userPausedRef.current,
      });
      if (player.status === 'readyToPlay' && player.playing) {
        playerStateRef.current = 'PLAYING';
        setPlayerState('PLAYING');
        if (externalPlayer) externalPlayer._playerState = 'PLAYING';
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
        setIsBufferingUI(false);
      } else {
        const nextState = hasEverPlayedRef.current ? 'BUFFERING' : 'LOADING';
        playerStateRef.current = nextState;
        setPlayerState(nextState);
        if (externalPlayer) externalPlayer._playerState = nextState;
        setDebouncedBuffering(true);
      }
      resetHideTimer();
    }
  }, [player, playerState, playerSource, setDebouncedBuffering, externalPlayer, resetHideTimer, activeEngineType, vlcPlayer]);

  const toggleMute = useCallback(() => {
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      try {
        const nextMuted = !isMuted;
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
      const modes = ['contain', 'cover', 'fill'];
      const nextIdx = (modes.indexOf(prev) + 1) % modes.length;
      return modes[nextIdx];
    });
    showControlsUI();
  }, [showControlsUI]);

  const triggerSeekFeedback = useCallback((text) => {
    setSeekFeedback({ text, key: Date.now() });
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
    seekTargetTimestampRef.current = 0;
    if (seekWatchdogRef.current) {
      clearTimeout(seekWatchdogRef.current);
      seekWatchdogRef.current = null;
    }

    logPlayerDiagnostic('seekSettled', {
      seekOpId: opId,
      actualTime,
      wasPlaying: wasPlayingBeforeSeekRef.current,
      userPaused: userPausedRef.current,
    });

    if (wasPlayingBeforeSeekRef.current && !userPausedRef.current && playerStateRef.current !== 'ERROR') {
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (externalPlayer) externalPlayer._playerState = 'PLAYING';
      playbackIntentRef.current = 'PLAYING';
      manualResumeUntilRef.current = Date.now() + 900;
      const resumeLifecycle = {
        isStillActive: () => playbackIntentRef.current === 'PLAYING' && !userPausedRef.current,
      };
      if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
        resumeActiveEnginePlayback({
          activeEngineType: ENGINE_TYPE.VLC,
          vlcPlayer,
          nativePlayer: player,
          volume: volumeRef.current,
          isMuted: isMutedRef.current,
        }, resumeLifecycle);
      } else {
        resumeActiveEnginePlayback({
          activeEngineType: ENGINE_TYPE.NATIVE,
          nativePlayer: player,
          volume: volumeRef.current,
          isMuted: isMutedRef.current,
        }, resumeLifecycle);
      }
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
      confirmPlaybackActive(requestCounterRef.current);
    } else {
      cancelPostResumeAudioSync();
      playerStateRef.current = 'PAUSED';
      setPlayerState('PAUSED');
      if (externalPlayer) externalPlayer._playerState = 'PAUSED';
      playbackIntentRef.current = 'PAUSED';
      if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
        try { vlcPlayer.pause(); } catch (_e) {}
      } else {
        try {
          player?.pause();
        } catch (_e) {}
      }
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
      setIsBufferingUI(false);
      setDebouncedBuffering(false);
    }
  }, [player, externalPlayer, confirmPlaybackActive, setDebouncedBuffering, activeEngineType, vlcPlayer]);
  completeSeekRef.current = completeSeek;

  const executeSeek = useCallback((targetSec, source = 'scrubber') => {
    const isVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer;
    if (!player && !isVlc) return;
    try {
      const dur = duration || (player ? player.duration : 0) || 0;
      let safeTime = Math.max(0, targetSec);
      if (dur > 1 && safeTime >= dur - 0.05) {
        safeTime = Math.max(0, dur - 0.15);
      }
      if (dur > 0) {
        safeTime = Math.min(dur, safeTime);
      }

      // Record playback intent before seek started (only on initial seek action of a sequence)
      if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
        const wasPlaying = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (isVlc ? (playerStateRef.current === 'PLAYING') : Boolean(player?.playing));
        wasPlayingBeforeSeekRef.current = wasPlaying;
      }

      // 1. Immediately pause native player so old video/audio NEVER continues playing
      try {
        if (isVlc) {
          // Do not pause VLC, seeking while playing allows seamless frame handover
        } else {
          player?.pause();
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
      lastPlaybackTimeRef.current = safeTime;
      lastAdvanceTimeRef.current = Date.now();

      // Enter buffering state immediately: shows buffering indicator and hides Play/Pause
      playerStateRef.current = 'BUFFERING';
      setPlayerState('BUFFERING');
      if (externalPlayer) externalPlayer._playerState = 'BUFFERING';
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

      // Watchdog fallback to settle seek if native position reporting is delayed
      seekWatchdogRef.current = setTimeout(() => {
        if (seekOpId === seekCounterRef.current && (isSeekingSettlingRef.current || isSeekingRef.current)) {
          logPlayerDiagnostic('seekSettledTimeout', { seekOpId, targetTime: safeTime });
          completeSeek(seekOpId, safeTime);
        }
      }, 1600);

      showControlsUI();
    } catch (_e) {}
  }, [player, duration, externalPlayer, setDebouncedBuffering, completeSeek, showControlsUI, activeEngineType, vlcPlayer]);

  const handleSeek = useCallback((targetSec) => {
    executeSeek(targetSec, 'scrubber');
  }, [executeSeek]);

  const handleSeekingChange = useCallback((seeking) => {
    const isVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer;
    if (seeking) {
      if (!isSeekingRef.current && !isSeekingSettlingRef.current) {
        const wasPlaying = (playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) || (isVlc ? (playerStateRef.current === 'PLAYING') : Boolean(player?.playing));
        wasPlayingBeforeSeekRef.current = wasPlaying;
      }
      isSeekingRef.current = true;
      try {
        if (isVlc) {
          vlcPlayer.pause();
        } else {
          player?.pause();
        }
      } catch (_e) {}
      playerStateRef.current = 'BUFFERING';
      setPlayerState('BUFFERING');
      if (externalPlayer) externalPlayer._playerState = 'BUFFERING';
      setDebouncedBuffering(true);
      setIsBufferingUI(true);
      cancelAutoHideTimer();
      showControlsUI();
    } else {
      isSeekingRef.current = false;
      resetHideTimer();
    }
  }, [player, externalPlayer, cancelAutoHideTimer, showControlsUI, resetHideTimer, setDebouncedBuffering, activeEngineType, vlcPlayer]);

  const handleRewind = useCallback(() => {
    const isVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer;
    if (!player && !isVlc) return;
    try {
      const cur = (isSeekingSettlingRef.current || isSeekingRef.current) && seekTargetTimeRef.current !== null
        ? seekTargetTimeRef.current
        : (isVlc ? currentTime : (typeof player.currentTime === 'number' ? player.currentTime : (currentTime || 0)));
      const target = Math.max(0, cur - 10);
      executeSeek(target, 'rewind');
      triggerSeekFeedback('↶ 10s');
      showControlsUI();
    } catch (_e) {}
  }, [player, currentTime, executeSeek, showControlsUI, triggerSeekFeedback, activeEngineType, vlcPlayer]);

  const handleForward = useCallback(() => {
    const isVlc = activeEngineType === ENGINE_TYPE.VLC && vlcPlayer;
    if (!player && !isVlc) return;
    try {
      const cur = (isSeekingSettlingRef.current || isSeekingRef.current) && seekTargetTimeRef.current !== null
        ? seekTargetTimeRef.current
        : (isVlc ? currentTime : (typeof player.currentTime === 'number' ? player.currentTime : (currentTime || 0)));
      const dur = duration || (player ? player.duration : 0) || 0;
      const target = dur > 0 ? Math.min(dur, cur + 10) : cur + 10;
      executeSeek(target, 'forward');
      triggerSeekFeedback('10s ↷');
      showControlsUI();
    } catch (_e) {}
  }, [player, duration, currentTime, executeSeek, showControlsUI, triggerSeekFeedback, activeEngineType, vlcPlayer]);

  const handleTouchZone = (side) => {
    if (isMini) {
      toggleControls();
      return;
    }
    const now  = Date.now();
    const last = lastTapRef.current;
    if (now - last.time < 320 && last.side === side) {
      side === 'left' ? handleRewind() : handleForward();
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

    // If native player is in error and recreatePlayer callback is available, recreate the player instance!
    if (player?.status === 'error' && typeof recreatePlayer === 'function') {
      logPlayerDiagnostic('liveRetryWithPlayerRecreation', { streamId, platform: Platform.OS });
      recreatePlayer();
      return;
    }

    // If active engine is VLC, reload VLC source and play
    if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
      const streamUri = rawUri || validation.uri || sanitizedUri;
      if (streamUri) {
        playerStateRef.current = 'LOADING';
        setPlayerState('LOADING');
        setIsBufferingUI(true);
        setDebouncedBuffering(true);
        try {
          vlcPlayer.muted = false;
          vlcPlayer.autoPlay = true;
          vlcPlayer.source = {
            uri: streamUri,
            userAgent: DEFAULT_IPTV_USER_AGENT,
            vlcOptions: getPlatformVlcOptions({ isLive: true }),
            title: title || channel?.name || 'Live Channel',
          };
          try { vlcPlayer.play(); } catch (_e) {}
        } catch (_vlcErr) {}
      }
      return;
    }

    if (!player || !validation.isValid || !playerSource) return;
    const reqId = ++requestCounterRef.current;
    lastToastedAttemptIdRef.current = null;
    if (externalPlayer) {
      externalPlayer._playerState = 'LOADING';
      externalPlayer._playbackError = null;
      externalPlayer._errorUri = null;
      externalPlayer._errorMessage = null;
      externalPlayer._hasEverPlayed = false;
      externalPlayer._attemptId = reqId;
      externalPlayer._lastToastedAttemptId = null;
    }
    attemptedFallbackUrlsRef.current.clear();
    autoRecoveryAttemptedRef.current = false;
    hasEverPlayedRef.current = false;
    setHasFirstFrame(false);
    lastPlaybackTimeRef.current = -1;
    lastAdvanceTimeRef.current = Date.now();
    currentUrlRef.current = validation.uri;
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

    clearAllWatchdogs();
    startReadinessPoller(reqId);
    armActiveRecoveryWatchdog(reqId, playerSource);

    loadTimeoutRef.current = setTimeout(() => {
      if (reqId === requestCounterRef.current && (playerStateRef.current === 'LOADING' || playerStateRef.current === 'BUFFERING' || playerStateRef.current === 'RETRYING')) {
        logPlayerDiagnostic('liveRetryConnectSlow', {
          streamId,
          reqId,
          platform: Platform.OS,
          url: validation.uri,
          durationMs: 25000,
        });
      }
    }, 25000);

    replaceQueueRef.current = replaceQueueRef.current.then(async () => {
      if (reqId !== requestCounterRef.current) return;
      try {
        if (Platform.OS === 'ios' && typeof player.replaceAsync === 'function') {
          try {
            await player.replaceAsync(null);
            await new Promise((resolve) => setTimeout(resolve, 40));
          } catch (_e) {}
        }
        if (reqId !== requestCounterRef.current) return;

        if (typeof player.replaceAsync === 'function') {
          await player.replaceAsync(playerSource);
        } else {
          player.replace(playerSource);
        }

        if (reqId === requestCounterRef.current && playbackIntentRef.current === 'PLAYING' && !userPausedRef.current) {
          try {
            player.muted = false;
            player.volume = volumeRef.current || 1.0;
            player.play();
          } catch (_e) {}
          if (player.status === 'readyToPlay' || player.playing) {
            hasEverPlayedRef.current = true;
            setHasFirstFrame(true);
            playerStateRef.current = 'PLAYING';
            setPlayerState('PLAYING');
            if (externalPlayer) {
              externalPlayer._playerState = 'PLAYING';
              externalPlayer._hasEverPlayed = true;
            }
            if (bufferTimerRef.current) {
              clearTimeout(bufferTimerRef.current);
              bufferTimerRef.current = null;
            }
            setIsBufferingUI(false);
            setDebouncedBuffering(false);
          }
          initiateAutoPlayback(reqId);
        }
      } catch (err) {
        if (reqId === requestCounterRef.current) {
          triggerErrorState(err, reqId);
        }
      }
    });
  }, [player, validation, playerSource, triggerErrorState, setDebouncedBuffering, clearAllWatchdogs, externalPlayer, recreatePlayer, streamId, startReadinessPoller, armActiveRecoveryWatchdog, initiateAutoPlayback]);

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
    setHasFirstFrame(true);
    hasEverPlayedRef.current = true;
    if (externalPlayer) {
      externalPlayer._hasEverPlayed = true;
    }
    try {
      if (player) {
        player.muted = false;
        player.volume = volumeRef.current || 1.0;
      }
    } catch (_e) {}

    if (playerStateRef.current !== 'PAUSED' && !userPausedRef.current) {
      playerStateRef.current = 'PLAYING';
      setPlayerState('PLAYING');
      if (externalPlayer) externalPlayer._playerState = 'PLAYING';
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

    logPlayerDiagnostic('liveStartupTimings', {
      totalSelectionToFirstFrameMs: totalLatency,
      t0_selection_to_url_ms: t0_to_t1,
      t1_url_to_assigned_ms: t1_to_t3,
      t3_assigned_to_ready_ms: t3_to_t5,
      t5_ready_to_playback_ms: t5_to_t8,
      t8_playback_to_first_frame_ms: t8_to_t7,
      streamId,
      platform: Platform.OS,
    });
  }, [externalPlayer, streamId, setDebouncedBuffering, confirmPlaybackActive, player]);

  const videoViewProps = useMemo(() => getPlatformVideoViewProps({ contentFit, isMini }), [contentFit, isMini]);

  if (!channel && !validation.isValid && !rawUri) {
    return (
      <View style={styles.placeholderContainer}>
        <Text style={styles.placeholderText}>Select a channel to start watching</Text>
      </View>
    );
  }

  if (!validation.isValid && (channel || rawUri)) {
    return (
      <View style={[styles.playerContainer, !isMini && styles.expandedContainer]}>
        <View style={styles.videoViewport}>
          <BrokenVideoView
            title="Unable to Play Video"
            heading="Unable to Play Video"
            errorMessage="Unable to play this stream."
            message="Unable to play this stream."
            explanation="The stream address is invalid or unavailable."
            onRetry={handleRetry}
            onBack={onClose || onMinimize}
            isMini={isMini}
            insets={insets}
          />
        </View>
      </View>
    );
  }

  const isPlaying = (playerState === 'PLAYING' || playerState === 'LOADING' || playerState === 'BUFFERING' || playerState === 'RETRYING') && playerState !== 'PAUSED' && playerState !== 'ERROR';
  const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR' && (
    playerState === 'LOADING' ||
    playerState === 'BUFFERING' ||
    playerState === 'RETRYING' ||
    (isBufferingUI && playerState !== 'PLAYING')
  );

  const canSeekStream = Boolean(duration > 0 && isFinite(duration));

  return (
    <View style={[styles.playerContainer, !isMini && styles.expandedContainer]}>
      {/* Video Viewport (bounded container) */}
      <View style={styles.videoViewport}>
        <View
          ref={viewportRef}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          onLayout={(e) => measureAndLogLayout('EmbeddedVideoPlayer:videoViewport', viewportRef, e.nativeEvent.layout, insets, { mode })}
        />
        {/* Layer 1: Unified Dual Playback Video Surface — NEVER unmounts, pointerEvents none prevents native touch capture */}
        <View
          ref={videoSurfaceRef}
          style={[StyleSheet.absoluteFill, styles.videoSurface]}
          pointerEvents="none"
          onLayout={(e) => measureAndLogLayout('EmbeddedVideoPlayer:videoSurface', videoSurfaceRef, e.nativeEvent.layout, insets, { mode })}
        >
          <UnifiedVideoSurface
            style={StyleSheet.absoluteFill}
            activeEngineType={activeEngineType}
            nativePlayer={player}
            vlcPlayer={vlcPlayer}
            contentFit={contentFit}
            isMini={isMini}
            isSwitching={isSwitchingEngine}
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
              onLayout={(e) => measureAndLogLayout('EmbeddedVideoPlayer:unifiedOverlay', unifiedOverlayRef, e.nativeEvent.layout, insets, { mode })}
            />
            {/* Layer 2: Master Gesture Overlay & Touch Zones */}
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
              isMini={isMini}
              insets={insets}
              onHudChange={setGestureHud}
            />

            {/* Layer 7: Unified PlayerControls — automatically adapts between mini & expanded */}
            <View
              ref={controlsContainerRef}
              style={styles.controlsContainer}
              pointerEvents={controlsVisible ? 'box-none' : 'none'}
              onLayout={(e) => measureAndLogLayout('EmbeddedVideoPlayer:controlsContainer', controlsContainerRef, e.nativeEvent.layout, insets, { mode })}
            >
              <PlayerControls
                opacityAnim={controlsOpacityRef.current}
                isPlaying={isPlaying}
                onTogglePlay={togglePlay}
                title={title || 'Live Channel'}
                type="live"
                isLive={true}
                canSeek={canSeekStream}
                currentTime={currentTime}
                duration={duration}
                onSeek={handleSeek}
                onSeekingChange={handleSeekingChange}
                onRewind={handleRewind}
                onForward={handleForward}
                isMuted={isMuted}
                onToggleMute={toggleMute}
                contentFit={contentFit}
                onCycleFit={!isMini ? cycleFitMode : undefined}
                onFullscreen={isMini ? onExpand : onMinimize}
                onBack={!isMini ? onMinimize : undefined}
                onBackdropPress={toggleControls}
                isMini={isMini}
                streamId={streamId || channel?.streamId || channel?.id}
                extension={extension || channel?.containerExtension || 'ts'}
                poster={channel?.poster || channel?.logo || channel?.stream_icon}
                url={url}
                insets={insets}
                topAnim={topAnim}
                centerAnim={centerAnim}
                bottomAnim={bottomAnim}
                isBuffering={isWaitingForMedia}
                bufferingLabel={playerState === 'RETRYING' ? 'Connecting fallback stream...' : (playerState === 'LOADING' ? 'Connecting stream...' : 'Buffering...')}
                gestureHud={gestureHud}
                availableAudioTracks={availableAudioTracks}
                selectedAudioTrack={selectedAudioTrack}
                onSelectAudioTrack={handleSelectAudioTrack}
                availableSubtitleTracks={availableSubtitleTracks}
                selectedSubtitleTrack={selectedSubtitleTrack}
                onSelectSubtitleTrack={handleSelectSubtitleTrack}
                onBeforeOpenTrackModal={handleBeforeOpenTrackModal}
                activeEngineType={activeEngineType}
                engineMode={engineMode}
                onOpenEngineModal={undefined}
              />
            </View>
          </View>
        )}

        {/* Layer 3.5: Independent Buffering & Loading Overlay — ALWAYS visible while buffering, regardless of controls */}
        {playerState !== 'ERROR' && playerState !== 'PAUSED' && (
          <View style={styles.bufferingOverlay} pointerEvents="none">
            <View style={styles.bufferingCenterBox}>
              <BufferingIndicator
                visible={isWaitingForMedia && playerState !== 'PAUSED'}
                size={isMini ? 32 : 52}
                strokeWidth={isMini ? 3 : 3.8}
                isMini={isMini}
                showLabel={!isMini}
                labelText={playerState === 'RETRYING' ? 'Connecting fallback stream...' : (playerState === 'LOADING' ? 'Connecting stream...' : 'Buffering...')}
              />
            </View>
          </View>
        )}

        {/* Layer 4: Seek HUD Feedback */}
        {seekFeedback && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.seekFeedbackBox,
              {
                opacity: seekFeedbackAnimRef.current,
                transform: [{ scale: seekFeedbackAnimRef.current.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
              },
            ]}
          >
            <Text style={styles.seekFeedbackText}>{seekFeedback.text}</Text>
          </Animated.View>
        )}

        {/* Layer 5: Error State */}
        {playerState === 'ERROR' && (
          <BrokenVideoView
            title={errorDetails?.heading || 'Unable to Play Video'}
            heading={errorDetails?.heading || 'Unable to Play Video'}
            errorMessage={errorDetails?.exactError || errorDetails?.message || errorMessage || 'Unable to play this stream.'}
            message={errorDetails?.message || errorMessage || 'Unable to play this stream.'}
            exactError={errorDetails?.exactError}
            errorCode={errorDetails?.errorCode}
            explanation={errorDetails?.explanation || 'This stream may be temporarily unavailable or off-air.'}
            canRetry={errorDetails ? errorDetails.canRetry : true}
            onRetry={handleRetry}
            onBack={onClose || onMinimize}
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
            isMini={isMini}
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
        bottomOffset={isMini ? 44 : 90}
      />

      {/* Layer 8: Dual Playback Engine Selection Modal */}
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
              target = (vlcAvail && (isMkvStream || (Platform.OS === 'ios' && isTsStream))) ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
            }
            if (target !== activeEngineType) {
              await switchEngine(target, ENGINE_SWITCH_REASON.MANUAL_SWITCH);
            }
          } catch (_e) {}
        }}
        onClose={() => setShowEngineModal(false)}
        onDismiss={() => setShowEngineModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  playerContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  expandedContainer: {
    borderRadius: 0,
    borderWidth: 0,
  },
  placeholderContainer: {
    flex: 1,
    backgroundColor: Colors.background.primary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderText: {
    fontSize: 13,
    color: Colors.text.tertiary,
    fontWeight: '500',
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
    top: '38%',
    backgroundColor: 'rgba(18, 18, 20, 0.94)',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.brand.primary,
    zIndex: 25,
  },
  seekFeedbackText: {
    color: '#FFFFFF',
    fontSize: 14,
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
