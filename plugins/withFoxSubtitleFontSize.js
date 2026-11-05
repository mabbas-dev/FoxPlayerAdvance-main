const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FOX_V3 = 'FOX_SUBTITLE_V3';

const IOS_MODULE_MAP = `    Function("setFoxSubtitleFontSize") { (sizeKey: String) in
      let map: [String: (Double, Int)] = [
        "small": (0.95, 40),
        "normal": (4.0, 85),
        "large": (6.0, 110),
        "extra_large": (8.5, 140),
      ]
      let style = map[sizeKey] ?? (0.95, 40)
      VideoManager.shared.applyFoxSubtitleFontSize(
        relativeHeightPercent: style.0,
        relativeFontScale: style.1
      )
    }

`;

const IOS_MANAGER_PATCH = `
  // ${FOX_V3}
  func applyFoxSubtitleFontSize(relativeHeightPercent: Double, relativeFontScale: Int = 85) {
    foxStoredSubtitleRelativeHeightPercent = relativeHeightPercent
    foxStoredSubtitleRelativeFontScale = relativeFontScale
    reapplyFoxStoredSubtitleStyleToAllPlayers()
  }

  func reapplyFoxStoredSubtitleStyleToAllPlayers() {
    reloadPlayers { player in
      guard let item = player.ref.currentItem else { return }
      Self.applyFoxTextStyleRules(
        to: item,
        videoHeightPercent: self.foxStoredSubtitleRelativeHeightPercent,
        relativeFontScale: self.foxStoredSubtitleRelativeFontScale
      )
    }
  }

  static func applyFoxTextStyleRules(to item: AVPlayerItem, videoHeightPercent: Double, relativeFontScale: Int) {
    let attrs: [AnyHashable: Any] = [
      kCMTextMarkupAttribute_BaseFontSizePercentageRelativeToVideoHeight as String: NSNumber(value: videoHeightPercent),
      kCMTextMarkupAttribute_GenericBaseFontSizePercentageRelativeToVideoHeight as String: NSNumber(value: videoHeightPercent),
      kCMTextMarkupAttribute_RelativeFontSize as String: NSNumber(value: relativeFontScale),
      kCMTextMarkupAttribute_ForegroundColorARGB as String: NSNumber(value: 0xFFFFFFFF),
    ]
    guard let rule = AVTextStyleRule(textMarkupAttributes: attrs) else { return }
    item.textStyleRules = [rule]
  }
`;

function readWrite(file, mutator) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  const next = mutator(content);
  if (next !== content) fs.writeFileSync(file, next);
}

function upgradeFoxSubtitleV3(expoVideoRoot) {
  const iosModule = path.join(expoVideoRoot, 'ios', 'VideoModule.swift');
  readWrite(iosModule, (content) => {
    if (!content.includes('setFoxSubtitleFontSize')) return content;
    if (content.includes('"small": (0.95, 40)')) return content;
    return content.replace(
      /Function\("setFoxSubtitleFontSize"\) \{ \(sizeKey: String\) in[\s\S]*?\n    \}\n\n    View\(VideoView\.self\)/,
      `${IOS_MODULE_MAP}    View(VideoView.self)`,
    );
  });

  const iosManager = path.join(expoVideoRoot, 'ios', 'VideoManager.swift');
  readWrite(iosManager, (content) => {
    if (!content.includes('foxStoredSubtitleRelativeHeightPercent')) return content;
    let next = content.replace(
      /private var foxStoredSubtitleRelativeHeightPercent: Double = [0-9.]+/,
      'private var foxStoredSubtitleRelativeHeightPercent: Double = 0.95',
    );
    next = next.replace(
      /private var foxStoredSubtitleRelativeFontScale: Int = [0-9]+/,
      'private var foxStoredSubtitleRelativeFontScale: Int = 40',
    );
    return next;
  });

  const androidModule = path.join(expoVideoRoot, 'android', 'src', 'main', 'java', 'expo/modules/video/VideoModule.kt');
  readWrite(androidModule, (content) => {
    if (!content.includes('setFoxSubtitleFontSize')) return content;
    if (content.includes('"small" to 7f')) return content;
    return content.replace(
      /Function\("setFoxSubtitleFontSize"\) \{ sizeKey: String ->[\s\S]*?\n    \}\n\n    View\(SurfaceVideoView::class\)/,
      `    Function("setFoxSubtitleFontSize") { sizeKey: String ->
      val map = mapOf(
        "small" to 8f,
        "normal" to 13f,
        "large" to 18f,
        "extra_large" to 26f,
      )
      val sp = map[sizeKey] ?: 8f
      VideoManager.applyFoxSubtitleFontSize(sp)
    }

    View(SurfaceVideoView::class)`,
    );
  });
}

