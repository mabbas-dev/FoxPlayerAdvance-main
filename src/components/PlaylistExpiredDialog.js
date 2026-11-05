import React from 'react';

/**
 * PlaylistExpiredDialog
 *
 * NOTE: The standalone popup modal has been consolidated into the authoritative LoadingScreen
 * presentation (`LoadingScreen.js` via `GlobalRefreshScreen` in `_layout.js`).
 * This completely eliminates native UIKit Modal presentation conflicts on iOS.
 *
 * Handlers implemented via LoadingScreen:
 * - Switch playlist: switchPlaylist(playlistId)
 * - Add new playlist: router.push('/pairing?mode=add')
 */
export default function PlaylistExpiredDialog() {
  return null;
}

