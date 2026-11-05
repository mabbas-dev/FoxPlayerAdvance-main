import { TIMEOUTS } from '../constants/index.js';
import { isAdultContent } from './m3uParser.js';
import { resolvePosterUrl, sanitizePosterString } from '../utils/imageHelpers.js';
import { linkAbortSignal } from './syncEngine.js';
import {
  ERROR_CATEGORY,
  AppNetworkError,
  isDeviceOffline,
} from './networkErrors.js';

export { resolvePosterUrl, sanitizePosterString };

/**
 * Xtream Codes API client
 * 
 * Supports both Xtream Codes and compatible providers.
 */

/**
 * Normalize server URL to have protocol and strip trailing endpoints
 */
export function normalizeServerUrl(serverUrl) {
  let url = (serverUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  url = url.replace(/\/player_api\.php(\?.*)?$/i, '');
  url = url.replace(/\/get\.php(\?.*)?$/i, '');
  url = url.replace(/\/c\/?$/i, '');
  url = url.replace(/\/+$/, '');
  return url;
}

/**
 * Build base Xtream URL
 */
function buildXtreamBase(serverUrl, username, password) {
  const base = normalizeServerUrl(serverUrl);
  return `${base}/player_api.php?username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`;
}

/**
 * Safely extracts an array from various provider response shapes
 * Supports direct array, { categories: [] }, { streams: [] }, { data: [] }, { items: [] }, or object dictionaries
 */
export function safeExtractArray(data, entityName = 'items') {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.categories)) return data.categories;
  if (Array.isArray(data.streams)) return data.streams;
  if (Array.isArray(data.series)) return data.series;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  // If user_info or server_info is present, this is an auth/account response, NOT a streams/categories list
  if (data.user_info || data.server_info) {
    return [];
  }
  // If dictionary keyed by ID: { "1": { ... }, "2": { ... } }
  const vals = Object.values(data);
  if (vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null) {
    const first = vals[0];
    if (
      first.category_id != null ||
      first.stream_id != null ||
      first.series_id != null ||
      first.num != null ||
      (first.id != null && (first.name != null || first.title != null || first.category_name != null))
    ) {
      return vals;
    }
  }
  return [];
}

/**
 * Safely compute alternate protocol URL (HTTP <-> HTTPS).
 * If a custom non-SSL port (e.g. :8080, :8000, :8880, :25461) is present on an HTTP URL,
 * switching to HTTPS on the SAME port will always fail TLS handshake (LibreSSL alert 35 / TCP RST).
 * Therefore, we only alternate protocols when no custom port is present, or for standard ports 80/443.
 */
function getAlternateProtocolUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const port = parsed.port;
    if (parsed.protocol === 'http:') {
      if (!port || port === '80') {
        parsed.protocol = 'https:';
        parsed.port = '';
        return parsed.toString().replace(/\/+$/, '');
      }
      return null;
    } else if (parsed.protocol === 'https:') {
      if (!port || port === '443') {
        parsed.protocol = 'http:';
        parsed.port = '';
        return parsed.toString().replace(/\/+$/, '');
      }
      return null;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

/**
 * Make Xtream API request with automatic protocol fallback (HTTP <-> HTTPS)
 */
async function xtreamRequest(serverUrl, username, password, action, extraParams = '', customTimeoutMs = null, externalSignal = null, retryOptions = {}) {
  const isLargePayload = action === 'get_vod_streams' || action === 'get_series' || action === 'get_live_streams';
  const timeoutMs = customTimeoutMs || (isLargePayload ? 90000 : TIMEOUTS.IPTV);
  const linked = linkAbortSignal(externalSignal, timeoutMs);

  const normalized = normalizeServerUrl(serverUrl);
  const base = buildXtreamBase(normalized, username, password);
  const url = `${base}&action=${action}${extraParams}`;

  try {
    const response = await fetch(url, {
      signal: linked.signal,
      headers: {
        'User-Agent': 'IPTVSmartersPro/3.1.5 (Linux; Android 12)',
        'Accept': 'application/json, text/plain, */*',
        'Connection': 'keep-alive',
      },
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AppNetworkError(ERROR_CATEGORY.AUTH_ERROR, 'IPTV_AUTH_FAILED', { statusCode: response.status });
      }

      // If server returned 5xx (e.g. Cloudflare HTTP 520 / 502) and we haven't switched protocol, try alternate
      if (response.status >= 500 && !retryOptions._triedAltProtocol) {
        const altServerUrl = getAlternateProtocolUrl(normalized);
        if (altServerUrl) {
          try {
            return await xtreamRequest(altServerUrl, username, password, action, extraParams, customTimeoutMs, externalSignal, { ...retryOptions, _triedAltProtocol: true });
          } catch (_altErr) {}
        }
      }

      throw new AppNetworkError(
        ERROR_CATEGORY.PLAYLIST_SOURCE_ERROR,
        `Xtream server returned HTTP ${response.status}`,
        { statusCode: response.status }
      );
    }

    let data;
    try {
      data = await response.json();
    } catch (_parseErr) {
      throw new AppNetworkError(ERROR_CATEGORY.INVALID_RESPONSE, 'Xtream server returned an invalid response.');
    }

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      data._workingServerUrl = normalized;
    }

    return data;
  } catch (e) {
    // Caller-initiated abort (obsolete playlist / unmounted consumer) is a cancellation, not an error
    if (externalSignal?.aborted) {
      throw new AppNetworkError(ERROR_CATEGORY.REQUEST_ABORTED, 'Xtream request cancelled.', { isCancelled: true });
    }
    if (e.name === 'AbortError' || linked.didTimeout()) {
      throw new AppNetworkError(ERROR_CATEGORY.TIMEOUT, 'Xtream server request timed out.');
    }
    if (e instanceof AppNetworkError) throw e;
    if (e.message === 'IPTV_AUTH_FAILED') {
      throw new AppNetworkError(ERROR_CATEGORY.AUTH_ERROR, 'IPTV_AUTH_FAILED');
    }

    // Handle transient network / socket failures (e.g. TCP RST / ECONNRESET / libusrtcp drop)
    const isNetError = e.message?.includes('Network request failed') || e.message?.includes('fetch') || e.message?.includes('reset');
    const retryCount = retryOptions._retryCount || 0;
    const maxRetries = retryOptions.maxRetries !== undefined ? retryOptions.maxRetries : 2;

    if (isNetError && !externalSignal?.aborted) {
      if (retryCount < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(1.5, retryCount), 3000);
        await new Promise((r) => setTimeout(r, backoffMs));
        if (externalSignal?.aborted) {
          throw new AppNetworkError(ERROR_CATEGORY.REQUEST_ABORTED, 'Xtream request cancelled.', { isCancelled: true });
        }
        return await xtreamRequest(serverUrl, username, password, action, extraParams, customTimeoutMs, externalSignal, {
          ...retryOptions,
          _retryCount: retryCount + 1,
        });
      }

      // If custom port failed, try without port
      if (!retryOptions._triedNoPort) {
        try {
          const parsed = new URL(normalized);
          if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
            const noPortUrl = `${parsed.protocol}//${parsed.hostname}`;
            return await xtreamRequest(noPortUrl, username, password, action, extraParams, customTimeoutMs, externalSignal, {
              ...retryOptions,
              _triedNoPort: true,
              _retryCount: 0,
            });
          }
        } catch (_npErr) {}
      }

      // If all retries on current protocol failed, attempt protocol fallback (HTTP <-> HTTPS)
      if (!retryOptions._triedAltProtocol) {
        const altServerUrl = getAlternateProtocolUrl(normalized);
        if (altServerUrl) {
          try {
            return await xtreamRequest(altServerUrl, username, password, action, extraParams, customTimeoutMs, externalSignal, {
              ...retryOptions,
              _triedAltProtocol: true,
              _retryCount: 0,
            });
          } catch (_altErr) {}
        }
      }

      const offline = await isDeviceOffline();
      if (offline) {
        throw new AppNetworkError(ERROR_CATEGORY.OFFLINE, 'No internet connection.');
      }
      throw new AppNetworkError(
        ERROR_CATEGORY.PLAYLIST_SOURCE_ERROR,
        'Unable to connect to Xtream server. Please check the server URL.'
      );
    }
    throw e;
  } finally {
    linked.cleanup();
  }
}

