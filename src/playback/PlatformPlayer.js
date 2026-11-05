/**
 * FOX PLAYER — Platform Player Resolver
 *
 * Exposes the authoritative platform player driver for the active host OS.
 * Also exports AndroidPlayer and IOSPlayer individually for independent testing.
 */

let Platform = { OS: 'ios', select: (obj) => (obj ? (obj.ios || obj.default) : undefined) };
try {
  const RN = require('react-native');
  if (RN && RN.Platform) Platform = RN.Platform;
} catch (_e) {}
import { AndroidPlayer } from './AndroidPlayer.js';
import { IOSPlayer } from './IOSPlayer.js';

export const isIOS = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';

/**
 * Returns the native player driver for the specified or current platform.
 *
 * @param {string} [platform=Platform.OS]
 * @returns {import('./AndroidPlayer.js').AndroidPlayerDriver | import('./IOSPlayer.js').IOSPlayerDriver}
 */
export function getPlatformPlayer(platform = Platform.OS) {
  return platform === 'ios' ? IOSPlayer : AndroidPlayer;
}

export const ActivePlatformPlayer = Platform.OS === 'ios' ? IOSPlayer : AndroidPlayer;

export { AndroidPlayer, IOSPlayer };
export default ActivePlatformPlayer;
