/**
 * Normalize audio/subtitle track objects from expo-video and rn-vlc-plyr
 * into a consistent shape for TrackSelectionModal and selection handlers.
 */

const LANG_IN_NAME = [
  ['english', 'en'],
  ['spanish', 'es'],
  ['french', 'fr'],
  ['german', 'de'],
  ['italian', 'it'],
  ['portuguese', 'pt'],
  ['russian', 'ru'],
  ['arabic', 'ar'],
  ['hindi', 'hi'],
  ['urdu', 'ur'],
  ['chinese', 'zh'],
  ['japanese', 'ja'],
  ['korean', 'ko'],
  ['turkish', 'tr'],
];

function inferLanguageFromName(name) {
  if (!name || typeof name !== 'string') return '';
  const lower = name.toLowerCase();
  for (const [token, code] of LANG_IN_NAME) {
    if (lower.includes(token)) return code;
  }
  const bracket = name.match(/\[([^\]]+)\]/);
  if (bracket?.[1]) {
    const inner = bracket[1].toLowerCase();
    for (const [token, code] of LANG_IN_NAME) {
      if (inner.includes(token)) return code;
    }
  }
  return '';
}

export function normalizeAudioTrack(track, index = 0) {
  if (!track) return null;
  const id = track.id ?? track.trackId ?? index;
  const rawName = (track.name || track.title || '').trim();
  const rawLabel = (track.label || rawName || '').trim();
  const language = (track.language || inferLanguageFromName(rawLabel || rawName) || '').trim();
  return {
    ...track,
    id,
    label: rawLabel || `Audio Track ${index + 1}`,
    name: rawName || rawLabel || `Audio Track ${index + 1}`,
    language,
    isDefault: Boolean(track.isDefault || track.default),
  };
}

export function normalizeSubtitleTrack(track, index = 0) {
  if (!track) return null;
  const id = track.id ?? track.trackId ?? index;
  const rawName = (track.name || track.title || '').trim();
  const rawLabel = (track.label || rawName || '').trim();
  const language = (track.language || inferLanguageFromName(rawLabel || rawName) || '').trim();
  return {
    ...track,
    id,
    label: rawLabel || `Subtitle ${index + 1}`,
    name: rawName || rawLabel || `Subtitle ${index + 1}`,
    language,
  };
}

export function normalizeAudioTrackList(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((t, i) => normalizeAudioTrack(t, i)).filter(Boolean);
}

export function normalizeSubtitleTrackList(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((t, i) => normalizeSubtitleTrack(t, i)).filter(Boolean);
}

export function resolveSelectedTrack(selected, list) {
  if (!list?.length) return selected ?? null;
  if (selected == null) {
    return list.find((t) => t.isDefault || t.default) || list[0];
  }
  if (typeof selected === 'number' || typeof selected === 'string') {
    const selStr = String(selected);
    const byId = list.find(
      (t) => (t.id != null && String(t.id) === selStr) || (t.trackId != null && String(t.trackId) === selStr)
    );
    if (byId) return byId;
    const idx = Number(selected);
    if (!Number.isNaN(idx) && list[idx]) return list[idx];
    return selected;
  }
  if (typeof selected === 'object') {
    const selId = selected.id ?? selected.trackId;
    if (selId != null) {
      const byId = list.find((t) => t.id != null && String(t.id) === String(selId));
      if (byId) return byId;
    }
    if (selected.label) {
      const byLabel = list.find((t) => t.label === selected.label || t.name === selected.label);
      if (byLabel) return byLabel;
    }
    if (selected.name) {
      const byName = list.find((t) => t.name === selected.name);
      if (byName) return byName;
    }
  }
  return selected;
}

/**
 * Read the latest track lists synchronously from the active playback engine.
 */
export function collectPlaybackMediaTracks({
  activeEngineType,
  player = null,
  vlcPlayer = null,
  fallbackAudioTracks = [],
  fallbackSubtitleTracks = [],
  selectedAudioTrack = null,
  selectedSubtitleTrack = null,
} = {}) {
  let rawAudio = [];
  let rawSubs = [];

  if (activeEngineType === 'VLC' && vlcPlayer) {
    try {
      if (Array.isArray(vlcPlayer.audioTracks)) rawAudio = vlcPlayer.audioTracks;
      if (Array.isArray(vlcPlayer.subtitleTracks)) rawSubs = vlcPlayer.subtitleTracks;
    } catch (_e) {}
  } else if (player) {
    try {
      if (Array.isArray(player.availableAudioTracks)) rawAudio = player.availableAudioTracks;
      if (Array.isArray(player.availableSubtitleTracks)) rawSubs = player.availableSubtitleTracks;
    } catch (_e) {}
  }

  if (!rawAudio.length && Array.isArray(fallbackAudioTracks)) {
    rawAudio = fallbackAudioTracks;
  }
  if (!rawSubs.length && Array.isArray(fallbackSubtitleTracks)) {
    rawSubs = fallbackSubtitleTracks;
  }

  const availableAudioTracks = normalizeAudioTrackList(rawAudio);
  const availableSubtitleTracks = normalizeSubtitleTrackList(rawSubs);

  let resolvedAudio = selectedAudioTrack;
  let resolvedSub = selectedSubtitleTrack;

  if (activeEngineType === 'VLC' && vlcPlayer) {
    try {
      if (vlcPlayer.selectedAudioTrack != null && availableAudioTracks.length) {
        resolvedAudio =
          availableAudioTracks.find((t) => String(t.id) === String(vlcPlayer.selectedAudioTrack)) ||
          resolvedAudio;
      }
      if (
        vlcPlayer.selectedSubtitleTrack != null &&
        vlcPlayer.selectedSubtitleTrack >= 0 &&
        availableSubtitleTracks.length
      ) {
        resolvedSub =
          availableSubtitleTracks.find((t) => String(t.id) === String(vlcPlayer.selectedSubtitleTrack)) ||
          resolvedSub;
      }
    } catch (_e) {}
  } else if (player) {
    try {
      if (player.audioTrack) resolvedAudio = player.audioTrack;
      if (player.subtitleTrack) resolvedSub = player.subtitleTrack;
    } catch (_e) {}
  }

  return {
    availableAudioTracks,
    availableSubtitleTracks,
    selectedAudioTrack: resolveSelectedTrack(resolvedAudio, availableAudioTracks),
    selectedSubtitleTrack: selectedSubtitleTrack === null && !resolvedSub
      ? null
      : resolveSelectedTrack(resolvedSub, availableSubtitleTracks),
  };
}
