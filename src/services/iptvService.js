import {
  CONFIG_TYPES,
  getPlaylistConfigKey,
  getPlaylistChannelsKey,
  getPlaylistMoviesKey,
  getPlaylistSeriesKey,
  getPlaylistMovieCatKey,
  getPlaylistSeriesCatKey,
  STORAGE_KEYS,
} from '../constants';
import { writeCache, readCache, readCacheStale } from '../storage/cacheStorage';
import { getDevicePlaylist } from './apiService';
import { fetchAndParseM3U, isAdultContent } from './m3uParser';
import {
  xtreamAuthenticate,
  xtreamGetLiveCategories,
  xtreamGetLiveStreams,
  xtreamGetVodCategories,
  xtreamGetVodStreams,
  xtreamGetSeriesCategories,
  xtreamGetSeries,
  buildLiveStreamUrl,
} from './xtreamService';
import { throwIfAborted, isCancelledError } from './syncEngine';
import { logCache, logError, logRefresh } from '../utils/diagnostics';
import {
  ERROR_CATEGORY,
  AppNetworkError,
  isAbortOrCancelledError,
} from './networkErrors.js';
import {
  parseXtreamCredentialsFromUrl,
  sanitizeUrlForLogging,
} from '../utils/m3uUrlHelpers.js';
import { inferPlaylistType, resolvePlaylistSourceConfig } from '../utils/playlistSourceResolver.js';

const inFlightSyncs = new Map();

/**
 * Downloads, normalizes and caches the datasets (Live / Movies / Series) of ONE playlist.
 *
 * Ownership rules (enforced by the central sync coordinator in AppContext):
 *  - Only the coordinator's dataset job manager calls this function, one job at a time.
 *    Screens never trigger their own full downloads.
 *  - The playlist REGISTRY is owned by association reconciliation. This function never
 *    writes the saved-playlist list, so a late/obsolete download can never resurrect a
 *    playlist that the backend removed.
 *  - Results are returned IN MEMORY so the caller can commit them directly. The caller
 *    must not re-read the multi-megabyte cache files it just wrote (that doubled the
 *    peak JS + JNI string memory and was a major contributor to refresh crashes).
 *  - Each dataset is written exactly once, under its playlist-scoped key. The legacy
 *    un-scoped keys are no longer written: duplicating every dataset doubled disk/JNI
 *    work and let one playlist's data/credentials leak into another's fallbacks.
 *
 * Signature is backwards compatible: syncPlaylist(deviceId, progressCallback, targetPlaylistId, { signal })
 * Progress callback: (step: string, progress: number 0-1) => void
 */
