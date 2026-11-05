import {
  getCachedConfig,
  getCachedSeries,
  getCategorySeries,
} from '../services/iptvService';
import { xtreamGetSeriesInfo } from '../services/xtreamService';
import { resolveMediaSource } from './mediaSourcePipeline';

export function episodeMatchesStreamId(episode, targetId) {
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
}

export function extractEpisodeStreamIdFromUrl(playUrl) {
  if (!playUrl || typeof playUrl !== 'string') return null;
  const trimmed = playUrl.trim();
  const seriesMatch = trimmed.match(/\/series\/[^/]+\/[^/]+\/(\d+)(?:\.|\?|$)/i);
  if (seriesMatch) return seriesMatch[1];
  return null;
}

function matchesSeriesRow(row, seriesId) {
  if (!row || seriesId == null || seriesId === '') return false;
  const sid = String(seriesId);
  const candidates = [row.id, row.seriesId, row.stream_id, row.streamId];
  return candidates.some((c) => c != null && String(c) === sid);
}

async function collectSeriesItemsFromCache(cachedRoot, playlistId) {
  if (!cachedRoot) return [];
  if (Array.isArray(cachedRoot)) return cachedRoot;

  const items = [];
  const categories = Array.isArray(cachedRoot.categories) ? cachedRoot.categories : [];
  for (const cat of categories) {
    let catItems = Array.isArray(cat.items) ? cat.items : [];
    if (catItems.length === 0 && cat.id != null && String(cat.id).trim() !== '') {
      try {
        const diskItems = await getCategorySeries(String(cat.id), true, playlistId);
        if (Array.isArray(diskItems) && diskItems.length > 0) {
          catItems = diskItems;
        }
      } catch (_e) {}
    }
    for (const row of catItems) {
      items.push(row);
    }
  }
  return items;
}

export function flattenSeriesEpisodes(seasons) {
  const list = [];
  if (!Array.isArray(seasons)) return list;

  const sortedSeasons = [...seasons].sort(
    (a, b) => (Number(a.seasonNumber) || 0) - (Number(b.seasonNumber) || 0),
  );

  for (const season of sortedSeasons) {
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    const sortedEps = [...episodes].sort(
      (a, b) =>
        (Number(a.episodeNumber ?? a.episode_num) || 0) -
        (Number(b.episodeNumber ?? b.episode_num) || 0),
    );
    for (const episode of sortedEps) {
      list.push({ season, episode });
    }
  }
  return list;
}

export function findNextEpisodeEntry(detail, currentStreamId, options = {}) {
  const playbackUrl = options.playbackUrl;
  const flat = flattenSeriesEpisodes(detail?.seasons);
  if (!flat.length) return null;

  const idCandidates = [
    currentStreamId,
    extractEpisodeStreamIdFromUrl(playbackUrl),
  ].filter((id) => id != null && String(id).trim() !== '');

  for (const id of idCandidates) {
    const idx = flat.findIndex(({ episode }) =>
      episodeMatchesStreamId(episode, id),
    );
    if (idx >= 0 && idx < flat.length - 1) return flat[idx + 1];
  }

  if (playbackUrl) {
    const normUrl = playbackUrl.split('?')[0].trim();
    const idx = flat.findIndex(({ episode }) => {
      const epUrl = (episode.url || episode.streamUrl || '').split('?')[0].trim();
      return epUrl && epUrl === normUrl;
    });
    if (idx >= 0 && idx < flat.length - 1) return flat[idx + 1];
  }

  return null;
}

export function formatNextEpisodeLabel(entry) {
  if (!entry?.episode) return 'Next episode';
  const seasonLabel = entry.season?.seasonNumber
    ? `S${entry.season.seasonNumber}`
    : '';
  const epNum = entry.episode.episodeNumber ?? entry.episode.episodeNum ?? '';
  const epLabel = epNum !== '' && epNum != null ? `E${epNum}` : '';
  const epTitle =
    entry.episode.title ||
    entry.episode.name ||
    (epNum !== '' ? `Episode ${epNum}` : 'Next episode');
  const prefix = [seasonLabel, epLabel].filter(Boolean).join(' ');
  return prefix ? `${prefix} · ${epTitle}` : epTitle;
}

