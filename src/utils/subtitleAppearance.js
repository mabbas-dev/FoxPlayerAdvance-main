import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { getPlatformVlcOptions } from './playerConfig.js';
import { DEFAULT_IPTV_USER_AGENT } from './mediaSourcePipeline.js';
import { SUBTITLE_FONT_SIZES } from '../playback/playerSettings.js';
import { ENGINE_TYPE } from '../playback/playbackTypes.js';

let expoVideoNative = null;

function getExpoVideoNative() {
  if (expoVideoNative !== null) return expoVideoNative;
  try {
    expoVideoNative = requireNativeModule('ExpoVideo');
  } catch (_e) {
    expoVideoNative = undefined;
  }
  return expoVideoNative;
}

export function getSubtitleFontSizePx(sizeId) {
  return SUBTITLE_FONT_SIZES[sizeId] || SUBTITLE_FONT_SIZES.normal || 18;
}

export function applyNativeSubtitleFontSize(sizeId) {
  if (!sizeId) return false;
  const mod = getExpoVideoNative();
  if (mod && typeof mod.setFoxSubtitleFontSize === 'function') {
    try {
      mod.setFoxSubtitleFontSize(sizeId);
      return true;
    } catch (_e) {}
  }
  return false;
}

function vlcOptionsKey(vlcOptions) {
  return JSON.stringify(vlcOptions || []);
}

function seekVlcWithRetries(vlcPlayer, timeMs, isLive) {
  if (isLive || !timeMs || timeMs < 1) return;
  const delays = Platform.OS === 'ios' ? [350, 900, 1600] : [250, 700, 1400];
  delays.forEach((delay) => {
    setTimeout(() => {
      try {
        vlcPlayer.seek(timeMs);
      } catch (_e) {}
    }, delay);
  });
}

export function tryApplyVlcSubtitleFontSizeLive(vlcPlayer, sizeId) {
  if (!vlcPlayer) return false;
  const sizePx = getSubtitleFontSizePx(sizeId);
  try {
    if (typeof vlcPlayer.setSubtitleFontSize === 'function') {
      vlcPlayer.setSubtitleFontSize(sizePx);
      return true;
    }
    if (typeof vlcPlayer.setTextRendererFontSize === 'function') {
      vlcPlayer.setTextRendererFontSize(sizePx);
      return true;
    }
  } catch (_e) {}
  return false;
}

export function assignVlcSourceWithSubtitleSize(
  vlcPlayer,
  {
    streamUri,
    isLive = false,
    subtitleSize = 'normal',
    title = 'Stream',
    userAgent = DEFAULT_IPTV_USER_AGENT,
    forceReload = false,
  } = {}
) {
  if (!vlcPlayer || !streamUri) return false;
  const vlcOptions = getPlatformVlcOptions({ isLive, subtitleSize });
  const prev = vlcPlayer.source;
  const optionsChanged = vlcOptionsKey(prev?.vlcOptions) !== vlcOptionsKey(vlcOptions);
  if (!forceReload && prev?.uri === streamUri && !optionsChanged) {
    return false;
  }
  vlcPlayer.source = {
    uri: streamUri,
    userAgent,
    vlcOptions,
    title,
  };
  return true;
}

export function reapplyVlcSubtitleFontSize(
  vlcPlayer,
  {
    streamUri,
    isLive = false,
    subtitleSize = 'normal',
    title = 'Stream',
    userAgent = DEFAULT_IPTV_USER_AGENT,
    resumeTimeMs = 0,
  } = {}
) {
  if (!vlcPlayer) return false;
  const effectiveUri = streamUri || vlcPlayer.source?.uri;
  if (!effectiveUri) return false;

  const savedTimeMs =
    resumeTimeMs > 0
      ? resumeTimeMs
      : Math.max(0, Math.floor(vlcPlayer.currentTime || 0));
  const wasPlaying =
    vlcPlayer.status === 'playing' || vlcPlayer.status === 'buffering';
  const selectedSub = vlcPlayer.selectedSubtitleTrack;
  const selectedAud = vlcPlayer.selectedAudioTrack;

  try {
    const didAssign = assignVlcSourceWithSubtitleSize(vlcPlayer, {
      streamUri: effectiveUri,
      isLive,
      subtitleSize,
      title,
      userAgent,
      forceReload: true,
    });
    if (!didAssign) return false;

    vlcPlayer.autoPlay = wasPlaying;
    if (wasPlaying) {
      try {
        vlcPlayer.play();
      } catch (_e) {}
    }

    seekVlcWithRetries(vlcPlayer, savedTimeMs, isLive);

    if (!isLive && savedTimeMs > 250) {
      setTimeout(() => {
        if (selectedAud != null && selectedAud >= 0) {
          try {
            vlcPlayer.setAudioTrack(selectedAud);
          } catch (_e) {}
        }
        if (selectedSub != null && selectedSub >= 0) {
          try {
            vlcPlayer.setSubtitleTrack(selectedSub);
          } catch (_e) {}
        }
      }, Platform.OS === 'ios' ? 1000 : 750);
    }
    return true;
  } catch (_e) {
    return false;
  }
}

/**
 * Apply caption size without restarting native playback.
 * VLC reloads only when live font APIs are unavailable (with resume seek).
 */
export function applySubtitleFontSizeEverywhere({
  newSize,
  activeEngineType,
  vlcPlayer = null,
  streamUri = null,
  isLive = false,
  title = 'Stream',
  resumeTimeMs = 0,
}) {
  if (!newSize) return;

  if (activeEngineType !== ENGINE_TYPE.VLC) {
    applyNativeSubtitleFontSize(newSize);
    return;
  }

  if (!vlcPlayer) return;

  if (tryApplyVlcSubtitleFontSizeLive(vlcPlayer, newSize)) {
    return;
  }

  reapplyVlcSubtitleFontSize(vlcPlayer, {
    streamUri,
    isLive,
    subtitleSize: newSize,
    title,
    resumeTimeMs,
  });
}
