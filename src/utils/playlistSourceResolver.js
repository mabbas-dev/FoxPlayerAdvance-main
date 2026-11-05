import { CONFIG_TYPES } from '../constants';
import { parseXtreamCredentialsFromUrl } from './m3uUrlHelpers.js';

function normalizeServerUrl(serverUrl) {
  let url = (serverUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  url = url.replace(/\/player_api\.php(\?.*)?$/i, '');
  url = url.replace(/\/get\.php(\?.*)?$/i, '');
  url = url.replace(/\/c\/?$/i, '');
  return url.replace(/\/+$/, '');
}

/**
 * Infer playlist wire format from backend type + URL shape (supports Xtream-compatible providers).
 */
export function inferPlaylistType(raw) {
  if (!raw || typeof raw !== 'object') return CONFIG_TYPES.XTREAM;

  const t = String(raw.type || raw.config?.type || '').toLowerCase().trim();
  if (t === CONFIG_TYPES.M3U || t === 'm3u' || t === 'm3u8' || t === 'hls') {
    return CONFIG_TYPES.M3U;
  }
  if (
    t === CONFIG_TYPES.XTREAM ||
    t === 'xtream' ||
    t === 'xstream' ||
    t === 'xteve' ||
    t.includes('xtream') ||
    t.includes('trex')
  ) {
    return CONFIG_TYPES.XTREAM;
  }

  const m3uUrl = String(raw.playlist_url || raw.playlistUrl || raw.url || raw.config?.playlist_url || '').trim();
  if (parseXtreamCredentialsFromUrl(m3uUrl)) {
    return CONFIG_TYPES.XTREAM;
  }

  const serverUrl = String(raw.server_url || raw.serverUrl || raw.config?.server_url || '').trim();
  if (parseXtreamCredentialsFromUrl(serverUrl)) {
    return CONFIG_TYPES.XTREAM;
  }

  const username = String(raw.username || raw.user || raw.config?.username || '').trim();
  const password = String(raw.password || raw.pass || raw.config?.password || '').trim();
  if (serverUrl && username && password) {
    return CONFIG_TYPES.XTREAM;
  }
  if (m3uUrl) {
    return CONFIG_TYPES.M3U;
  }
  return CONFIG_TYPES.XTREAM;
}

/**
 * Normalize any playlist record (local, remote, or API config) into sync-ready credentials.
 */
export function resolvePlaylistSourceConfig(raw) {
  const base = raw?.config && typeof raw.config === 'object' ? { ...raw.config, ...raw } : { ...(raw || {}) };
  const type = inferPlaylistType(base);

  let playlistUrl = String(
    base.playlist_url || base.playlistUrl || base.url || '',
  ).trim();
  let serverUrl = String(base.server_url || base.serverUrl || '').trim();
  let username = String(base.username || base.user || '').trim();
  let password = String(base.password || base.pass || '').trim();

  const credsFromPlaylistUrl = parseXtreamCredentialsFromUrl(playlistUrl);
  const credsFromServerField = parseXtreamCredentialsFromUrl(serverUrl);

  const parsed = credsFromPlaylistUrl || credsFromServerField;
  if (parsed) {
    serverUrl = parsed.serverUrl || serverUrl;
    username = username || parsed.username || '';
    password = password || parsed.password || '';
  }

  if (!serverUrl && playlistUrl) {
    try {
      const parsedUrl = new URL(playlistUrl);
      serverUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    } catch (_e) {}
  }

  if (serverUrl) {
    serverUrl = normalizeServerUrl(serverUrl);
  }

  const name =
    base.name ||
    base.playlist_name ||
    (type === CONFIG_TYPES.XTREAM ? username || 'Xtream IPTV' : 'M3U Playlist');

  return {
    ...base,
    type,
    name,
    playlist_name: name,
    playlistUrl,
    playlist_url: playlistUrl,
    serverUrl,
    server_url: serverUrl,
    username,
    password,
  };
}