/**
 * Authenticate and get account info
 */
export async function xtreamAuthenticate(serverUrl, username, password, options = {}) {
  const data = await xtreamRequest(serverUrl, username, password, 'get_account_info', '', null, options.signal);

  if (!data || !data.user_info) {
    throw new AppNetworkError(ERROR_CATEGORY.AUTH_ERROR, 'IPTV_AUTH_FAILED');
  }

  const statusStr = String(data.user_info.status || '').toLowerCase().trim();
  const expDate = data.user_info.exp_date;
  const isExpDatePassed = (() => {
    if (!expDate || expDate === 'null' || expDate === 0 || expDate === '0') return false;
    const num = Number(expDate);
    if (!isNaN(num) && num > 0) {
      const ms = num > 1e11 ? num : num * 1000;
      return ms < Date.now();
    }
    const parsed = Date.parse(expDate);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed < Date.now();
    }
    return false;
  })();

  if (statusStr === 'expired' || isExpDatePassed) {
    throw new AppNetworkError(ERROR_CATEGORY.PROVIDER_EXPIRED, 'PROVIDER_EXPIRED', {
      expirationDate: expDate,
      status: data.user_info.status || 'Expired',
    });
  }

  if (data.user_info.auth === 0 || data.user_info.auth === '0') {
    const rawMsg = String(data.user_info.message || '').toLowerCase();
    if (rawMsg.includes('expired') || statusStr.includes('expired')) {
      throw new AppNetworkError(ERROR_CATEGORY.PROVIDER_EXPIRED, 'PROVIDER_EXPIRED');
    }
    throw new AppNetworkError(ERROR_CATEGORY.AUTH_ERROR, 'IPTV_AUTH_FAILED');
  }

  // Derive optimal stream/api server URL if server_info contains a specific port/protocol
  let resolvedServerUrl = data._workingServerUrl || serverUrl;
  if (data.server_info && typeof data.server_info === 'object') {
    const sInfo = data.server_info;
    const host = (sInfo.url || '').trim();
    const port = String(sInfo.port || sInfo.https_port || '').trim();
    const proto = (sInfo.server_protocol || '').toLowerCase().trim();

    try {
      const parsed = new URL(normalizeServerUrl(resolvedServerUrl));
      // Only refine port if user did not specify one explicitly
      if (!parsed.port && port && port !== '80' && port !== '443') {
        const isLocalHost = !host || host === 'localhost' || host.startsWith('127.') || host.startsWith('192.168.') || host.startsWith('10.');
        const targetHost = isLocalHost ? parsed.hostname : host;
        const targetProto = proto ? `${proto}:` : parsed.protocol;
        resolvedServerUrl = `${targetProto}//${targetHost}:${port}`;
      }
    } catch (_e) {}
  }

  return {
    status: data.user_info.status,
    expirationDate: data.user_info.exp_date,
    maxConnections: data.user_info.max_connections,
    activeConnections: data.user_info.active_cons,
    serverUrl: resolvedServerUrl,
  };
}

/**
 * Get live stream categories
 */
