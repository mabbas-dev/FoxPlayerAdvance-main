/**
 * Stream format helpers.
 * Derives a short, human-readable stream format label (TS, HLS, MP4, MKV...)
 * for movies, episodes and series so it can be shown on cards.
 */

// Extensions that map to a friendlier label
const LABEL_MAP = {
  m3u8: 'HLS',
  m3u: 'HLS',
  mpd: 'DASH',
};

/**
 * Extracts a file extension from a stream URL (ignores query/hash).
 * Returns null when the URL has no recognizable extension.
 */
export function extractUrlExtension(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.split('?')[0].split('#')[0];
  const match = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Converts a raw extension (e.g. ".m3u8", "ts") into a display label (e.g. "HLS", "TS").
 */
export function formatLabelFromExtension(ext) {
  if (!ext || typeof ext !== 'string') return null;
  const clean = ext.trim().replace(/^\.+/, '').toLowerCase();
  if (!clean) return null;
  return LABEL_MAP[clean] || clean.toUpperCase();
}

/**
 * Raw extension for a single playable item (movie / episode / channel).
 * The actual URL wins over metadata, because that is what the player receives.
 */
export function getItemExtension(item) {
  if (!item || typeof item !== 'object') return null;
  return (
    extractUrlExtension(item.url) ||
    item.containerExtension ||
    item.container_extension ||
    item.info?.container_extension ||
    null
  );
}

/**
 * Display label for a single playable item (movie / episode).
 */
export function getItemFormatLabel(item) {
  return formatLabelFromExtension(getItemExtension(item));
}

/**
 * Collects every episode of a series regardless of storage shape
 * (seasons[].episodes array or episodes { [season]: [] } map).
 */
function collectSeriesEpisodes(series) {
  if (Array.isArray(series?.seasons) && series.seasons.length > 0) {
    return series.seasons.flatMap((s) => (Array.isArray(s?.episodes) ? s.episodes : []));
  }
  if (series?.episodes && typeof series.episodes === 'object') {
    return Object.values(series.episodes).flatMap((eps) => (Array.isArray(eps) ? eps : []));
  }
  return [];
}

/**
 * Display label for a series card. Series list APIs (Xtream get_series) do not
 * carry a container extension, so this only resolves when episode data is
 * available on the item (M3U playlists or a loaded series detail).
 * Multiple formats are joined, e.g. "MKV/MP4".
 */
export function getSeriesFormatLabel(series) {
  if (!series || typeof series !== 'object') return null;
  if (Array.isArray(series.formats) && series.formats.length > 0) {
    return series.formats.map(formatLabelFromExtension).filter(Boolean).join('/');
  }
  const labels = new Set();
  for (const ep of collectSeriesEpisodes(series)) {
    const label = getItemFormatLabel(ep);
    if (label) labels.add(label);
    if (labels.size >= 3) break;
  }
  return labels.size > 0 ? Array.from(labels).join('/') : null;
}

/**
 * Display label for any card item based on its type.
 */
export function getCardFormatLabel(item, type = 'movie') {
  if (!item) return null;
  const normType = item.type === 'channel' ? 'live' : (item.type || type);
  if (normType === 'series') return getSeriesFormatLabel(item);
  return getItemFormatLabel(item);
}