function patchExpoVideo(projectRoot) {
  const expoVideoRoot = path.join(projectRoot, 'node_modules', 'expo-video');
  upgradeFoxSubtitleV3(expoVideoRoot);

  const iosManager = path.join(expoVideoRoot, 'ios', 'VideoManager.swift');
  readWrite(iosManager, (content) => {
    if (content.includes('applyFoxSubtitleFontSize(relativeHeightPercent:')) return content;
    if (!content.includes('func onAppBackgrounded()')) return content;
    return content.replace('  func onAppBackgrounded() {', `${IOS_MANAGER_PATCH}\n\n  func onAppBackgrounded() {`);
  });

  const iosModule = path.join(expoVideoRoot, 'ios', 'VideoModule.swift');
  readWrite(iosModule, (content) => {
    if (content.includes('setFoxSubtitleFontSize')) return content;
    return content.replace('    View(VideoView.self) {', `${IOS_MODULE_MAP}    View(VideoView.self) {`);
  });

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
    'SubtitleUtils.kt',
  );
  readWrite(androidUtils, (content) => {
    if (content.includes('foxOverrideFontSizeSp')) return content;
    let next = content.replace(
      'object SubtitleUtils {',
      'object SubtitleUtils {\n  @JvmField\n  var foxOverrideFontSizeSp: Float? = null\n',
    );
    next = next.replace(
      '        val baseFontSize = 16f // Reasonable base size\n        setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, baseFontSize * fontScale)\n      }\n    }\n  }',
      '        val baseFontSize = foxOverrideFontSizeSp ?: 16f\n        setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, baseFontSize * fontScale)\n      } else if (foxOverrideFontSizeSp != null) {\n        setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, foxOverrideFontSizeSp!!)\n      }\n    }\n  }',
    );
    return next;
  });

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
    'VideoManager.kt',
  );
  readWrite(androidManager, (content) => {
    if (content.includes('applyFoxSubtitleFontSize')) return content;
    if (!content.includes('import expo.modules.video.utils.weakMutableHashSetOf')) return content;
    let next = content.replace(
      'import expo.modules.video.utils.weakMutableHashSetOf',
      'import expo.modules.video.utils.SubtitleUtils\nimport expo.modules.video.utils.weakMutableHashSetOf',
    );
    return next.replace(
      /\n}\s*$/,
      `
  fun applyFoxSubtitleFontSize(sp: Float) {
    SubtitleUtils.foxOverrideFontSizeSp = sp
    videoViews.values.forEach { videoView ->
      SubtitleUtils.configureSubtitleView(videoView.playerView, videoView.context)
    }
  }
}
`,
    );
  });

  const androidModule = path.join(expoVideoRoot, 'android', 'src', 'main', 'java', 'expo/modules/video/VideoModule.kt');
  readWrite(androidModule, (content) => {
    if (content.includes('setFoxSubtitleFontSize')) return content;
    const snippet = `    Function("setFoxSubtitleFontSize") { sizeKey: String ->
      val map = mapOf(
        "small" to 8f,
        "normal" to 13f,
        "large" to 18f,
        "extra_large" to 26f,
      )
      val sp = map[sizeKey] ?: 8f
      VideoManager.applyFoxSubtitleFontSize(sp)
    }

`;
    return content.replace('    View(SurfaceVideoView::class) {', `${snippet}    View(SurfaceVideoView::class) {`);
  });
}

function withFoxSubtitleFontSize(config) {
  for (const platform of ['ios', 'android']) {
    config = withDangerousMod(config, [
      platform,
      async (configProps) => {
        patchExpoVideo(configProps.modRequest.projectRoot);
        return configProps;
      },
    ]);
  }
  return config;
}

module.exports = createRunOncePlugin(withFoxSubtitleFontSize, 'withFoxSubtitleFontSize');

if (require.main === module) {
  patchExpoVideo(path.join(__dirname, '..'));
}
