const assert = require('assert');

const {
  prepareStreamUrlForPlatform,
  getStreamFallbackUrl,
  sanitizeMediaUrl,
} = require('../src/utils/playerConfig.js');

const {
  detectContentType,
  normalizePlaybackSource,
  DEFAULT_IPTV_USER_AGENT,
} = require('../src/utils/mediaSourcePipeline.js');

const { normalizeStreamSource } = require('../src/playback/sourceNormalizer.js');
const { IOSPlayer } = require('../src/playback/IOSPlayer.js');
const { AndroidPlayer } = require('../src/playback/AndroidPlayer.js');

async function runTests() {
  console.log('=== RUNNING AVPLAYER & EXOPLAYER STREAM FIX TESTS ===\n');

  // TEST 1: Default IPTV User Agent standard
  console.log('1. Testing Standard IPTV User-Agent...');
  assert.strictEqual(DEFAULT_IPTV_USER_AGENT, 'IPTVSmartersPro/3.1.5 (Linux; Android 12)');
  console.log('   ✓ User-Agent matches industry standard accepted by IPTV firewalls.');

  // TEST 2: iOS AVPlayer Live Stream URL Transformation
  console.log('\n2. Testing iOS AVPlayer Live Stream URL Transformation...');
  const iosTsLive = 'http://provider.tv:8080/live/user123/pass456/9876.ts';
  const preparedIosLive = prepareStreamUrlForPlatform(iosTsLive, {
    type: 'live',
    platform: 'ios',
  });
  assert.strictEqual(
    preparedIosLive,
    'http://provider.tv:8080/live/user123/pass456/9876.m3u8',
    'iOS live TS stream must be rewritten to direct provider .m3u8'
  );

  // Test with query parameters
  const iosTsWithQuery = 'http://provider.tv:8080/live/user123/pass456/9876.ts?token=xyz123';
  const preparedIosWithQuery = prepareStreamUrlForPlatform(iosTsWithQuery, {
    type: 'live',
    platform: 'ios',
  });
  assert.strictEqual(
    preparedIosWithQuery,
    'http://provider.tv:8080/live/user123/pass456/9876.m3u8?token=xyz123',
    'iOS live stream query parameters must be preserved during .m3u8 rewrite'
  );

  // Test live stream without extension
  const iosNoExt = 'http://provider.tv:8080/live/user123/pass456/9876';
  const preparedIosNoExt = prepareStreamUrlForPlatform(iosNoExt, {
    type: 'live',
    platform: 'ios',
  });
  assert.strictEqual(
    preparedIosNoExt,
    'http://provider.tv:8080/live/user123/pass456/9876.m3u8',
    'iOS live stream without extension must be rewritten to .m3u8'
  );

  // Test live stream with output=ts
  const iosOutputTs = 'http://provider.tv:8080/live/user123/pass456/9876?output=ts';
  const preparedIosOutputTs = prepareStreamUrlForPlatform(iosOutputTs, {
    type: 'live',
    platform: 'ios',
  });
  assert.strictEqual(
    preparedIosOutputTs,
    'http://provider.tv:8080/live/user123/pass456/9876.m3u8?output=m3u8',
    'iOS live stream with output=ts must be rewritten to output=m3u8 with .m3u8 path'
  );

  // Test live stream DASH .mpd
  const iosMpdLive = 'http://provider.tv:8080/live/user123/pass456/manifest.mpd';
  const preparedIosMpdLive = prepareStreamUrlForPlatform(iosMpdLive, {
    type: 'live',
    platform: 'ios',
  });
  assert.strictEqual(
    preparedIosMpdLive,
    'http://provider.tv:8080/live/user123/pass456/manifest.m3u8',
    'iOS live stream DASH .mpd must be rewritten to .m3u8'
  );
  console.log('   ✓ iOS live streams correctly targeted to provider HLS (.m3u8) endpoints.');

  // TEST 3: iOS AVPlayer VOD (.mkv -> .mp4, legacy formats)
  console.log('\n3. Testing iOS AVPlayer VOD Container Rewriting (.mkv -> .mp4)...');
  const iosMkvVod = 'http://provider.tv:8080/movie/user123/pass456/555.mkv';
  const preparedIosVod = prepareStreamUrlForPlatform(iosMkvVod, {
    type: 'movie',
    platform: 'ios',
  });
  assert.strictEqual(
    preparedIosVod,
    'http://provider.tv:8080/movie/user123/pass456/555.mp4',
    'iOS MKV movie must be rewritten to .mp4 for native AVPlayer playback'
  );

  // Test legacy AVI and FLV
  const iosAviVod = 'http://provider.tv:8080/movie/user123/pass456/123.avi';
  assert.strictEqual(
    prepareStreamUrlForPlatform(iosAviVod, { type: 'movie', platform: 'ios' }),
    'http://provider.tv:8080/movie/user123/pass456/123.mp4',
    'iOS AVI movie must be rewritten to .mp4'
  );
  const iosFlvVod = 'http://provider.tv:8080/movie/user123/pass456/123.flv';
  assert.strictEqual(
    prepareStreamUrlForPlatform(iosFlvVod, { type: 'movie', platform: 'ios' }),
    'http://provider.tv:8080/movie/user123/pass456/123.mp4',
    'iOS FLV movie must be rewritten to .mp4'
  );
  console.log('   ✓ iOS VOD movies correctly rewritten from .mkv/.avi/.flv to .mp4.');

  // TEST 4: Android ExoPlayer Stream Preservation
  console.log('\n4. Testing Android ExoPlayer Stream Preservation...');
  const androidTsLive = 'http://provider.tv:8080/live/user123/pass456/9876.ts';
  const preparedAndroidLive = prepareStreamUrlForPlatform(androidTsLive, {
    type: 'live',
    platform: 'android',
  });
  assert.strictEqual(
    preparedAndroidLive,
    androidTsLive,
    'Android stream URL must preserve authentic provider URL'
  );

  const androidMkvVod = 'http://provider.tv:8080/movie/user123/pass456/555.mkv';
  const preparedAndroidVod = prepareStreamUrlForPlatform(androidMkvVod, {
    type: 'movie',
    platform: 'android',
  });
  assert.strictEqual(
    preparedAndroidVod,
    androidMkvVod,
    'Android MKV URL must be preserved for Media3 ExoPlayer'
  );
  console.log('   ✓ Android stream URLs correctly preserved for Media3 ExoPlayer.');

  // TEST 5: Content-Type Classification
  console.log('\n5. Testing Content-Type Classification (iOS & Android)...');
  // Live HLS stream
  assert.strictEqual(
    detectContentType('http://provider.tv/live/1.m3u8', { type: 'live', platform: 'ios' }),
    'hls'
  );
  assert.strictEqual(
    detectContentType('http://provider.tv/live/1.m3u8', { type: 'live', platform: 'android' }),
    'hls'
  );
  // Live TS stream on Android must NOT force 'progressive'
  assert.strictEqual(
    detectContentType('http://provider.tv/live/1.ts', { type: 'live', platform: 'android' }),
    'auto',
    'Live TS stream on Android must return "auto" to let ExoPlayer dynamically probe TS packets'
  );
  // Live stream on iOS must be HLS
  assert.strictEqual(
    detectContentType('http://provider.tv/live/1.m3u8', { type: 'live', platform: 'ios' }),
    'hls'
  );
  // VOD MP4 & MKV
  assert.strictEqual(
    detectContentType('http://provider.tv/movie/1.mp4', { type: 'movie' }),
    'progressive'
  );
  assert.strictEqual(
    detectContentType('http://provider.tv/movie/1.mkv', { type: 'movie' }),
    'progressive'
  );
  console.log('   ✓ Content-type classification prevents rigid progressive constraints on live streams.');

  // TEST 6: Fallback URL Generation
  console.log('\n6. Testing Fallback URL Generation...');
  assert.strictEqual(
    getStreamFallbackUrl('http://provider.tv/live/1.m3u8', { isLive: true, platform: 'ios' }),
    'http://provider.tv/live/1.ts'
  );
  assert.strictEqual(
    getStreamFallbackUrl('http://provider.tv/live/1.ts', { isLive: true, platform: 'ios' }),
    'http://provider.tv/live/1.m3u8'
  );
  assert.strictEqual(
    getStreamFallbackUrl('http://provider.tv/movie/1.mkv', { isLive: false, platform: 'ios' }),
    'http://provider.tv/movie/1.mp4'
  );
  assert.strictEqual(
    getStreamFallbackUrl('http://provider.tv/movie/1.mp4', { isLive: false, platform: 'ios' }),
    'http://provider.tv/movie/1.m3u8'
  );
  assert.strictEqual(
    getStreamFallbackUrl('http://provider.tv/movie/1.mp4', { isLive: false, platform: 'android' }),
    'http://provider.tv/movie/1.mkv'
  );
  console.log('   ✓ Fallback URLs correctly generate format alternates.');

  // TEST 7: Source Normalizers with Headers & Platform Players
  console.log('\n7. Testing Platform Player prepareSource with Headers...');
  const rawLiveItem = {
    url: 'http://provider.tv:8080/live/user123/pass456/100.ts',
    name: 'BBC One HD',
    type: 'live',
  };

  // iOS normalized
  const iosNorm = normalizeStreamSource(rawLiveItem, 'ios');
  assert.strictEqual(iosNorm.isValid, true);
  assert.strictEqual(iosNorm.headers['User-Agent'], DEFAULT_IPTV_USER_AGENT);
  const iosPrepared = IOSPlayer.prepareSource(iosNorm);
  assert(iosPrepared != null);
  assert.strictEqual(iosPrepared.headers['User-Agent'], DEFAULT_IPTV_USER_AGENT);
  assert.strictEqual(iosPrepared.contentType, 'hls');

  // Android normalized
  const androidNorm = normalizeStreamSource(rawLiveItem, 'android');
  assert.strictEqual(androidNorm.isValid, true);
  assert.strictEqual(androidNorm.headers['User-Agent'], DEFAULT_IPTV_USER_AGENT);
  const androidPrepared = AndroidPlayer.prepareSource(androidNorm);
  assert(androidPrepared != null);
  assert.strictEqual(androidPrepared.headers['User-Agent'], DEFAULT_IPTV_USER_AGENT);
  // On Android, live TS should NOT enforce rigid progressive content type
  assert.notStrictEqual(androidPrepared.contentType, 'progressive');

  console.log('   ✓ Platform player sources correctly carry standard User-Agent and proper contentTypes.');

  console.log('\n=== ALL AVPLAYER & EXOPLAYER STREAM FIX TESTS PASSED! ===\n');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
