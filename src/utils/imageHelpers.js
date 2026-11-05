/**
 * Image Utilities and Poster URI Normalization
 * Pure functions independent of native modules for 100% testability.
 */

/**
 * Sanitizes and normalizes an image URL from IPTV feeds and external sources.
 * Handles objects, arrays, TMDb relative paths, protocol-relative URLs,
 * backslashes, double slashes, unescaped spaces, and missing server hosts.
 */
// Fast in-memory cache to prevent redundant regex executions across thousands of list items
const urlCache = new Map();
const URL_CACHE_LIMIT = 2500;

export function normalizeImageUrl(raw, serverUrl = null) {
  if (!raw) return null;

  let target = raw;

  // Handle object structure { uri: '...' } or { url: '...' } or { src: '...' }
  if (typeof target === 'object' && target !== null) {
    if (Array.isArray(target)) {
      target = target.find((item) => typeof item === 'string' && item.trim().length > 0) || null;
    } else {
      target = target.url || target.uri || target.src || null;
    }
  }

  if (!target || typeof target !== 'string') return null;

  // Check cache first for instant O(1) response
  const cacheKey = serverUrl ? `${serverUrl}|${target}` : target;
  const cached = urlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = _computeNormalizedImageUrl(target, serverUrl);

  if (urlCache.size >= URL_CACHE_LIMIT) {
    const firstKey = urlCache.keys().next().value;
    urlCache.delete(firstKey);
  }
  urlCache.set(cacheKey, result);
  return result;
}

