/**
 * FOX PLAYER — Android Platform Player
 *
 * Resolved directly on Android by Metro bundler.
 */

import { AndroidPlayer } from './AndroidPlayer.js';
import { IOSPlayer } from './IOSPlayer.js';
export const isIOS = false;
export const isAndroid = true;

export function getPlatformPlayer() {
  return AndroidPlayer;
}

export const ActivePlatformPlayer = AndroidPlayer;

export { AndroidPlayer, IOSPlayer };
export default AndroidPlayer;
