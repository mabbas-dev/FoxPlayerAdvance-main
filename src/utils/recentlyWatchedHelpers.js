import { getCachedConfig } from '../services/iptvService';
import { buildLiveStreamUrl, buildVodStreamUrl } from '../services/xtreamService';

export function getRecentWatchTypeLabel(item) {
  if (item?.type === 'live') return 'Live TV';
  if (item?.type === 'series') return 'Series';
  return 'Movie';
}

/**
 * Professional watch-state label for cards (percentage text, no progress bars).
 * @returns {{ variant: 'live'|'percent'|'almost'|'complete'|'started'|'none', text: string|null }}
 */
export function getRecentWatchProgressDisplay(item) {
  if (item?.type === 'live' || item?.type === 'channel') {
    return { variant: 'none', text: null };
  }
  const dur = Number(item?.durationSec) || 0;
  const pos = Number(item?.positionSec) || 0;
  if (dur >= 30 && pos >= 1) {
    const pct = Math.min(100, Math.round((pos / dur) * 100));
    if (pct >= 100 || pos >= dur - 20) {
      return { variant: 'complete', text: '100%' };
    }
    if (pct >= 95) {
      return { variant: 'almost', text: `${pct}%` };
    }
    return { variant: 'percent', text: `${pct}%` };
  }
  if (pos > 3) {
    return { variant: 'started', text: 'Started' };
  }
  return { variant: 'none', text: null };
}

/** @returns {number|null} 0–100 for VOD progress, null if not applicable */
export function getRecentWatchProgressPercent(item) {
  if (item?.type === 'live' || item?.type === 'channel') return null;
  const dur = Number(item?.durationSec) || 0;
  const pos = Number(item?.positionSec) || 0;
  if (dur < 30 || pos < 1) return null;
  return Math.min(100, Math.round((pos / dur) * 100));
}

export async function resolveRecentPlayUrl(activePlaylistId, item) {
  if (item?.url) return item.url;
  const cachedCfg = await getCachedConfig(activePlaylistId);
  const cfg = cachedCfg?.config || cachedCfg?.configuration || cachedCfg || {};
  const serverUrl = cfg.server_url || cfg.serverUrl || '';
  const username = cfg.username || '';
  const password = cfg.password || '';
  if (!serverUrl || !username || !password) return '';
  if (item.type === 'live') {
    return buildLiveStreamUrl(
      serverUrl,
      username,
      password,
      item.streamId || item.id,
      item.containerExtension || 'ts',
    );
  }
  return buildVodStreamUrl(
    serverUrl,
    username,
    password,
    item.streamId || item.id,
    item.containerExtension || 'mp4',
  );
}

export function navigateToRecentItem(router, item, playUrl) {
  if (item.type === 'live' || item.type === 'channel') {
    return;
  }
  const isSeries = item.type === 'series';
  const resolvedSeriesId = item.seriesId != null ? String(item.seriesId) : null;

  if (isSeries && resolvedSeriesId) {
    const epId = item.streamId || item.id;
    const hasPlayable = Boolean(playUrl || item.url);
    const resumeSeconds =
      Number(item.positionSec) > 3 ? String(Math.floor(Number(item.positionSec))) : undefined;
    router.push({
      pathname: '/(tabs)/series',
      params: {
        seriesId: resolvedSeriesId,
        returnTo: 'recently-watched',
        ...(item.categoryId ? { categoryId: String(item.categoryId) } : {}),
        ...(epId
          ? {
              episodeStreamId: String(epId),
              focusAt: String(Date.now()),
              autoPlayEpisode: hasPlayable ? '1' : '0',
              ...(resumeSeconds ? { resumeSeconds } : {}),
            }
          : {}),
      },
    });
    return;
  }
  if (!playUrl && !item.url) return;
  const resumeSeconds =
    item.type !== 'live' && Number(item.positionSec) > 3
      ? String(Math.floor(Number(item.positionSec)))
      : undefined;
  router.push({
    pathname: '/player',
    params: {
      url: playUrl || item.url,
      title: item.name || '',
      type: 'movie',
      poster: item.poster || item.logo || '',
      streamId: String(item.streamId || item.id),
      extension: item.containerExtension || 'mp4',
      selectedAt: String(Date.now()),
      ...(resumeSeconds ? { resumeSeconds } : {}),
      recentEntryId: String(item.id),
    },
  });
}
