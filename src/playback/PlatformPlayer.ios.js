/**
 * FOX PLAYER — iOS Platform Player
 *
 * Resolved directly on iOS by Metro bundler.
 */

import { AndroidPlayer } from './AndroidPlayer.js';
import { IOSPlayer } from './IOSPlayer.js';

export const isIOS = true;
export const isAndroid = false;

export function getPlatformPlayer() {
  return IOSPlayer;
}

export const ActivePlatformPlayer = IOSPlayer;

export { AndroidPlayer, IOSPlayer };
export default IOSPlayer;
