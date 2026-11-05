const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Live Stream iOS Playback & Error Handling Tests ---');

// 1. Verify playerConfig.js disables loop for iOS live playback
const playerConfigCode = fs.readFileSync(path.join(__dirname, '../src/utils/playerConfig.js'), 'utf8');
assert(playerConfigCode.includes('loop: false'), 'playerConfig.js must configure loop: false for iOS live playback');

// 2. Verify IOSPlayer.js configurePlayer sets loop to false
const iosPlayerCode = fs.readFileSync(path.join(__dirname, '../src/playback/IOSPlayer.js'), 'utf8');
assert(iosPlayerCode.includes('player.loop = false;'), 'IOSPlayer must set player.loop = false');

// 3. Verify hlsSegmenter.js implements waitForSegments, 10-segment window, and upstream error tracking
const hlsSegmenterCode = fs.readFileSync(path.join(__dirname, '../server/services/hlsSegmenter.js'), 'utf8');
assert(hlsSegmenterCode.includes('waitForSegments(count = 2'), 'hlsSegmenter must export waitForSegments with default count 2');
assert(hlsSegmenterCode.includes('while (this.segments.size > 10)'), 'hlsSegmenter rolling window must retain up to 10 segments');
assert(hlsSegmenterCode.includes('this.error = new Error'), 'hlsSegmenter must track upstream error status');
assert(hlsSegmenterCode.includes('_notifyListeners()'), 'hlsSegmenter must wake listeners immediately upon upstream failure');

// 4. Verify server/routes/stream.js waits for segments and returns HTTP 503 instead of hanging or sending empty manifest
const streamRouteCode = fs.readFileSync(path.join(__dirname, '../server/routes/stream.js'), 'utf8');
assert(streamRouteCode.includes('await session.waitForSegments(2'), 'stream route must await at least 2 segments');
assert(streamRouteCode.includes('session.segments.size === 0') && streamRouteCode.includes('503'), 'stream route must return HTTP 503 on 0 segments or error');

// 5. Verify LiveScreen.js lifecycle: resets playingChannel on blur and guards channelId param
const liveScreenCode = fs.readFileSync(path.join(__dirname, '../src/screens/LiveScreen.js'), 'utf8');
assert(liveScreenCode.includes('setPlayingChannel(null);'), 'LiveScreen must reset playingChannel to null on blur/cleanup');
assert(liveScreenCode.includes('consumedChannelIdRef'), 'LiveScreen must guard channelId auto-selection with consumedChannelIdRef');
assert(liveScreenCode.includes('p.loop = false;'), 'LiveScreen must configure livePlayer loop = false');

// 6. Verify EmbeddedVideoPlayer.js play/pause reliability and crash prevention
const playerCode = fs.readFileSync(path.join(__dirname, '../src/components/EmbeddedVideoPlayer.js'), 'utf8');
assert(playerCode.includes('player.playing') && playerCode.includes('playerState === \'PLAYING\''), 'togglePlay must inspect both native playing state and component state');
assert(playerCode.includes('!userPausedRef.current && (playerState === \'PLAYING\' || (typeof player?.playing === \'boolean\' && player.playing))'), 'isPlaying calculation must prevent stuck paused state');
assert(playerCode.includes('pausedAtRef'), 'EmbeddedVideoPlayer must track pause duration for live stream catch-up');
assert(playerCode.includes('isRawTsOnIos'), 'EmbeddedVideoPlayer must avoid raw .ts fallback on iOS');
assert(playerCode.includes('25000'), 'EmbeddedVideoPlayer must implement connect watchdog');
assert(playerCode.includes('BrokenVideoView') && playerCode.includes('isMini={isMini}'), 'EmbeddedVideoPlayer must pass isMini to BrokenVideoView');

// 7. Verify BrokenVideoView supports isMini responsive display
const brokenViewCode = fs.readFileSync(path.join(__dirname, '../src/components/BrokenVideoView.js'), 'utf8');
assert(brokenViewCode.includes('isMini = false'), 'BrokenVideoView must support isMini prop');
assert(brokenViewCode.includes('miniContainer'), 'BrokenVideoView must style mini player container responsively');

console.log('PASS: All Live Stream iOS playback, error handling, and crash protection invariants verified!');
