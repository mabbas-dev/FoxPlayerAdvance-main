const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NEEDLE =
  '      if #available(iOS 16.0, *) {\n        let windowScene = self.rootViewController?.view.window?.windowScene\n        windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: orientationMask))\n        self.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()\n      }\n      UIDevice.current.setValue(newOrientation.rawValue, forKey: "orientation")\n      UIViewController.attemptRotationToDeviceOrientation()';

const REPLACEMENT =
  '      if #available(iOS 16.0, *) {\n        let windowScene = self.rootViewController?.view.window?.windowScene\n        windowScene?.requestGeometryUpdate(.iOS(interfaceOrientations: orientationMask))\n        self.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()\n      } else {\n        UIDevice.current.setValue(newOrientation.rawValue, forKey: "orientation")\n        UIViewController.attemptRotationToDeviceOrientation()\n      }';

function withExpoScreenOrientationIosFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const swiftPath = path.join(
        cfg.modRequest.projectRoot,
        'node_modules/expo-screen-orientation/ios/ScreenOrientationRegistry.swift',
      );
      if (!fs.existsSync(swiftPath)) return cfg;
      const src = fs.readFileSync(swiftPath, 'utf8');
      if (src.includes(NEEDLE)) {
        fs.writeFileSync(swiftPath, src.replace(NEEDLE, REPLACEMENT));
      }
      return cfg;
    },
  ]);
}

module.exports = withExpoScreenOrientationIosFix;