export async function xtreamGetLiveCategories(serverUrl, username, password, options = {}) {
  const data = await xtreamRequest(serverUrl, username, password, 'get_live_categories', '', null, options.signal);
  if (!Array.isArray(data)) return [];
  return data.map((c) => ({
    id: String(c.category_id),
    name: c.category_name || 'Unknown',
    isAdult: isAdultContent(c.category_name, ''),
  }));
}

/**
 * Get live streams for a category
 */
export async function xtreamGetLiveStreams(serverUrl, username, password, categoryId = null, options = {}) {
  const extra = categoryId ? `&category_id=${categoryId}` : '';
  const data = await xtreamRequest(serverUrl, username, password, 'get_live_streams', extra, null, options.signal);
  if (!Array.isArray(data)) return [];
  return data.map((s) => {
    const streamId = String(s.stream_id || s.id || '');
    const ext = (s.container_extension || 'ts').replace(/^\.+/, '');
    const playUrl = (serverUrl && username && password && streamId)
      ? buildLiveStreamUrl(serverUrl, username, password, streamId, ext)
      : null;
    return {
      id: streamId,
      name: s.name || 'Unknown Channel',
      logo: resolvePosterUrl(s, serverUrl) || s.stream_icon || null,
      categoryId: String(s.category_id || ''),
      streamId,
      containerExtension: ext,
      isAdult: isAdultContent(s.name, ''),
      epgId: s.epg_channel_id || null,
      url: playUrl,
      serverUrl,
      username,
      password,
      type: 'live',
    };
  });
}

/**
 * Normalizes raw movie item into standardized application Movie model
 */
export function normalizeMovieItem(v, serverUrl = null, username = null, password = null) {
  if (!v || typeof v !== 'object') return null;
  const streamId = String(v.stream_id || v.id || v.streamId || v.num || '').trim();
  if (!streamId) return null;

  const ext = (v.container_extension || v.containerExtension || 'mp4').replace(/^\.+/, '');
  const rawName = v.name || v.title || 'Untitled Movie';
  const posterUrl = resolvePosterUrl(v, serverUrl);
  const categoryId = v.category_id != null ? String(v.category_id) : (v.categoryId != null ? String(v.categoryId) : '');

  let playUrl = v.url || null;
  if (!playUrl && serverUrl && username && password && streamId) {
    playUrl = buildVodStreamUrl(serverUrl, username, password, streamId, ext);
  }

  return {
    id: streamId,
    streamId,
    name: rawName,
    title: rawName,
    poster: posterUrl,
    posterUri: posterUrl,
    cover: posterUrl,
    categoryId,
    containerExtension: ext,
    year: v.year || (v.release_date ? String(v.release_date).split('-')[0] : null) || null,
    rating: v.rating != null ? (isNaN(Number(v.rating)) ? null : Number(v.rating)) : null,
    rating5Based: v.rating_5based != null ? Number(v.rating_5based) : null,
    plot: v.plot || v.description || null,
    director: v.director || null,
    cast: v.cast || v.actors || null,
    duration: v.duration || null,
    isAdult: isAdultContent(rawName, ''),
    type: 'movie',
    url: playUrl,
    serverUrl,
    username,
    password,
  };
}

/**
 * Get VOD categories
 */
export async function xtreamGetVodCategories(serverUrl, username, password, options = {}) {
  try {
    console.log('[MOVIES] Request action=get_vod_categories');
    const data = await xtreamRequest(serverUrl, username, password, 'get_vod_categories', '', null, options.signal);
    const list = safeExtractArray(data, 'categories');
    console.log(`[MOVIES] Categories count: ${list.length}`);
    return list
      .filter((c) => c && typeof c === 'object' && (c.category_id != null || c.id != null) && String(c.category_id ?? c.id).trim() !== '')
      .map((c) => ({
        id: String(c.category_id != null ? c.category_id : c.id).trim(),
        name: String(c.category_name || c.name || 'Unknown Category').trim(),
        isAdult: isAdultContent(c.category_name || c.name || '', ''),
      }));
  } catch (err) {
    if (options.strict || err?.isCancelled) throw err;
    console.warn('[MOVIES] Failed to fetch VOD categories:', err.message);
    return [];
  }
}

