const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('\n--- 30. iOS Stream Connection & Startup Latency Optimization ---');

  let passed = 0;
  let failed = 0;

  function t(name, fn) {
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. MoviesScreen.js non-blocking navigation and selectedAt propagation
  t('1. MoviesScreen.js passes selectedAt and triggers addRecentlyWatched non-blockingly', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/MoviesScreen.js'), 'utf8');
    assert(code.includes("selectedAt: String(Date.now())"), 'Passes selectedAt timestamp to /player route');
    assert(!code.includes("await addRecentlyWatched("), 'addRecentlyWatched does not block navigation');
    assert(code.includes("addRecentlyWatched({"), 'addRecentlyWatched is called');
  });

  // 2. SeriesScreen.js non-blocking navigation and selectedAt propagation
  t('2. SeriesScreen.js passes selectedAt and triggers addRecentlyWatched non-blockingly', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/SeriesScreen.js'), 'utf8');
    assert(code.includes("selectedAt: String(Date.now())"), 'Passes selectedAt timestamp to /player route');
    assert(!code.includes("await addRecentlyWatched("), 'addRecentlyWatched does not block navigation');
    assert(code.includes("addRecentlyWatched({"), 'addRecentlyWatched is called');
  });

  // 3. FavoritesScreen.js non-blocking navigation and selectedAt propagation
  t('3. FavoritesScreen.js passes selectedAt and triggers addRecentlyWatched non-blockingly', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/FavoritesScreen.js'), 'utf8');
    assert(code.includes("selectedAt: String(Date.now())"), 'Passes selectedAt timestamp to /player route');
    assert(!code.includes("await addRecentlyWatched("), 'addRecentlyWatched does not block navigation');
  });

  // 4. PlayerScreen.js reads selectedAt and initializes t0_tap
  t('4. PlayerScreen.js reads selectedAt and initializes timingRef.current.t0_tap', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes("selectedAt"), 'selectedAt parameter is extracted from useLocalSearchParams');
    assert(code.includes("timingRef.current.t0_tap = selectedAt ? Number(selectedAt) :"), 't0_tap uses user tap timestamp');
  });

  // 5. PlayerScreen.js eliminates premature play() before replaceAsync
  t('5. PlayerScreen.js eliminates premature play() before replaceAsync resolves', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    const replaceAsyncSection = code.substring(code.indexOf('isReplacingSourceRef.current = true;'), code.indexOf('replaceAsync(playerSource)'));
    assert(!replaceAsyncSection.includes('player.play()'), 'No premature player.play() call before replaceAsync');
  });

  // 6. PlayerScreen.js eliminates redundant play() call on playingChange(false)
  t('6. PlayerScreen.js does not force play() on false rate drops during buffering', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    const playingChangeSection = code.substring(code.indexOf("player.addListener('playingChange'"), code.indexOf("player.addListener?.('sourceLoad'"));
    const falseBranch = playingChangeSection.substring(playingChangeSection.indexOf('} else if (playerStateRef.current !== \'ERROR\') {'));
    assert(!falseBranch.includes('player.play()'), 'No duplicate play() call in playingChange(false) branch');
  });

  // 7. PlayerScreen.js and EmbeddedVideoPlayer.js wire onFirstFrameRender on VideoView
  t('7. PlayerScreen.js and EmbeddedVideoPlayer.js wire onFirstFrameRender on VideoView', () => {
    const playerScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    const embeddedCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
    assert(playerScreenCode.includes('onFirstFrameRender={handleFirstFrameRender}'), 'PlayerScreen passes onFirstFrameRender to VideoView');
    assert(embeddedCode.includes('onFirstFrameRender={handleFirstFrameRender}'), 'EmbeddedVideoPlayer passes onFirstFrameRender to VideoView');
    assert(playerScreenCode.includes('playbackStartupTimings'), 'PlayerScreen logs playbackStartupTimings');
    assert(embeddedCode.includes('liveStartupTimings'), 'EmbeddedVideoPlayer logs liveStartupTimings');
  });

  // 8. playerConfig.js defines optimized buffer options for iOS and preserves Android
  t('8. playerConfig.js defines low-latency buffer options for iOS and preserves Android', () => {
    const { getPlatformBufferOptions } = require('../src/utils/playerConfig.js');
    const iosLive = getPlatformBufferOptions({ type: 'live', platform: 'ios' });
    assert.strictEqual(iosLive.preferredForwardBufferDuration, 1.0, 'iOS live uses 1.0s buffer');
    assert.strictEqual(iosLive.waitsToMinimizeStalling, false, 'iOS live waitsToMinimizeStalling is false');

    const iosVod = getPlatformBufferOptions({ type: 'movie', platform: 'ios' });
    assert.strictEqual(iosVod.preferredForwardBufferDuration, 2.0, 'iOS VOD uses 2.0s buffer');
    assert.strictEqual(iosVod.waitsToMinimizeStalling, false, 'iOS VOD waitsToMinimizeStalling is false');

    const androidLive = getPlatformBufferOptions({ type: 'live', platform: 'android' });
    assert.strictEqual(androidLive.preferredForwardBufferDuration, 3.0, 'Android live buffer preserved');
    assert.strictEqual(androidLive.minBufferForPlayback, 1.0, 'Android live minBuffer preserved');

    const androidVod = getPlatformBufferOptions({ type: 'movie', platform: 'android' });
    assert.strictEqual(androidVod.preferredForwardBufferDuration, 10.0, 'Android VOD buffer preserved');
    assert.strictEqual(androidVod.minBufferForPlayback, 2.5, 'Android VOD minBuffer preserved');
  });

  // 9. Startup timings calculation coverage
  t('9. Diagnostic calculation covers T0 through T7 milestones', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/screens/PlayerScreen.js'), 'utf8');
    assert(code.includes('totalSelectionToFirstFrameMs'), 'Calculates total selection to first frame time');
    assert(code.includes('t0_selection_to_url_ms'), 'Calculates selection to URL time');
    assert(code.includes('t1_url_to_assigned_ms'), 'Calculates URL to source assignment time');
    assert(code.includes('t3_assigned_to_ready_ms'), 'Calculates source loading to ready time');
    assert(code.includes('t5_ready_to_playback_ms'), 'Calculates ready to playback request time');
    assert(code.includes('t8_playback_to_first_frame_ms'), 'Calculates playback request to first frame time');
  });

  if (failed > 0) {
    throw new Error(`Section 30 failed: ${failed} tests failed`);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