export async function syncPlaylist(deviceId, progressCallback, targetPlaylistId = null, options = {}) {
  const syncKey = `${deviceId || 'dev'}_${targetPlaylistId || 'default'}`;
  if (inFlightSyncs.has(syncKey)) {
    return inFlightSyncs.get(syncKey);
  }

  const syncPromise = (async () => {
    try {
      const signal = options.signal || null;
      const progress = (step, pct) => {
        if (signal?.aborted) return;
        if (typeof progressCallback === 'function') progressCallback(step, pct);
      };

      progress('Connecting to FOX PLAYER', 0.05);

  // Get config from backend (specifying playlistId if provided)
  let configResponse = null;
  try {
    configResponse = await getDevicePlaylist(deviceId, targetPlaylistId, { signal });
  } catch (e) {
    if (isAbortOrCancelledError(e)) {
      throw e;
    }
    logRefresh('Backend unavailable during playlist config fetch, checking local cache', {
      error: e.message,
      playlistId: targetPlaylistId,
    });
  }
  throwIfAborted(signal);

  if (!configResponse || !configResponse.configured) {
    // Graceful fallback: retrieve locally saved playlist configuration
    const local = options.localConfig || (targetPlaylistId ? await readCache(getPlaylistConfigKey(targetPlaylistId)) : null);
    if (local && (local.playlistUrl || local.playlist_url || local.serverUrl || local.server_url || local.config || local.url)) {
      logRefresh('Proceeding with locally saved playlist configuration', { playlistId: targetPlaylistId });
      const resolvedLocal = resolvePlaylistSourceConfig(local.config ? { ...local.config, ...local } : local);
      configResponse = {
        configured: true,
        type: resolvedLocal.type,
        id: targetPlaylistId || local.id || local.playlist_id || 'pl_default',
        name: resolvedLocal.name || 'Playlist',
        configuration: resolvedLocal,
      };
    } else {
      throw new AppNetworkError(
        ERROR_CATEGORY.BACKEND_UNAVAILABLE,
        'NO_CONFIGURATION',
        { playlistId: targetPlaylistId }
      );
    }
  }

  const rawConfig = configResponse.configuration || configResponse.config || configResponse || {};
  const resolvedSource = resolvePlaylistSourceConfig({
    ...rawConfig,
    type: configResponse.type || rawConfig.type,
    name: configResponse.name || configResponse.playlist_name || rawConfig.name,
    id: configResponse.id || configResponse.playlist_id || rawConfig.id || targetPlaylistId,
  });
  const type = inferPlaylistType(resolvedSource);
  const playlistId = String(configResponse.id || configResponse.playlist_id || rawConfig.id || targetPlaylistId || 'pl_default');

  // Stale-identity guard: the backend must answer for the playlist we asked for (checking id, playlist_id, or device_playlist_id)
  const isTargetMatched = !targetPlaylistId ||
    String(targetPlaylistId) === String(playlistId) ||
    String(targetPlaylistId) === String(configResponse.id) ||
    String(targetPlaylistId) === String(configResponse.playlist_id) ||
    String(targetPlaylistId) === String(configResponse.device_playlist_id) ||
    String(targetPlaylistId) === String(rawConfig.id) ||
    String(targetPlaylistId) === String(rawConfig.playlist_id) ||
    String(targetPlaylistId) === String(rawConfig.device_playlist_id);

  if (!isTargetMatched) {
    throw new AppNetworkError(ERROR_CATEGORY.STALE_REQUEST, 'PLAYLIST_MISMATCH', { playlistId: targetPlaylistId });
  }

  const playlistName =
    configResponse.name ||
    configResponse.playlist_name ||
    rawConfig.playlist_name ||
    rawConfig.name ||
    (type === CONFIG_TYPES.XTREAM ? (rawConfig.username || 'Xtream IPTV') : 'M3U Playlist');

  const config = {
    ...resolvedSource,
    playlist_name: playlistName,
    name: playlistName,
  };

  const configPayload = {
    id: playlistId,
    name: playlistName,
    type,
    config: {
      ...config,
      playlist_name: playlistName,
    },
    syncedAt: Date.now(),
  };

  let result;
  if (type === CONFIG_TYPES.M3U) {
    const rawM3uUrl = config.playlist_url || config.playlistUrl || config.url;
    const xtreamCreds = parseXtreamCredentialsFromUrl(rawM3uUrl) || (
      (config.server_url || config.serverUrl) && config.username && config.password
        ? {
            isXtream: true,
            serverUrl: config.server_url || config.serverUrl,
            username: config.username,
            password: config.password,
          }
        : null
    );

    try {
      result = await syncM3U(config, progress, playlistId, signal);
    } catch (m3uErr) {
      if (isAbortOrCancelledError(m3uErr)) throw m3uErr;

      // If direct M3U download fails or times out, but the URL contains Xtream credentials,
      // seamlessly fall back to syncing via the provider's native Xtream API!
      if (xtreamCreds && xtreamCreds.serverUrl && xtreamCreds.username && xtreamCreds.password) {
        logRefresh('[M3U] Direct M3U fetch failed, seamlessly syncing via provider Xtream API', {
          serverUrl: xtreamCreds.serverUrl,
          error: m3uErr.message,
        });
        progress('Connecting to provider service', 0.2);

        const xtreamConfig = {
          ...config,
          server_url: xtreamCreds.serverUrl,
          serverUrl: xtreamCreds.serverUrl,
          username: xtreamCreds.username,
          password: xtreamCreds.password,
          playlist_name: playlistName,
          type: CONFIG_TYPES.XTREAM,
        };

        const xtreamConfigPayload = {
          ...configPayload,
          type: CONFIG_TYPES.XTREAM,
          config: xtreamConfig,
        };

        result = await syncXtream(xtreamConfig, progress, playlistId, signal, xtreamConfigPayload);
      } else {
        throw m3uErr;
      }
    }
  } else if (type === CONFIG_TYPES.XTREAM) {
    result = await syncXtream(config, progress, playlistId, signal, configPayload);
  } else {
    throw new Error('Unknown configuration type.');
  }

  if (result.expirationDate) {
    configPayload.config.expirationDate = result.expirationDate;
    configPayload.config.status = result.status;
  }
  configPayload.syncedAt = Date.now();

  throwIfAborted(signal);
  await writeCache(getPlaylistConfigKey(playlistId), configPayload);
  progress('Ready', 1.0);

  return { ...result, playlistId, playlistName, type, config: configPayload };
    } finally {
      inFlightSyncs.delete(syncKey);
    }
  })();

  inFlightSyncs.set(syncKey, syncPromise);
  return syncPromise;
}

