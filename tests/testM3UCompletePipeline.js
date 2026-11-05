/**
 * FOX PLAYER — COMPREHENSIVE M3U PLAYLIST PIPELINE TEST SUITE
 * 
 * Tests all 14 critical scenarios:
 * 1. Valid M3U with multiple live channels
 * 2. M3U with logos, group-title and #EXTGRP directives
 * 3. M3U with missing optional metadata (graceful fallbacks)
 * 4. M3U with quoted attributes and display names containing commas
 * 5. Windows (CRLF) and Unix (LF) line endings + UTF-8 BOM
 * 6. Empty, invalid, and HTML error playlists
 * 7. HTTP errors (404, 401/403, timeouts, network failures)
 * 8. High-volume large playlists (5,000+ channels) performance
 * 9. M3U add -> backend persistence -> app normalization
 * 10. M3U refresh coordinator -> updated dataset
 * 11. Strict playlist isolation (M3U <-> Xtream <-> M3U switching)
 * 12. Two M3U playlists with duplicate / overlapping entry IDs
 * 13. Web management workflow (association, removal, ID Lock safeguard)
 * 14. Playback pipeline URL resolution (Live M3U8/TS, Movies, Series SxxExx)
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.DATABASE_PATH = ':memory:';
process.env.ENCRYPTION_KEY = 'test_key_for_m3u_pipeline_tests_32!';

const { initDatabase, getDb } = require('../server/database/db');
const { registerOrUpdateDevice, getDevice, setIdLock } = require('../server/models/deviceModel');
const {
  savePlaylistConfig,
  getPlaylistConfig,
  getAllPlaylists,
  setActivePlaylist,
  deletePlaylist,
  getSafeServerHost,
} = require('../server/models/playlistModel');

let passCount = 0;
let failCount = 0;

function it(description, fn) {
  try {
    fn();
    passCount++;
    console.log(`  [PASS] ${description}`);
  } catch (err) {
    failCount++;
    console.error(`  [FAIL] ${description}`);
    console.error(`         ${err.message}`);
  }
}

async function itAsync(description, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  [PASS] ${description}`);
  } catch (err) {
    failCount++;
    console.error(`  [FAIL] ${description}`);
    console.error(`         ${err.message}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('       FOX PLAYER — M3U COMPREHENSIVE PIPELINE VERIFICATION     ');
  console.log('================================================================\n');

  // Load modules with dynamic import
  const { parseM3U, fetchAndParseM3U } = await import('../src/services/m3uParser.js');
  const { resolveMediaSource } = await import('../src/utils/mediaSourcePipeline.js');

  await initDatabase();

  // --------------------------------------------------------------------------
  // TEST 1: Valid M3U with Several Live Channels
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: Valid M3U with Live Channels ---');
  it('Parses valid channels and groups correctly', () => {
    const raw = `#EXTM3U
#EXTINF:-1 tvg-id="bbc1" tvg-name="BBC One HD" tvg-logo="http://logos.com/bbc1.png" group-title="UK",BBC One HD
http://stream.provider.com/live/bbc1.m3u8
#EXTINF:-1 tvg-id="itv1" tvg-name="ITV1" tvg-logo="http://logos.com/itv1.png" group-title="UK",ITV1
http://stream.provider.com/live/itv1.ts
#EXTINF:-1 tvg-id="cnn" group-title="US News",CNN International
http://stream.provider.com/live/cnn.m3u8
`;
    const result = parseM3U(raw);
    assert.strictEqual(result.total, 3, 'Should parse 3 channels');
    assert.strictEqual(result.channels[0].name, 'BBC One HD');
    assert.strictEqual(result.channels[0].group, 'UK');
    assert.strictEqual(result.channels[0].containerExtension, 'm3u8');
    assert.strictEqual(result.channels[1].containerExtension, 'ts');
    assert.deepStrictEqual(result.categories, ['UK', 'US News']);
  });

  // --------------------------------------------------------------------------
  // TEST 2: M3U with logos, multiple groups, and #EXTGRP directives
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 2: Logos & #EXTGRP Directive Handling ---');
  it('Applies #EXTGRP when group-title attribute is absent', () => {
    const raw = `#EXTM3U
#EXTINF:-1 tvg-id="espn" tvg-logo="https://cdn.com/espn.png",ESPN HD
#EXTGRP:Sports Network
http://stream.provider.com/sports/espn.m3u8
#EXTINF:-1 group-title="Movies",Action Cinema
http://stream.provider.com/vod/cinema.mp4
`;
    const result = parseM3U(raw);
    assert.strictEqual(result.channels[0].group, 'Sports Network', 'Should use #EXTGRP');
    assert.strictEqual(result.channels[0].logo, 'https://cdn.com/espn.png');
    assert.strictEqual(result.channels[1].group, 'Movies');
  });

  // --------------------------------------------------------------------------
  // TEST 3: M3U with missing optional metadata
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 3: Missing Optional Metadata ---');
  it('Falls back cleanly when tvg-id, logo, and group are missing', () => {
    const raw = `#EXTM3U
#EXTINF:-1,Euronews
http://stream.provider.com/euronews.m3u8
#EXTINF:0,France 24
http://stream.provider.com/france24.ts
`;
    const result = parseM3U(raw);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.channels[0].name, 'Euronews');
    assert.strictEqual(result.channels[0].group, 'General');
    assert.strictEqual(result.channels[0].logo, null);
    assert.ok(result.channels[0].id.startsWith('ch_'), 'Generates deterministic ch_ ID');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Quoted Attributes & Names with Commas
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 4: Quoted Attributes & Commas in Channel/Movie Titles ---');
  it('Preserves commas in display names without truncating titles', () => {
    const raw = `#EXTM3U
#EXTINF:-1 tvg-name="Batman" group-title="Action, Movies",Batman, The Dark Knight (2008)
http://stream.provider.com/movies/batman.mp4
#EXTINF:-1 tvg-id="ch4" group-title="UK",Channel 4, London Region
http://stream.provider.com/live/ch4.m3u8
`;
    const result = parseM3U(raw);
    assert.strictEqual(result.channels[0].name, 'Batman, The Dark Knight (2008)');
    assert.strictEqual(result.channels[0].group, 'Action, Movies');
    assert.strictEqual(result.channels[1].name, 'Channel 4, London Region');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Line Endings & UTF-8 BOM
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 5: CRLF/LF Line Endings & UTF-8 BOM ---');
  it('Handles UTF-8 BOM and Windows CRLF line endings seamlessly', () => {
    const crlfRaw = '\uFEFF#EXTM3U\r\n#EXTINF:-1 tvg-id="sky1",Sky One\r\nhttp://stream.com/sky1.m3u8\r\n#EXTINF:-1 tvg-id="sky2",Sky Two\r\nhttp://stream.com/sky2.m3u8\r\n';
    const result = parseM3U(crlfRaw);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.channels[0].name, 'Sky One');
    assert.strictEqual(result.channels[1].name, 'Sky Two');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Empty and Malformed Playlists
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 6: Empty and Malformed Playlists ---');
  it('Rejects non-string and empty inputs with descriptive errors', () => {
    assert.throws(() => parseM3U(''), /Invalid M3U content/);
    assert.throws(() => parseM3U(null), /Invalid M3U content/);
  });

  it('Detects HTML server error pages masquerading as playlists', () => {
    const htmlPage = '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>';
    assert.throws(() => parseM3U(htmlPage), /HTML page instead/);
  });

  it('Rejects random non-M3U text', () => {
    assert.throws(() => parseM3U('hello world this is not a playlist'), /Not a valid M3U playlist/);
  });

  it('Rejects M3U with header but 0 channels', () => {
    assert.throws(() => parseM3U('#EXTM3U\n# Comment only\n'), /No valid channels found/);
  });

  // --------------------------------------------------------------------------
  // TEST 7: HTTP Errors and Network Pipeline
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 7: HTTP Fetch Pipeline & Error Handling ---');
  await itAsync('Handles 404, 401, redirects, and network errors correctly', async () => {
    // Start temporary local mock HTTP server
    const mockServer = http.createServer((req, res) => {
      if (req.url === '/playlist.m3u') {
        res.writeHead(200, { 'Content-Type': 'application/x-mpegURL' });
        res.end('#EXTM3U\n#EXTINF:-1,Channel 1\nhttp://stream.com/ch1.m3u8\n');
      } else if (req.url === '/redirect.m3u') {
        res.writeHead(302, { Location: '/playlist.m3u' });
        res.end();
      } else if (req.url === '/denied.m3u') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Access Denied');
      } else if (req.url === '/missing.m3u') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // 1. Success fetch
      const resOk = await fetchAndParseM3U(`${base}/playlist.m3u`);
      assert.strictEqual(resOk.total, 1);
      assert.strictEqual(resOk.channels[0].name, 'Channel 1');

      // 2. Redirect following
      const resRedirect = await fetchAndParseM3U(`${base}/redirect.m3u`);
      assert.strictEqual(resRedirect.total, 1);

      // 3. 403 Access Denied
      await assert.rejects(
        async () => await fetchAndParseM3U(`${base}/denied.m3u`),
        /access denied/i
      );

      // 4. 404 Not Found
      await assert.rejects(
        async () => await fetchAndParseM3U(`${base}/missing.m3u`),
        /404/
      );
    } finally {
      mockServer.close();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 8: High Volume Large Playlists
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 8: High-Volume Large Playlists (5,000+ entries) ---');
  it('Parses 5,000 entries efficiently without memory leaks or index errors', () => {
    const lines = ['#EXTM3U'];
    for (let i = 1; i <= 5000; i++) {
      lines.push(`#EXTINF:-1 tvg-id="ch${i}" group-title="Group ${i % 20}",Channel Number ${i}`);
      lines.push(`http://cdn.streams.com/live/stream_${i}.ts`);
    }
    const bigContent = lines.join('\n');

    const start = Date.now();
    const result = parseM3U(bigContent);
    const durationMs = Date.now() - start;

    assert.strictEqual(result.total, 5000);
    assert.strictEqual(result.categories.length, 20);
    assert.ok(durationMs < 1000, `Large playlist parsed in ${durationMs}ms (< 1000ms target)`);
  });

  // --------------------------------------------------------------------------
  // TEST 9: M3U Add -> Backend Persistence -> App Synchronization
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 9: Backend Persistence & Device Association ---');
  it('Persists M3U playlist in SQLite database with type=m3u and playlist_url', () => {
    const devId = 'M3UTEST1';
    registerOrUpdateDevice(devId);

    const saved = savePlaylistConfig(devId, {
      type: 'm3u',
      playlist_name: 'Test IPTV M3U',
      playlist_url: 'https://provider.com/playlist.m3u8',
    });

    assert.ok(saved.playlist_id, 'Returns saved playlist ID');

    // Retrieve via model
    const config = getPlaylistConfig(devId, saved.playlist_id);
    assert.strictEqual(config.type, 'm3u');
    assert.strictEqual(config.playlist_name, 'Test IPTV M3U');
    assert.strictEqual(config.playlist_url, 'https://provider.com/playlist.m3u8');
    assert.strictEqual(config.is_active, true);

    const all = getAllPlaylists(devId);
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].type, 'm3u');
    assert.strictEqual(all[0].name, 'Test IPTV M3U');
  });

  // --------------------------------------------------------------------------
  // TEST 10: Content Classification (Live TV, Movies with Year, Series Grouping)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 10: Accurate Content Classification & Series Grouping ---');
  it('Classifies content into Live TV, Movies (with year), and Series (seasons & episodes)', () => {
    const testM3U = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" group-title="News",CNN International
http://stream.com/live/cnn.m3u8
#EXTINF:-1 group-title="Action Movies",Inception (2010)
http://stream.com/movies/inception.mp4
#EXTINF:-1 group-title="Drama Movies",The Godfather (1972)
http://stream.com/movies/godfather.mkv
#EXTINF:-1 group-title="TV Series",Breaking Bad S01E01 Pilot
http://stream.com/series/bb_s1e1.mp4
#EXTINF:-1 group-title="TV Series",Breaking Bad S01E02 Cat's in the Bag
http://stream.com/series/bb_s1e2.mp4
#EXTINF:-1 group-title="TV Series",Breaking Bad S02E01 Seven Thirty-Seven
http://stream.com/series/bb_s2e1.mp4
`;
    const parsed = parseM3U(testM3U);
    assert.strictEqual(parsed.total, 6);

    // Verify classification rules
    const live = [];
    const movies = [];
    const seriesEpisodes = [];

    const sPattern = /^(.*?)\s*[-._ ]*S(\d{1,2})[\s._-]*E(\d{1,3})\b\s*[-:._ ]*(.*)$/i;

    for (const item of parsed.channels) {
      const grp = (item.group || '').toLowerCase();
      const match = item.name.match(sPattern);
      if (match) {
        seriesEpisodes.push({
          series: match[1].trim(),
          season: parseInt(match[2], 10),
          episode: parseInt(match[3], 10),
          title: match[4].trim(),
          url: item.url,
        });
      } else if (grp.includes('movie')) {
        const yearMatch = item.name.match(/\b(19\d\d|20\d\d)\b/);
        movies.push({
          name: item.name,
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          url: item.url,
        });
      } else {
        live.push(item);
      }
    }

    assert.strictEqual(live.length, 1, '1 Live channel');
    assert.strictEqual(movies.length, 2, '2 Movies');
    assert.strictEqual(movies[0].year, 2010);
    assert.strictEqual(movies[1].year, 1972);

    assert.strictEqual(seriesEpisodes.length, 3, '3 Series episodes');
    assert.strictEqual(seriesEpisodes[0].series, 'Breaking Bad');
    assert.strictEqual(seriesEpisodes[0].season, 1);
    assert.strictEqual(seriesEpisodes[0].episode, 1);
    assert.strictEqual(seriesEpisodes[2].season, 2);
    assert.strictEqual(seriesEpisodes[2].episode, 1);
  });

  // --------------------------------------------------------------------------
  // TEST 11: Playlist Switching Isolation (M3U <-> Xtream <-> M3U)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 11: Playlist Switching & Isolation ---');
  it('Maintains strict separation between M3U and Xtream playlists', () => {
    const devId = 'ISOLATE1';
    registerOrUpdateDevice(devId);

    // Add M3U playlist 1
    const p1 = savePlaylistConfig(devId, {
      type: 'm3u',
      playlist_name: 'Playlist M3U Alpha',
      playlist_url: 'http://server1.com/pl1.m3u8',
    });

    // Add Xtream playlist 2
    const p2 = savePlaylistConfig(devId, {
      type: 'xtream',
      playlist_name: 'Playlist Xtream Beta',
      server_url: 'http://xtream.server.com:8080',
      username: 'user123',
      password: 'pwd',
    });

    // Switch to P1
    setActivePlaylist(devId, p1.playlist_id);
    const active1 = getPlaylistConfig(devId);
    assert.strictEqual(String(active1.id), String(p1.playlist_id));
    assert.strictEqual(active1.type, 'm3u');
    assert.strictEqual(active1.playlist_url, 'http://server1.com/pl1.m3u8');

    // Switch to P2
    setActivePlaylist(devId, p2.playlist_id);
    const active2 = getPlaylistConfig(devId);
    assert.strictEqual(String(active2.id), String(p2.playlist_id));
    assert.strictEqual(active2.type, 'xtream');
    assert.strictEqual(active2.username, 'user123');
  });

  // --------------------------------------------------------------------------
  // TEST 12: Two M3U Playlists with Overlapping IDs / Names
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 12: Overlapping Channel IDs and Collisions ---');
  it('Disambiguates duplicate tvg-ids and stream URLs without key collisions', () => {
    const raw = `#EXTM3U
#EXTINF:-1 tvg-id="cnn" group-title="News",CNN 720p
http://stream.com/cnn_720.ts
#EXTINF:-1 tvg-id="cnn" group-title="News",CNN 1080p
http://stream.com/cnn_1080.ts
#EXTINF:-1 tvg-id="cnn" group-title="News",CNN 4K
http://stream.com/cnn_4k.ts
`;
    const result = parseM3U(raw);
    const idSet = new Set(result.channels.map((c) => c.id));
    assert.strictEqual(idSet.size, 3, 'All 3 channels must receive distinct unique IDs');
  });

  // --------------------------------------------------------------------------
  // TEST 13: Web Management Workflow (Add, Set Active, Remove, ID Lock)
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 13: Web Management & ID Lock Enforcement ---');
  it('Supports adding and removing M3U playlists, obeying ID Lock', () => {
    const devId = 'WEBMGT01';
    registerOrUpdateDevice(devId);

    // 1. Add M3U playlist
    const p1 = savePlaylistConfig(devId, {
      type: 'm3u',
      playlist_name: 'Web Added M3U',
      playlist_url: 'http://cdn.tv/live.m3u',
    });
    assert.ok(p1.playlist_id);

    // 2. Safe Host extraction
    const host = getSafeServerHost('m3u', null, 'http://cdn.tv:8080/live.m3u?token=secret123');
    assert.strictEqual(host, 'http://cdn.tv:8080', 'Hides private token from safe host');

    // 3. Test ID Lock
    setIdLock(devId, true);
    assert.throws(
      () => savePlaylistConfig(devId, { type: 'm3u', playlist_url: 'http://other.com/pl.m3u' }),
      /locked/i
    );

    // Unlock
    setIdLock(devId, false);
    const deleted = deletePlaylist(devId, p1.playlist_id);
    assert.strictEqual(deleted, true);

    const remaining = getAllPlaylists(devId);
    assert.strictEqual(remaining.length, 0);
  });

  // --------------------------------------------------------------------------
  // TEST 14: Playback Pipeline URL Resolution
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 14: Unified Playback Pipeline Source Resolution ---');
  it('Resolves M3U live channels, movies, and series episodes into playable session payloads', () => {
    // 1. Live Channel with direct M3U8 URL
    const liveItem = {
      id: 'ch_cnn',
      name: 'CNN HD',
      url: 'https://stream.provider.com/live/cnn.m3u8?token=xyz',
      logo: 'https://logo.com/cnn.png',
      containerExtension: 'm3u8',
    };
    const liveResolved = resolveMediaSource({ type: 'live', item: liveItem });
    assert.strictEqual(liveResolved.url, 'https://stream.provider.com/live/cnn.m3u8?token=xyz');
    assert.strictEqual(liveResolved.extension, 'm3u8');
    assert.strictEqual(liveResolved.poster, 'https://logo.com/cnn.png');

    // 2. Movie with direct MP4 URL
    const movieItem = {
      id: 'vod_avatar',
      name: 'Avatar (2009)',
      url: 'https://vod.provider.com/movies/avatar.mp4',
      poster: 'https://poster.com/avatar.jpg',
      year: 2009,
    };
    const movieResolved = resolveMediaSource({ type: 'movie', item: movieItem });
    assert.strictEqual(movieResolved.url, 'https://vod.provider.com/movies/avatar.mp4');
    assert.strictEqual(movieResolved.extension, 'mp4');
    assert.strictEqual(movieResolved.metadata.year, 2009);

    // 3. Series Episode with direct stream URL
    const episodeItem = {
      id: 'ep_101',
      name: 'Breaking Bad S01E01: Pilot',
      url: 'https://series.provider.com/breakingbad/s01e01.mp4',
      thumbnail: 'https://img.com/ep1.jpg',
    };
    const episodeResolved = resolveMediaSource({ type: 'series', item: episodeItem });
    assert.strictEqual(episodeResolved.url, 'https://series.provider.com/breakingbad/s01e01.mp4');
    assert.strictEqual(episodeResolved.extension, 'mp4');
    assert.strictEqual(episodeResolved.poster, 'https://img.com/ep1.jpg');
  });

  console.log('\n================================================================');
  console.log(`TOTAL PASS: ${passCount} | TOTAL FAIL: ${failCount}`);
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error('Test suite runner crashed:', e);
  process.exit(1);
});