/**
 * Get VOD streams for a category or all categories
 */
export async function xtreamGetVodStreams(serverUrl, username, password, categoryId = null, options = {}) {
  try {
    const extra = (categoryId != null && categoryId !== 'ALL' && categoryId !== 'all') ? `&category_id=${categoryId}` : '';
    console.log(`[MOVIES] Request action=get_vod_streams${extra}`);
    const data = await xtreamRequest(serverUrl, username, password, 'get_vod_streams', extra, 60000, options.signal);
    const list = safeExtractArray(data, 'streams');
    console.log(`[MOVIES] Streams response received (count: ${list.length})`);
    const normalized = list
      .map((v) => normalizeMovieItem(v, serverUrl, username, password))
      .filter(Boolean);
    console.log(`[MOVIES] Normalized movie count: ${normalized.length}`);
    if (normalized.length > 0) {
      console.log(`[MOVIES] First movie sample: ${normalized[0].name} (ext: ${normalized[0].containerExtension}, catId: ${normalized[0].categoryId})`);
    }
    return normalized;
  } catch (err) {
    if (options.strict || err?.isCancelled) throw err;
    console.warn('[MOVIES] Failed to fetch VOD streams:', err.message);
    return [];
  }
}

/**
 * Normalizes raw series item into standardized application Series model
 */
export function normalizeSeriesItem(item, serverUrl = null, username = null, password = null) {
  if (!item || typeof item !== 'object') return null;
  const seriesId = String(item.series_id != null ? item.series_id : (item.id != null ? item.id : (item.seriesId != null ? item.seriesId : '')));
  if (!seriesId) return null;

  const rawTitle = item.name || item.title || 'Untitled Series';
  const posterUri = resolvePosterUrl(item, serverUrl);
  const backdropUrl = resolvePosterUrl(item.backdrop_path, serverUrl) || posterUri;
  const plotText = item.plot || item.description || '';
  const categoryId = item.category_id != null ? String(item.category_id) : (item.categoryId != null ? String(item.categoryId) : null);
  const releaseDate = item.releaseDate || item.release_date || null;
  const year = item.year || (releaseDate ? String(releaseDate).split('-')[0] : null) || null;
  const rating = item.rating != null ? (isNaN(Number(item.rating)) ? null : Number(item.rating)) : null;

  return {
    id: seriesId,
    seriesId,
    name: rawTitle,
    title: rawTitle,
    posterUri,
    poster: posterUri,
    cover: posterUri,
    backdrop: backdropUrl,
    plot: plotText,
    description: plotText,
    genre: item.genre || '',
    rating,
    rating5Based: item.rating_5based != null ? Number(item.rating_5based) : null,
    categoryId,
    categoryIds: Array.isArray(item.category_ids) ? item.category_ids.map(String) : (categoryId ? [categoryId] : []),
    releaseDate,
    year,
    cast: item.cast || item.actors || null,
    director: item.director || null,
    isAdult: isAdultContent(rawTitle, ''),
    type: 'series',
    serverUrl,
    username,
    password,
  };
}

/**
 * Get series categories
 */
export async function xtreamGetSeriesCategories(serverUrl, username, password, options = {}) {
  try {
    console.log('[SERIES] Request action=get_series_categories');
    const data = await xtreamRequest(serverUrl, username, password, 'get_series_categories', '', null, options.signal);
    console.log(`[SERIES] Categories response received (type: ${typeof data}, isArray: ${Array.isArray(data)})`);
    const list = safeExtractArray(data, 'categories');
    console.log(`[SERIES] Category count: ${list.length}`);
    return list
      .filter((c) => c && typeof c === 'object' && (c.category_id != null || c.id != null) && String(c.category_id ?? c.id).trim() !== '')
      .map((c) => ({
        id: String(c.category_id != null ? c.category_id : c.id).trim(),
        name: String(c.category_name || c.name || 'Unknown Category').trim(),
        isAdult: isAdultContent(c.category_name || c.name || '', ''),
      }));
  } catch (err) {
    if (options.strict || err?.isCancelled) throw err;
    console.warn('[SERIES] Failed to fetch series categories:', err.message);
    return [];
  }
}

