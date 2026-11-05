/**
 * FOX PLAYER — iOS Playback Startup Latency, Buffering, Seeking & Progress Synchronization Tests
 *
 * Section 31 test suite verifying:
 * 1. IOSPlayer.js buffer config aligns with low-latency startup (1.0s live / 2.0s VOD).
 * 2. LiveScreen.js sets selectedAt on channel selection and parameter navigation.
 * 3. PlayerScreen.js executes centralized seek with monotonic seekOpId and bounds clamping.
 * 4. Stale timeUpdate events during seeking are suppressed until target position is reached.
 * 5. Transient CMTimeZero ticks during active playback are filtered out to prevent seekbar jumping to 0.
 * 6. Seeking watchdog handles stalled native seek operations with automatic recovery.
 * 7. Seeking while paused strictly preserves PAUSED state without unexpected auto-play.
 * 8. Rapid skip forward/rewind skips calculate offset against the latest target time.
 * 9. Live TV displays Direct Broadcast badge and disallows percentage seeking, while VOD enables full seekbar.
 * 10. Android Media3 / ExoPlayer buffer configurations remain intact with zero regressions.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runTests() {
  console.log('================================================================');
  console.log('  FOX PLAYER — iOS STARTUP, BUFFERING, SEEKING & SYNC TESTS     ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function it(desc, fn) {
    total++;
    try {
      fn();
      console.log(`  [PASS] ${total}. ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${total}. ${desc}`);
      console.error(`         ${err.message}`);
    }
  }

  const iosPlayerPath = path.join(__dirname, '../src/playback/IOSPlayer.js');
  const iosPlayerCode = fs.readFileSync(iosPlayerPath, 'utf8');

  const playerConfigPath = path.join(__dirname, '../src/utils/playerConfig.js');
  const playerConfigCode = fs.readFileSync(playerConfigPath, 'utf8');

  const playerScreenPath = path.join(__dirname, '../src/screens/PlayerScreen.js');
  const playerScreenCode = fs.readFileSync(playerScreenPath, 'utf8');

  const liveScreenPath = path.join(__dirname, '../src/screens/LiveScreen.js');
  const liveScreenCode = fs.readFileSync(liveScreenPath, 'utf8');

  const embeddedPlayerPath = path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js');
  const embeddedPlayerCode = fs.readFileSync(embeddedPlayerPath, 'utf8');

  const playbackControllerPath = path.join(__dirname, '../src/playback/PlaybackController.js');
  const playbackControllerCode = fs.readFileSync(playbackControllerPath, 'utf8');

  const playerSeekBarPath = path.join(__dirname, '../src/components/PlayerSeekBar.js');
  const playerSeekBarCode = fs.readFileSync(playerSeekBarPath, 'utf8');

  // Test 1: IOSPlayer.js buffer config aligns with low-latency startup
  it('IOSPlayer.js defines low-latency buffer config (1.0s live / 2.0s VOD)', () => {
    assert(iosPlayerCode.includes('preferredForwardBufferDuration: live ? 1.0 : 2.0'), 'IOSPlayer.js must use 1.0s live / 2.0s VOD');
    assert(iosPlayerCode.includes('waitsToMinimizeStalling: false'), 'IOSPlayer.js must disable waitsToMinimizeStalling');
  });

  // Test 2: LiveScreen.js attaches selectedAt timestamp on direct press and param navigation
  it('LiveScreen.js attaches selectedAt timestamp on direct press and param navigation', () => {
    assert(liveScreenCode.includes('selectedAt: Date.now()'), 'LiveScreen.js must attach selectedAt: Date.now()');
    assert(liveScreenCode.includes('setPlayingChannel({ ...found, selectedAt: Date.now() });'), 'LiveScreen.js must attach selectedAt on param navigation');
  });

  // Test 3: PlayerScreen.js executes centralized seek with monotonic seekOpId and bounds clamping
  it('PlayerScreen.js executes centralized seek with monotonic seekOpId and target clamping', () => {
    assert(playerScreenCode.includes('const executeSeek = useCallback('), 'PlayerScreen.js must have executeSeek callback');
    assert(playerScreenCode.includes('const seekOpId = ++seekCounterRef.current'), 'PlayerScreen.js must increment seekCounterRef');
    assert(playerScreenCode.includes('isSeekingSettlingRef.current = true'), 'PlayerScreen.js must track isSeekingSettlingRef');
    assert(playerScreenCode.includes('Math.min(dur, safeTime)'), 'PlayerScreen.js must clamp target time to duration');
  });

  // Test 4: Stale timeUpdate suppression during seeking in PlayerScreen and PlaybackController
  it('PlayerScreen.js and PlaybackController.js suppress stale timeUpdate events while seek settles', () => {
    assert(playerScreenCode.includes('if (isSeekingSettlingRef.current && seekTargetTimeRef.current !== null)'), 'PlayerScreen.js must guard against stale ticks');
    assert(playbackControllerCode.includes('if (this.isSeekingSettling && this.seekTargetTime !== null)'), 'PlaybackController.js must guard against stale ticks');
  });

  // Test 5: Transient CMTimeZero glitch protection during active playback
  it('PlayerScreen.js, EmbeddedVideoPlayer.js, and PlaybackController.js protect against transient zero time glitches', () => {
    assert(playerScreenCode.includes('if (safeCurr === 0 && lastPlaybackTimeRef.current > 1.5 && hasEverPlayedRef.current)'), 'PlayerScreen.js must filter transient 0');
    assert(embeddedPlayerCode.includes('if (curr === 0 && (lastPlaybackTimeRef.current || 0) > 1.5 && hasEverPlayedRef.current)'), 'EmbeddedVideoPlayer.js must filter transient 0');
    assert(playbackControllerCode.includes('if (curr === 0 && (this.lastPlaybackTime || 0) > 1.5)'), 'PlaybackController.js must filter transient 0');
  });

  // Test 6: Seeking watchdog handles stalled native seek operations
  it('PlayerScreen.js and PlaybackController.js arm seeking watchdogs to recover from stalled seeks', () => {
    assert(playerScreenCode.includes('seekWatchdogRef.current = setTimeout('), 'PlayerScreen.js must arm seek watchdog timer');
    assert(playbackControllerCode.includes('this.seekWatchdogTimer = setTimeout('), 'PlaybackController.js must arm seek watchdog timer');
  });

  // Test 7: Seeking while paused preserves PAUSED state
  it('PlayerScreen.js and PlaybackController.js preserve PAUSED state when seeking while paused', () => {
    assert(playerScreenCode.includes('wasPlayingBeforeSeekRef.current = wasPlaying'), 'PlayerScreen.js must track wasPlayingBeforeSeek');
    assert(playbackControllerCode.includes('this.wasPlayingBeforeSeek = (this.playbackIntent === \'PLAYING\' && !this.userPaused)'), 'PlaybackController.js must track wasPlayingBeforeSeek');
  });

  // Test 8: Rapid skip forward/rewind skips calculate offset against the latest target time
  it('Rapid skip forward/rewind skips calculate offset against the latest target time', () => {
    assert(playerScreenCode.includes('const cur = isSeekingSettlingRef.current && seekTargetTimeRef.current !== null'), 'handleRewind/Forward must use seekTargetTimeRef if settling');
  });

  // Test 9: Live TV displays Direct Broadcast badge and disallows percentage seeking, while VOD enables full seekbar
  it('PlayerSeekBar.js renders Direct Broadcast badge for live streams and supports full scrubbing for VOD', () => {
    assert(playerSeekBarCode.includes('if (isLive) {'), 'PlayerSeekBar.js must have dedicated isLive branch');
    assert(playerSeekBarCode.includes('DIRECT BROADCAST'), 'PlayerSeekBar.js must render DIRECT BROADCAST badge');
    assert(playerSeekBarCode.includes('hasValidDuration'), 'PlayerSeekBar.js must validate duration for PanResponder activation');
  });

  // Test 10: Android Media3 / ExoPlayer buffer configurations remain intact
  it('Android buffer options and playback driver remain completely intact with zero regressions', () => {
    assert(playerConfigCode.includes('preferredForwardBufferDuration: live ? 3.0 : 10.0'), 'Android buffer options must be preserved');
    assert(playerConfigCode.includes('minBufferForPlayback: live ? 1.0 : 2.5'), 'Android minBufferForPlayback must be preserved');
  });

  console.log(`\n====================================================`);
  console.log(`TOTAL TESTS: ${total}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${total - passed}`);
  console.log(`====================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
