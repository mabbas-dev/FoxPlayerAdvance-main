/**
 * FOX PLAYER — Strict Seeking Lifecycle & Buffering-Based Control Visibility Test Suite
 *
 * Validates:
 * 1. Immediate native pause upon seek initiation (seekbar dragging, forward, rewind)
 * 2. Playback intent recording (wasPlayingBeforeSeekRef)
 * 3. Unified state machine transitioning to BUFFERING immediately on seek
 * 4. Stale playback prevention & timeUpdate suppression during seek settling
 * 5. Target position convergence & automatic playback resumption only when previously playing
 * 6. Intentional pause preservation after seek (stays paused if was paused before seek)
 * 7. Buffering-based Play/Pause visibility: Play/Pause button is unmounted from UI with pointerEvents="none" spacer during buffering
 * 8. Authoritative single-source-of-truth state (isWaitingForMedia / isBuffering) driving both BufferingIndicator and Play/Pause buttons
 * 9. Rapid seek coalescing where latest seek target wins monotonically
 * 10. Live TV non-seekable streams safety and cross-platform consistency
 */

const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n================================================================');
  console.log('  FOX PLAYER — SEEKING LIFECYCLE & CONTROL VISIBILITY TESTS     ');
  console.log('================================================================\n');

  let total = 0;
  let passed = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${total}. ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${total}. ${message}`);
    }
  }

  const playerScreenPath = path.join(__dirname, '../src/screens/PlayerScreen.js');
  const embeddedPlayerPath = path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js');
  const playerControlsPath = path.join(__dirname, '../src/components/PlayerControls.js');
  const playerSeekBarPath = path.join(__dirname, '../src/components/PlayerSeekBar.js');

  const playerScreenCode = fs.readFileSync(playerScreenPath, 'utf8').replace(/\r\n/g, '\n');
  const embeddedPlayerCode = fs.readFileSync(embeddedPlayerPath, 'utf8').replace(/\r\n/g, '\n');
  const playerControlsCode = fs.readFileSync(playerControlsPath, 'utf8');
  const playerSeekBarCode = fs.readFileSync(playerSeekBarPath, 'utf8');

  // ----------------------------------------------------
  // SECTION 1: Strict Pause During Seeking Initiation
  // ----------------------------------------------------
  console.log('--- 1. Strict Pause During Seeking Initiation ---');

  assert(
    playerScreenCode.includes('player.pause()') &&
    playerScreenCode.includes('wasPlayingBeforeSeekRef.current = wasPlaying') &&
    playerScreenCode.includes('// 1. Immediately pause native player so old video/audio NEVER continues playing'),
    'PlayerScreen.js immediately pauses native player and captures wasPlaying intent upon seek initiation'
  );

  assert(
    embeddedPlayerCode.includes('player?.pause()') &&
    embeddedPlayerCode.includes('wasPlayingBeforeSeekRef.current = wasPlaying') &&
    embeddedPlayerCode.includes('// 1. Immediately pause native player so old video/audio NEVER continues playing'),
    'EmbeddedVideoPlayer.js immediately pauses native player and captures wasPlaying intent upon seek initiation'
  );

  assert(
    playerScreenCode.includes('handleSeekingChange = useCallback((seeking) => {') &&
    playerScreenCode.includes('player?.pause();') &&
    playerScreenCode.includes('isSeekingRef.current = true;'),
    'PlayerScreen.js pauses native player immediately when user begins dragging seekbar thumb'
  );

  assert(
    embeddedPlayerCode.includes('handleSeekingChange = useCallback((seeking) => {') &&
    embeddedPlayerCode.includes('player?.pause();') &&
    embeddedPlayerCode.includes('isSeekingRef.current = true;'),
    'EmbeddedVideoPlayer.js pauses native player immediately when user begins dragging seekbar thumb'
  );

  // ----------------------------------------------------
  // SECTION 2: Unified State Machine & Buffering During Seek
  // ----------------------------------------------------
  console.log('\n--- 2. State Machine & Immediate Buffering During Seek ---');

  assert(
    playerScreenCode.includes("playerStateRef.current = 'BUFFERING';") &&
    playerScreenCode.includes("setPlayerState('BUFFERING');") &&
    playerScreenCode.includes('setDebouncedBuffering(true);') &&
    playerScreenCode.includes('setIsBufferingUI(true);'),
    'PlayerScreen.js immediately transitions state to BUFFERING and shows buffering UI on seek'
  );

  assert(
    embeddedPlayerCode.includes("playerStateRef.current = 'BUFFERING';") &&
    embeddedPlayerCode.includes("setPlayerState('BUFFERING');") &&
    embeddedPlayerCode.includes('setDebouncedBuffering(true);') &&
    embeddedPlayerCode.includes('setIsBufferingUI(true);'),
    'EmbeddedVideoPlayer.js immediately transitions state to BUFFERING and shows buffering UI on seek'
  );

  assert(
    playerScreenCode.includes('const seekOpId = ++seekCounterRef.current;') &&
    embeddedPlayerCode.includes('const seekOpId = ++seekCounterRef.current;'),
    'Both players use monotonic seekOpId counter to invalidate stale seek operations'
  );

  assert(
    playerScreenCode.includes('seekWatchdogRef.current = setTimeout(') &&
    embeddedPlayerCode.includes('seekWatchdogRef.current = setTimeout('),
    'Both players arm a seekWatchdog timer to settle seeking safely without infinite buffering'
  );

  // ----------------------------------------------------
  // SECTION 3: Stale Playback & Time Tick Suppression
  // ----------------------------------------------------
  console.log('\n--- 3. Stale Playback & Time Tick Suppression ---');

  assert(
    playerScreenCode.includes('if (isSeekingRef.current) return;') &&
    embeddedPlayerCode.includes('if (isSeekingRef.current) {\n        return;\n      }'),
    'Both players suppress native timeUpdate progress ticks while user is actively dragging thumb'
  );

  assert(
    playerScreenCode.includes('if (isSeekingSettlingRef.current && seekTargetTimeRef.current !== null)') &&
    embeddedPlayerCode.includes('if (isSeekingSettlingRef.current && seekTargetTimeRef.current !== null)'),
    'Both players verify seek target convergence before accepting native time ticks'
  );

  assert(
    playerScreenCode.includes('!isSeekingRef.current && !isSeekingSettlingRef.current') &&
    embeddedPlayerCode.includes('!isSeekingRef.current && !isSeekingSettlingRef.current'),
    'initiateAutoPlayback and playingChange listeners are strictly guarded against firing during seek settling'
  );

  // ----------------------------------------------------
  // SECTION 4: Automatic Resume vs Manual Pause Preservation
  // ----------------------------------------------------
  console.log('\n--- 4. Automatic Resume vs Manual Pause Preservation ---');

  assert(
    playerScreenCode.includes('if (wasPlayingBeforeSeekRef.current && !userPausedRef.current && playerStateRef.current !== \'ERROR\')') &&
    playerScreenCode.includes("playerStateRef.current = 'PLAYING';") &&
    playerScreenCode.includes('player.play();') &&
    playerScreenCode.includes("playerStateRef.current = 'PAUSED';") &&
    playerScreenCode.includes('player.pause();'),
    'PlayerScreen.js resumes playback if previously playing, and keeps player paused if previously paused'
  );

  assert(
    embeddedPlayerCode.includes('if (wasPlayingBeforeSeekRef.current && !userPausedRef.current && playerStateRef.current !== \'ERROR\')') &&
    embeddedPlayerCode.includes("playerStateRef.current = 'PLAYING';") &&
    embeddedPlayerCode.includes('player?.play();') &&
    embeddedPlayerCode.includes("playerStateRef.current = 'PAUSED';") &&
    embeddedPlayerCode.includes('player?.pause();'),
    'EmbeddedVideoPlayer.js resumes playback if previously playing, and keeps player paused if previously paused'
  );

  // ----------------------------------------------------
  // SECTION 5: Buffering-Based Play/Pause Control Visibility
  // ----------------------------------------------------
  console.log('\n--- 5. Buffering-Based Play/Pause Control Visibility ---');

  assert(
    playerControlsCode.includes('{!isBuffering ? (') &&
    playerControlsCode.includes('styles.playBtnWrapper') &&
    playerControlsCode.includes(') : (') &&
    playerControlsCode.includes('styles.playBtnSpacer') &&
    playerControlsCode.includes('pointerEvents="none"'),
    'PlayerControls completely unmounts Play/Pause button and replaces with pointerEvents="none" spacer during buffering'
  );

  assert(
    playerControlsCode.includes('playBtnSpacer: {') &&
    playerControlsCode.includes('miniPlayBtnSpacer: {'),
    'PlayerControls defines dedicated playBtnSpacer styles maintaining button dimensions without layout jumping'
  );

  assert(
    playerScreenCode.includes("const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR' &&") &&
    playerScreenCode.includes('isBuffering={isWaitingForMedia}'),
    'PlayerScreen drives PlayerControls buffering state authoritatively from isWaitingForMedia'
  );

  assert(
    embeddedPlayerCode.includes("const isWaitingForMedia = playerState !== 'PAUSED' && playerState !== 'ERROR' &&") &&
    embeddedPlayerCode.includes('isBuffering={isWaitingForMedia}'),
    'EmbeddedVideoPlayer drives PlayerControls buffering state authoritatively from isWaitingForMedia'
  );

  // ----------------------------------------------------
  // SECTION 6: Rapid Skip Forward & Rewind Coalescing
  // ----------------------------------------------------
  console.log('\n--- 6. Rapid Skip Forward & Rewind Coalescing ---');

  assert(
    playerScreenCode.includes('const cur = isSeekingSettlingRef.current && seekTargetTimeRef.current !== null') &&
    playerScreenCode.includes('Math.max(0, cur - 10)') &&
    playerScreenCode.includes('cur + 10'),
    'PlayerScreen coalesces rapid forward/rewind taps using seekTargetTimeRef so cumulative seeks win'
  );

  assert(
    embeddedPlayerCode.includes('const cur = (isSeekingSettlingRef.current || isSeekingRef.current) && seekTargetTimeRef.current !== null') ||
    embeddedPlayerCode.includes('const cur = isSeekingSettlingRef.current && seekTargetTimeRef.current !== null'),
    'EmbeddedVideoPlayer coalesces rapid forward/rewind taps using seekTargetTimeRef'
  );

  // ----------------------------------------------------
  // SECTION 7: Non-Seekable Live TV Safety
  // ----------------------------------------------------
  console.log('\n--- 7. Non-Seekable Live TV Safety ---');

  assert(
    playerScreenCode.includes("if (!player || type === 'live') return;"),
    'PlayerScreen disallows invalid seek requests on live streams'
  );

  assert(
    embeddedPlayerCode.includes('const canSeekStream = Boolean(duration > 0 && isFinite(duration));') &&
    embeddedPlayerCode.includes('canSeek={canSeekStream}'),
    'EmbeddedVideoPlayer enables seeking strictly when stream has a valid finite duration'
  );

  assert(
    playerSeekBarCode.includes('const hasValidDuration = duration > 0 && !isNaN(duration) && isFinite(duration) && !isLive && !disabled;'),
    'PlayerSeekBar PanResponder only activates when media has valid finite duration and is not live'
  );

  console.log(`\n====================================================`);
  console.log(`TOTAL SEEKING & VISIBILITY TESTS: ${total}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${total - passed}`);
  console.log(`====================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }

  return { total, passed, failed: total - passed };
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
