const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests(externalAssert) {
  const tAssert = externalAssert || ((cond, msg) => {
    if (!cond) throw new Error(msg);
    console.log(`  PASS: ${msg}`);
  });

  console.log('\n--- 24. IPTV Provider Expiry & Playlist Switch Architecture Tests ---');

  // 1. Check networkErrors source
  const networkErrorsPath = path.join(__dirname, '../src/services/networkErrors.js');
  const networkErrorsSource = fs.readFileSync(networkErrorsPath, 'utf8');

  tAssert(networkErrorsSource.includes("PROVIDER_EXPIRED: 'PROVIDER_EXPIRED'"), 'ERROR_CATEGORY includes PROVIDER_EXPIRED');
  tAssert(networkErrorsSource.includes('export function isProviderExpiredError'), 'isProviderExpiredError helper is exported');
  tAssert(networkErrorsSource.includes('export function isPlaylistExpired'), 'isPlaylistExpired helper is exported');
  tAssert(networkErrorsSource.includes('case ERROR_CATEGORY.PROVIDER_EXPIRED:'), 'getUserFriendlyErrorMessage handles PROVIDER_EXPIRED');

  // 2. Check xtreamService source
  const xtreamServicePath = path.join(__dirname, '../src/services/xtreamService.js');
  const xtreamServiceSource = fs.readFileSync(xtreamServicePath, 'utf8');
  tAssert(xtreamServiceSource.includes("statusStr === 'expired'") || xtreamServiceSource.includes('PROVIDER_EXPIRED'), 'xtreamAuthenticate checks for expired provider');

  // 3. Check m3uParser source
  const m3uParserPath = path.join(__dirname, '../src/services/m3uParser.js');
  const m3uParserSource = fs.readFileSync(m3uParserPath, 'utf8');
  tAssert(m3uParserSource.includes('PROVIDER_EXPIRED'), 'm3uParser detects expired messages and throws PROVIDER_EXPIRED');

  // 4. Check AppContext source
  const appContextPath = path.join(__dirname, '../src/state/AppContext.js');
  const appContextSource = fs.readFileSync(appContextPath, 'utf8');
  tAssert(appContextSource.includes('playlistExpiredModal:'), 'AppContext includes playlistExpiredModal state');
  tAssert(appContextSource.includes('SHOW_PLAYLIST_EXPIRED_DIALOG'), 'AppContext reducer handles SHOW_PLAYLIST_EXPIRED_DIALOG');
  tAssert(appContextSource.includes('isProviderExpiredError(err)'), 'AppContext intercepts provider expired errors during sync');

  // 5. Check PlaylistExpiredDialog component
  const dialogPath = path.join(__dirname, '../src/components/PlaylistExpiredDialog.js');
  const dialogExists = fs.existsSync(dialogPath);
  tAssert(dialogExists, 'PlaylistExpiredDialog component file exists');
  const dialogSource = fs.readFileSync(dialogPath, 'utf8');
  tAssert(dialogSource.includes('export default function PlaylistExpiredDialog'), 'PlaylistExpiredDialog is exported');
  tAssert(dialogSource.includes('switchPlaylist(playlistId)'), 'PlaylistExpiredDialog handles switching playlists');
  tAssert(dialogSource.includes("router.push('/pairing?mode=add')"), 'PlaylistExpiredDialog handles adding a new playlist');

  // 6. Check _layout.js integration
  const layoutPath = path.join(__dirname, '../src/app/_layout.js');
  const layoutSource = fs.readFileSync(layoutPath, 'utf8');
  tAssert(layoutSource.includes('<PlaylistExpiredDialog />'), '_layout.js renders PlaylistExpiredDialog');
  tAssert(layoutSource.includes('onSwitchPlaylist='), '_layout.js connects onSwitchPlaylist to LoadingScreen');

  // 7. Check HomeScreen status pill
  const homePath = path.join(__dirname, '../src/screens/HomeScreen.js');
  const homeSource = fs.readFileSync(homePath, 'utf8');
  tAssert(homeSource.includes('statusPillExpired'), 'HomeScreen styles expired status pill');
  tAssert(homeSource.includes('showPlaylistExpiredDialog'), 'HomeScreen status pill allows opening Playlist Switch dialog');
}

if (require.main === module) {
  let passed = 0;
  let failed = 0;
  const localAssert = (cond, msg) => {
    if (cond) {
      console.log(`  PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL: ${msg}`);
      failed++;
    }
  };
  runTests(localAssert);
  console.log(`\nTests: Passed ${passed}, Failed ${failed}`);
  if (failed > 0) process.exit(1);
}

module.exports = { runTests };