function _computeNormalizedImageUrl(target, serverUrl = null) {
  let str = target.trim();
  if (
    !str ||
    str.toLowerCase() === 'null' ||
    str.toLowerCase() === 'undefined' ||
    str.toLowerCase() === 'none' ||
    str.toLowerCase() === 'false' ||
    str === 'http://' ||
    str === 'https://'
  ) {
    return null;
  }

  // Strip wrapping quotes
  str = str.replace(/^["']+|["']+$/g, '');

  // Normalize backslashes (common in Windows-hosted IPTV panels and escaped JSON)
  str = str.replace(/\\/g, '/');

  // Fix protocol-relative URLs (e.g., //images.cdn.com/...)
  if (str.startsWith('//')) {
    str = 'https:' + str;
  }

  // Fix domain without scheme (e.g. image.tmdb.org/t/p/w500/xyz.jpg)
  if (/^image\.tmdb\.org/i.test(str)) {
    str = 'https://' + str;
  }

  // Handle TMDb paths with /t/p/ or /original/
  if (str.startsWith('/t/p/') || str.startsWith('/original/')) {
    str = `https://image.tmdb.org${str}`;
  } else if (/^\/[a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp|gif|svg)/i.test(str)) {
    // Handle standard relative TMDb poster path (e.g., /8b8R8l88...jpg)
    str = `https://image.tmdb.org/t/p/w500${str}`;
  }

  // Fix malformed single slash after protocol (http:/ -> http://)
  str = str
    .replace(/^http:\/([^\/])/, 'http://$1')
    .replace(/^https:\/([^\/])/, 'https://$1');

  // Handle stale IPTV panel domains or Xtream /images/ paths
  // Master panels often store dead scraper domains in MySQL (e.g. starshare.one or webhop.live:8080)
  const isStaleHost = /(?:^|\/\/|\.)(?:starshare\.[a-z]+|webhop\.[a-z]+|localhost|127\.0\.0\.1|0\.0\.0\.0|domain\.com|xtream-codes\.com)(?::\d+)?/i.test(str);
  const imagesMatch = str.match(/(\/images\/[a-zA-Z0-9_\-\.]+\.(?:jpg|jpeg|png|webp|gif|svg))/i);
  const isTrustedCdn = /(?:tmdb\.org|themoviedb\.org|media-amazon\.com|imdb\.com|thetvdb\.com|fanart\.tv|wikimedia\.org|wikipedia\.org|imgur\.com|cloudinary\.com|amazonaws\.com|googleusercontent\.com|ytimg\.com)/i.test(str);

  // Upgrade trusted image CDNs to HTTPS to avoid ATS blocks and redirect failures on iOS
  if (isTrustedCdn && str.startsWith('http://')) {
    str = str.replace(/^http:\/\//i, 'https://');
  }

  if ((isStaleHost || imagesMatch) && !isTrustedCdn) {
    if (serverUrl) {
      const cleanServer = serverUrl.replace(/\/+$/, '');
      const imagePath = imagesMatch ? imagesMatch[1] : str.replace(/^https?:\/\/[^\/]+/, '');
      const cleanPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
      str = `${cleanServer}${cleanPath}`;
    } else if (isStaleHost) {
      // If host is known to be dead/unreachable and no serverUrl is available to rescue it,
      // return null immediately so we avoid DNS failures or 30-second socket timeouts.
      return null;
    }
  }

  // Handle server-relative path (e.g. /images/movie_123.jpg or images/movie_123.jpg)
  if (serverUrl && (str.startsWith('/') || !/^[a-zA-Z0-9+.-]+:\/\//.test(str))) {
    const cleanServer = serverUrl.replace(/\/+$/, '');
    const cleanPath = str.replace(/^\/+/, '');
    str = `${cleanServer}/${cleanPath}`;
  }

  // Collapse redundant consecutive slashes in the path while preserving protocol '://'
  str = str.replace(/([^:])\/+/g, '$1/');

  // Must have a valid web or local scheme
  if (!/^(https?|file|content):/i.test(str)) {
    return null;
  }

  // Safely encode raw unescaped spaces while preserving existing %-escapes
  try {
    return encodeURI(decodeURI(str));
  } catch (_e) {
    try {
      return encodeURI(str);
    } catch (_e2) {
      return str.replace(/\s+/g, '%20');
    }
  }
}

/**
 * Backward compatibility alias for sanitizeUri
 */
export const sanitizeUri = normalizeImageUrl;

/**
 * Backward compatibility alias for sanitizePosterString
 */
export const sanitizePosterString = normalizeImageUrl;

/**
 * Resolves and normalizes poster/cover URL from arbitrary provider metadata.
 * Evaluates candidate fields in order of quality, reliability, and presence.
 */
const posterCache = new WeakMap();

export function resolvePosterUrl(raw, serverUrl = null) {
  if (!raw || (typeof raw !== 'object' && typeof raw !== 'string')) return null;

  if (typeof raw === 'string') {
    return normalizeImageUrl(raw, serverUrl);
  }

  if (posterCache.has(raw)) {
    return posterCache.get(raw);
  }

  // Candidate fields in strict order of quality/reliability
  const candidates = [
    // Primary poster fields
    raw.poster,
    raw.poster_path,
    raw.cover,
    raw.cover_big,
    raw.cover_tmdb,
    raw.stream_icon,
    raw.movie_image,
    raw.logo,
    raw.tvg_logo,
    raw.tvgLogo,
    raw.icon,
    raw.image,
    raw.thumbnail,
    // Nested fields in Xtream info objects
    raw.info?.cover,
    raw.info?.cover_big,
    raw.info?.cover_tmdb,
    raw.info?.movie_image,
    raw.info?.poster,
    raw.info?.poster_path,
    raw.info?.stream_icon,
    raw.series_info?.cover,
    raw.series_info?.cover_big,
    raw.series_info?.cover_tmdb,
    // Backdrop fallbacks if primary poster is absent
    raw.backdrop_path,
    raw.backdrop,
    raw.info?.backdrop_path,
    raw.info?.backdrop,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = normalizeImageUrl(candidate, serverUrl);
    if (resolved) {
      posterCache.set(raw, resolved);
      return resolved;
    }
  }

  posterCache.set(raw, null);
  return null;
}