function simpleHash(str) {
  if (!str) return '00000000';
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
}

/**
 * Helper to extract series name, season number, episode number, and episode title.
 */
function parseSeriesInfo(name) {
  if (!name || typeof name !== 'string') return null;

  // Pattern 1: S01E02, s1e5, S01.E02, S01 - E02
  const sPattern = /^(.*?)\s*[-._ ]*S(\d{1,2})[\s._-]*E(\d{1,3})\b\s*[-:._ ]*(.*)$/i;
  let match = name.match(sPattern);
  if (match) {
    const seriesTitle = (match[1] || '').trim().replace(/[-._]+$/, '').trim() || name;
    const seasonNumber = parseInt(match[2], 10);
    const episodeNumber = parseInt(match[3], 10);
    const epTitle = (match[4] || '').trim().replace(/^[-:._ ]+/, '').trim();
    return { seriesTitle, seasonNumber, episodeNumber, epTitle };
  }

  // Pattern 2: 1x02, 02x15
  const xPattern = /^(.*?)\s*[-._ ]*(\d{1,2})x(\d{1,3})\b\s*[-:._ ]*(.*)$/i;
  match = name.match(xPattern);
  if (match) {
    const seriesTitle = (match[1] || '').trim().replace(/[-._]+$/, '').trim() || name;
    const seasonNumber = parseInt(match[2], 10);
    const episodeNumber = parseInt(match[3], 10);
    const epTitle = (match[4] || '').trim().replace(/^[-:._ ]+/, '').trim();
    return { seriesTitle, seasonNumber, episodeNumber, epTitle };
  }

  // Pattern 3: Season 1 Episode 2 / Season 1 Ep 2
  const wordPattern = /^(.*?)\s*[-._ ]*Season\s*(\d{1,2})[\s._-]*Ep(?:isode)?\s*(\d{1,3})\b\s*[-:._ ]*(.*)$/i;
  match = name.match(wordPattern);
  if (match) {
    const seriesTitle = (match[1] || '').trim().replace(/[-._]+$/, '').trim() || name;
    const seasonNumber = parseInt(match[2], 10);
    const episodeNumber = parseInt(match[3], 10);
    const epTitle = (match[4] || '').trim().replace(/^[-:._ ]+/, '').trim();
    return { seriesTitle, seasonNumber, episodeNumber, epTitle };
  }

  return null;
}

/**
 * Extract 4-digit release year from title
 */