/**
 * Get series list for a category or all series
 */
export async function xtreamGetSeries(serverUrl, username, password, categoryId = null, options = {}) {
  try {
    const extra = (categoryId != null && categoryId !== 'ALL' && categoryId !== 'all') ? `&category_id=${categoryId}` : '';
    console.log(`[SERIES] Series request started: action=get_series${extra}`);
    const data = await xtreamRequest(serverUrl, username, password, 'get_series', extra, 60000, options.signal);
    console.log(`[SERIES] API response received (type: ${typeof data}, isArray: ${Array.isArray(data)})`);
    const list = safeExtractArray(data, 'series');
    console.log(`[SERIES] Raw series count: ${list.length}`);
    const normalized = list
      .map((s) => normalizeSeriesItem(s, serverUrl, username, password))
      .filter(Boolean);
    console.log(`[SERIES] Normalized series count: ${normalized.length}`);
    if (normalized.length > 0) {
      console.log(`[SERIES] First normalized item: ${normalized[0].name} (id: ${normalized[0].id}, catId: ${normalized[0].categoryId})`);
    }
    return normalized;
  } catch (err) {
    if (options.strict || err?.isCancelled) throw err;
    console.warn('[SERIES] Failed to fetch series:', err.message);
    return [];
  }
}

/**
 * Get series info (seasons and episodes)
 */
