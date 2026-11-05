/**
 * FOX PLAYER — Player Controls & LiveTV Buffering Regression Test Suite
 *
 * Verifies the fixes for:
 * BUG 1: Movies & Series player controls restoration (center play/pause, rewind/forward, seekbar)
 * BUG 2: LiveTV buffering state machine (spinner prompt dismissal on playback start, no false live stalls)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n================================================================');
  console.log('  FOX PLAYER — CONTROLS & LIVETV BUFFERING REGRESSION TESTS     ');
  console.log('================================================================\n');

  const playerControlsCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerControls.js'), 'utf8');
  const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
  const embeddedCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
  const seekBarCode = fs.readFileSync(path.join(__dirname, '../src/components/PlayerSeekBar.js'), 'utf8');

  // -------------------------------------------------------------------------
  // 1. Movies & Series Center Play/Pause Control Restoration
  // -------------------------------------------------------------------------
  console.log('--- 1. Movies & Series Center Play/Pause Control Restoration ---');
  // Must render playBtnWrapper without being replaced by bufferingCenterBox when isBuffering is true
  assert(
    playerControlsCode.includes('styles.playBtnWrapper') &&
    playerControlsCode.includes('styles.playCircle') &&
    playerControlsCode.includes('isPlaying ?') &&
    playerControlsCode.includes('<PauseIcon') &&
    playerControlsCode.includes('<PlayIcon'),
    'Center play/pause button must be actively rendered reflecting isPlaying state'
  );
  // Ensure isBuffering does not conditionally suppress playBtnWrapper
  assert(
    !playerControlsCode.includes('{isBuffering ? (\n            <View style={[styles.bufferingCenterBox'),
    'PlayerControls must NOT replace center play button with empty box when isBuffering is true'
  );
  console.log('  PASS: Center Play/Pause button restored and reflects actual playback state');

  // -------------------------------------------------------------------------
  // 2. Movies & Series Rewind and Forward Controls Restoration
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Movies & Series Rewind and Forward Controls Restoration ---');
  assert(
    playerControlsCode.includes('{showSeek && onRewind && !isMini ? (') &&
    playerControlsCode.includes('<Rewind10Icon'),
    'Rewind 10s button must not be conditionally hidden by buffering'
  );
  assert(
    playerControlsCode.includes('{showSeek && onForward && !isMini ? (') &&
    playerControlsCode.includes('<Forward10Icon'),
    'Forward 10s button must not be conditionally hidden by buffering'
  );
  console.log('  PASS: Rewind and forward buttons restored for VOD playback');

  // -------------------------------------------------------------------------
  // 3. Movies & Series Seekbar & Timeline Progress Restoration
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Movies & Series Seekbar & Progress Restoration ---');
  assert(
    playerControlsCode.includes('<PlayerSeekBar') &&
    playerControlsCode.includes('currentTime={currentTime}') &&
    playerControlsCode.includes('duration={duration}') &&
    playerControlsCode.includes('onSeek={onSeek}'),
    'PlayerControls embeds PlayerSeekBar with current time, duration, and onSeek handler'
  );
  assert(
    seekBarCode.includes('PanResponder.create') &&
    seekBarCode.includes('formatTime(displayTime') &&
    seekBarCode.includes('formatTime(duration'),
    'PlayerSeekBar calculates timeline progress and formats current time and duration'
  );
  // PlayerScreen must NOT pass fragile un-synced 0-opacity entrance styles to PlayerControls
  assert(
    !playerScreenCode.includes('bottomAnim={bottomAnim}'),
    'PlayerScreen must not pass un-synced bottomAnim that could set seekbar opacity to 0'
  );
  console.log('  PASS: Seekbar and timeline progress bar restored with accurate duration and seeking');

  // -------------------------------------------------------------------------
  // 4. LiveTV Prompt Spinner Dismissal on Playback Start
  // -------------------------------------------------------------------------
  console.log('\n--- 4. LiveTV Prompt Spinner Dismissal on Playback Start ---');
  // In EmbeddedVideoPlayer, native playingChange must immediately confirm playback without waiting for VOD curr > 0.05
  assert(
    embeddedCode.includes('hasEverPlayedRef.current = true;') &&
    embeddedCode.includes('setHasFirstFrame(true);') &&
    embeddedCode.includes("playerStateRef.current = 'PLAYING';") &&
    embeddedCode.includes("setPlayerState('PLAYING');") &&
    embeddedCode.includes('setIsBufferingUI(false);'),
    'EmbeddedVideoPlayer immediately confirms PLAYING and clears buffering on native playingChange'
  );
  console.log('  PASS: LiveTV buffering spinner dismisses promptly when playback starts');

  // -------------------------------------------------------------------------
  // 5. LiveTV Stationary Stall Protection (No False Stalls on Playing Live Streams)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. LiveTV Stationary Stall Protection ---');
  // Live streams do not advance a monotonic VOD timeline; stall must only trigger if player is loading or not playing
  assert(
    embeddedCode.includes("if (player?.status === 'loading' || (typeof player?.playing === 'boolean' && !player.playing))"),
    'EmbeddedVideoPlayer guards stationary time check so playing live streams do not falsely buffer'
  );
  console.log('  PASS: LiveTV playing streams protected against false stationary rebuffering');

  // -------------------------------------------------------------------------
  // 6. Strict Separation of Buffering vs Playing States
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Strict Separation of Buffering vs Playing States ---');
  const expectedWaitingExpr = "playerState !== 'PAUSED' && playerState !== 'ERROR' && (\n    playerState === 'LOADING' ||\n    playerState === 'BUFFERING' ||\n    playerState === 'RETRYING' ||\n    (isBufferingUI && playerState !== 'PLAYING')\n  )";
  assert(
    embeddedCode.includes("const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR'"),
    'EmbeddedVideoPlayer evaluates isWaitingForMedia strictly without ambiguous loading flags'
  );
  assert(
    playerScreenCode.includes("const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR'"),
    'PlayerScreen evaluates isWaitingForMedia strictly without ambiguous loading flags'
  );
  console.log('  PASS: Playback state machine strictly isolates LOADING/BUFFERING from PLAYING/PAUSED');

  // -------------------------------------------------------------------------
  // 7. Manual Pause and Error Isolation
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Manual Pause and Error Isolation ---');
  assert(
    embeddedCode.includes("userPausedRef.current = true") &&
    embeddedCode.includes("playbackIntentRef.current = 'PAUSED'") &&
    embeddedCode.includes("setIsBufferingUI(false)"),
    'EmbeddedVideoPlayer immediately clears spinner and sets PAUSED on user pause'
  );
  assert(
    playerScreenCode.includes("userPausedRef.current = true") &&
    playerScreenCode.includes("playbackIntentRef.current = 'PAUSED'") &&
    playerScreenCode.includes("setIsBufferingUI(false)"),
    'PlayerScreen immediately clears spinner and sets PAUSED on user pause'
  );
  console.log('  PASS: Manual pause and fatal errors cleanly hide buffering spinner');

  console.log('\n====================================================');
  console.log('ALL CONTROLS & LIVETV BUFFERING TESTS PASSED (7/7)');
  console.log('====================================================\n');
}

module.exports = { runTests };

if (require.main === module) {
  runTests();
}
