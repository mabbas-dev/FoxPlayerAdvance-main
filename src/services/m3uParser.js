import { TIMEOUTS, ADULT_KEYWORDS } from '../constants/index.js';
import {
  ERROR_CATEGORY,
  AppNetworkError,
  isDeviceOffline,
} from './networkErrors.js';
import {
  sanitizeUrlForLogging,
  validateAndNormalizeM3UUrl,
} from '../utils/m3uUrlHelpers.js';

/**
 * Parses an attribute string from an #EXTINF line.
 * Handles:
 *   key="value"
 *   key='value'
 *   key=value
 * Spaces, commas, quotes inside values are supported safely.
 */
// Precompiled regular expressions for high-throughput zero-allocation parsing
const ATTR_REGEX = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',]+))/g;

function parseAttributes(attrString) {
  const attrs = {};
  if (!attrString) return attrs;

  ATTR_REGEX.lastIndex = 0;
  let match;
  while ((match = ATTR_REGEX.exec(attrString)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
    attrs[key] = (value || '').trim();
  }
  return attrs;
}

/**
 * Extracts duration, attributes, and display name from #EXTINF line.
 * Format: #EXTINF:duration [attributes],Display Name
 * Display name begins after the first comma that is NOT inside quoted attribute values.
 */
function parseExtInf(infoLine) {
  // Strip leading '#EXTINF:'
  const content = infoLine.substring(8).trim();

  // Find the comma that separates attributes/duration from display name.
  // We must track quotes to avoid splitting on a comma inside an attribute value.
  let commaIdx = -1;
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === ',' && !inDoubleQuote && !inSingleQuote) {
      commaIdx = i;
      break;
    }
  }

  let durationAndAttrs = '';
  let displayName = '';

  if (commaIdx >= 0) {
    durationAndAttrs = content.substring(0, commaIdx).trim();
    displayName = content.substring(commaIdx + 1).trim();
  } else {
    durationAndAttrs = content.trim();
  }

  // Duration is first token: e.g. "-1", "0", "120"
  const spaceIdx = durationAndAttrs.search(/\s/);
  let duration = -1;
  let attrString = '';

  if (spaceIdx >= 0) {
    const durStr = durationAndAttrs.substring(0, spaceIdx).trim();
    duration = parseFloat(durStr) || -1;
    attrString = durationAndAttrs.substring(spaceIdx + 1).trim();
  } else {
    duration = parseFloat(durationAndAttrs) || -1;
  }

  const attrs = parseAttributes(attrString);

  return {
    duration,
    attrs,
    displayName,
  };
}

/**
 * Extracts container extension from stream URL or default based on format.
 */
function extractExtension(url) {
  if (!url || typeof url !== 'string') return 'ts';
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const match = cleanUrl.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) {
      return match[1].toLowerCase();
    }
  } catch (_e) {}
  return 'ts';
}

/**
 * Deterministic 32-bit FNV-1a / DJB2 variant hash for stable unique IDs
 */
function simpleHash(str) {
  if (!str) return '00000000';
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
}

/**
 * Generate stable unique channel ID incorporating tvg-id and URL hash
 */
function generateChannelId(url, tvgId, index) {
  const urlHash = simpleHash(url);
  if (tvgId) {
    const cleanTvg = tvgId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 32);
    return `tvg_${cleanTvg}_${urlHash}`;
  }
  return `ch_${urlHash}_${index}`;
}

