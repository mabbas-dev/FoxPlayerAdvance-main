import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { FIXED_SUBTITLE_SIZE_ID } from '../playback/playerSettings.js';
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

/** Apply the single fixed caption style (expo-video / AVPlayer / ExoPlayer). */
export function applyFixedNativeSubtitleStyle() {
  const mod = getExpoVideoNative();
  if (mod && typeof mod.setFoxSubtitleFontSize === 'function') {
    try {
      mod.setFoxSubtitleFontSize(FIXED_SUBTITLE_SIZE_ID);
      return true;
    } catch (_e) {}
  }
  return false;
}

export function reapplyFixedNativeSubtitleStyleWithRetries(
  delaysMs = Platform.OS === 'ios' ? [0, 80, 200, 500, 1000, 2000] : [0, 150, 500],
) {
  delaysMs.forEach((delay) => {
    setTimeout(() => applyFixedNativeSubtitleStyle(), delay);
  });
}

/**
 * Fixed subtitle size only — no user resize. VLC size comes from getPlatformVlcOptions at load.
 */
export function applyFixedSubtitles({ activeEngineType } = {}) {
  applyFixedNativeSubtitleStyle();
  if (activeEngineType !== ENGINE_TYPE.VLC) {
    reapplyFixedNativeSubtitleStyleWithRetries();
  }
}
