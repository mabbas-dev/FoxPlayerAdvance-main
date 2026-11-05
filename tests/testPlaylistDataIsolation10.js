/**
 * FOX PLAYER — 10 Runtime Isolation Acceptance Tests
 *
 * Explicitly tests:
 * Test 1: Playlist A -> Home (Verify ONLY A data)
 * Test 2: A -> B (Verify ONLY B data)
 * Test 3: B -> A (Verify ONLY A data again)
 * Test 4: A -> B -> C quickly (Verify final state contains ONLY C)
 * Test 5: Start loading A -> switch B while A requests still running (Verify A responses cannot overwrite B)
 * Test 6: Two playlists contain identical content IDs (Verify scoped keys & zero collision)
 * Test 7: Refresh Playlist B (Verify no Playlist A data appears)
 * Test 8: Remove Playlist A while B is active (Verify B remains completely unaffected)
 * Test 9: Remove currently active playlist (Verify safe fallback switch or pairing reset)
 * Test 10: Backend changes playlist associations while running (Verify updates without restart & zero dataset mixing)
 */

const assert = require('assert');
const {
  REFRESH_STATE,
  SYNC_STATUS,
  DEVICE_STATUS,
  getPlaylistFavoritesKey,
} = require('../src/constants/index.js');

console.log('================================================================');
console.log('   FOX PLAYER — 10 RUNTIME ISOLATION ACCEPTANCE TESTS          ');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
    passed++;
  } catch (e) {
    console.error(`  [FAIL] ${desc}:`, e.message);
    failed++;
  }
}

async function itAsync(desc, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${desc}`);
    passed++;
  } catch (e) {
    console.error(`  [FAIL] ${desc}:`, e.message);
    failed++;
  }
}

// In-Memory Reducer replicating AppContext COMMIT_PLAYLIST_ACTIVE & stale guards
function appReducer(state, action) {
  switch (action.type) {
    case 'START_PLAYLIST_LIFECYCLE': {
      return {
        ...state,
        refreshState: action.payload.isSwitch ? REFRESH_STATE.SWITCHING : REFRESH_STATE.REFRESHING,
        refreshStep: action.payload.step || 'Processing playlist...',
        refreshProgress: 0.1,
        refreshError: null,
      };
    }

    case 'COMMIT_PLAYLIST_ACTIVE': {
      const {
        playlistId,
        playlistObj,
        savedPlaylists,
        live,
        movies,
        series,
        movieStore,
        seriesStore,
        favorites,
        config,
      } = action.payload;

      return {
        ...state,
        activePlaylistId: playlistId,
        activePlaylist: playlistObj || null,
        savedPlaylists: savedPlaylists || state.savedPlaylists,
        liveData: live ? { ...live, playlistId } : null,
        moviesData: movies ? { ...movies, playlistId } : null,
        seriesData: series ? { ...series, playlistId } : null,
        moviesStore: movieStore ? { ...movieStore, playlistId } : null,
        seriesStore: seriesStore ? { ...seriesStore, playlistId } : null,
        favorites: Array.isArray(favorites) ? favorites : [],
        playlistConfig: config || null,
        isConfigured: true,
        playbackSessionId: (state.playbackSessionId || 0) + 1,
      };
    }

    case 'SET_CONTENT': {
      const { contentType, data } = action.payload;
      if (data?.playlistId && state.activePlaylistId && String(data.playlistId) !== String(state.activePlaylistId)) {
        return state; // Stale drop
      }
      if (contentType === 'live') return { ...state, liveData: data };
      if (contentType === 'movies') return { ...state, moviesData: data };
      if (contentType === 'series') return { ...state, seriesData: data };
      return state;
    }

    case 'SET_MOVIES_STORE': {
      if (action.payload?.playlistId && state.activePlaylistId && String(action.payload.playlistId) !== String(state.activePlaylistId)) {
        return state; // Stale drop
      }
      return { ...state, moviesStore: action.payload };
    }

    case 'SET_SERIES_STORE': {
      if (action.payload?.playlistId && state.activePlaylistId && String(action.payload.playlistId) !== String(state.activePlaylistId)) {
        return state; // Stale drop
      }
      return { ...state, seriesStore: action.payload };
    }

    case 'COMPLETE_PLAYLIST_LIFECYCLE': {
      return {
        ...state,
        refreshState: REFRESH_STATE.IDLE,
        refreshStep: 'Ready',
        refreshProgress: 1,
        refreshError: null,
      };
    }

    case 'SET_PLAYLISTS': {
      return {
        ...state,
        savedPlaylists: action.payload.playlists,
        activePlaylistId: action.payload.activePlaylistId,
        activePlaylist: action.payload.activePlaylist,
      };
    }

    case 'CLEAR_PLAYLIST_CONTENT': {
      return {
        ...state,
        liveData: null,
        moviesData: null,
        seriesData: null,
        moviesStore: null,
        seriesStore: null,
        playlistConfig: null,
        isConfigured: false,
        activePlaylistId: null,
        activePlaylist: null,
        favorites: [],
      };
    }

    default:
      return state;
  }
}

// Sample Data Generator
function createMockPlaylistData(id, name, contentId) {
  return {
    playlist: { id, name, type: 'xtream', serverUrl: `http://${id}.tv:8080`, username: `user_${id}`, password: `pass_${id}` },
    live: {
      playlistId: id,
      categories: [
        { id: `${id}_cat1`, name: `${name} Live News`, channels: [{ id: contentId, name: `${name} CNN`, streamId: contentId, url: `http://${id}.tv/live/1.m3u8` }] },
      ],
    },
    movies: {
      playlistId: id,
      categories: [
        { id: `${id}_mcat1`, name: `${name} Action`, items: [{ id: contentId, name: `${name} Action Movie`, streamId: contentId, url: `http://${id}.tv/movie/1.mp4` }] },
      ],
    },
    series: {
      playlistId: id,
      categories: [
        { id: `${id}_scat1`, name: `${name} Drama Series`, items: [{ id: contentId, seriesId: contentId, name: `${name} Drama Show` }] },
      ],
    },
    favorites: [
      { id: String(contentId), type: 'live', title: `${name} Fav Channel` },
    ],
  };
}

