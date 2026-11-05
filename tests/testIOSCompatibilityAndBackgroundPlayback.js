import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('      FOX PLAYER — iOS COMPATIBILITY & BACKGROUND PLAYBACK      ');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    failed++;
  }
}

// 1. app.json iOS Configuration
runTest('app.json has NSAppTransportSecurity with NSAllowsArbitraryLoads: true for IPTV streams', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
  const ios = appJson.expo.ios;
  assert.ok(ios, 'ios configuration object must exist');
  assert.strictEqual(ios.bundleIdentifier, 'com.foxplayer.app');
  assert.strictEqual(ios.requireFullScreen, true);
  assert.strictEqual(ios.userInterfaceStyle, 'dark');
  assert.ok(ios.infoPlist, 'infoPlist must exist');
  assert.strictEqual(ios.infoPlist.NSAppTransportSecurity?.NSAllowsArbitraryLoads, true);
});

runTest('app.json configures landscape orientations and hidden status bar for iOS', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
  const infoPlist = appJson.expo.ios.infoPlist;
  assert.deepStrictEqual(infoPlist.UISupportedInterfaceOrientations, [
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ]);
  assert.deepStrictEqual(infoPlist['UISupportedInterfaceOrientations~ipad'], [
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ]);
  assert.strictEqual(infoPlist.UIStatusBarHidden, true);
  assert.strictEqual(infoPlist.UIViewControllerBasedStatusBarAppearance, false);
});

runTest('app.json disables background audio/video playback to prevent sound when minimized', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
  const infoPlist = appJson.expo.ios.infoPlist;
  assert.strictEqual(infoPlist.UIBackgroundModes, undefined, 'UIBackgroundModes audio must NOT be set');
  
  const plugins = appJson.expo.plugins;
  const videoPlugin = plugins.find(p => Array.isArray(p) && p[0] === 'expo-video');
  assert.ok(videoPlugin, 'expo-video plugin must exist');
  assert.strictEqual(videoPlugin[1]?.supportsBackgroundPlayback, false, 'supportsBackgroundPlayback must be false');
});

// 2. _layout.js Cross-Platform Safety
runTest('_layout.js contains no invalid NavigationBar JSX and guards Android native modules', () => {
  const layoutContent = fs.readFileSync(path.join(rootDir, 'src/app/_layout.js'), 'utf8');
  assert.ok(!layoutContent.includes('<NavigationBar'), 'Must not render NavigationBar JSX component');
  assert.ok(!layoutContent.includes("from 'expo-navigation-bar'"), 'Must not statically top-level import NavigationBar');
  assert.ok(layoutContent.includes("require('expo-navigation-bar')"), 'Must dynamically require expo-navigation-bar inside Android guard');
});

// 3. Video Players Background Suppression
runTest('PlayerScreen.js enforces staysActiveInBackground: false and pauses on background/inactive', () => {
  const playerContent = fs.readFileSync(path.join(rootDir, 'src/screens/PlayerScreen.js'), 'utf8');
  assert.ok(playerContent.includes('staysActiveInBackground = false'), 'staysActiveInBackground must be set to false');
  assert.ok(playerContent.includes("nextAppState === 'background' || nextAppState === 'inactive'"), 'Must detect background and inactive state');
  assert.ok(playerContent.includes('player.pause()'), 'Must pause player when backgrounded');
});

runTest('EmbeddedVideoPlayer.js enforces staysActiveInBackground: false and pauses on background/inactive', () => {
  const embeddedContent = fs.readFileSync(path.join(rootDir, 'src/components/EmbeddedVideoPlayer.js'), 'utf8');
  assert.ok(embeddedContent.includes('staysActiveInBackground = false'), 'staysActiveInBackground must be false');
  assert.ok(embeddedContent.includes("nextAppState === 'background' || nextAppState === 'inactive'"), 'Must detect background and inactive state');
  assert.ok(embeddedContent.includes('player.pause()'), 'Must pause embedded player when backgrounded');
});

// 4. iOS Device Storage IDFV Derivation
runTest('deviceStorage.js derives ID using getIosIdForVendorAsync on iOS', () => {
  const deviceStorageContent = fs.readFileSync(path.join(rootDir, 'src/storage/deviceStorage.js'), 'utf8');
  assert.ok(deviceStorageContent.includes('Application.getIosIdForVendorAsync'), 'Must check getIosIdForVendorAsync on iOS');
  assert.ok(deviceStorageContent.includes("Platform.OS === 'ios'"), 'Must have Platform.OS === ios block');
});

console.log('\n================================================================');
console.log(`TOTAL PASS: ${passed} | TOTAL FAIL: ${failed}`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
