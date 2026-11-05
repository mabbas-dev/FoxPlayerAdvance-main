const {
  withDangerousMod,
  withAppBuildGradle,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config Plugin for MobileVLCKit (iOS) and libVLC (Android).
 * Ensures native build dependencies, deployment targets, and packaging options
 * are seamlessly configured for rn-vlc-plyr on both platforms.
 */
function withVlcKitAndroid(config) {
  return withAppBuildGradle(config, (configProps) => {
    let buildGradle = configProps.modResults.contents;

    // Ensure packagingOptions pickFirst includes libc++_shared.so to resolve duplicate STL collision
    if (!buildGradle.includes("pickFirst '**/libc++_shared.so'")) {
      const packagingBlock = `
    packagingOptions {
        pickFirst '**/libc++_shared.so'
        pickFirst '**/libvlc.so'
        pickFirst '**/libvlcjni.so'
    }
`;
      if (buildGradle.includes('android {')) {
        buildGradle = buildGradle.replace('android {', `android {${packagingBlock}`);
      }
    }

    configProps.modResults.contents = buildGradle;
    return configProps;
  });
}

function withVlcKitIos(config) {
  return withDangerousMod(config, [
    'ios',
    async (configProps) => {
      const podfilePath = path.join(configProps.modRequest.platformProjectRoot, 'Podfile');
      if (fs.existsSync(podfilePath)) {
        let podfile = fs.readFileSync(podfilePath, 'utf8');

        // Ensure MobileVLCKit pod is referenced if not already present
        if (!podfile.includes('MobileVLCKit')) {
          const vlcPodEntry = `  pod 'MobileVLCKit', '~> 3.7.4'\n`;
          const targetMatch = podfile.match(/target\s+['"][^'"]+['"]\s+do/);
          if (targetMatch) {
            podfile = podfile.replace(targetMatch[0], `${targetMatch[0]}\n${vlcPodEntry}`);
            fs.writeFileSync(podfilePath, podfile, 'utf8');
          }
        }
      }
      return configProps;
    },
  ]);
}

function withVlcKit(config) {
  config = withVlcKitAndroid(config);
  config = withVlcKitIos(config);
  return config;
}

const pkg = { name: 'withVlcKit', version: '1.0.0' };
module.exports = createRunOncePlugin(withVlcKit, pkg.name, pkg.version);