export async function xtreamGetSeriesInfo(serverUrl, username, password, seriesId) {
  try {
    console.log(`[SERIES] Opening series: ${seriesId}`);
    console.log('[SERIES] Series info request started');
    const data = await xtreamRequest(serverUrl, username, password, 'get_series_info', `&series_id=${seriesId}`, 30000);
    if (!data || typeof data !== 'object') {
      console.warn(`[SERIES] Series info returned empty response`);
      return null;
    }

    const info = data.info || {};
    const seasons = Array.isArray(data.seasons) ? data.seasons : (data.seasons && typeof data.seasons === 'object' ? Object.values(data.seasons) : []);
    const episodes = data.episodes || {};

    let parsedSeasons = [];

    if (typeof episodes === 'object' && !Array.isArray(episodes)) {
      parsedSeasons = Object.keys(episodes).map((seasonKey) => {
        const seasonNum = parseInt(seasonKey, 10) || 1;
        const eps = Array.isArray(episodes[seasonKey]) ? episodes[seasonKey] : Object.values(episodes[seasonKey] || {});
        const seasonMeta = seasons.find((s) => Number(s.season_number ?? s.seasonNumber) === seasonNum) || {};

        return {
          seasonNumber: seasonNum,
          name: seasonMeta.name || `Season ${seasonNum}`,
          overview: seasonMeta.overview || '',
          cover: resolvePosterUrl(seasonMeta, serverUrl),
          episodes: eps.map((e) => {
            const epNum = Number(e.episode_num ?? e.episodeNumber) || 0;
            const epId = String(e.id || e.stream_id || '');
            const epPoster = resolvePosterUrl(e.info, serverUrl) || resolvePosterUrl(e, serverUrl);
            return {
              id: epId,
              streamId: epId,
              episodeNumber: epNum,
              episodeNum: epNum,
              title: e.title || `Episode ${epNum}`,
              thumbnail: epPoster,
              poster: epPoster,
              description: e.info?.plot || e.plot || '',
              plot: e.info?.plot || e.plot || '',
              duration: e.info?.duration || e.duration || null,
              containerExtension: (e.container_extension || e.info?.container_extension || e.containerExtension || 'mp4').replace(/^\.+/, ''),
              rating: e.info?.rating || e.rating || null,
            };
          }).filter((ep) => Boolean(ep.id)),
        };
      });
    } else if (Array.isArray(episodes)) {
      const seasonMap = {};
      for (const e of episodes) {
        const sNum = parseInt(e.season ?? e.season_num ?? 1, 10) || 1;
        if (!seasonMap[sNum]) seasonMap[sNum] = [];
        const epNum = Number(e.episode_num ?? e.episodeNumber) || 0;
        const epId = String(e.id || e.stream_id || '');
        const epPoster = resolvePosterUrl(e.info, serverUrl) || resolvePosterUrl(e, serverUrl);
        seasonMap[sNum].push({
          id: epId,
          streamId: epId,
          episodeNumber: epNum,
          episodeNum: epNum,
          title: e.title || `Episode ${epNum}`,
          thumbnail: epPoster,
          poster: epPoster,
          description: e.info?.plot || e.plot || '',
          plot: e.info?.plot || e.plot || '',
          duration: e.info?.duration || e.duration || null,
          containerExtension: (e.container_extension || e.info?.container_extension || e.containerExtension || 'mp4').replace(/^\.+/, ''),
          rating: e.info?.rating || e.rating || null,
        });
      }
      parsedSeasons = Object.keys(seasonMap).map((sNum) => ({
        seasonNumber: parseInt(sNum, 10),
        name: `Season ${sNum}`,
        episodes: seasonMap[sNum],
      }));
    }

    parsedSeasons.sort((a, b) => a.seasonNumber - b.seasonNumber);

    const totalEps = parsedSeasons.reduce((acc, s) => acc + (s.episodes?.length || 0), 0);
    console.log(`[SERIES] Seasons count: ${parsedSeasons.length}`);
    console.log(`[SERIES] Episodes count: ${totalEps}`);

    const seriesPoster = resolvePosterUrl(info, serverUrl) || resolvePosterUrl(data, serverUrl);

    return {
      id: String(seriesId),
      seriesId: String(seriesId),
      name: info.name || info.title || 'Unknown Series',
      title: info.name || info.title || 'Unknown Series',
      poster: seriesPoster,
      cover: seriesPoster,
      plot: info.plot || info.description || null,
      description: info.plot || info.description || null,
      year: info.releaseDate ? String(info.releaseDate).split('-')[0] : (info.release_date ? String(info.release_date).split('-')[0] : null),
      rating: info.rating != null ? Number(info.rating) : null,
      genre: info.genre || '',
      cast: info.cast || info.actors || null,
      director: info.director || null,
      seasons: parsedSeasons,
    };
  } catch (err) {
    console.warn(`[SERIES] Failed to fetch series ${seriesId} info:`, err.message);
    throw err;
  }
}

function normalizeBaseUrl(serverUrl) {
  let base = (serverUrl || '').trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
}

/**
 * Build live stream URL
 */
export function buildLiveStreamUrl(serverUrl, username, password, streamId, extension = 'ts') {
  const base = normalizeBaseUrl(serverUrl);
  const ext = (extension || 'ts').replace(/^\.+/, '');
  return `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}

/**
 * Build VOD stream URL
 */
export function buildVodStreamUrl(serverUrl, username, password, streamId, extension = 'mp4') {
  const base = normalizeBaseUrl(serverUrl);
  const ext = (extension || 'mp4').replace(/^\.+/, '');
  return `${base}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}

/**
 * Build series episode stream URL
 */
export function buildSeriesStreamUrl(serverUrl, username, password, streamId, extension = 'mp4') {
  const base = normalizeBaseUrl(serverUrl);
  const ext = (extension || 'mp4').replace(/^\.+/, '');
  return `${base}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
}