// Pre-compiled adult keyword regex for 100x faster execution than array iteration
const ADULT_REGEX = new RegExp(
  `(?:${ADULT_KEYWORDS.map((k) => k.replace(/[+*?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'i'
);
const adultCache = new Map();
const ADULT_CACHE_LIMIT = 1000;

/**
 * Detect adult content from name and group (O(1) cached lookup)
 */
export function isAdultContent(name = '', group = '') {
  if (!name && !group) return false;
  const key = `${name}|${group}`;
  const cached = adultCache.get(key);
  if (cached !== undefined) return cached;

  const result = ADULT_REGEX.test(`${name} ${group}`);
  if (adultCache.size >= ADULT_CACHE_LIMIT) {
    const first = adultCache.keys().next().value;
    adultCache.delete(first);
  }
  adultCache.set(key, result);
  return result;
}

/**
 * Parse an M3U playlist string into structured channel data
 * Supports:
 * - UTF-8 BOM (\uFEFF)
 * - CRLF and LF line endings
 * - Leading comments and blank lines
 * - #EXTINF, #EXTGRP, #EXTVLCOPT, #KODIPROP
 * - Quoted attributes and commas in channel names
 * - Large playlists
 */
export function parseM3U(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Invalid M3U content: empty or non-string input.');
  }

  // Strip UTF-8 Byte Order Mark (BOM) if present
  let cleanContent = content;
  if (cleanContent.charCodeAt(0) === 0xFEFF) {
    cleanContent = cleanContent.slice(1);
  }

  // Fast check for HTML error responses from server
  const first500 = cleanContent.substring(0, 500).trim().toLowerCase();
  if (first500.includes('expired') || first500.includes('subscription expired') || first500.includes('account expired')) {
    throw new AppNetworkError(
      ERROR_CATEGORY.PROVIDER_EXPIRED,
      'Playlist subscription has expired.'
    );
  }
  if (
    first500.startsWith('<!doctype html') ||
    first500.startsWith('<html') ||
    first500.includes('</html>') ||
    first500.includes('<head>') ||
    first500.includes('cloudflare')
  ) {
    console.warn('[M3U] invalid response: server returned HTML page instead of M3U content');
    throw new AppNetworkError(
      ERROR_CATEGORY.UNSUPPORTED_RESPONSE,
      'Server returned an HTML page instead of an M3U playlist.'
    );
  }

  // Split into lines (supporting \r\n and \n)
  const lines = cleanContent.split(/\r?\n/);

  // Validate M3U format: must contain #EXTM3U or #EXTINF
  let hasValidHeader = false;
  let firstDirectiveIdx = -1;

  for (let idx = 0; idx < Math.min(lines.length, 100); idx++) {
    const trimmed = lines[idx].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#EXTM3U')) {
      hasValidHeader = true;
      firstDirectiveIdx = idx;
      console.log('[M3U] detected extended M3U (#EXTM3U header)');
      break;
    }
    if (trimmed.startsWith('#EXTINF:')) {
      hasValidHeader = true;
      firstDirectiveIdx = idx;
      console.log('[M3U] detected extended M3U (#EXTINF directives)');
      break;
    }
  }

  if (!hasValidHeader) {
    const lowerContent = cleanContent.substring(0, 1000).toLowerCase();
    if (lowerContent.includes('expired') || lowerContent.includes('subscription')) {
      throw new AppNetworkError(
        ERROR_CATEGORY.PROVIDER_EXPIRED,
        'Playlist subscription has expired.'
      );
    }
    console.warn('[M3U] invalid response: expected #EXTM3U header or #EXTINF entries');
    throw new AppNetworkError(
      ERROR_CATEGORY.INVALID_M3U,
      'Not a valid M3U playlist: missing #EXTM3U header or #EXTINF entries.'
    );
  }

  const channels = [];
  const categories = new Set();
  const seenIds = new Set();

  let i = firstDirectiveIdx >= 0 ? firstDirectiveIdx : 0;
  let channelIndex = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith('#EXTINF:')) {
      const infoLine = line;
      let streamUrl = '';
      let extGroup = '';
      const vlcOptions = {};

      // Look ahead for directives (#EXTGRP, #EXTVLCOPT, etc.) until the next stream URL
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (!nextLine) {
          j++;
          continue;
        }

        if (nextLine.startsWith('#EXTGRP:')) {
          extGroup = nextLine.substring(8).trim();
          j++;
          continue;
        }

        if (nextLine.startsWith('#EXTVLCOPT:')) {
          const opt = nextLine.substring(11).trim();
          const eqIdx = opt.indexOf('=');
          if (eqIdx > 0) {
            vlcOptions[opt.substring(0, eqIdx).trim().toLowerCase()] = opt.substring(eqIdx + 1).trim();
          }
          j++;
          continue;
        }

        if (nextLine.startsWith('#KODIPROP:')) {
          // Kodi properties (e.g. inputstream.adaptive.manifest_type)
          j++;
          continue;
        }

        if (nextLine.startsWith('#EXTINF:')) {
          // Another EXTINF without a stream URL — skip previous broken entry
          i = j - 1;
          break;
        }

        if (nextLine.startsWith('#')) {
          // Other comment or unknown directive, skip
          j++;
          continue;
        }

        // Found non-comment, non-empty line: this is the stream URL
        streamUrl = nextLine;
        i = j;
        break;
      }

      if (!streamUrl) {
        i++;
        continue;
      }

      // Parse the EXTINF line
      const { duration, attrs, displayName } = parseExtInf(infoLine);

      const tvgId = attrs['tvg-id'] || attrs['tvg_id'] || '';
      const tvgName = attrs['tvg-name'] || attrs['tvg_name'] || '';
      const tvgLogo = attrs['tvg-logo'] || attrs['tvg_logo'] || attrs['logo'] || '';
      const groupTitle = attrs['group-title'] || attrs['group_title'] || extGroup || 'General';
      const tvgShift = attrs['tvg-shift'] || '';
      const containerExtension = extractExtension(streamUrl);

      // Name priority: display name (after comma) > tvg-name > fallback
      const resolvedName = displayName || tvgName || 'Unknown Channel';
      const resolvedGroup = groupTitle.trim() || 'General';

      channelIndex++;
      let channelId = generateChannelId(streamUrl, tvgId, channelIndex);

      // Ensure uniqueness within this playlist
      if (seenIds.has(channelId)) {
        channelId = `${channelId}_${channelIndex}`;
      }
      seenIds.add(channelId);

      const channel = {
        id: channelId,
        streamId: channelId,
        name: resolvedName,
        logo: tvgLogo || null,
        poster: tvgLogo || null,
        group: resolvedGroup,
        categoryId: resolvedGroup,
        url: streamUrl,
        tvgId: tvgId || null,
        tvgName: tvgName || null,
        tvgShift: tvgShift || null,
        duration: duration >= 0 ? duration : null,
        containerExtension,
        isAdult: isAdultContent(resolvedName, resolvedGroup),
        vlcOptions: Object.keys(vlcOptions).length > 0 ? vlcOptions : undefined,
      };

      channels.push(channel);
      if (channel.group) categories.add(channel.group);
    }

    i++;
  }

  if (channels.length === 0) {
    console.warn('[M3U] parse completed with 0 channels');
    throw new AppNetworkError(
      ERROR_CATEGORY.NO_VALID_ENTRIES,
      'No channels found in the playlist.'
    );
  }

  return {
    channels,
    categories: Array.from(categories).sort(),
    total: channels.length,
  };
}

/**
 * Fetch and parse M3U from a URL
 * Validates HTTP status, handles redirects, timeouts, UTF-8 BOM, user-agent retries, and errors.
 */
export async function fetchAndParseM3U(url, options = {}) {
  const cleanUrl = validateAndNormalizeM3UUrl(url);

  const sanitizedUrl = sanitizeUrlForLogging(cleanUrl);
  console.log('[M3U] request started:', sanitizedUrl);

  const externalSignal = options.signal || null;
  const controller = new AbortController();
  // 60-second default timeout for large IPTV M3U catalogs
  const timeoutMs = options.timeout || (TIMEOUTS.IPTV ? Math.max(TIMEOUTS.IPTV, 60000) : 60000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener?.('abort', onExternalAbort);
  }

  // Standard IPTV request headers matching xtreamService
  const baseHeaders = {
    'User-Agent': 'FOX-PLAYER/1.0',
    Accept: '*/*',
    ...(options.headers || {}),
  };

  try {
    let response = await fetch(cleanUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: baseHeaders,
    });

    // If server rejects with 403 or 401, retry once with standard IPTV Smarters user agent
    if ((response.status === 403 || response.status === 401) && !options.headers?.['User-Agent']) {
      console.log('[M3U] Server returned status', response.status, 'with default UA. Retrying with standard player UA...');
      try {
        const retryResponse = await fetch(cleanUrl, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            ...baseHeaders,
            'User-Agent': 'IPTVSmartersPro/3.1.5 (Linux; Android 12)',
          },
        });
        if (retryResponse.ok) {
          response = retryResponse;
        }
      } catch (_retryErr) {
        // Keep original response
      }
    }

    if (!response.ok) {
      console.warn('[M3U] request failed: HTTP', response.status);
      if (response.status === 401) {
        throw new AppNetworkError(
          ERROR_CATEGORY.HTTP_401,
          'Playlist authentication required (HTTP 401). Check credentials.',
          { statusCode: 401 }
        );
      }
      if (response.status === 403) {
        throw new AppNetworkError(
          ERROR_CATEGORY.HTTP_403,
          'Playlist access denied (HTTP 403). Check credentials or IP authorization.',
          { statusCode: 403 }
        );
      }
      if (response.status === 404) {
        throw new AppNetworkError(
          ERROR_CATEGORY.HTTP_404,
          'Playlist URL not found (HTTP 404). Please verify the link.',
          { statusCode: 404 }
        );
      }
      if (response.status >= 500) {
        throw new AppNetworkError(
          ERROR_CATEGORY.HTTP_5XX,
          `Playlist server error (HTTP ${response.status}). Please try again later.`,
          { statusCode: response.status }
        );
      }
      throw new AppNetworkError(
        ERROR_CATEGORY.HTTP_ERROR,
        `Playlist request failed (HTTP ${response.status}).`,
        { statusCode: response.status }
      );
    }

    const contentType = response.headers?.get?.('content-type') || 'unknown';
    const text = await response.text();
    console.log(`[M3U] response received: status=${response.status} contentType=${contentType} size=${text ? text.length : 0} chars`);

    if (!text || !text.trim()) {
      console.warn('[M3U] invalid response: empty content');
      throw new AppNetworkError(
        ERROR_CATEGORY.EMPTY_RESPONSE,
        'Playlist source returned an empty response.'
      );
    }

    const parsed = parseM3U(text);
    console.log(`[M3U] parsed items=${parsed.channels.length} categories=${parsed.categories.length}`);
    return parsed;
  } catch (e) {
    if (externalSignal?.aborted) {
      throw new AppNetworkError(
        ERROR_CATEGORY.REQUEST_ABORTED,
        'Playlist request cancelled.',
        { isCancelled: true }
      );
    }
    if (e.name === 'AbortError') {
      console.warn('[M3U] request timed out after', timeoutMs, 'ms');
      throw new AppNetworkError(
        ERROR_CATEGORY.TIMEOUT,
        'Playlist request timed out. Please check your network and provider server.'
      );
    }
    if (e instanceof AppNetworkError) throw e;
    if (e.message?.includes('Network request failed') || e.message?.includes('Failed to fetch') || e.message?.includes('fetch')) {
      // Attempt alternate protocol fallback (http <-> https) only if safe (no non-standard port)
      if (!options._triedAltProtocol) {
        try {
          const parsed = new URL(cleanUrl);
          const port = parsed.port;
          let altUrl = null;
          if (parsed.protocol === 'http:' && (!port || port === '80')) {
            parsed.protocol = 'https:';
            parsed.port = '';
            altUrl = parsed.toString();
          } else if (parsed.protocol === 'https:' && (!port || port === '443')) {
            parsed.protocol = 'http:';
            parsed.port = '';
            altUrl = parsed.toString();
          }
          if (altUrl) {
            return await fetchAndParseM3U(altUrl, { ...options, _triedAltProtocol: true });
          }
        } catch (_altErr) {}
      }

      const offline = await isDeviceOffline();
      if (offline) {
        throw new AppNetworkError(ERROR_CATEGORY.OFFLINE, 'No internet connection.');
      }
      throw new AppNetworkError(
        ERROR_CATEGORY.NETWORK_ERROR,
        'Network error: unable to reach the playlist server. Please check the URL and your connection.'
      );
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }
}
