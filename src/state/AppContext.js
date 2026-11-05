import React, { createContext, useContext, useReducer, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import {
  getSavedIdentity,
  restoreIdentity,
  createFreshIdentity,
  getAndroidDeviceId,
} from '../storage/deviceStorage';
import {
  registerDevice,
  checkAppUpdate,
  getDevicePlaylists,
  setActiveDevicePlaylist,
  deleteDevicePlaylist,
  setDeviceIdLock,
  getDeviceIdLock,
  getSubscriptionStatus,
  activateTrial as activateTrialApi,
  recoverDeviceByAndroidId,
} from '../services/apiService';
import { syncPlaylist, getCachedChannels, getCachedMovies, getCachedSeries, getCachedConfig } from '../services/iptvService';
import {
  getSavedPlaylists,
  savePlaylist,
  syncSavedPlaylistsWithRemote,
  getActivePlaylistId,
  setActivePlaylistId,
  deletePlaylist as deletePlaylistStorage,
  migrateLegacyPlaylist,
  hydratePlaylistCredentials,
} from '../storage/playlistStorage';
import { cleanupLegacySqlite } from '../storage/legacyDbCleanup';
import { clearPlaylistCache, clearAllPlaylistCaches, readCache, writeCache } from '../storage/cacheStorage';
import * as Network from 'expo-network';
import { isAdultPinEnabled } from '../storage/pinStorage';
import { DEVICE_STATUS, CONFIG_TYPES, DATASET_STATUS, CACHE_FRESHNESS_MS, SYNC_STATUS, REFRESH_STATE, API_BASE_URL } from '../constants';
import { logSync, logRefresh } from '../utils/diagnostics';
import { resolvePlaylistSourceConfig } from '../utils/playlistSourceResolver';
import {
  ERROR_CATEGORY,
  AppNetworkError,
  isAbortOrCancelledError,
  getUserFriendlyErrorMessage,
  isProviderExpiredError,
  isPlaylistExpired,
} from '../services/networkErrors';
import {
  getAllFavorites,
  toggleFavorite as toggleFavoriteStorage,
  restoreUserDataFromRecovery,
  removeFavorite as removeFavoriteStorage,
  getFavoriteKey,
  createUnifiedFavorite,
} from '../storage/userStorage';
import { toastService } from '../services/toastService';
import {
  normalizeSubscriptionRecord,
  extractSubscriptionFromStatusResponse,
} from '../utils/subscriptionUtils';
import AppUpdateModal from '../components/AppUpdateModal';

const AppContext = createContext(null);

const initialState = {
  // Profiles (authoritatively fetched from API device playlists)
  isProfilePickerOpen: false,

  // Device & Installation UUID
  installationId: null,
  deviceId: null,
  deviceStatus: DEVICE_STATUS.UNREGISTERED,
  idLock: false,
  pairingToken: null,
  pairingCode: null,

  // Authoritative Device Subscription & Free Trial
  subscription: null,
  isSubscriptionValid: true,
  subscriptionError: null,
  isTrialEligible: false,
  trialDurationDays: 7,
  appExpiresAt: null,

  // Multi-Playlist Registry & Dataset Lifecycle
  savedPlaylists: [],
  activePlaylistId: null,
  activePlaylist: null,
  playbackSessionId: 1,
  playlistStatuses: {},
  
  // Configuration
  isConfigured: false,
  configType: null,
  playlistConfig: null,
  lastSyncAt: null,

  // Content
  liveData: null,
  moviesData: null,
  seriesData: null,

  // In-memory cache stores for instant tab switching (0ms latency)
  moviesStore: {
    categories: [],
    allMovies: [],
    categoryMap: {},
    loaded: false,
    syncedAt: null,
  },
  seriesStore: {
    categories: [],
    allSeries: [],
    categoryMap: {},
    loaded: false,
    syncedAt: null,
  },

  // Authoritative Central Refresh & Switch Lifecycle State Machine
  refreshState: REFRESH_STATE.IDLE,
  refreshStep: '',
  refreshProgress: 0,
  refreshError: null,
  refreshTargetPlaylistId: null,

  // Explicit Sync Coordinator state (kept synchronized for backward compatibility)
  syncStatus: SYNC_STATUS.IDLE,
  isSyncing: false,
  isRefreshing: false,
  syncProgress: 0,
  syncStep: '',
  syncError: null,

  // Playlist Expired Modal State
  playlistExpiredModal: {
    visible: false,
    playlistId: null,
    playlistName: '',
    reason: 'expired',
  },

  // Adult content
  adultPinEnabled: false,
  adultUnlocked: false,

  // Unified Favorites
  favorites: [],
  favoritesLoaded: false,

  // App state
  isInitialized: false,
  initError: null,
};

function buildStoreFromMovies(moviesData, playlistId = null) {
  const pid = playlistId || moviesData?.playlistId || null;
  if (!moviesData) {
    return { playlistId: pid, categories: [], allMovies: [], categoryMap: {}, loaded: false, syncedAt: null };
  }
  const categories = Array.isArray(moviesData.categories) ? moviesData.categories : [];
  const map = {};
  const all = [];
  for (const cat of categories) {
    if (Array.isArray(cat.items) && cat.items.length > 0) {
      map[String(cat.id)] = cat.items;
      all.push(...cat.items);
    }
  }
  return { playlistId: pid, categories, allMovies: all, categoryMap: map, loaded: true, syncedAt: Date.now() };
}

function buildStoreFromSeries(seriesData, playlistId = null) {
  const pid = playlistId || seriesData?.playlistId || null;
  if (!seriesData) {
    return { playlistId: pid, categories: [], allSeries: [], categoryMap: {}, loaded: false, syncedAt: null };
  }
  const categories = Array.isArray(seriesData.categories) ? seriesData.categories : [];
  const map = {};
  const all = [];
  for (const cat of categories) {
    if (Array.isArray(cat.items) && cat.items.length > 0) {
      map[String(cat.id)] = cat.items;
      all.push(...cat.items);
    }
  }
  const expectedTotal = Number(seriesData?.total) || categories.reduce(
    (acc, c) => acc + (Number(c?.itemCount) || (Array.isArray(c?.items) ? c.items.length : 0)),
    0,
  );
  const loaded = all.length > 0 || expectedTotal === 0;
  return {
    playlistId: pid,
    categories,
    allSeries: all,
    categoryMap: map,
    loaded,
    syncedAt: loaded ? Date.now() : null,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_INSTALLATION_ID':
      return { ...state, installationId: action.payload };
    case 'SET_SUBSCRIPTION': {
      const sub = action.payload
        ? normalizeSubscriptionRecord(action.payload, action.payload)
        : null;
      const isValid = sub
        ? (sub.is_valid !== undefined
            ? Boolean(sub.is_valid)
            : (sub.is_active !== undefined ? Boolean(sub.is_active) : sub.status === 'active'))
        : true;
      return {
        ...state,
        subscription: sub,
        isSubscriptionValid: isValid,
        appExpiresAt: sub?.expires_at || null,
        isTrialEligible: sub ? false : state.isTrialEligible,
      };
    }
    case 'SET_TRIAL_ELIGIBILITY':
      return {
        ...state,
        isTrialEligible: Boolean(action.payload?.is_trial_eligible),
        trialDurationDays: action.payload?.trial_settings?.duration_days || state.trialDurationDays || 7,
      };
    case 'SET_SUBSCRIPTION_ERROR':
      return { ...state, subscriptionError: action.payload };
    case 'SET_DEVICE_ID':
      return { ...state, deviceId: action.payload };
    case 'SET_DEVICE_STATUS':
      return { ...state, deviceStatus: action.payload };
    case 'SET_ID_LOCK':
      return { ...state, idLock: Boolean(action.payload) };
    case 'SET_PAIRING_INFO':
      return { ...state, pairingToken: action.payload.token, pairingCode: action.payload.code };
    case 'SET_PLAYLISTS':
      return {
        ...state,
        savedPlaylists: action.payload.playlists || [],
        activePlaylistId: action.payload.activePlaylistId ?? state.activePlaylistId,
        activePlaylist: action.payload.activePlaylist ?? state.activePlaylist,
      };
    case 'SET_ACTIVE_PLAYLIST':
      return {
        ...state,
        activePlaylistId: action.payload.activePlaylistId,
        activePlaylist: action.payload.activePlaylist,
        playbackSessionId: state.playbackSessionId + 1,
      };
    case 'RESET_PLAYBACK_SESSION':
      return {
        ...state,
        playbackSessionId: state.playbackSessionId + 1,
      };
    case 'SET_CONFIGURED':
      return {
        ...state,
        isConfigured: action.payload.isConfigured,
        configType: action.payload.configType || null,
        playlistConfig: action.payload.playlistConfig ?? state.playlistConfig,
      };
    case 'COMMIT_PLAYLIST_ACTIVE': {
      const {
        playlistId,
        playlistObj,
        savedPlaylists,
        live,
        movies,
        series,
        movieStore,
        seriesStore,
        favorites,
        config,
      } = action.payload;

      const pid = String(playlistId);

      return {
        ...state,
        activePlaylistId: pid,
        activePlaylist: playlistObj || null,
        savedPlaylists: savedPlaylists || state.savedPlaylists,
        liveData: live ? { ...live, playlistId: pid } : null,
        moviesData: movies ? { ...movies, playlistId: pid } : null,
        seriesData: series ? { ...series, playlistId: pid } : null,
        moviesStore: movieStore || { playlistId: pid, categories: [], allMovies: [], categoryMap: {}, loaded: false, syncedAt: null },
        seriesStore: seriesStore || { playlistId: pid, categories: [], allSeries: [], categoryMap: {}, loaded: false, syncedAt: null },
        favorites: Array.isArray(favorites) ? favorites : [],
        favoritesLoaded: true,
        playlistConfig: config || null,
        configType: config?.type || playlistObj?.type || null,
        isConfigured: true,
        deviceStatus: DEVICE_STATUS.READY,
        playbackSessionId: state.playbackSessionId + 1,
        lastSyncAt: Date.now(),
      };
    }
    case 'SET_CONTENT': {
      const pid = action.payload?.playlistId;
      if (pid && String(pid) !== String(state.activePlaylistId)) {
        return state; // Stale response guard
      }
      const effectiveId = pid || state.activePlaylistId;
      return {
        ...state,
        liveData: action.payload.live !== undefined ? (action.payload.live ? { ...action.payload.live, playlistId: effectiveId } : null) : state.liveData,
        moviesData: action.payload.movies !== undefined ? (action.payload.movies ? { ...action.payload.movies, playlistId: effectiveId } : null) : state.moviesData,
        seriesData: action.payload.series !== undefined ? (action.payload.series ? { ...action.payload.series, playlistId: effectiveId } : null) : state.seriesData,
        lastSyncAt: action.payload.syncedAt ?? state.lastSyncAt,
      };
    }
    case 'CLEAR_PLAYLIST_CONTENT':
      return {
        ...state,
        liveData: null,
        moviesData: null,
        seriesData: null,
        moviesStore: { playlistId: null, categories: [], allMovies: [], categoryMap: {}, loaded: false, syncedAt: null },
        seriesStore: { playlistId: null, categories: [], allSeries: [], categoryMap: {}, loaded: false, syncedAt: null },
        favorites: [],
        favoritesLoaded: false,
      };
    case 'SET_MOVIES_STORE': {
      const pid = action.payload?.playlistId || state.activePlaylistId;
      if (action.payload?.playlistId && String(action.payload.playlistId) !== String(state.activePlaylistId)) {
        return state; // Stale response guard
      }
      return {
        ...state,
        moviesStore: {
          ...state.moviesStore,
          ...action.payload,
          playlistId: pid,
          loaded: true,
          syncedAt: Date.now(),
        },
      };
    }
    case 'SET_SERIES_STORE': {
      const pid = action.payload?.playlistId || state.activePlaylistId;
      if (action.payload?.playlistId && String(action.payload.playlistId) !== String(state.activePlaylistId)) {
        return state; // Stale response guard
      }
      return {
        ...state,
        seriesStore: {
          ...state.seriesStore,
          ...action.payload,
          playlistId: pid,
          loaded: true,
          syncedAt: Date.now(),
        },
      };
    }
    case 'START_PLAYLIST_LIFECYCLE': {
      const mode = action.payload.mode;
      const isRefresh = mode === REFRESH_STATE.REFRESHING;
      return {
        ...state,
        playlistExpiredModal: {
          visible: false,
          playlistId: null,
          playlistName: '',
          reason: 'expired',
        },
        refreshState: mode,
        refreshStep: action.payload.step || (isRefresh ? 'Refreshing playlist...' : 'Switching playlist...'),
        refreshProgress: action.payload.progress ?? 0.05,
        refreshError: null,
        refreshTargetPlaylistId: action.payload.targetPlaylistId ?? null,
        isSyncing: true,
        isRefreshing: isRefresh,
        syncStatus: isRefresh ? SYNC_STATUS.REFRESHING : SYNC_STATUS.SYNCING,
        syncStep: action.payload.step || (isRefresh ? 'Refreshing playlist...' : 'Switching playlist...'),
        syncProgress: action.payload.progress ?? 0.05,
        syncError: null,
      };
    }
    case 'UPDATE_PLAYLIST_LIFECYCLE': {
      return {
        ...state,
        refreshState: action.payload.state ?? state.refreshState,
        refreshStep: action.payload.step ?? state.refreshStep,
        refreshProgress: action.payload.progress ?? state.refreshProgress,
        syncStep: action.payload.step ?? state.syncStep,
        syncProgress: action.payload.progress ?? state.syncProgress,
      };
    }
    case 'COMPLETE_PLAYLIST_LIFECYCLE': {
      return {
        ...state,
        playlistExpiredModal: {
          visible: false,
          playlistId: null,
          playlistName: '',
          reason: 'expired',
        },
        refreshState: REFRESH_STATE.IDLE,
        refreshStep: 'Ready',
        refreshProgress: 1,
        refreshError: null,
        refreshTargetPlaylistId: null,
        isSyncing: false,
        isRefreshing: false,
        syncStatus: SYNC_STATUS.READY,
        syncStep: 'Ready',
        syncProgress: 1,
        syncError: null,
        lastSyncAt: Date.now(),
      };
    }
    case 'FAIL_PLAYLIST_LIFECYCLE': {
      const isRecoverable = action.payload.recoverable !== false;
      return {
        ...state,
        refreshState: isRecoverable ? REFRESH_STATE.ERROR : REFRESH_STATE.IDLE,
        refreshStep: action.payload.step || 'Connection Error',
        refreshProgress: 0,
        refreshError: action.payload.error || 'Failed to refresh playlist.',
        isSyncing: false,
        isRefreshing: false,
        syncStatus: SYNC_STATUS.ERROR,
        syncStep: '',
        syncProgress: 0,
        syncError: action.payload.error || 'Failed to refresh playlist.',
      };
    }
    case 'SHOW_PLAYLIST_EXPIRED_DIALOG': {
      const targetPid = action.payload?.playlistId ? String(action.payload.playlistId) : state.activePlaylistId;
      const isTargetActive = !state.activePlaylistId || String(targetPid) === String(state.activePlaylistId);
      return {
        ...state,
        playlistExpiredModal: {
          visible: true,
          playlistId: targetPid,
          playlistName: action.payload?.playlistName || (isTargetActive ? state.activePlaylist?.name : '') || 'Playlist',
          reason: action.payload?.reason || 'expired',
        },
        // Only trigger full-screen expired refresh state if the ACTIVE playlist is expired
        refreshState: isTargetActive ? REFRESH_STATE.EXPIRED : (state.refreshState === REFRESH_STATE.SWITCHING ? REFRESH_STATE.IDLE : state.refreshState),
        refreshStep: isTargetActive ? 'Subscription Expired' : state.refreshStep,
        refreshError: null,
        isSyncing: false,
        isRefreshing: false,
        syncError: null,
      };
    }
    case 'HIDE_PLAYLIST_EXPIRED_DIALOG':
      return {
        ...state,
        playlistExpiredModal: {
          visible: false,
          playlistId: null,
          playlistName: '',
          reason: 'expired',
        },
        refreshState: state.refreshState === REFRESH_STATE.EXPIRED ? REFRESH_STATE.IDLE : state.refreshState,
      };
    case 'DISMISS_PLAYLIST_REFRESH_ERROR': {
      return {
        ...state,
        refreshState: REFRESH_STATE.IDLE,
        refreshError: null,
        refreshStep: '',
        refreshProgress: 0,
        isSyncing: false,
        isRefreshing: false,
      };
    }
    case 'SET_SYNC_STATUS':
      return {
        ...state,
        syncStatus: action.payload.status ?? state.syncStatus,
        isSyncing: action.payload.isSyncing !== undefined ? action.payload.isSyncing : state.isSyncing,
        isRefreshing: action.payload.isRefreshing !== undefined ? action.payload.isRefreshing : state.isRefreshing,
        syncProgress: action.payload.progress ?? state.syncProgress,
        syncStep: action.payload.step !== undefined ? action.payload.step : state.syncStep,
        syncError: action.payload.error !== undefined ? action.payload.error : state.syncError,
        lastSyncAt: action.payload.syncedAt ?? state.lastSyncAt,
      };
    case 'SET_SYNCING':
      return {
        ...state,
        isSyncing: action.payload.syncing,
        isRefreshing: action.payload.isRefreshing ?? false,
        syncStatus: action.payload.syncing
          ? (action.payload.isRefreshing ? SYNC_STATUS.REFRESHING : SYNC_STATUS.SYNCING)
          : (action.payload.error ? SYNC_STATUS.ERROR : (state.isConfigured ? SYNC_STATUS.READY : SYNC_STATUS.IDLE)),
        syncProgress: action.payload.progress ?? 0,
        syncStep: action.payload.step ?? '',
        syncError: action.payload.error ?? null,
      };
    case 'SET_SYNC_PROGRESS':
      return { ...state, syncProgress: action.payload.progress, syncStep: action.payload.step };
    case 'SET_ADULT_PIN_ENABLED':
      return { ...state, adultPinEnabled: action.payload };
    case 'SET_ADULT_UNLOCKED':
      return { ...state, adultUnlocked: action.payload };
    case 'SET_FAVORITES':
      return { ...state, favorites: action.payload || [], favoritesLoaded: true };
    case 'OPTIMISTIC_TOGGLE_FAVORITE': {
      const { item, typeOverride } = action.payload;
      const unified = createUnifiedFavorite(item, typeOverride);
      const targetKey = getFavoriteKey(unified.type, unified.id);
      const existingIndex = state.favorites.findIndex(
        (f) => getFavoriteKey(f.type, f.id) === targetKey
      );
      let updated;
      if (existingIndex >= 0) {
        updated = state.favorites.filter((_, idx) => idx !== existingIndex);
      } else {
        updated = [unified, ...state.favorites];
      }
      return { ...state, favorites: updated, favoritesLoaded: true };
    }
    case 'OPTIMISTIC_REMOVE_FAVORITE': {
      const { type, id } = action.payload;
      const targetKey = getFavoriteKey(type, id);
      const updated = state.favorites.filter((f) => getFavoriteKey(f.type, f.id) !== targetKey);
      return { ...state, favorites: updated, favoritesLoaded: true };
    }
    case 'SET_PLAYLIST_STATUS': {
      const { playlistId, status, error, syncedAt } = action.payload;
      if (!playlistId) return state;
      return {
        ...state,
        playlistStatuses: {
          ...state.playlistStatuses,
          [playlistId]: {
            status,
            error: error ?? null,
            syncedAt: syncedAt ?? state.playlistStatuses[playlistId]?.syncedAt ?? null,
          },
        },
      };
    }
    case 'SET_PROFILE_PICKER_OPEN':
      return { ...state, isProfilePickerOpen: Boolean(action.payload) };
    case 'SET_INITIALIZED':
      return { ...state, isInitialized: true, initError: action.payload ?? null };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [appUpdateOffer, setAppUpdateOffer] = useState(null);
  const dismissedAppUpdateCodeRef = useRef(0);
  const appUpdateInFlightRef = useRef(false);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyAppUpdateResult = useCallback((res) => {
    if (!res?.update_available || !res?.latest) {
      setAppUpdateOffer(null);
      return;
    }
    const code = Number(res.latest.version_code) || 0;
    if (!res.force_update && code > 0 && code <= dismissedAppUpdateCodeRef.current) {
      setAppUpdateOffer(null);
      return;
    }
    setAppUpdateOffer(res);
  }, []);

  const runAppUpdateCheck = useCallback(async () => {
    if (appUpdateInFlightRef.current) return;
    appUpdateInFlightRef.current = true;
    try {
      const res = await Promise.race([
        checkAppUpdate(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('APP_UPDATE_CHECK_TIMEOUT')), 8000);
        }),
      ]);
      applyAppUpdateResult(res);
    } catch (_e) {
      /* non-blocking */
    } finally {
      appUpdateInFlightRef.current = false;
    }
  }, [applyAppUpdateResult]);

  useEffect(() => {
    if (!state.isInitialized) return undefined;
    const timer = setTimeout(() => runAppUpdateCheck(), 1200);
    return () => clearTimeout(timer);
  }, [state.isInitialized, runAppUpdateCheck]);

  useEffect(() => {
    if (!state.isInitialized) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') runAppUpdateCheck();
    });
    return () => sub.remove();
  }, [state.isInitialized, runAppUpdateCheck]);

  const dismissAppUpdate = useCallback(() => {
    const code = Number(appUpdateOffer?.latest?.version_code) || 0;
    if (code > 0) dismissedAppUpdateCodeRef.current = code;
    setAppUpdateOffer(null);
  }, [appUpdateOffer]);

  const switchVersionRef = useRef(0);
  const activePlaylistIdRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const syncSequenceRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);
  const wasOfflineRef = useRef(false);

  // Authoritative Central Lifecycle Coordinator Refs
  const coordinatorOpIdRef = useRef(0);
  const inFlightCoordinatorPromiseRef = useRef(null);
  const inFlightTargetIdRef = useRef(null);
  const lastLifecycleParamsRef = useRef(null);
  const activeLifecycleAbortControllerRef = useRef(null);

  /**
   * Initialize the app — device ID, saved playlists, active playlist, and scoped cache loading
   */
  const initialize = useCallback(async () => {
    try {
      // 0. Non-blocking legacy SQLite cleanup — runs in background, never blocks startup
      cleanupLegacySqlite().catch(() => {});

      // 1. Get or create installation identity with automatic Android ID recovery
      let identity = await getSavedIdentity();
      let isRecovered = false;
      let recoveredData = null;

      if (!identity) {
        // App sandbox was wiped (e.g. reinstall) or first launch
        if (Platform.OS === 'android') {
          const androidId = getAndroidDeviceId();
          if (androidId) {
            try {
              const recRes = await recoverDeviceByAndroidId(androidId);
              if (recRes && recRes.success && recRes.recovered && recRes.device_id) {
                identity = await restoreIdentity(recRes.device_id, recRes.installation_id, androidId);
                isRecovered = true;
                recoveredData = recRes;
              }
            } catch (recErr) {
              console.warn('[App] Automatic recovery network check failed:', recErr?.message);
            }
          }
        }

        if (!identity) {
          identity = await createFreshIdentity(Platform.OS === 'android' ? getAndroidDeviceId() : null);
        }
      }

      const deviceId = identity.deviceId;
      const installationId = identity.installationId;
      const androidId = identity.androidId || (Platform.OS === 'android' ? getAndroidDeviceId() : null);

      dispatch({ type: 'SET_INSTALLATION_ID', payload: installationId });
      dispatch({ type: 'SET_DEVICE_ID', payload: deviceId });
      dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.REGISTERED });

      // If recovered from backend via Android ID, immediately hydrate recovered subscription and user data
      if (isRecovered && recoveredData) {
        if (recoveredData.subscription) {
          dispatch({ type: 'SET_SUBSCRIPTION', payload: recoveredData.subscription });
          writeCache('fox_player_cached_subscription', recoveredData.subscription).catch(() => {});
        }
        if (recoveredData.userData) {
          restoreUserDataFromRecovery(recoveredData.userData).catch(() => {});
        }
      }

      // 2. Run backend registration AND local data loading in parallel for faster startup
      //    Backend calls (network) and local storage reads don't depend on each other.
      let remotePlaylists = [];
      let authoritativeRemoteReceived = false;
      const backendPromise = (async () => {
        try {
          const regRes = await registerDevice(deviceId, { installationId, androidId });
          if (regRes?.device_id && regRes.device_id !== deviceId) {
            dispatch({ type: 'SET_DEVICE_ID', payload: regRes.device_id });
          }
          const hasSub = Boolean(regRes?.subscription || (regRes?.has_subscription && (regRes?.is_active || regRes?.is_valid)));
          const subData = regRes?.subscription || (hasSub ? regRes : null);
          if (subData) {
            dispatch({ type: 'SET_SUBSCRIPTION', payload: subData });
            writeCache('fox_player_cached_subscription', subData).catch(() => {});
          } else if (regRes?.is_trial_eligible) {
            dispatch({
              type: 'SET_TRIAL_ELIGIBILITY',
              payload: {
                is_trial_eligible: regRes.is_trial_eligible,
                trial_settings: regRes.trial_settings,
              },
            });
          }
          if (regRes?.device) {
            if (typeof regRes.device.id_lock === 'boolean') {
              dispatch({ type: 'SET_ID_LOCK', payload: regRes.device.id_lock });
            }
            if (regRes.device.pairing_token) {
              dispatch({
                type: 'SET_PAIRING_INFO',
                payload: { token: regRes.device.pairing_token, code: regRes.device.pairing_code },
              });
            }
          }

          const remoteRes = await getDevicePlaylists(deviceId, { installationId });
          if (remoteRes && remoteRes.success && Array.isArray(remoteRes.playlists)) {
            remotePlaylists = remoteRes.playlists;
            authoritativeRemoteReceived = true;
            if (typeof remoteRes.id_lock === 'boolean') {
              dispatch({ type: 'SET_ID_LOCK', payload: remoteRes.id_lock });
            }
          } else if (isRecovered && recoveredData && Array.isArray(recoveredData.playlists) && recoveredData.playlists.length > 0) {
            remotePlaylists = recoveredData.playlists;
            authoritativeRemoteReceived = true;
          }
        } catch (e) {
          // Safe offline fallback: load last authoritative cached subscription
          readCache('fox_player_cached_subscription').then((cachedSub) => {
            if (cachedSub) dispatch({ type: 'SET_SUBSCRIPTION', payload: cachedSub });
          }).catch(() => {});

          if (!isAbortOrCancelledError(e)) {
            const reason = e.category === ERROR_CATEGORY.OFFLINE
              ? 'Device offline'
              : (e.category === ERROR_CATEGORY.BACKEND_UNAVAILABLE
                ? `Server unreachable (${API_BASE_URL})`
                : (e.message || 'Unknown network error'));
            console.warn(`[App] Backend unavailable during init: ${reason}`);
          }
        }
      })();

      // 3. Load local data (PIN + playlists + activeId) in parallel with backend
      const localPromise = (async () => {
        const [pinEnabled, localPlaylists, localActiveId] = await Promise.all([
          isAdultPinEnabled(),
          getSavedPlaylists(),
          getActivePlaylistId(),
        ]);
        return { pinEnabled, localPlaylists, localActiveId };
      })();

      // Wait for both parallel tracks to complete
      await Promise.all([backendPromise, localPromise]);
      const { pinEnabled, localPlaylists, localActiveId } = await localPromise;

      dispatch({ type: 'SET_ADULT_PIN_ENABLED', payload: pinEnabled });

      // 4. Load saved playlists: if remote returned authoritative playlists, reconcile immediately
      let savedPlaylists = [];
      if (authoritativeRemoteReceived) {
        if (remotePlaylists.length === 0) {
          logSync('Server authoritatively confirmed 0 playlists for device. Purging local cache.');
          await syncSavedPlaylistsWithRemote([]);
          await setActivePlaylistId(null);
          await clearAllPlaylistCaches();
          savedPlaylists = [];
        } else {
          savedPlaylists = await syncSavedPlaylistsWithRemote(remotePlaylists, state.deviceId);
        }
      } else {
        savedPlaylists = localPlaylists;
        // If no local playlists, attempt legacy migration
        if (savedPlaylists.length === 0) {
          const legacyConfig = await getCachedConfig();
          if (legacyConfig) {
            await migrateLegacyPlaylist(legacyConfig);
            savedPlaylists = await getSavedPlaylists();
          }
        }
      }

      // If no saved playlists remain, reset configured state immediately and route to pairing setup
      if (savedPlaylists.length === 0) {
        activePlaylistIdRef.current = null;
        await setActivePlaylistId(null);
        dispatch({
          type: 'SET_PLAYLISTS',
          payload: { playlists: [], activePlaylistId: null, activePlaylist: null },
        });
        dispatch({
          type: 'SET_CONFIGURED',
          payload: { isConfigured: false, playlistConfig: null },
        });
        dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
        dispatch({ type: 'SET_INITIALIZED' });
        return;
      }

      // 5. Determine active playlist ID
      let activeId = localActiveId;
      if (!activeId || !savedPlaylists.find((p) => String(p.id) === String(activeId))) {
        const activeServerPl = savedPlaylists.find((p) => p.isActive);
        activeId = activeServerPl?.id || savedPlaylists[0]?.id || null;
      }

      if (activeId) {
        // Non-blocking — we already have the value in memory
        setActivePlaylistId(activeId).catch(() => {});
      }
      activePlaylistIdRef.current = activeId;

      const activePlaylist = savedPlaylists.find((p) => String(p.id) === String(activeId)) || null;

      // 6. Fast Startup: Load live, config, favorites, movies & series ALL in parallel
      const [liveData, configData, favData] = await Promise.all([
        getCachedChannels(true, activeId),
        getCachedConfig(activeId),
        getAllFavorites(activeId),
      ]);

      const isConfigured = !!(activePlaylist || configData);

      if (isConfigured) {
        const confType = activePlaylist?.type || configData?.type || CONFIG_TYPES.XTREAM;
        const confObj = configData || {
          id: activeId,
          type: confType,
          config: activePlaylist,
        };

        dispatch({
          type: 'COMMIT_PLAYLIST_ACTIVE',
          payload: {
            playlistId: activeId,
            playlistObj: activePlaylist,
            savedPlaylists,
            live: liveData ? { ...liveData, playlistId: activeId } : null,
            movies: null,
            series: null,
            movieStore: null,
            seriesStore: null,
            favorites: Array.isArray(favData) ? favData : [],
            config: confObj,
          },
        });

        // Non-blocking background hydration of movies & series — fire immediately (0ms)
        Promise.resolve().then(async () => {
          try {
            if (activePlaylistIdRef.current !== activeId) return;
            const [moviesData, seriesData] = await Promise.all([
              getCachedMovies(true, activeId),
              getCachedSeries(true, activeId),
            ]);
            if (activePlaylistIdRef.current !== activeId) return;

            if (moviesData) {
              const movieStore = buildStoreFromMovies(moviesData, activeId);
              dispatch({ type: 'SET_CONTENT', payload: { playlistId: activeId, movies: moviesData } });
              dispatch({ type: 'SET_MOVIES_STORE', payload: movieStore });
            }
            if (seriesData) {
              const seriesStore = buildStoreFromSeries(seriesData, activeId);
              dispatch({ type: 'SET_CONTENT', payload: { playlistId: activeId, series: seriesData } });
              dispatch({ type: 'SET_SERIES_STORE', payload: seriesStore });
            }
          } catch (_bgErr) {}
        });

        const syncedTime = confObj?.syncedAt || Date.now();
        const isFresh = (Date.now() - syncedTime) < CACHE_FRESHNESS_MS;
        dispatch({
          type: 'SET_PLAYLIST_STATUS',
          payload: {
            playlistId: activeId,
            status: isFresh ? DATASET_STATUS.CACHED : DATASET_STATUS.STALE,
            syncedAt: syncedTime,
          },
        });

        if (isPlaylistExpired(activePlaylist) || isPlaylistExpired(configData)) {
          logRefresh('Active playlist detected as expired during initial launch', { activeId });
          dispatch({
            type: 'SHOW_PLAYLIST_EXPIRED_DIALOG',
            payload: {
              playlistId: activeId,
              playlistName: activePlaylist?.name || 'Current Playlist',
              reason: 'expired',
            },
          });
        }
      } else {
        dispatch({
          type: 'SET_PLAYLISTS',
          payload: {
            playlists: savedPlaylists,
            activePlaylistId: null,
            activePlaylist: null,
          },
        });
        dispatch({
          type: 'SET_CONFIGURED',
          payload: { isConfigured: false, playlistConfig: null },
        });
        dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
      }

      dispatch({ type: 'SET_INITIALIZED' });
    } catch (e) {
      console.error('[App] Initialization error:', e);
      dispatch({ type: 'SET_INITIALIZED', payload: e.message });
    }
  }, []);

  /**
   * Authoritative Central Coordinator for all playlist refresh & switch lifecycles.
   * Ensures deterministic state machine transitions:
   * IDLE -> (REFRESHING | SWITCHING) -> SYNCHRONIZING -> INITIALIZING -> (READY -> IDLE | ERROR)
   *
   * Features:
   * - Strict single-flight deduplication (subsequent identical requests attach to active promise)
   * - Superseded operation protection via monotonic opId (stale responses cannot commit)
   * - Safe player teardown (RESET_PLAYBACK_SESSION)
   * - Full playlist isolation (data scoped by playlistId)
   * - Preserves valid cache on error (no destructive blank states)
   * - Recoverable error state with retry and dismiss
   * - Unconditional cleanup in finally block (NEVER hangs in loading state)
   */
  const executePlaylistLifecycle = useCallback(async ({
    targetPlaylistId = null,
    isManual = false,
    isSwitch = false,
  } = {}) => {
    if (!state.deviceId) {
      return { success: false, error: 'NO_DEVICE_ID' };
    }

    const requestedTargetId = targetPlaylistId ? String(targetPlaylistId) : null;
    const currentActiveId = state.activePlaylistId ? String(state.activePlaylistId) : null;
    const resolvedTargetId = requestedTargetId || currentActiveId;

    // 1. Single-Flight Deduplication:
    // If an identical operation is already running, attach to and return its promise.
    if (inFlightCoordinatorPromiseRef.current) {
      if (inFlightTargetIdRef.current === resolvedTargetId && !isSwitch) {
        logRefresh('Attaching to active lifecycle operation', { resolvedTargetId });
        try {
          return await inFlightCoordinatorPromiseRef.current;
        } catch (e) {
          return { success: false, error: e?.message || 'Operation failed' };
        }
      }
    }

    // Save params for retry
    lastLifecycleParamsRef.current = { targetPlaylistId: resolvedTargetId, isManual, isSwitch };

    // Advance operation ID to cancel / supersede any earlier in-flight operations
    coordinatorOpIdRef.current += 1;
    const currentOpId = coordinatorOpIdRef.current;
    inFlightTargetIdRef.current = resolvedTargetId;

    // Abort any previously running lifecycle network requests
    if (activeLifecycleAbortControllerRef.current) {
      activeLifecycleAbortControllerRef.current.abort();
      activeLifecycleAbortControllerRef.current = null;
    }
    const lifecycleAbortController = new AbortController();
    activeLifecycleAbortControllerRef.current = lifecycleAbortController;

    const lifecyclePromise = (async () => {
      const mode = isSwitch ? REFRESH_STATE.SWITCHING : REFRESH_STATE.REFRESHING;
      const initialStep = isSwitch
        ? 'Switching playlist...'
        : 'Connecting to FOX PLAYER...';

      // 2. Safely tear down active playback session ONLY if refreshing in place.
      // During a switch, keep previous playback session valid until target playlist is confirmed valid.
      if (!isSwitch) {
        dispatch({ type: 'RESET_PLAYBACK_SESSION' });
      }

      // 3. Immediately transition into full refresh / switch loading mode
      dispatch({
        type: 'START_PLAYLIST_LIFECYCLE',
        payload: {
          mode,
          targetPlaylistId: resolvedTargetId,
          step: initialStep,
          progress: 0.05,
        },
      });
      dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.SYNCING });

      let effectiveTargetId = String(resolvedTargetId || '');
      let targetPlaylistObj = null;
      let savedPlaylists = [];

      try {
        // 4. Authoritative check with backend for current device playlists
        let remotePlaylists = [];
        let backendReachable = false;
        try {
          const remoteRes = await getDevicePlaylists(state.deviceId, {
            signal: lifecycleAbortController.signal,
            operationId: currentOpId,
            playlistId: resolvedTargetId,
          });
          if (coordinatorOpIdRef.current !== currentOpId) {
            return { success: false, reason: 'SUPERSEDED' };
          }
          if (remoteRes?.success && Array.isArray(remoteRes.playlists)) {
            backendReachable = true;
            remotePlaylists = remoteRes.playlists;
            if (typeof remoteRes.id_lock === 'boolean') {
              dispatch({ type: 'SET_ID_LOCK', payload: remoteRes.id_lock });
            }
          }
        } catch (netErr) {
          if (isAbortOrCancelledError(netErr)) throw netErr;
          logRefresh('Backend unreachable during playlist check', { error: netErr.message });
        }

        if (coordinatorOpIdRef.current !== currentOpId) {
          return { success: false, reason: 'SUPERSEDED' };
        }

        // CASE 0: Confirmed Zero Playlists on backend
        if (backendReachable && remotePlaylists.length === 0) {
          logSync('Backend confirmed 0 playlists associated with device');
          activePlaylistIdRef.current = null;
          await setActivePlaylistId(null);
          dispatch({
            type: 'SET_PLAYLISTS',
            payload: { playlists: [], activePlaylistId: null, activePlaylist: null },
          });
          dispatch({
            type: 'SET_CONFIGURED',
            payload: { isConfigured: false, playlistConfig: null, configType: null },
          });
          dispatch({ type: 'CLEAR_PLAYLIST_CONTENT' });
          dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
          dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });
          await clearAllPlaylistCaches();
          return { success: true, count: 0, resetToPairing: true };
        }

        // 5. Reconcile playlists with local storage
        if (remotePlaylists.length > 0) {
          savedPlaylists = await syncSavedPlaylistsWithRemote(remotePlaylists);
        } else {
          savedPlaylists = await getSavedPlaylists();
        }

        if (coordinatorOpIdRef.current !== currentOpId) {
          return { success: false, reason: 'SUPERSEDED' };
        }

        // 6. Resolve effective target playlist ID
        // Only accept resolvedTargetId if it exists in current savedPlaylists!
        const matchesSavedPlaylistId = (p, target) => (
          String(p.id) === String(target) ||
          String(p.playlist_id) === String(target) ||
          String(p.device_playlist_id) === String(target)
        );

        const targetInSaved = resolvedTargetId
          ? savedPlaylists.find((p) => matchesSavedPlaylistId(p, resolvedTargetId))
          : null;

        if (isSwitch && requestedTargetId && !targetInSaved) {
          dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });
          toastService.show(
            'That playlist is not available on this device. Pull to refresh the playlist list.',
            'error',
            4000,
          );
          return { success: false, error: 'PLAYLIST_NOT_FOUND' };
        }

        if (isSwitch && targetInSaved) {
          effectiveTargetId = String(targetInSaved.id);
        } else {
          effectiveTargetId = String(
            (targetInSaved ? targetInSaved.id : null) ||
            savedPlaylists.find((p) => p.isActive && !isPlaylistExpired(p))?.id ||
            savedPlaylists.find((p) => !isPlaylistExpired(p))?.id ||
            savedPlaylists.find((p) => p.isActive)?.id ||
            savedPlaylists[0]?.id ||
            '',
          );
        }

        if (!effectiveTargetId || savedPlaylists.length === 0) {
          dispatch({
            type: 'SET_CONFIGURED',
            payload: { isConfigured: false, playlistConfig: null },
          });
          dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
          dispatch({
            type: 'FAIL_PLAYLIST_LIFECYCLE',
            payload: {
              error: 'No playlists configured. Scan the QR code to add a playlist.',
              step: 'No Playlist',
              recoverable: false,
            },
          });
          return { success: false, reason: 'NO_PLAYLIST' };
        }

        targetPlaylistObj = savedPlaylists.find((p) => (
          String(p.id) === effectiveTargetId ||
          String(p.playlist_id) === effectiveTargetId ||
          String(p.device_playlist_id) === effectiveTargetId
        )) || null;

        if (targetPlaylistObj || effectiveTargetId) {
          targetPlaylistObj = await hydratePlaylistCredentials(
            state.deviceId,
            effectiveTargetId,
            targetPlaylistObj
              ? { ...resolvePlaylistSourceConfig(targetPlaylistObj), id: effectiveTargetId }
              : { id: effectiveTargetId },
          );
          try {
            await savePlaylist({ ...targetPlaylistObj, id: effectiveTargetId });
          } catch (_e) {}
        }

        if (isPlaylistExpired(targetPlaylistObj) && !isManual) {
          logRefresh('Target playlist is already expired, keeping current playlist active', {
            targetId: effectiveTargetId,
            activeId: currentActiveId,
          });

          // Ensure target playlist is marked Expired in storage
          try {
            await savePlaylist({ ...targetPlaylistObj, status: 'Expired' });
            const updated = await getSavedPlaylists();
            const isTargetActive = !currentActiveId || String(effectiveTargetId) === String(currentActiveId);
            const preservedActivePlaylist = isTargetActive
              ? (state.activePlaylist ? { ...state.activePlaylist, status: 'Expired' } : null)
              : state.activePlaylist;

            dispatch({
              type: 'SET_PLAYLISTS',
              payload: {
                playlists: updated,
                activePlaylistId: isTargetActive ? effectiveTargetId : currentActiveId,
                activePlaylist: preservedActivePlaylist,
              },
            });
          } catch (_e) {}

          const isTargetActive = !currentActiveId || String(effectiveTargetId) === String(currentActiveId);
          if (isTargetActive) {
            dispatch({
              type: 'SHOW_PLAYLIST_EXPIRED_DIALOG',
              payload: {
                playlistId: effectiveTargetId,
                playlistName: targetPlaylistObj?.name || 'Playlist',
                reason: 'expired',
              },
            });
          } else {
            // End switch lifecycle to restore UI without global error lock
            dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });
            toastService.show('Playlist expired', 'error', 3500);
          }

          return { success: false, reason: 'EXPIRED', targetPlaylistId: effectiveTargetId, activePlaylistId: currentActiveId };
        }

        // 7. Check if valid cached data already exists for target playlist (read sequentially to prevent Hermes heap spike)
        const cachedConfig = await getCachedConfig(effectiveTargetId);
        const cachedLive = await getCachedChannels(true, effectiveTargetId);
        const cachedMovies = await getCachedMovies(true, effectiveTargetId);
        const cachedSeries = await getCachedSeries(true, effectiveTargetId);
        const cachedFavs = await getAllFavorites(effectiveTargetId);

        if (coordinatorOpIdRef.current !== currentOpId) {
          return { success: false, reason: 'SUPERSEDED' };
        }

        const hasValidCache = Boolean(cachedLive || cachedMovies || cachedSeries || cachedConfig);
        const cacheSyncedAt = cachedConfig?.syncedAt || cachedLive?.syncedAt || 0;
        const isFresh = hasValidCache && cacheSyncedAt > 0 && Date.now() - cacheSyncedAt < CACHE_FRESHNESS_MS;

        let needFullDownload = isManual || !hasValidCache || !isFresh;
        if (isSwitch && hasValidCache && !isManual) {
          needFullDownload = false;
        }
        let finalLive = cachedLive;
        let finalMovies = cachedMovies;
        let finalSeries = cachedSeries;
        let finalConfig = cachedConfig;
        let finalFavs = cachedFavs;

        if (needFullDownload) {
          dispatch({
            type: 'UPDATE_PLAYLIST_LIFECYCLE',
            payload: {
              state: REFRESH_STATE.SYNCHRONIZING,
              step: `Synchronizing ${targetPlaylistObj?.name || 'playlist'}...`,
              progress: 0.25,
            },
          });

          // Synchronize with provider
          await syncPlaylist(
            state.deviceId,
            (step, progress) => {
              if (coordinatorOpIdRef.current === currentOpId) {
                dispatch({
                  type: 'UPDATE_PLAYLIST_LIFECYCLE',
                  payload: {
                    state: REFRESH_STATE.SYNCHRONIZING,
                    step,
                    progress: 0.25 + progress * 0.55,
                  },
                });
              }
            },
            effectiveTargetId,
            {
              signal: lifecycleAbortController.signal,
              localConfig: targetPlaylistObj,
              skipBulkLive: Boolean(isSwitch),
              credentialsOnlyLocal: Boolean(isSwitch),
            }
          );

          if (coordinatorOpIdRef.current !== currentOpId) {
            return { success: false, reason: 'SUPERSEDED' };
          }

          // Read freshly written data (read sequentially to prevent Hermes heap spike)
          const resConfig = await getCachedConfig(effectiveTargetId);
          const resLive = await getCachedChannels(true, effectiveTargetId);
          const resMovies = await getCachedMovies(true, effectiveTargetId);
          const resSeries = await getCachedSeries(true, effectiveTargetId);
          const resFavs = await getAllFavorites(effectiveTargetId);

          if (coordinatorOpIdRef.current !== currentOpId) {
            return { success: false, reason: 'SUPERSEDED' };
          }

          finalLive = resLive;
          finalMovies = resMovies;
          finalSeries = resSeries;
          finalConfig = resConfig;
          finalFavs = resFavs;
        }

        // 8. Preparing content stage
        dispatch({
          type: 'UPDATE_PLAYLIST_LIFECYCLE',
          payload: {
            state: REFRESH_STATE.INITIALIZING,
            step: 'Preparing your content...',
            progress: 0.85,
          },
        });

        // 9. Validate ready state (Requirement 15)
        const hasContent = Boolean(finalLive || finalMovies || finalSeries || finalConfig);
        if (!hasContent) {
          throw new AppNetworkError(
            ERROR_CATEGORY.PLAYLIST_SOURCE_ERROR,
            'Unable to load playlist content. Please verify the playlist source.'
          );
        }

        // 10. Persist active ID and notify backend
        await setActivePlaylistId(effectiveTargetId);
        activePlaylistIdRef.current = effectiveTargetId;
        if (state.deviceId) {
          setActiveDevicePlaylist(state.deviceId, effectiveTargetId).catch(() => {});
        }

        // Reset playback session now that target playlist is validated and ready to play
        if (isSwitch) {
          dispatch({ type: 'RESET_PLAYBACK_SESSION' });
        }

        // 11. Atomically commit normalized state scoped strictly to target playlist
        const movieStore = buildStoreFromMovies(finalMovies, effectiveTargetId);
        const seriesStore = buildStoreFromSeries(finalSeries, effectiveTargetId);
        const resolvedConfig = finalConfig || { id: effectiveTargetId, type: targetPlaylistObj?.type, config: targetPlaylistObj };

        dispatch({
          type: 'COMMIT_PLAYLIST_ACTIVE',
          payload: {
            playlistId: effectiveTargetId,
            playlistObj: targetPlaylistObj,
            savedPlaylists,
            live: finalLive ? { ...finalLive, playlistId: effectiveTargetId } : null,
            movies: finalMovies ? { ...finalMovies, playlistId: effectiveTargetId } : null,
            series: finalSeries ? { ...finalSeries, playlistId: effectiveTargetId } : null,
            movieStore,
            seriesStore,
            favorites: Array.isArray(finalFavs) ? finalFavs : [],
            config: resolvedConfig,
          },
        });

        dispatch({
          type: 'SET_PLAYLIST_STATUS',
          payload: {
            playlistId: effectiveTargetId,
            status: DATASET_STATUS.CACHED,
            syncedAt: Date.now(),
          },
        });

        // 12. Complete lifecycle and dismiss refresh screen
        dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });

        logRefresh('Playlist lifecycle completed successfully', { playlistId: effectiveTargetId });
        return { success: true, playlistId: effectiveTargetId };
      } catch (err) {
        if (coordinatorOpIdRef.current !== currentOpId || isAbortOrCancelledError(err)) {
          logRefresh('Playlist lifecycle operation superseded or cancelled, ignoring silently', {
            currentOpId,
            activeOpId: coordinatorOpIdRef.current,
            isCancelled: isAbortOrCancelledError(err),
          });
          return { success: false, reason: 'SUPERSEDED' };
        }

        const isExpired = isProviderExpiredError(err);
        if (isExpired) {
          logRefresh('Provider expired or unauthorized detected for playlist', {
            error: err?.message,
            targetId: effectiveTargetId,
            activeId: currentActiveId,
          });

          try {
            const currentPlaylists = await getSavedPlaylists();
            const targetPl = currentPlaylists.find((p) => String(p.id) === String(effectiveTargetId)) || targetPlaylistObj;
            if (targetPl) {
              await savePlaylist({ ...targetPl, status: 'Expired' });
            }
            const updated = await getSavedPlaylists();

            const isTargetActive = !currentActiveId || String(effectiveTargetId) === String(currentActiveId);
            const preservedActivePlaylist = isTargetActive
              ? (state.activePlaylist ? { ...state.activePlaylist, status: 'Expired' } : null)
              : state.activePlaylist;

            dispatch({
              type: 'SET_PLAYLISTS',
              payload: {
                playlists: updated,
                activePlaylistId: isTargetActive ? effectiveTargetId : currentActiveId,
                activePlaylist: preservedActivePlaylist,
              },
            });
          } catch (_e) {}

          const isTargetActive = !currentActiveId || String(effectiveTargetId) === String(currentActiveId);

          if (isTargetActive) {
            dispatch({
              type: 'SHOW_PLAYLIST_EXPIRED_DIALOG',
              payload: {
                playlistId: effectiveTargetId,
                playlistName: targetPlaylistObj?.name || (isTargetActive ? state.activePlaylist?.name : '') || 'Playlist',
                reason: 'expired',
              },
            });
          } else {
            // If this was an attempted switch to an expired playlist from a working active playlist,
            // complete the switch lifecycle cleanly without locking the screen
            dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });
            toastService.show('Playlist expired', 'error', 3500);
          }

          return { success: false, reason: 'EXPIRED', targetPlaylistId: effectiveTargetId, activePlaylistId: currentActiveId };
        }

        const isNoConfig = err.message === 'NO_CONFIGURATION';
        const errMsg = isNoConfig
          ? 'No IPTV playlist connected. Scan the QR code to configure.'
          : getUserFriendlyErrorMessage(err);

        logRefresh('Playlist lifecycle failed', { error: errMsg, category: err?.category });

        if (isSwitch && currentActiveId && String(effectiveTargetId) !== String(currentActiveId)) {
          try {
            const fbConfig = await getCachedConfig(effectiveTargetId);
            const fbLive = await getCachedChannels(true, effectiveTargetId);
            const fbMovies = await getCachedMovies(true, effectiveTargetId);
            const fbSeries = await getCachedSeries(true, effectiveTargetId);
            const fbFavs = await getAllFavorites(effectiveTargetId);
            const hasCachedContent = Boolean(fbConfig || fbLive || fbMovies || fbSeries);

            if (hasCachedContent && coordinatorOpIdRef.current === currentOpId) {
              const playlistsForCommit =
                savedPlaylists.length > 0 ? savedPlaylists : (await getSavedPlaylists());
              const playlistObj =
                targetPlaylistObj ||
                playlistsForCommit.find((p) => String(p.id) === String(effectiveTargetId)) ||
                resolvePlaylistSourceConfig(fbConfig || { id: effectiveTargetId });

              await setActivePlaylistId(effectiveTargetId);
              activePlaylistIdRef.current = effectiveTargetId;
              if (state.deviceId) {
                setActiveDevicePlaylist(state.deviceId, effectiveTargetId).catch(() => {});
              }

              dispatch({ type: 'RESET_PLAYBACK_SESSION' });

              const movieStore = buildStoreFromMovies(fbMovies, effectiveTargetId);
              const seriesStore = buildStoreFromSeries(fbSeries, effectiveTargetId);
              const resolvedConfig =
                fbConfig || { id: effectiveTargetId, type: playlistObj?.type, config: playlistObj };

              dispatch({
                type: 'COMMIT_PLAYLIST_ACTIVE',
                payload: {
                  playlistId: effectiveTargetId,
                  playlistObj,
                  savedPlaylists: playlistsForCommit,
                  live: fbLive ? { ...fbLive, playlistId: effectiveTargetId } : null,
                  movies: fbMovies ? { ...fbMovies, playlistId: effectiveTargetId } : null,
                  series: fbSeries ? { ...fbSeries, playlistId: effectiveTargetId } : null,
                  movieStore,
                  seriesStore,
                  favorites: Array.isArray(fbFavs) ? fbFavs : [],
                  config: resolvedConfig,
                },
              });

              dispatch({
                type: 'SET_PLAYLIST_STATUS',
                payload: {
                  playlistId: effectiveTargetId,
                  status: DATASET_STATUS.CACHED,
                  syncedAt: Date.now(),
                },
              });

              dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });
              toastService.show(
                'Switched using saved playlist data. Refresh if content looks outdated.',
                'info',
                4000,
              );
              return { success: true, playlistId: effectiveTargetId, usedCachedFallback: true };
            }
          } catch (_cacheFallbackErr) {}

          if (coordinatorOpIdRef.current === currentOpId) {
            try {
              const rehydrated = await hydratePlaylistCredentials(
                state.deviceId,
                effectiveTargetId,
                targetPlaylistObj || { id: effectiveTargetId },
              );
              const credsOk =
                rehydrated?.serverUrl &&
                rehydrated?.username &&
                String(rehydrated?.password || '').trim();
              if (credsOk) {
                await syncPlaylist(
                  state.deviceId,
                  (step, progress) => {
                    if (coordinatorOpIdRef.current === currentOpId) {
                      dispatch({
                        type: 'UPDATE_PLAYLIST_LIFECYCLE',
                        payload: {
                          state: REFRESH_STATE.SYNCHRONIZING,
                          step,
                          progress: 0.25 + progress * 0.55,
                        },
                      });
                    }
                  },
                  effectiveTargetId,
                  {
                    signal: lifecycleAbortController.signal,
                    localConfig: rehydrated,
                    skipBulkLive: true,
                    credentialsOnlyLocal: true,
                  },
                );

                const resConfig = await getCachedConfig(effectiveTargetId);
                const resLive = await getCachedChannels(true, effectiveTargetId);
                const resMovies = await getCachedMovies(true, effectiveTargetId);
                const resSeries = await getCachedSeries(true, effectiveTargetId);
                const resFavs = await getAllFavorites(effectiveTargetId);
                const hasRetryContent = Boolean(resConfig || resLive || resMovies || resSeries);

                if (hasRetryContent && coordinatorOpIdRef.current === currentOpId) {
                  const playlistsForCommit =
                    savedPlaylists.length > 0 ? savedPlaylists : (await getSavedPlaylists());
                  const playlistObj = {
                    ...(targetPlaylistObj || {}),
                    ...rehydrated,
                    id: effectiveTargetId,
                  };

                  await setActivePlaylistId(effectiveTargetId);
                  activePlaylistIdRef.current = effectiveTargetId;
                  if (state.deviceId) {
                    setActiveDevicePlaylist(state.deviceId, effectiveTargetId).catch(() => {});
                  }

                  dispatch({ type: 'RESET_PLAYBACK_SESSION' });

                  const movieStore = buildStoreFromMovies(resMovies, effectiveTargetId);
                  const seriesStore = buildStoreFromSeries(resSeries, effectiveTargetId);
                  const resolvedConfig =
                    resConfig || { id: effectiveTargetId, type: playlistObj?.type, config: playlistObj };

                  dispatch({
                    type: 'COMMIT_PLAYLIST_ACTIVE',
                    payload: {
                      playlistId: effectiveTargetId,
                      playlistObj,
                      savedPlaylists: playlistsForCommit,
                      live: resLive ? { ...resLive, playlistId: effectiveTargetId } : null,
                      movies: resMovies ? { ...resMovies, playlistId: effectiveTargetId } : null,
                      series: resSeries ? { ...resSeries, playlistId: effectiveTargetId } : null,
                      movieStore,
                      seriesStore,
                      favorites: Array.isArray(resFavs) ? resFavs : [],
                      config: resolvedConfig,
                    },
                  });

                  dispatch({
                    type: 'SET_PLAYLIST_STATUS',
                    payload: {
                      playlistId: effectiveTargetId,
                      status: DATASET_STATUS.CACHED,
                      syncedAt: Date.now(),
                    },
                  });

                  dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });
                  return { success: true, playlistId: effectiveTargetId, usedLocalCredentialRetry: true };
                }
              }
            } catch (retryErr) {
              logRefresh('Switch retry with local credentials failed', { error: retryErr?.message });
            }
          }

          dispatch({ type: 'COMPLETE_PLAYLIST_LIFECYCLE' });
          toastService.show('Could not switch playlist.', 'error', 7500, { multiline: true });
          if (errMsg) {
            toastService.show(errMsg, 'error', 8000, { multiline: true });
          }
          return { success: false, error: errMsg, targetPlaylistId: effectiveTargetId, activePlaylistId: currentActiveId };
        }

        const hasValidExisting = Boolean(state.liveData || state.moviesData || state.seriesData);
        const currentPlaylistsList = (savedPlaylists && savedPlaylists.length > 0) ? savedPlaylists : (state.savedPlaylists || []);
        const hasNoPlaylistsAtAll = currentPlaylistsList.length === 0;

        // If the device has truly no playlists configured anywhere, transition to NOT_CONFIGURED
        if (hasNoPlaylistsAtAll || (isNoConfig && !targetPlaylistObj)) {
          activePlaylistIdRef.current = null;
          await setActivePlaylistId(null);
          dispatch({
            type: 'SET_CONFIGURED',
            payload: { isConfigured: false, playlistConfig: null },
          });
          dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
          dispatch({
            type: 'FAIL_PLAYLIST_LIFECYCLE',
            payload: {
              error: errMsg,
              step: 'Setup Required',
              recoverable: false,
            },
          });
          return { success: false, error: errMsg, resetToPairing: true };
        }

        // If playlists exist but loading the source failed, keep it recoverable so user can reload or switch
        dispatch({
          type: 'FAIL_PLAYLIST_LIFECYCLE',
          payload: {
            error: errMsg,
            step: 'Connection Error',
            recoverable: true,
          },
        });

        if (!hasValidExisting && isNoConfig) {
          dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
        }

        return { success: false, error: errMsg };
      }
    })();

    inFlightCoordinatorPromiseRef.current = lifecyclePromise;
    try {
      return await lifecyclePromise;
    } finally {
      if (coordinatorOpIdRef.current === currentOpId) {
        inFlightCoordinatorPromiseRef.current = null;
        inFlightTargetIdRef.current = null;
        activeLifecycleAbortControllerRef.current = null;
      }
    }
  }, [state.deviceId, state.activePlaylistId, state.liveData, state.moviesData, state.seriesData, state.activePlaylist]);

  /**
   * Switch active playlist via the authoritative central coordinator
   */
  const switchPlaylist = useCallback(async (targetPlaylistId) => {
    return executePlaylistLifecycle({
      targetPlaylistId,
      isManual: false,
      isSwitch: true,
    });
  }, [executePlaylistLifecycle]);

  /**
   * Refresh playlist via the authoritative central coordinator
   */
  const reloadPlaylist = useCallback(async (targetPlaylistId = null, options = {}) => {
    const isManual = options?.isManual !== false;
    return executePlaylistLifecycle({
      targetPlaylistId: targetPlaylistId || state.activePlaylistId,
      isManual,
      isSwitch: false,
    });
  }, [executePlaylistLifecycle, state.activePlaylistId]);

  /**
   * Retry the last active refresh/switch operation
   */
  const retryRefresh = useCallback(async () => {
    const params = lastLifecycleParamsRef.current || { isManual: true };
    return executePlaylistLifecycle(params);
  }, [executePlaylistLifecycle]);

  /**
   * Dismiss recoverable refresh error screen
   */
  const dismissRefreshError = useCallback(() => {
    dispatch({ type: 'DISMISS_PLAYLIST_REFRESH_ERROR' });
  }, []);

  /**
   * Show playlist expired switch dialog
   */
  const showPlaylistExpiredDialog = useCallback((params = {}) => {
    dispatch({
      type: 'SHOW_PLAYLIST_EXPIRED_DIALOG',
      payload: {
        playlistId: params?.playlistId || state.activePlaylistId,
        playlistName: params?.playlistName || state.activePlaylist?.name || 'Current Playlist',
        reason: params?.reason || 'expired',
      },
    });
  }, [state.activePlaylistId, state.activePlaylist]);

  /**
   * Hide playlist expired switch dialog
   */
  const hidePlaylistExpiredDialog = useCallback(() => {
    dispatch({ type: 'HIDE_PLAYLIST_EXPIRED_DIALOG' });
  }, []);

  /**
   * Delete a saved playlist
   */
  const deleteSavedPlaylist = useCallback(async (playlistId) => {
    if (!playlistId) return;
    const strId = String(playlistId);

    const updatedPlaylists = await deletePlaylistStorage(strId);
    if (state.deviceId) {
      deleteDevicePlaylist(state.deviceId, strId).catch(() => {});
    }

    if (strId === state.activePlaylistId) {
      if (updatedPlaylists.length > 0) {
        const nextPlaylist = updatedPlaylists[0];
        dispatch({
          type: 'SET_PLAYLISTS',
          payload: {
            playlists: updatedPlaylists,
            activePlaylistId: nextPlaylist.id,
            activePlaylist: nextPlaylist,
          },
        });
        await switchPlaylist(nextPlaylist.id);
      } else {
        switchVersionRef.current += 1;
        activePlaylistIdRef.current = null;
        await setActivePlaylistId(null);
        dispatch({ type: 'RESET_PLAYBACK_SESSION' });
        dispatch({
          type: 'SET_PLAYLISTS',
          payload: {
            playlists: [],
            activePlaylistId: null,
            activePlaylist: null,
          },
        });
        dispatch({
          type: 'SET_CONFIGURED',
          payload: { isConfigured: false, playlistConfig: null, configType: null },
        });
        dispatch({ type: 'CLEAR_PLAYLIST_CONTENT' });
        dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
        await clearAllPlaylistCaches();
      }
    } else {
      dispatch({
        type: 'SET_PLAYLISTS',
        payload: {
          playlists: updatedPlaylists,
          activePlaylistId: state.activePlaylistId,
          activePlaylist: state.activePlaylist,
        },
      });
    }
  }, [state.deviceId, state.activePlaylistId, state.activePlaylist, switchPlaylist]);

  /**
   * Synchronize playlists with the remote backend.
   * Pulls newly added playlists, handles remote removals (including tearing down active playback
   * if the active playlist was removed remotely), and updates local state.
   * Features:
   * - Request deduplication via syncInFlightRef
   * - Stale response protection via monotonic syncSequenceRef
   * - Auto-initialization when the first playlist is added from the website
   * - Safe playback preservation when non-active playlists are added or removed
   * - Automatic transition to pairing screen when all playlists are removed
   */
  const syncRemotePlaylists = useCallback(async () => {
    const curState = stateRef.current;
    if (!curState.deviceId) return { success: false, reason: 'NO_DEVICE_ID' };
    if (inFlightCoordinatorPromiseRef.current || (curState.refreshState !== REFRESH_STATE.IDLE && curState.refreshState !== REFRESH_STATE.EXPIRED)) {
      return { success: false, reason: 'LIFECYCLE_ACTIVE' };
    }
    if (syncInFlightRef.current) {
      return { success: false, reason: 'IN_FLIGHT' };
    }

    syncInFlightRef.current = true;
    syncSequenceRef.current += 1;
    const currentSeq = syncSequenceRef.current;

    try {
      const remoteRes = await getDevicePlaylists(curState.deviceId);
      if (syncSequenceRef.current !== currentSeq) {
        return { success: false, reason: 'STALE_RESPONSE' };
      }

      if (!remoteRes?.success || !Array.isArray(remoteRes.playlists)) {
        return { success: false, reason: 'FETCH_FAILED' };
      }

      if (typeof remoteRes.id_lock === 'boolean') {
        dispatch({ type: 'SET_ID_LOCK', payload: remoteRes.id_lock });
      }

      const remotePlaylists = remoteRes.playlists;
      const remoteIds = new Set(remotePlaylists.map((p) => String(p.id)));

      // Authoritative sync: reconciles all backend playlists into local storage
      const updatedLocalPlaylists = await syncSavedPlaylistsWithRemote(remotePlaylists, state.deviceId);
      if (syncSequenceRef.current !== currentSeq) {
        return { success: false, reason: 'STALE_RESPONSE' };
      }

      const prevPlaylists = curState.savedPlaylists || [];
      const currentActiveId = curState.activePlaylistId;

      // Detect if playlist collection changed (count, IDs, names, or urls)
      const countChanged = prevPlaylists.length !== updatedLocalPlaylists.length;
      const contentChanged = updatedLocalPlaylists.some((up, idx) => {
        const prev = prevPlaylists[idx];
        return (
          !prev ||
          String(prev.id) !== String(up.id) ||
          prev.name !== up.name ||
          prev.serverUrl !== up.serverUrl ||
          prev.playlistUrl !== up.playlistUrl
        );
      });
      const hasChanges = countChanged || contentChanged;

      // CASE 0: ALL PLAYLISTS REMOVED FROM BACKEND (Zero playlists associated with device)
      if (updatedLocalPlaylists.length === 0) {
        if (curState.isConfigured || prevPlaylists.length > 0 || currentActiveId) {
          logSync('All playlists removed remotely -> resetting to pairing');
          switchVersionRef.current += 1;
          activePlaylistIdRef.current = null;
          await setActivePlaylistId(null);
          dispatch({ type: 'RESET_PLAYBACK_SESSION' });
          dispatch({
            type: 'SET_PLAYLISTS',
            payload: { playlists: [], activePlaylistId: null, activePlaylist: null },
          });
          dispatch({
            type: 'SET_CONFIGURED',
            payload: { isConfigured: false, playlistConfig: null, configType: null },
          });
          dispatch({ type: 'CLEAR_PLAYLIST_CONTENT' });
          dispatch({ type: 'SET_DEVICE_STATUS', payload: DEVICE_STATUS.NOT_CONFIGURED });
          dispatch({
            type: 'SET_SYNC_STATUS',
            payload: { status: SYNC_STATUS.EMPTY, isSyncing: false, isRefreshing: false, progress: 1, step: '', error: null },
          });
          await clearAllPlaylistCaches();
          return { success: true, count: 0, resetToPairing: true };
        }
        return { success: true, count: 0 };
      }

      // CASE 1: FIRST PLAYLIST ADDITION (Device was NOT configured or had no active playlist)
      if ((!curState.isConfigured || !currentActiveId || prevPlaylists.length === 0) && updatedLocalPlaylists.length > 0) {
        logSync('First playlist addition detected -> initializing content');
        const targetActive = updatedLocalPlaylists.find((p) => p.isActive) || updatedLocalPlaylists[0];
        const newActiveId = String(targetActive.id);
        activePlaylistIdRef.current = newActiveId;
        await setActivePlaylistId(newActiveId);

        dispatch({
          type: 'SET_PLAYLISTS',
          payload: {
            playlists: updatedLocalPlaylists,
            activePlaylistId: newActiveId,
            activePlaylist: targetActive,
          },
        });

        // Initialize and load the playlist content completely so Home opens automatically
        await reloadPlaylist(newActiveId);
        return { success: true, count: updatedLocalPlaylists.length, initialized: true };
      }

      // CASE 2: ACTIVE PLAYLIST WAS REMOVED REMOTELY (other playlists remain)
      if (currentActiveId && !remoteIds.has(String(currentActiveId))) {
        logSync('Active playlist removed remotely -> switching to fallback', { removedId: currentActiveId });
        dispatch({ type: 'RESET_PLAYBACK_SESSION' });
        await clearPlaylistCache(currentActiveId);

        if (updatedLocalPlaylists.length > 0) {
          const fallback = updatedLocalPlaylists[0];
          await switchPlaylist(fallback.id);
        }
        return { success: true, count: updatedLocalPlaylists.length, removedActive: true };
      }

      // CASE 3: PLAYLISTS CHANGED WHILE ACTIVE PLAYLIST REMAINS VALID
      if (hasChanges) {
        const nextActivePlaylist = updatedLocalPlaylists.find((p) => String(p.id) === String(currentActiveId)) || curState.activePlaylist;
        const prevActivePlaylist = prevPlaylists.find((p) => String(p.id) === String(currentActiveId));

        const activeConfigChanged = Boolean(
          prevActivePlaylist &&
          (prevActivePlaylist.serverUrl !== nextActivePlaylist.serverUrl ||
           prevActivePlaylist.playlistUrl !== nextActivePlaylist.playlistUrl ||
           prevActivePlaylist.username !== nextActivePlaylist.username ||
           prevActivePlaylist.password !== nextActivePlaylist.password)
        );

        dispatch({
          type: 'SET_PLAYLISTS',
          payload: {
            playlists: updatedLocalPlaylists,
            activePlaylistId: currentActiveId,
            activePlaylist: nextActivePlaylist,
          },
        });

        if (activeConfigChanged) {
          logSync('Active playlist credentials/URL changed on backend -> reloading dataset', { playlistId: currentActiveId });
          await clearPlaylistCache(currentActiveId);
          await reloadPlaylist(currentActiveId);
        }
      }

      return { success: true, count: updatedLocalPlaylists.length };
    } catch (e) {
      if (!isAbortOrCancelledError(e)) {
        if (consecutiveErrorsRef.current <= 1) {
          logSync('Remote playlist sync warning:', { error: e.message, category: e.category });
        }
      }
      return { success: false, error: e.message };
    } finally {
      syncInFlightRef.current = false;
    }
  }, [switchPlaylist, reloadPlaylist]);

  // Listen for AppState changes, background sync & network reconnection to synchronize remote changes
  useEffect(() => {
    if (!state.isInitialized || !state.deviceId) return;

    let isMounted = true;
    let pollTimeout = null;

    const runSync = async () => {
      if (!isMounted) return;
      try {
        const res = await syncRemotePlaylists();
        if (res && res.success) {
          consecutiveErrorsRef.current = 0;
        } else {
          consecutiveErrorsRef.current += 1;
        }
      } catch (_e) {
        consecutiveErrorsRef.current += 1;
      }
    };

    const scheduleNextPoll = () => {
      if (!isMounted) return;
      // Fast polling (5s) while on pairing screen, 30s when configured. Backoff up to 120s on error.
      const baseInterval = !state.isConfigured ? 5000 : 30000;
      const backoff = Math.min(120000, baseInterval * Math.pow(1.8, Math.min(consecutiveErrorsRef.current, 5)));
      const interval = consecutiveErrorsRef.current > 0 ? backoff : baseInterval;

      pollTimeout = setTimeout(async () => {
        await runSync();
        scheduleNextPoll();
      }, interval);
    };

    scheduleNextPoll();

    // AppState listener (sync immediately on foreground resume)
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        consecutiveErrorsRef.current = 0;
        runSync();
      }
    };

    let appStateSub = null;
    if (typeof AppState !== 'undefined' && AppState?.addEventListener) {
      appStateSub = AppState.addEventListener('change', handleAppStateChange);
    }

    // Network connectivity listener: sync immediately on reconnect (throttled to 30s)
    const networkCheckInterval = setInterval(async () => {
      if (!isMounted) return;
      try {
        const netState = await Network.getNetworkStateAsync();
        const isOnline = Boolean(netState.isConnected && netState.isInternetReachable !== false);
        if (isOnline && wasOfflineRef.current) {
          wasOfflineRef.current = false;
          consecutiveErrorsRef.current = 0;
          runSync();
        } else if (!isOnline) {
          wasOfflineRef.current = true;
        }
      } catch (_e) {}
    }, 30000);

    return () => {
      isMounted = false;
      if (pollTimeout) clearTimeout(pollTimeout);
      if (networkCheckInterval) clearInterval(networkCheckInterval);
      if (appStateSub?.remove) appStateSub.remove();
    };
  }, [state.isInitialized, state.deviceId, state.isConfigured, syncRemotePlaylists]);

  /**
   * Toggle ID Lock setting on backend and update local state
   */
  const toggleIdLock = useCallback(async (newLockState) => {
    if (!state.deviceId) return false;
    const targetState = Boolean(newLockState);
    try {
      const res = await setDeviceIdLock(state.deviceId, targetState);
      if (res?.success) {
        dispatch({ type: 'SET_ID_LOCK', payload: targetState });
        return true;
      }
      return false;
    } catch (e) {
      console.error('[App] Failed to update ID Lock:', e);
      try {
        const lockRes = await getDeviceIdLock(state.deviceId);
        if (lockRes?.success) {
          dispatch({ type: 'SET_ID_LOCK', payload: lockRes.id_lock });
        }
      } catch (_e) {}
      throw e;
    }
  }, [state.deviceId]);

  /**
   * Authoritatively refresh device subscription status against server UTC clock
   */
  const refreshSubscription = useCallback(async () => {
    if (!state.deviceId && !state.installationId) return null;
    try {
      const res = await getSubscriptionStatus(state.deviceId, state.installationId);
      const subData = extractSubscriptionFromStatusResponse(res);
      if (subData) {
        dispatch({ type: 'SET_SUBSCRIPTION', payload: subData });
        try {
          await writeCache('fox_player_cached_subscription', subData);
        } catch (_e) {}
        return subData;
      } else if (res?.is_trial_eligible) {
        dispatch({
          type: 'SET_TRIAL_ELIGIBILITY',
          payload: {
            is_trial_eligible: true,
            trial_settings: res.trial_settings,
          },
        });
        return { is_valid: false, status: 'trial_available' };
      }
    } catch (err) {
      console.warn('[App] Failed to refresh subscription status:', err.message);
    }
    return null;
  }, [state.deviceId, state.installationId]);

  /**
   * Atomically activate free trial on backend
   */
  const activateTrial = useCallback(async () => {
    if (!state.installationId) throw new Error('Installation UUID is required to activate trial.');
    const res = await activateTrialApi(state.deviceId, state.installationId);
    if (res?.success && res.subscription) {
      dispatch({ type: 'SET_SUBSCRIPTION', payload: res.subscription });
      try {
        await writeCache('fox_player_cached_subscription', res.subscription);
      } catch (_e) {}
      return res.subscription;
    }
    throw new Error(res?.error?.message || 'Failed to activate trial.');
  }, [state.deviceId, state.installationId]);


  /**
   * Unlock adult content (called after PIN verified)
   */
  const unlockAdult = useCallback(() => {
    dispatch({ type: 'SET_ADULT_UNLOCKED', payload: true });
  }, []);

  const lockAdult = useCallback(() => {
    dispatch({ type: 'SET_ADULT_UNLOCKED', payload: false });
  }, []);

  const refreshAdultPinStatus = useCallback(async () => {
    const enabled = await isAdultPinEnabled();
    dispatch({ type: 'SET_ADULT_PIN_ENABLED', payload: enabled });
  }, []);

  const setMoviesData = useCallback((moviesData) => {
    dispatch({ type: 'SET_CONTENT', payload: { movies: moviesData } });
  }, []);

  const setSeriesData = useCallback((seriesData) => {
    dispatch({ type: 'SET_CONTENT', payload: { series: seriesData } });
  }, []);

  const setMoviesStore = useCallback((storeData) => {
    dispatch({ type: 'SET_MOVIES_STORE', payload: storeData });
  }, []);

  const setSeriesStore = useCallback((storeData) => {
    dispatch({ type: 'SET_SERIES_STORE', payload: storeData });
  }, []);

  // Memoized Set of composite identity keys: 'movie:123', 'series:456', 'live:789'
  const favoriteKeys = useMemo(() => {
    const set = new Set();
    for (const f of state.favorites) {
      if (f && f.id) {
        set.add(getFavoriteKey(f.type, f.id));
      }
    }
    return set;
  }, [state.favorites]);

  const isFavorite = useCallback(
    (type, id) => {
      if (!id) return false;
      return favoriteKeys.has(getFavoriteKey(type, id));
    },
    [favoriteKeys]
  );

  const toggleFavorite = useCallback(async (typeOrItem, maybeItem) => {
    let item;
    let type;
    if (maybeItem && typeof typeOrItem === 'string') {
      type = typeOrItem;
      item = maybeItem;
    } else {
      item = typeOrItem;
      type = item?.type;
    }

    if (!item) return false;

    // 1. Optimistic dispatch immediately (0ms UI latency!)
    dispatch({
      type: 'OPTIMISTIC_TOGGLE_FAVORITE',
      payload: { item, typeOverride: type },
    });

    // 2. Persist in background scoped to active playlist
    try {
      const isAdded = await toggleFavoriteStorage(type, item, state.activePlaylistId);
      return isAdded;
    } catch (e) {
      console.warn('[Favorites] Failed to persist toggle:', e);
      const fresh = await getAllFavorites(state.activePlaylistId);
      dispatch({ type: 'SET_FAVORITES', payload: fresh });
      return false;
    }
  }, [state.activePlaylistId]);

  const removeFavorite = useCallback(async (type, id) => {
    dispatch({ type: 'OPTIMISTIC_REMOVE_FAVORITE', payload: { type, id } });
    try {
      await removeFavoriteStorage(type, id, state.activePlaylistId);
    } catch (e) {
      console.warn('[Favorites] Failed to persist removal:', e);
    }
  }, [state.activePlaylistId]);

  const refreshFavorites = useCallback(async () => {
    const favs = await getAllFavorites(state.activePlaylistId);
    dispatch({ type: 'SET_FAVORITES', payload: favs });
  }, [state.activePlaylistId]);

  const getPlaylistDatasetStatus = useCallback((playlistId) => {
    if (!playlistId) return DATASET_STATUS.NEVER_DOWNLOADED;
    const strId = String(playlistId);
    if (state.playlistStatuses[strId]) {
      return state.playlistStatuses[strId].status;
    }
    return DATASET_STATUS.NEVER_DOWNLOADED;
  }, [state.playlistStatuses]);

  const isExpired = useMemo(() => {
    // Only consider the active playlist context expired
    if (state.refreshState === REFRESH_STATE.EXPIRED) {
      if (!state.refreshTargetPlaylistId || String(state.refreshTargetPlaylistId) === String(state.activePlaylistId)) {
        return true;
      }
    }
    if (state.playlistExpiredModal?.visible) {
      if (!state.playlistExpiredModal.playlistId || String(state.playlistExpiredModal.playlistId) === String(state.activePlaylistId)) {
        return true;
      }
    }
    if (isPlaylistExpired(state.activePlaylist)) return true;
    if (isPlaylistExpired(state.playlistConfig)) return true;
    if (state.activePlaylistId && Array.isArray(state.savedPlaylists)) {
      const currentPl = state.savedPlaylists.find((p) => String(p.id) === String(state.activePlaylistId));
      if (currentPl && isPlaylistExpired(currentPl)) return true;
    }
    return false;
  }, [state.refreshState, state.refreshTargetPlaylistId, state.playlistExpiredModal, state.activePlaylist, state.playlistConfig, state.activePlaylistId, state.savedPlaylists]);

  const selectProfile = useCallback(async (profileOrId) => {
    const targetId = typeof profileOrId === 'string' ? profileOrId : (profileOrId?.id || profileOrId?.playlist_id);
    if (!targetId) return { success: false, error: 'NO_PROFILE_ID' };
    dispatch({ type: 'SET_PROFILE_PICKER_OPEN', payload: false });

    // Store user's profile selection in persistent cache
    try {
      await setActivePlaylistId(targetId);
    } catch (_e) {}

    const isTargetActive = String(targetId) === String(state.activePlaylistId);
    const hasLoadedContent = Boolean(
      isTargetActive &&
      (state.liveData?.channels?.length > 0 || state.moviesData?.items?.length > 0 || state.seriesData?.items?.length > 0)
    );

    if (!isTargetActive) {
      return await switchPlaylist(targetId);
    } else if (!hasLoadedContent) {
      return await reloadPlaylist(targetId, { isManual: false });
    }
    return { success: true, playlistId: targetId };
  }, [state.activePlaylistId, state.liveData, state.moviesData, state.seriesData, switchPlaylist, reloadPlaylist]);

  const openProfilePicker = useCallback(() => {
    dispatch({ type: 'SET_PROFILE_PICKER_OPEN', payload: true });
  }, []);

  const closeProfilePicker = useCallback(() => {
    dispatch({ type: 'SET_PROFILE_PICKER_OPEN', payload: false });
  }, []);

  const activePlaylistName = useMemo(() => {
    return (
      state.activePlaylist?.name ||
      state.playlistConfig?.name ||
      state.playlistConfig?.config?.name ||
      'Current Playlist'
    );
  }, [state.activePlaylist, state.playlistConfig]);

  const contextValue = useMemo(() => ({
    ...state,
    profiles: state.savedPlaylists,
    activeProfile: state.activePlaylist,
    activeProfileId: state.activePlaylistId,
    isExpired,
    activePlaylistName,
    availablePlaylists: state.savedPlaylists,
    getPlaylistDatasetStatus,
    refreshState: state.refreshState,
    refreshStep: state.refreshStep,
    refreshProgress: state.refreshProgress,
    refreshError: state.refreshError,
    retryRefresh,
    dismissRefreshError,
    playlistExpiredModal: state.playlistExpiredModal,
    showPlaylistExpiredDialog,
    hidePlaylistExpiredDialog,
    synchronizationStatus: {
      status: state.syncStatus || (state.isSyncing ? SYNC_STATUS.SYNCING : SYNC_STATUS.READY),
      isSyncing: state.isSyncing,
      isRefreshing: state.isRefreshing,
      lastSyncAt: state.lastSyncAt,
      syncError: state.syncError,
      syncStep: state.syncStep,
      syncProgress: state.syncProgress,
    },
    initialize,
    switchPlaylist,
    reloadPlaylist,
    refreshPlaylist: reloadPlaylist,
    syncRemotePlaylists,
    deleteSavedPlaylist,
    toggleIdLock,
    syncPlaylistData: reloadPlaylist,
    setMoviesData,
    setSeriesData,
    setMoviesStore,
    setSeriesStore,
    unlockAdult,
    lockAdult,
    refreshAdultPinStatus,
    favoriteKeys,
    isFavorite,
    toggleFavorite,
    removeFavorite,
    refreshFavorites,
    refreshSubscription,
    activateTrial,
    selectProfile,
    openProfilePicker,
    closeProfilePicker,
    dismissAppUpdate,
    refreshAppUpdateCheck: runAppUpdateCheck,
  }), [
    dismissAppUpdate,
    runAppUpdateCheck,
    state,
    isExpired,
    activePlaylistName,
    getPlaylistDatasetStatus,
    retryRefresh,
    dismissRefreshError,
    showPlaylistExpiredDialog,
    hidePlaylistExpiredDialog,
    initialize,
    switchPlaylist,
    reloadPlaylist,
    syncRemotePlaylists,
    deleteSavedPlaylist,
    toggleIdLock,
    setMoviesData,
    setSeriesData,
    setMoviesStore,
    setSeriesStore,
    unlockAdult,
    lockAdult,
    refreshAdultPinStatus,
    favoriteKeys,
    isFavorite,
    toggleFavorite,
    removeFavorite,
    refreshFavorites,
    refreshSubscription,
    activateTrial,
    selectProfile,
    openProfilePicker,
    closeProfilePicker,
  ]);

  const updateStoreUrl = String(appUpdateOffer?.latest?.store_url || '');
  const updateHasStore = /^https?:\/\//i.test(updateStoreUrl);
  const updateForceBlock = !!appUpdateOffer?.force_update && updateHasStore;

  return (
    <AppContext.Provider value={contextValue}>
      <View style={{ flex: 1 }}>
        {children}
        {appUpdateOffer?.latest ? (
          <AppUpdateModal
            visible
            forceUpdate={updateForceBlock}
            latest={appUpdateOffer.latest}
            onDismiss={dismissAppUpdate}
          />
        ) : null}
      </View>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
