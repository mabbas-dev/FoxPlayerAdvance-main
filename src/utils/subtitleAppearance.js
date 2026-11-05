import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
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

export function tryApplyVlcSubtitleFontSizeLive(vlcPlayer, sizeId) {
  if (!vlcPlayer || !sizeId) return false;
  const sizePx = getSubtitleFontSizePx(sizeId);
  try {
    if (typeof vlcPlayer.setSubtitleFontSize === 'function') {
      vlcPlayer.setSubtitleFontSize(sizePx);
      return true;
    }
  } catch (_e) {}
  return false;
}

export function reapplyNativeSubtitleSizeWithRetries(
  sizeId,
  delaysMs = Platform.OS === 'ios' ? [0, 200, 600] : [0, 150, 500],
) {
  if (!sizeId) return;
  delaysMs.forEach((delay) => {
    setTimeout(() => applyNativeSubtitleFontSize(sizeId), delay);
  });
}

/**
 * S/N/L/XL — no stream reload. Native: Fox module. VLC: live setSubtitleFontSize (patched rn-vlc-plyr).
 */
export function applySubtitleFontSizeForPlayback({
  newSize,
  activeEngineType,
  vlcPlayer = null,
}) {
  if (!newSize) return;

  applyNativeSubtitleFontSize(newSize);

  if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
    tryApplyVlcSubtitleFontSizeLive(vlcPlayer, newSize);
    return;
  }

  reapplyNativeSubtitleSizeWithRetries(newSize);
}
