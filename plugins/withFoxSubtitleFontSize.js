const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const IOS_MANAGER_PATCH = `
  func applyFoxSubtitleFontSize(relativeHeightPercent: Double) {
    reloadPlayers { player in
      guard let item = player.ref.currentItem else { return }
      let attrs: [AnyHashable: Any] = [
        kCMTextMarkupAttribute_BaseFontSizePercentageRelativeToVideoHeight as String: NSNumber(value: relativeHeightPercent),
      ]
      guard let rule = AVTextStyleRule(textMarkupAttributes: attrs) else { return }
      item.textStyleRules = [rule]
    }
  }
`;

const IOS_MODULE_SNIPPET = `    Function("setFoxSubtitleFontSize") { (sizeKey: String) in
      let map: [String: Double] = [
        "small": 3.5,
        "normal": 6.0,
        "large": 9.5,
        "extra_large": 13.0,
      ]
      let percent = map[sizeKey] ?? 6.0
      VideoManager.shared.applyFoxSubtitleFontSize(relativeHeightPercent: percent)
    }

`;

function patchExpoVideo(projectRoot) {
  const expoVideoRoot = path.join(projectRoot, 'node_modules', 'expo-video');

  const iosManager = path.join(expoVideoRoot, 'ios', 'VideoManager.swift');
  if (fs.existsSync(iosManager)) {
    let content = fs.readFileSync(iosManager, 'utf8');
    if (!content.includes('applyFoxSubtitleFontSize')) {
      content = content.replace(
        '  func onAppBackgrounded() {',
        `${IOS_MANAGER_PATCH}\n\n  func onAppBackgrounded() {`
      );
      fs.writeFileSync(iosManager, content);
    }
  }

  const iosModule = path.join(expoVideoRoot, 'ios', 'VideoModule.swift');
  if (fs.existsSync(iosModule)) {
    let content = fs.readFileSync(iosModule, 'utf8');
    if (!content.includes('setFoxSubtitleFontSize')) {
      content = content.replace(
        '    View(VideoView.self) {',
        `${IOS_MODULE_SNIPPET}    View(VideoView.self) {`
      );
      fs.writeFileSync(iosModule, content);
    }
  }

  const androidUtils = path.join(
    expoVideoRoot,
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'video',
    'utils',
    'SubtitleUtils.kt'
  );
  if (fs.existsSync(androidUtils)) {
    let content = fs.readFileSync(androidUtils, 'utf8');
    if (!content.includes('foxOverrideFontSizeSp')) {
      content = content.replace(
        'object SubtitleUtils {',
        'object SubtitleUtils {\n  @JvmField\n  var foxOverrideFontSizeSp: Float? = null\n'
      );
      content = content.replace(
        '        val baseFontSize = 16f // Reasonable base size\n        setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, baseFontSize * fontScale)\n      }\n    }\n  }',
        '        val baseFontSize = foxOverrideFontSizeSp ?: 16f\n        setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, baseFontSize * fontScale)\n      } else if (foxOverrideFontSizeSp != null) {\n        setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, foxOverrideFontSizeSp!!)\n      }\n    }\n  }'
      );
      fs.writeFileSync(androidUtils, content);
    }
  }

  const androidManager = path.join(
    expoVideoRoot,
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'video',
    'managers',
    'VideoManager.kt'
  );
  if (fs.existsSync(androidManager)) {
    let content = fs.readFileSync(androidManager, 'utf8');
    if (!content.includes('applyFoxSubtitleFontSize')) {
      if (!content.includes('import expo.modules.video.utils.SubtitleUtils')) {
        content = content.replace(
          'import expo.modules.video.utils.weakMutableHashSetOf',
          'import expo.modules.video.utils.SubtitleUtils\nimport expo.modules.video.utils.weakMutableHashSetOf'
        );
      }
      content = content.replace(
        /\n}\s*$/,
        `
  fun applyFoxSubtitleFontSize(sp: Float) {
    SubtitleUtils.foxOverrideFontSizeSp = sp
    videoViews.values.forEach { videoView ->
      SubtitleUtils.configureSubtitleView(videoView.playerView, videoView.context)
    }
  }
}
`
      );
      fs.writeFileSync(androidManager, content);
    }
  }

  const androidModule = path.join(
    expoVideoRoot,
    'android',
    'src',
    'main',
    'java',
    'expo',
    'modules',
    'video',
    'VideoModule.kt'
  );
  if (fs.existsSync(androidModule)) {
    let content = fs.readFileSync(androidModule, 'utf8');
    if (!content.includes('setFoxSubtitleFontSize')) {
      const snippet = `    Function("setFoxSubtitleFontSize") { sizeKey: String ->
      val map = mapOf(
        "small" to 12f,
        "normal" to 18f,
        "large" to 28f,
        "extra_large" to 40f,
      )
      val sp = map[sizeKey] ?: 18f
      VideoManager.applyFoxSubtitleFontSize(sp)
    }

`;
      content = content.replace('    View(SurfaceVideoView::class) {', `${snippet}    View(SurfaceVideoView::class) {`);
      fs.writeFileSync(androidModule, content);
    }
  }
}

function withFoxSubtitleFontSize(config) {
  config = withDangerousMod(config, [
    'ios',
    async (configProps) => {
      patchExpoVideo(configProps.modRequest.projectRoot);
      return configProps;
    },
  ]);
  config = withDangerousMod(config, [
    'android',
    async (configProps) => {
      patchExpoVideo(configProps.modRequest.projectRoot);
      return configProps;
    },
  ]);
  return config;
}

module.exports = createRunOncePlugin(withFoxSubtitleFontSize, 'withFoxSubtitleFontSize');

if (require.main === module) {
  patchExpoVideo(path.join(__dirname, '..'));
}