function extractYear(title) {
  if (!title) return null;
  const match = title.match(/\b(19\d\d|20\d\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Clean movie title by removing brackets, year tags, and quality labels for cleaner display
 */
function cleanMovieTitle(title) {
  if (!title) return 'Movie';
  return title
    .replace(/\s*\(\s*(?:19\d\d|20\d\d)\s*\)/g, '')
    .replace(/\s*\[\s*(?:19\d\d|20\d\d)\s*\]/g, '')
    .replace(/\s*\b(?:1080p|720p|4k|uhd|fhd|hd|hevc|x264|x265)\b/gi, '')
    .trim() || title;
}

async function syncM3U(config, progress, playlistId, signal) {
  progress('Loading playlist', 0.1);

  const rawUrl = (config.playlist_url || config.playlistUrl || config.url || '').trim();
  if (!rawUrl) {
    throw new AppNetworkError(
      ERROR_CATEGORY.INVALID_RESPONSE,
      'No playlist URL configured for this M3U playlist.'
    );
  }

  console.log('[M3U] Request started for playlist:', sanitizeUrlForLogging(rawUrl));
  const { channels, total } = await fetchAndParseM3U(rawUrl, { signal });
  throwIfAborted(signal);

  progress('Categorizing channels, movies & series', 0.4);

  const liveGrouped = {};
  const moviesGrouped = {};
  // seriesMap: categoryName -> Map of seriesKey -> { seriesObj, seasonsMap }
  const seriesCategoryMap = {};

  let liveCount = 0;
  let moviesCount = 0;
  let seriesEpisodeCount = 0;

  let processed = 0;
  for (const item of channels) {
    processed++;
    if (processed % 2500 === 0) {
      throwIfAborted(signal);
      // Yield to JS event loop so progress renders smoothly without UI lock
      await new Promise((r) => (typeof setImmediate !== 'undefined' ? setImmediate(r) : setTimeout(r, 0)));
      progress('Categorizing channels, movies & series', 0.4 + (processed / channels.length) * 0.4);
    }

    const groupLower = (item.group || '').toLowerCase();
    const urlLower = (item.url || '').toLowerCase();

    // 1. Series check: explicit series indicators in group or URL, or SxxExx pattern in title
    const hasSeriesPattern = parseSeriesInfo(item.name);
    const hasSeriesIndicator =
      (groupLower.includes('series') || groupLower.includes('tv show') || groupLower.includes('tv shows')) &&
      !groupLower.includes('live') &&
      !groupLower.includes('movie');
    const hasSeriesUrlPath = /\/series\//i.test(urlLower);

    const isSeries = Boolean(hasSeriesPattern || ((hasSeriesIndicator || hasSeriesUrlPath) && !groupLower.includes('movie')));

    // 2. Movie check: reliable group indicator or /movie/ URL path (conservative)
    const isMovie =
      !isSeries &&
      (groupLower.includes('movie') ||
       groupLower.includes('vod') ||
       groupLower.includes('cinema') ||
       groupLower.includes('film') ||
       groupLower.includes('pelicula') ||
       groupLower.includes('filme') ||
       /\/movie\//i.test(urlLower));

    if (isSeries) {
      seriesEpisodeCount++;
      const grp = item.group || 'Series';
      if (!seriesCategoryMap[grp]) {
        seriesCategoryMap[grp] = new Map();
      }

      const seriesInfo = hasSeriesPattern || {
        seriesTitle: item.name.replace(/\b(?:1080p|720p|4k|uhd|fhd|hd)\b/gi, '').trim() || item.name,
        seasonNumber: 1,
        episodeNumber: 1,
        epTitle: item.name,
      };

      const seriesKey = seriesInfo.seriesTitle.toLowerCase().trim();
      let seriesEntry = seriesCategoryMap[grp].get(seriesKey);

      if (!seriesEntry) {
        const seriesId = `m3u_ser_${simpleHash(seriesInfo.seriesTitle)}_${simpleHash(grp)}`;
        seriesEntry = {
          series: {
            id: seriesId,
            seriesId,
            name: seriesInfo.seriesTitle,
            title: seriesInfo.seriesTitle,
            poster: item.logo || null,
            cover: item.logo || null,
            backdrop: item.logo || null,
            group: grp,
            categoryId: grp,
            isAdult: item.isAdult,
            seasons: [],
            episodes: {},
            totalEpisodes: 0,
          },
          seasonsMap: new Map(), // seasonNumber -> array of episode objects
        };
        seriesCategoryMap[grp].set(seriesKey, seriesEntry);
      }

      // If series poster is missing, pick first available episode logo
      if (!seriesEntry.series.poster && item.logo) {
        seriesEntry.series.poster = item.logo;
        seriesEntry.series.cover = item.logo;
      }

      const sNum = seriesInfo.seasonNumber || 1;
      const epNum = seriesInfo.episodeNumber || 1;
      const epTitle = seriesInfo.epTitle || `Episode ${epNum}`;

      if (!seriesEntry.seasonsMap.has(sNum)) {
        seriesEntry.seasonsMap.set(sNum, []);
      }

      const episodeObj = {
        id: item.id,
        streamId: item.id,
        name: epTitle,
        title: epTitle,
        episodeNum: epNum,
        episodeNumber: epNum,
        seasonNumber: sNum,
        url: item.url,
        thumbnail: item.logo || null,
        poster: item.logo || null,
        containerExtension: item.containerExtension || 'mp4',
        duration: item.duration || null,
        isAdult: item.isAdult,
      };

      seriesEntry.seasonsMap.get(sNum).push(episodeObj);
      seriesEntry.series.totalEpisodes++;
    } else if (isMovie) {
      moviesCount++;
      const grp = item.group || 'Movies';
      if (!moviesGrouped[grp]) moviesGrouped[grp] = [];

      const year = extractYear(item.name);
      const cleanName = cleanMovieTitle(item.name);

      moviesGrouped[grp].push({
        id: item.id,
        streamId: item.id,
        name: item.name,
        cleanName,
        title: item.name,
        poster: item.logo || null,
        cover: item.logo || null,
        url: item.url,
        isAdult: item.isAdult,
        year,
        group: grp,
        categoryId: grp,
        containerExtension: item.containerExtension || 'mp4',
      });
    } else {
      liveCount++;
      const grp = item.group || 'General';
      if (!liveGrouped[grp]) liveGrouped[grp] = [];
      liveGrouped[grp].push({
        ...item,
        streamId: item.id,
        categoryId: grp,
      });
    }
  }

  // 3. Assemble normalized Series dataset
  const categorizedSeries = [];
  let distinctSeriesCount = 0;

  for (const [grpName, seriesMap] of Object.entries(seriesCategoryMap)) {
    const seriesItems = [];

    for (const { series, seasonsMap } of seriesMap.values()) {
      // Sort seasons numerically
      const sortedSeasonNums = Array.from(seasonsMap.keys()).sort((a, b) => a - b);
      const seasonsList = [];
      const episodesMap = {};

      for (const sNum of sortedSeasonNums) {
        const epList = seasonsMap.get(sNum);
        // Sort episodes by episode number
        epList.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));

        seasonsList.push({
          seasonNumber: sNum,
          name: `Season ${sNum}`,
          episodeCount: epList.length,
          episodes: epList,
        });

        episodesMap[String(sNum)] = epList;
      }

      series.seasons = seasonsList;
      series.episodes = episodesMap;
      seriesItems.push(series);
      distinctSeriesCount++;
    }

    if (seriesItems.length > 0) {
      categorizedSeries.push({
        id: grpName,
        name: grpName,
        items: seriesItems,
        isAdult: isAdultContent(grpName, ''),
      });
    }
  }

  // 4. Assemble normalized Live TV and Movies datasets
  const categorizedLive = Object.entries(liveGrouped).map(([name, items]) => ({
    id: name,
    name,
    channels: items,
    isAdult: isAdultContent(name, ''),
  }));

  const categorizedMovies = Object.entries(moviesGrouped).map(([name, items]) => ({
    id: name,
    name,
    items,
    isAdult: isAdultContent(name, ''),
  }));

  progress('Saving data', 0.85);

  const channelsData = {
    type: 'live',
    source: 'm3u',
    categories: categorizedLive.length > 0 ? categorizedLive : [{ id: 'all', name: 'All Channels', channels, isAdult: false }],
    total: liveCount > 0 ? liveCount : total,
    syncedAt: Date.now(),
    playlistId,
  };

  const moviesData = {
    type: 'movies',
    source: 'm3u',
    categories: categorizedMovies,
    total: moviesCount,
    syncedAt: Date.now(),
    playlistId,
  };

  const seriesData = {
    type: 'series',
    source: 'm3u',
    categories: categorizedSeries,
    total: distinctSeriesCount,
    episodeTotal: seriesEpisodeCount,
    syncedAt: Date.now(),
    playlistId,
  };

  // Sequential, playlist-scoped writes
  throwIfAborted(signal);
  await writeCache(getPlaylistChannelsKey(playlistId), channelsData);
  throwIfAborted(signal);
  await writeCache(getPlaylistMoviesKey(playlistId), moviesData);
  throwIfAborted(signal);
  await writeCache(getPlaylistSeriesKey(playlistId), seriesData);

  console.log(`[M3U] normalization completed: live=${liveCount}, movies=${moviesCount}, series=${distinctSeriesCount}`);
  console.log('[M3U] cache committed under playlist ID:', playlistId);

  return {
    live: channelsData,
    movies: moviesData,
    series: seriesData,
    liveTotal: liveCount > 0 ? liveCount : total,
    moviesTotal: moviesCount,
    seriesTotal: distinctSeriesCount,
    source: 'm3u',
  };
}


/**
 * Compact series record for list views. Drops fields no list/detail view reads
 * (duplicate `description`, `backdrop`, `cast`, `director`, per-item credentials).
 * Per-item credentials were serialized once PER SERIES into the cache file.
 * Detail views load full metadata via get_series_info.
 */
function compactSeriesItem(s) {
  return {
    id: s.id,
    seriesId: s.seriesId || s.id,
    name: s.name,
    title: s.title || s.name,
    poster: s.poster || null,
    posterUri: s.posterUri || s.poster || null,
    cover: s.cover || s.poster || null,
    plot: s.plot || '',
    genre: s.genre || '',
    rating: s.rating ?? null,
    year: s.year || null,
    categoryId: s.categoryId,
    categoryIds: s.categoryIds,
    isAdult: Boolean(s.isAdult),
    type: 'series',
  };
}

async function syncXtream(config, progress, playlistId, signal, configPayload) {
  const resolved = resolvePlaylistSourceConfig(config);
  const serverUrl = (resolved.server_url || resolved.serverUrl || '').trim();
  const username = (resolved.username || '').trim();
  const password = (resolved.password || '').trim();

  if (!serverUrl || !username || !password) {
    throw new AppNetworkError(
      ERROR_CATEGORY.PLAYLIST_SOURCE_ERROR,
      'Xtream configuration is incomplete. Missing Server URL, Username, or Password.'
    );
  }

  const net = { signal, strict: true };

  progress('Connecting & Authenticating', 0.1);
  const authInfo = await xtreamAuthenticate(serverUrl, username, password, net);
  throwIfAborted(signal);

  const effectiveServerUrl = authInfo.serverUrl || serverUrl;

  // Fetch Live Categories and Live Streams sequentially to prevent concurrent connection
  // exhaustion and TCP RST drops on restrictive IPTV servers
  progress('Loading LIVE categories', 0.22);
  const liveCategories = await xtreamGetLiveCategories(effectiveServerUrl, username, password, net);
  throwIfAborted(signal);

  // Brief pause to allow socket to flush before downloading large channel list
  await new Promise((r) => setTimeout(r, 150));
  throwIfAborted(signal);

  progress('Loading LIVE channels', 0.35);
  const liveStreams = await xtreamGetLiveStreams(effectiveServerUrl, username, password, null, net);
  throwIfAborted(signal);

  // Group streams by category
  const liveByCategory = groupByCategory(liveStreams, liveCategories, (s, cat) => ({
    ...s,
    url: buildLiveStreamUrl(effectiveServerUrl, username, password, s.streamId, s.containerExtension),
    categoryName: cat?.name || 'Uncategorized',
  }));

  progress('Saving LIVE channels', 0.5);
  const liveChannelsData = {
    type: 'live',
    source: 'xtream',
    categories: liveByCategory,
    total: liveStreams.length,
    syncedAt: Date.now(),
    serverUrl: effectiveServerUrl,
    username,
    playlistId,
  };

  throwIfAborted(signal);
  await writeCache(getPlaylistChannelsKey(playlistId), liveChannelsData);

  // Movies and Series: fetched with error isolation. Fetched sequentially to avoid
  // overwhelming provider connection thresholds and causing TCP socket drops.
  progress('Loading Movies & Series', 0.65);
  const safeFetch = async (fn) => {
    try {
      const value = await fn();
      return { status: 'fulfilled', value };
    } catch (reason) {
      return { status: 'rejected', reason };
    }
  };

  const vodCatsRes = await safeFetch(() => xtreamGetVodCategories(effectiveServerUrl, username, password, net));
  throwIfAborted(signal);
  await new Promise((r) => setTimeout(r, 100));

  const vodStreamsRes = await safeFetch(() => xtreamGetVodStreams(effectiveServerUrl, username, password, null, net));
  throwIfAborted(signal);
  await new Promise((r) => setTimeout(r, 100));

  const seriesCatsRes = await safeFetch(() => xtreamGetSeriesCategories(effectiveServerUrl, username, password, net));
  throwIfAborted(signal);
  await new Promise((r) => setTimeout(r, 100));

  const seriesRes = await safeFetch(() => xtreamGetSeries(effectiveServerUrl, username, password, null, net));
  throwIfAborted(signal);

  const moviesFailed = vodCatsRes.status !== 'fulfilled' || vodStreamsRes.status !== 'fulfilled';
  const seriesFailed = seriesCatsRes.status !== 'fulfilled' || seriesRes.status !== 'fulfilled';

  let moviesPayload = null;
  if (vodCatsRes.status === 'fulfilled') {
    const vodCategories = vodCatsRes.value || [];
    const vodStreams = vodStreamsRes.status === 'fulfilled' ? (vodStreamsRes.value || []) : [];
    const isLargeLibrary = vodStreams.length > 3000;

    // Compact movie items without bloated strings to prevent memory pressure
    const groupedMovies = {};
    for (const s of vodStreams) {
      const cid = s.categoryId ? String(s.categoryId) : 'all_other';
      const resolvedPoster = s.poster || s.stream_icon || s.cover || null;
      if (!groupedMovies[cid]) groupedMovies[cid] = [];
      groupedMovies[cid].push({
        id: String(s.streamId || s.id),
        streamId: String(s.streamId || s.id),
        name: s.name || s.title || 'Untitled Movie',
        title: s.name || s.title || 'Untitled Movie',
        poster: resolvedPoster,
        stream_icon: resolvedPoster,
        cover: resolvedPoster,
        categoryId: cid,
        containerExtension: s.containerExtension || 'mp4',
        year: s.year || null,
        rating: s.rating != null ? Number(s.rating) : null,
        isAdult: Boolean(s.isAdult),
        type: 'movie',
      });
    }

    // Write category caches in background if large library (never blocks foreground switch lifecycle)
    if (isLargeLibrary && Object.keys(groupedMovies).length > 0) {
      setTimeout(async () => {
        for (const [catId, catItems] of Object.entries(groupedMovies)) {
          try {
            await writeCache(getPlaylistMovieCatKey(playlistId, catId), catItems);
          } catch (_e) {}
        }
      }, 1000);
    }

    const categorizedMovies = vodCategories.map((cat) => ({
      id: String(cat.id),
      name: cat.name,
      isAdult: cat.isAdult,
      itemCount: groupedMovies[String(cat.id)]?.length || 0,
      items: isLargeLibrary
        ? (groupedMovies[String(cat.id)]?.slice(0, 30) || [])
        : (groupedMovies[String(cat.id)] || []),
    }));

    moviesPayload = {
      type: 'movies',
      source: 'xtream',
      categories: categorizedMovies,
      total: vodStreams.length,
      syncedAt: Date.now(),
      serverUrl: effectiveServerUrl,
      username,
      password,
      playlistId,
    };
    throwIfAborted(signal);
    await writeCache(getPlaylistMoviesKey(playlistId), moviesPayload);
  } else {
    logError('SYNC', 'Movies fetch failed — preserving cached movies', vodStreamsRes.reason || vodCatsRes.reason, { playlistId });
    moviesPayload = await readCacheStale(getPlaylistMoviesKey(playlistId));
  }

  let seriesPayload = null;
  if (seriesCatsRes.status === 'fulfilled') {
    const seriesCategories = seriesCatsRes.value || [];
    const seriesList = seriesRes.status === 'fulfilled' ? (seriesRes.value || []) : [];
    const isLargeSeriesLibrary = seriesList.length > 3000;

    const groupedSeries = {};
    for (const s of seriesList) {
      const cid = s.categoryId ? String(s.categoryId) : 'all_other';
      if (!groupedSeries[cid]) groupedSeries[cid] = [];
      groupedSeries[cid].push(compactSeriesItem(s));
    }

    // Write category caches in background if large library (never blocks foreground switch lifecycle)
    if (isLargeSeriesLibrary && Object.keys(groupedSeries).length > 0) {
      setTimeout(async () => {
        for (const [catId, catItems] of Object.entries(groupedSeries)) {
          try {
            await writeCache(getPlaylistSeriesCatKey(playlistId, catId), catItems);
          } catch (_e) {}
        }
      }, 2000);
    }

    const categorizedSeries = seriesCategories.map((cat) => ({
      id: String(cat.id),
      name: cat.name,
      isAdult: cat.isAdult,
      itemCount: groupedSeries[String(cat.id)]?.length || 0,
      items: isLargeSeriesLibrary
        ? (groupedSeries[String(cat.id)]?.slice(0, 30) || [])
        : (groupedSeries[String(cat.id)] || []),
    }));

    progress('Saving your library', 0.85);
    seriesPayload = {
      type: 'series',
      source: 'xtream',
      categories: categorizedSeries,
      total: seriesList.length,
      syncedAt: Date.now(),
      serverUrl: effectiveServerUrl,
      username,
      password,
      playlistId,
    };
    throwIfAborted(signal);
    await writeCache(getPlaylistSeriesKey(playlistId), seriesPayload);
  } else {
    logError('SYNC', 'Series fetch failed — preserving cached series', seriesRes.reason || seriesCatsRes.reason, { playlistId });
    seriesPayload = await readCacheStale(getPlaylistSeriesKey(playlistId));
  }

  return {
    live: liveChannelsData,
    movies: moviesPayload,
    series: seriesPayload,
    partial: moviesFailed || seriesFailed,
    liveTotal: liveStreams.length,
    moviesTotal: moviesPayload?.total || 0,
    seriesTotal: seriesPayload?.total || 0,
    source: 'xtream',
    expirationDate: authInfo.expirationDate,
    status: authInfo.status,
  };
}

/**
 * Read a playlist's cached datasets SEQUENTIALLY (never in parallel).
 * Each read materializes a large string on both the native (JVM) and JS heaps;
 * reading Live/Movies/Series concurrently tripled that peak. Returns null fields
 * for missing datasets. A cache miss never implies anything about the backend.
 */
export async function loadCachedDatasets(playlistId, { signal } = {}) {
  if (!playlistId) return { config: null, live: null, movies: null, series: null };
  const config = await readCacheStale(getPlaylistConfigKey(playlistId));
  throwIfAborted(signal);
  const live = await readCacheStale(getPlaylistChannelsKey(playlistId));
  throwIfAborted(signal);
  const movies = await readCacheStale(getPlaylistMoviesKey(playlistId));
  throwIfAborted(signal);
  const series = await readCacheStale(getPlaylistSeriesKey(playlistId));
  logCache(live || movies || series ? 'Cache hit' : 'Cache miss', {
    playlistId,
    live: Boolean(live),
    movies: Boolean(movies),
    series: Boolean(series),
  });
  return { config, live, movies, series };
}

export { isCancelledError };

function groupByCategory(items, categories, transformer) {
  const catMap = {};
  for (const cat of categories) {
    catMap[String(cat.id)] = cat;
  }

  const grouped = {};
  const uncategorizedItems = [];

  for (const item of items) {
    const rawCatId = item.categoryId ? String(item.categoryId) : null;
    if (rawCatId && catMap[rawCatId]) {
      if (!grouped[rawCatId]) grouped[rawCatId] = [];
      grouped[rawCatId].push(transformer(item, catMap[rawCatId]));
    } else {
      uncategorizedItems.push(transformer(item, null));
    }
  }

  const result = categories
    .filter((cat) => grouped[String(cat.id)]?.length > 0)
    .map((cat) => ({
      id: String(cat.id),
      name: cat.name,
      isAdult: cat.isAdult,
      items: grouped[String(cat.id)],
    }));

  if (uncategorizedItems.length > 0) {
    result.push({
      id: 'all_other',
      name: result.length === 0 ? 'All Content' : 'Other / General',
      isAdult: false,
      items: uncategorizedItems,
    });
  }

  return result;
}

/**
 * Load cached live channels (scoped to playlistId if provided)
 */
export async function getCachedChannels(allowStale = false, playlistId = null) {
  const key = getPlaylistChannelsKey(playlistId);
  const data = allowStale ? await readCacheStale(key) : await readCache(key);
  if (data) return data;
  // Strictly isolate: only fall back to legacy un-scoped cache if NO playlistId was specified
  if (!playlistId) {
    return allowStale ? readCacheStale(STORAGE_KEYS.CHANNELS_CACHE) : readCache(STORAGE_KEYS.CHANNELS_CACHE);
  }
  return null;
}

/**
 * Load cached movies (scoped to playlistId if provided)
 */
export async function getCachedMovies(allowStale = false, playlistId = null) {
  const key = getPlaylistMoviesKey(playlistId);
  const data = allowStale ? await readCacheStale(key) : await readCache(key);
  if (data) return data;
  if (!playlistId) {
    return allowStale ? readCacheStale(STORAGE_KEYS.MOVIES_CACHE) : readCache(STORAGE_KEYS.MOVIES_CACHE);
  }
  return null;
}

/**
 * Load cached series (scoped to playlistId if provided)
 */
export async function getCachedSeries(allowStale = false, playlistId = null) {
  const key = getPlaylistSeriesKey(playlistId);
  const data = allowStale ? await readCacheStale(key) : await readCache(key);
  if (data) return data;
  if (!playlistId) {
    return allowStale ? readCacheStale(STORAGE_KEYS.SERIES_CACHE) : readCache(STORAGE_KEYS.SERIES_CACHE);
  }
  return null;
}

/**
 * Load cached playlist config (scoped to playlistId if provided)
 */
export async function getCachedConfig(playlistId = null) {
  const key = getPlaylistConfigKey(playlistId);
  const data = await readCacheStale(key);
  if (data) return data;
  if (!playlistId) {
    return readCacheStale(STORAGE_KEYS.PLAYLIST_CONFIG);
  }
  return null;
}

/**
 * Load cached movies for a specific category
 */
export async function getCategoryMovies(categoryId, allowStale = false, playlistId = null) {
  const key = getPlaylistMovieCatKey(playlistId, categoryId);
  let data = allowStale ? await readCacheStale(key) : await readCache(key);
  if (data) return data;
  if (playlistId) {
    data = allowStale ? await readCacheStale(`fox_player_movies_cat_${categoryId}`) : await readCache(`fox_player_movies_cat_${categoryId}`);
    if (data) return data;
  }
  return null;
}

/**
 * Cache movies for a specific category
 */
export async function cacheCategoryMovies(categoryId, items, playlistId = null) {
  return writeCache(getPlaylistMovieCatKey(playlistId, categoryId), items);
}

/**
 * Load cached series for a specific category
 */
export async function getCategorySeries(categoryId, allowStale = false, playlistId = null) {
  const key = getPlaylistSeriesCatKey(playlistId, categoryId);
  let data = allowStale ? await readCacheStale(key) : await readCache(key);
  if (data) return data;
  if (playlistId) {
    data = allowStale ? await readCacheStale(`fox_player_series_cat_${categoryId}`) : await readCache(`fox_player_series_cat_${categoryId}`);
    if (data) return data;
  }
  return null;
}

/**
 * Cache series for a specific category
 */
export async function cacheCategorySeries(categoryId, items, playlistId = null) {
  return writeCache(getPlaylistSeriesCatKey(playlistId, categoryId), items);
}