export async function loadSeriesDetailForPlayback(playlistId, seriesId, options = {}) {
  if (!seriesId) return null;
  const sid = String(seriesId);
  const categoryId = options.categoryId;

  try {
    const cachedRoot = await getCachedSeries(true, playlistId);

    if (categoryId != null && String(categoryId).trim() !== '') {
      try {
        const catItems = await getCategorySeries(String(categoryId), true, playlistId);
        if (Array.isArray(catItems)) {
          const fromCat = catItems.find((s) => matchesSeriesRow(s, sid));
          if (fromCat?.seasons?.length) {
            return { seasons: fromCat.seasons, seriesMeta: fromCat };
          }
        }
      } catch (_e) {}
    }

    const rows = await collectSeriesItemsFromCache(cachedRoot, playlistId);
    const fromCache = rows.find((s) => matchesSeriesRow(s, sid));

    if (fromCache?.seasons?.length) {
      return {
        seasons: fromCache.seasons,
        seriesMeta: fromCache,
      };
    }

    const cachedCfg = await getCachedConfig(playlistId);
    const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
    const serverUrl =
      cfg.server_url ||
      cfg.serverUrl ||
      cachedRoot?.serverUrl ||
      fromCache?.serverUrl ||
      '';
    const username =
      cfg.username || cachedRoot?.username || fromCache?.username || '';
    const password =
      cfg.password || cachedRoot?.password || fromCache?.password || '';

    if (!serverUrl || !username) {
      return fromCache?.seasons?.length
        ? { seasons: fromCache.seasons, seriesMeta: fromCache }
        : null;
    }

    const detail = await xtreamGetSeriesInfo(serverUrl, username, password, sid);
    if (!detail?.seasons?.length) return null;

    return {
      seasons: detail.seasons,
      seriesMeta: {
        ...fromCache,
        ...detail,
        id: sid,
        seriesId: sid,
        serverUrl,
        username,
        password,
      },
    };
  } catch (_e) {
    return null;
  }
}

export function resolveNextEpisodePlayback({ entry, seriesMeta, credentials = {} }) {
  if (!entry?.episode) return null;

  let creds = { ...credentials };
  if (!creds.serverUrl || !creds.username) {
    creds = {
      serverUrl: seriesMeta?.serverUrl || creds.serverUrl || '',
      username: seriesMeta?.username || creds.username || '',
      password: seriesMeta?.password || creds.password || '',
    };
  }

  const seriesTitle = seriesMeta?.name || seriesMeta?.title || 'Series';
  const seasonLabel = entry.season?.seasonNumber ? `S${entry.season.seasonNumber}` : '';
  const epNum = entry.episode.episodeNumber ?? entry.episode.episodeNum ?? '';
  const epLabel = epNum !== '' && epNum != null ? `E${epNum}` : '';
  const epTitle =
    entry.episode.title ||
    entry.episode.name ||
    (epNum !== '' ? `Episode ${epNum}` : 'Episode');
  const fullTitle = `${seriesTitle} ${seasonLabel}${epLabel ? `${epLabel}: ` : ' - '}${epTitle}`.trim();

  const resolved = resolveMediaSource({
    type: 'series',
    item: {
      ...entry.episode,
      name: fullTitle,
      url: entry.episode.url,
      serverUrl: seriesMeta?.serverUrl || creds.serverUrl,
      username: seriesMeta?.username || creds.username,
      password: seriesMeta?.password || creds.password,
      poster:
        entry.episode.thumbnail ||
        entry.episode.poster ||
        seriesMeta?.poster ||
        seriesMeta?.cover,
    },
    credentials: creds,
  });

  if (!resolved?.url) return null;

  const epStreamKey = String(
    resolved.streamId ||
      entry.episode.id ||
      entry.episode.streamId ||
      entry.episode.stream_id ||
      '',
  );

  return {
    url: resolved.url,
    title: resolved.title || fullTitle,
    poster: resolved.poster || '',
    streamId: epStreamKey,
    extension: resolved.extension || 'mp4',
    episodeStreamId: epStreamKey,
    seriesId: String(seriesMeta?.id ?? seriesMeta?.seriesId ?? ''),
    categoryId:
      seriesMeta?.categoryId ?? seriesMeta?.category_id ?? undefined,
  };
}