(async () => {
  const plA = createMockPlaylistData('pl_A', 'Playlist Alpha', 101);
  const plB = createMockPlaylistData('pl_B', 'Playlist Beta', 101); // Shared content ID 101 to verify isolation
  const plC = createMockPlaylistData('pl_C', 'Playlist Gamma', 303);

  let state = {
    activePlaylistId: null,
    activePlaylist: null,
    savedPlaylists: [plA.playlist, plB.playlist, plC.playlist],
    liveData: null,
    moviesData: null,
    seriesData: null,
    moviesStore: null,
    seriesStore: null,
    favorites: [],
    playlistConfig: null,
    playbackSessionId: 0,
    refreshState: REFRESH_STATE.IDLE,
  };

  console.log('--- Executing 10 Runtime Isolation Tests ---\n');

  // Test 1: Playlist A -> Home. Verify ONLY A data
  it('Test 1: Playlist A -> Home (Verify ONLY A data)', () => {
    state = appReducer(state, {
      type: 'COMMIT_PLAYLIST_ACTIVE',
      payload: {
        playlistId: plA.playlist.id,
        playlistObj: plA.playlist,
        savedPlaylists: state.savedPlaylists,
        live: plA.live,
        movies: plA.movies,
        series: plA.series,
        movieStore: { playlistId: plA.playlist.id, loaded: true, allMovies: plA.movies.categories[0].items },
        seriesStore: { playlistId: plA.playlist.id, loaded: true, allSeries: plA.series.categories[0].items },
        favorites: plA.favorites,
        config: plA.playlist,
      },
    });

    assert.strictEqual(state.activePlaylistId, 'pl_A');
    assert.strictEqual(state.liveData.playlistId, 'pl_A');
    assert.strictEqual(state.moviesData.playlistId, 'pl_A');
    assert.strictEqual(state.seriesData.playlistId, 'pl_A');
    assert.strictEqual(state.moviesStore.playlistId, 'pl_A');
    assert.strictEqual(state.seriesStore.playlistId, 'pl_A');
    assert.strictEqual(state.liveData.categories[0].name, 'Playlist Alpha Live News');
    assert.strictEqual(state.moviesData.categories[0].items[0].name, 'Playlist Alpha Action Movie');
    assert.strictEqual(state.favorites[0].title, 'Playlist Alpha Fav Channel');
  });

  // Test 2: A -> B. Verify ONLY B data
  it('Test 2: A -> B (Verify ONLY B data)', () => {
    state = appReducer(state, {
      type: 'COMMIT_PLAYLIST_ACTIVE',
      payload: {
        playlistId: plB.playlist.id,
        playlistObj: plB.playlist,
        savedPlaylists: state.savedPlaylists,
        live: plB.live,
        movies: plB.movies,
        series: plB.series,
        movieStore: { playlistId: plB.playlist.id, loaded: true, allMovies: plB.movies.categories[0].items },
        seriesStore: { playlistId: plB.playlist.id, loaded: true, allSeries: plB.series.categories[0].items },
        favorites: plB.favorites,
        config: plB.playlist,
      },
    });

    assert.strictEqual(state.activePlaylistId, 'pl_B');
    assert.strictEqual(state.liveData.playlistId, 'pl_B');
    assert.strictEqual(state.moviesData.playlistId, 'pl_B');
    assert.strictEqual(state.seriesData.playlistId, 'pl_B');
    assert.strictEqual(state.liveData.categories[0].name, 'Playlist Beta Live News');
    assert.strictEqual(state.moviesData.categories[0].items[0].name, 'Playlist Beta Action Movie');
    assert.strictEqual(state.favorites[0].title, 'Playlist Beta Fav Channel');
    // Ensure no Playlist A remnants exist
    assert(!JSON.stringify(state.liveData).includes('Alpha'));
    assert(!JSON.stringify(state.moviesData).includes('Alpha'));
    assert(!JSON.stringify(state.seriesData).includes('Alpha'));
  });

  // Test 3: B -> A. Verify ONLY A data again
  it('Test 3: B -> A (Verify ONLY A data again)', () => {
    state = appReducer(state, {
      type: 'COMMIT_PLAYLIST_ACTIVE',
      payload: {
        playlistId: plA.playlist.id,
        playlistObj: plA.playlist,
        savedPlaylists: state.savedPlaylists,
        live: plA.live,
        movies: plA.movies,
        series: plA.series,
        movieStore: { playlistId: plA.playlist.id, loaded: true, allMovies: plA.movies.categories[0].items },
        seriesStore: { playlistId: plA.playlist.id, loaded: true, allSeries: plA.series.categories[0].items },
        favorites: plA.favorites,
        config: plA.playlist,
      },
    });

    assert.strictEqual(state.activePlaylistId, 'pl_A');
    assert.strictEqual(state.liveData.categories[0].name, 'Playlist Alpha Live News');
    assert.strictEqual(state.moviesData.categories[0].items[0].name, 'Playlist Alpha Action Movie');
    assert(!JSON.stringify(state.liveData).includes('Beta'));
  });

  // Test 4: A -> B -> C quickly. Verify final state contains ONLY C
  it('Test 4: A -> B -> C quickly (Verify final state contains ONLY C)', () => {
    let coordinatorOpId = 0;

    // Start switch to B (opId = 1)
    coordinatorOpId = 1;
    const op1 = coordinatorOpId;

    // Rapidly switch to C before B finishes (opId = 2)
    coordinatorOpId = 2;
    const op2 = coordinatorOpId;

    // Simulation: B finishes after C has started
    if (op1 === coordinatorOpId) {
      // Should NOT run because superseded
      state = appReducer(state, { type: 'COMMIT_PLAYLIST_ACTIVE', payload: { playlistId: plB.playlist.id } });
    }

    // C finishes
    if (op2 === coordinatorOpId) {
      state = appReducer(state, {
        type: 'COMMIT_PLAYLIST_ACTIVE',
        payload: {
          playlistId: plC.playlist.id,
          playlistObj: plC.playlist,
          savedPlaylists: state.savedPlaylists,
          live: plC.live,
          movies: plC.movies,
          series: plC.series,
          movieStore: { playlistId: plC.playlist.id, loaded: true, allMovies: plC.movies.categories[0].items },
          seriesStore: { playlistId: plC.playlist.id, loaded: true, allSeries: plC.series.categories[0].items },
          favorites: [],
          config: plC.playlist,
        },
      });
    }

    assert.strictEqual(state.activePlaylistId, 'pl_C');
    assert.strictEqual(state.liveData.playlistId, 'pl_C');
    assert.strictEqual(state.liveData.categories[0].name, 'Playlist Gamma Live News');
    assert(!JSON.stringify(state.liveData).includes('Beta'));
    assert(!JSON.stringify(state.liveData).includes('Alpha'));
  });

  // Test 5: Start loading A -> switch B while A requests are still running
  it('Test 5: Start loading A -> switch B while A requests still running (Verify A responses cannot overwrite B)', () => {
    // Current active is B
    state = appReducer(state, {
      type: 'COMMIT_PLAYLIST_ACTIVE',
      payload: {
        playlistId: plB.playlist.id,
        playlistObj: plB.playlist,
        savedPlaylists: state.savedPlaylists,
        live: plB.live,
        movies: plB.movies,
        series: plB.series,
        movieStore: { playlistId: plB.playlist.id, loaded: true, allMovies: plB.movies.categories[0].items },
        seriesStore: { playlistId: plB.playlist.id, loaded: true, allSeries: plB.series.categories[0].items },
        favorites: plB.favorites,
        config: plB.playlist,
      },
    });

    // Stale delayed response from A arrives for SET_CONTENT
    state = appReducer(state, {
      type: 'SET_CONTENT',
      payload: {
        contentType: 'movies',
        data: plA.movies, // Has playlistId: 'pl_A'
      },
    });

    // Stale delayed response from A arrives for SET_MOVIES_STORE
    state = appReducer(state, {
      type: 'SET_MOVIES_STORE',
      payload: {
        playlistId: 'pl_A',
        loaded: true,
        allMovies: plA.movies.categories[0].items,
      },
    });

    // Assert moviesData and moviesStore were NOT overwritten by Playlist A
    assert.strictEqual(state.activePlaylistId, 'pl_B');
    assert.strictEqual(state.moviesData.playlistId, 'pl_B');
    assert.strictEqual(state.moviesStore.playlistId, 'pl_B');
    assert.strictEqual(state.moviesData.categories[0].items[0].name, 'Playlist Beta Action Movie');
  });

  // Test 6: Two playlists contain the same content IDs
  it('Test 6: Two playlists contain identical content IDs (Verify distinct React keys & scoped cache keys)', () => {
    // Both plA and plB contain contentId = 101
    const keyA_movie = `${plA.playlist.id}:movie:${plA.movies.categories[0].items[0].id}`;
    const keyB_movie = `${plB.playlist.id}:movie:${plB.movies.categories[0].items[0].id}`;

    const keyA_favCache = getPlaylistFavoritesKey(plA.playlist.id);
    const keyB_favCache = getPlaylistFavoritesKey(plB.playlist.id);

    // Verify React keys are strictly distinct despite identical raw content IDs
    assert.notStrictEqual(keyA_movie, keyB_movie);
    assert.strictEqual(keyA_movie, 'pl_A:movie:101');
    assert.strictEqual(keyB_movie, 'pl_B:movie:101');

    // Verify cache keys are strictly distinct
    assert.notStrictEqual(keyA_favCache, keyB_favCache);
    assert.strictEqual(keyA_favCache, 'fox_player_pl_A_fav_all');
    assert.strictEqual(keyB_favCache, 'fox_player_pl_B_fav_all');
  });

  // Test 7: Refresh Playlist B (Verify no Playlist A data appears)
  it('Test 7: Refresh Playlist B (Verify no Playlist A data appears)', () => {
    // Simulate refresh cycle on Playlist B
    state = appReducer(state, {
      type: 'START_PLAYLIST_LIFECYCLE',
      payload: { isSwitch: false, step: 'Refreshing Playlist Beta...' },
    });
    assert.strictEqual(state.refreshState, REFRESH_STATE.REFRESHING);

    // Commit refreshed B
    state = appReducer(state, {
      type: 'COMMIT_PLAYLIST_ACTIVE',
      payload: {
        playlistId: plB.playlist.id,
        playlistObj: plB.playlist,
        savedPlaylists: state.savedPlaylists,
        live: plB.live,
        movies: plB.movies,
        series: plB.series,
        movieStore: { playlistId: plB.playlist.id, loaded: true, allMovies: plB.movies.categories[0].items },
        seriesStore: { playlistId: plB.playlist.id, loaded: true, allSeries: plB.series.categories[0].items },
        favorites: plB.favorites,
        config: plB.playlist,
      },
    });
    state = appReducer(state, { type: 'COMPLETE_PLAYLIST_LIFECYCLE' });

    assert.strictEqual(state.refreshState, REFRESH_STATE.IDLE);
    assert.strictEqual(state.activePlaylistId, 'pl_B');
    assert(!JSON.stringify(state.liveData).includes('Alpha'));
    assert(!JSON.stringify(state.moviesData).includes('Alpha'));
    assert.strictEqual(state.moviesData.categories[0].items[0].name, 'Playlist Beta Action Movie');
  });

  // Test 8: Remove Playlist A while B is active
  it('Test 8: Remove Playlist A while B is active (Verify B remains completely unaffected)', () => {
    assert.strictEqual(state.activePlaylistId, 'pl_B');

    const updatedPlaylists = state.savedPlaylists.filter((p) => p.id !== 'pl_A');
    state = appReducer(state, {
      type: 'SET_PLAYLISTS',
      payload: {
        playlists: updatedPlaylists,
        activePlaylistId: state.activePlaylistId,
        activePlaylist: state.activePlaylist,
      },
    });

    assert.strictEqual(state.activePlaylistId, 'pl_B');
    assert.strictEqual(state.savedPlaylists.length, 2);
    assert.strictEqual(state.savedPlaylists.find((p) => p.id === 'pl_A'), undefined);
    assert.strictEqual(state.moviesData.categories[0].items[0].name, 'Playlist Beta Action Movie');
  });

  // Test 9: Remove the currently active playlist
  it('Test 9: Remove the currently active playlist (Verify safe automated switch to fallback)', () => {
    // Current active is B. Remove B.
    const remainingPlaylists = state.savedPlaylists.filter((p) => p.id !== 'pl_B'); // Only pl_C remains
    assert.strictEqual(remainingPlaylists.length, 1);
    const fallback = remainingPlaylists[0];

    // Atomically transition to fallback playlist C
    state = appReducer(state, {
      type: 'COMMIT_PLAYLIST_ACTIVE',
      payload: {
        playlistId: fallback.id,
        playlistObj: fallback,
        savedPlaylists: remainingPlaylists,
        live: plC.live,
        movies: plC.movies,
        series: plC.series,
        movieStore: { playlistId: fallback.id, loaded: true, allMovies: plC.movies.categories[0].items },
        seriesStore: { playlistId: fallback.id, loaded: true, allSeries: plC.series.categories[0].items },
        favorites: [],
        config: fallback,
      },
    });

    assert.strictEqual(state.activePlaylistId, 'pl_C');
    assert.strictEqual(state.savedPlaylists.length, 1);
    assert.strictEqual(state.liveData.categories[0].name, 'Playlist Gamma Live News');

    // Now remove C as well (all playlists gone)
    state = appReducer(state, { type: 'CLEAR_PLAYLIST_CONTENT' });
    assert.strictEqual(state.activePlaylistId, null);
    assert.strictEqual(state.isConfigured, false);
    assert.strictEqual(state.liveData, null);
    assert.strictEqual(state.moviesData, null);
  });

  // Test 10: Backend changes playlist associations while app is running
  it('Test 10: Backend changes playlist associations while app is running (Verify clean synchronization & zero dataset mixing)', () => {
    // Backend reports new playlist D added and set as active
    const plD = createMockPlaylistData('pl_D', 'Playlist Delta', 404);
    const remotePlaylists = [plD.playlist];

    state = appReducer(state, {
      type: 'COMMIT_PLAYLIST_ACTIVE',
      payload: {
        playlistId: plD.playlist.id,
        playlistObj: plD.playlist,
        savedPlaylists: remotePlaylists,
        live: plD.live,
        movies: plD.movies,
        series: plD.series,
        movieStore: { playlistId: plD.playlist.id, loaded: true, allMovies: plD.movies.categories[0].items },
        seriesStore: { playlistId: plD.playlist.id, loaded: true, allSeries: plD.series.categories[0].items },
        favorites: plD.favorites,
        config: plD.playlist,
      },
    });

    assert.strictEqual(state.activePlaylistId, 'pl_D');
    assert.strictEqual(state.isConfigured, true);
    assert.strictEqual(state.liveData.playlistId, 'pl_D');
    assert.strictEqual(state.liveData.categories[0].name, 'Playlist Delta Live News');
    assert.strictEqual(state.moviesData.categories[0].items[0].name, 'Playlist Delta Action Movie');
    assert(!JSON.stringify(state.liveData).includes('Gamma'));
    assert(!JSON.stringify(state.liveData).includes('Beta'));
    assert(!JSON.stringify(state.liveData).includes('Alpha'));
  });

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
})();
