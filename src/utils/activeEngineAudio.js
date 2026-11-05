import { Platform } from 'react-native';
import { ENGINE_TYPE } from '../playback/playbackTypes.js';

const POST_RESUME_SYNC_MS = Platform.OS === 'ios'
  ? [0, 16, 48, 96, 160, 280, 420]
  : [0, 32, 96, 200];

let resumeAudioGeneration = 0;

function normalizeVolume(volume) {
  return typeof volume === 'number' && !Number.isNaN(volume) ? volume : 1.0;
}

/** Pause/mute expo-video when VLC owns playback — call sparingly (engine switch / VLC load). */
export function silenceNativeCompanionPlayer(nativePlayer) {
  if (!nativePlayer) return;
  try {
    if (nativePlayer.playing) {
      nativePlayer.pause();
    }
    nativePlayer.muted = true;
    nativePlayer.volume = 0;
  } catch (_e) {}
}

/**
 * Apply mute/volume on the engine that should be heard.
 * Does not touch the inactive native player unless muteInactiveNative is true.
 */
export function applyActiveEngineAudio({
  activeEngineType,
  vlcPlayer = null,
  nativePlayer = null,
  volume = 1.0,
  isMuted = false,
  muteInactiveNative = false,
} = {}) {
  const vol = normalizeVolume(volume);
  const muted = Boolean(isMuted || vol === 0);
  const vlcVolumePct = Math.round(Math.max(0, Math.min(1, vol)) * 100);

  if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
    try {
      vlcPlayer.muted = muted;
      if (!muted) {
        vlcPlayer.volume = vlcVolumePct;
      }
      if (typeof vlcPlayer.setMuted === 'function') {
        vlcPlayer.setMuted(muted);
      }
      if (!muted && typeof vlcPlayer.setVolume === 'function') {
        vlcPlayer.setVolume(vlcVolumePct);
      }
    } catch (_e) {}

    if (muteInactiveNative) {
      silenceNativeCompanionPlayer(nativePlayer);
    }
    return;
  }

  if (nativePlayer) {
    try {
      nativePlayer.muted = muted;
      nativePlayer.volume = vol;
    } catch (_e) {}
  }
}

function schedulePostResumeAudioSync(options, isStillActive) {
  const generation = ++resumeAudioGeneration;
  const still = typeof isStillActive === 'function' ? isStillActive : () => true;

  POST_RESUME_SYNC_MS.forEach((delayMs) => {
    setTimeout(() => {
      if (generation !== resumeAudioGeneration || !still()) return;

      applyActiveEngineAudio({ ...options, muteInactiveNative: false });

      const { activeEngineType, vlcPlayer, nativePlayer } = options || {};
      const shouldReassertPlay = delayMs >= 96 && delayMs <= 200;

      if (!shouldReassertPlay) return;

      if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
        try {
          if (!vlcPlayer.playing && !options.isMuted && normalizeVolume(options.volume) > 0) {
            vlcPlayer.play();
          }
        } catch (_e) {}
      } else if (nativePlayer) {
        try {
          if (!nativePlayer.playing && !options.isMuted && normalizeVolume(options.volume) > 0) {
            nativePlayer.play();
          }
        } catch (_e) {}
      }
    }, delayMs);
  });
}

/** Restore audio routing then resume the active engine (with post-resume audio re-assertion). */
export function resumeActiveEnginePlayback(options, lifecycle = {}) {
  resumeAudioGeneration += 1;
  const { isStillActive } = lifecycle;
  const still = typeof isStillActive === 'function' ? isStillActive : () => true;

  applyActiveEngineAudio({ ...options, muteInactiveNative: false });

  const { activeEngineType, vlcPlayer, nativePlayer } = options || {};

  if (activeEngineType === ENGINE_TYPE.VLC && vlcPlayer) {
    silenceNativeCompanionPlayer(nativePlayer);
    try {
      vlcPlayer.play();
    } catch (_e) {}
  } else if (nativePlayer) {
    try {
      nativePlayer.play();
    } catch (_e) {}
  }

  schedulePostResumeAudioSync(options, still);
}

/** Cancel in-flight post-resume audio sync (e.g. user paused again). */
export function cancelPostResumeAudioSync() {
  resumeAudioGeneration += 1;
}
