const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARK = 'FOX_VLC_IOS_SUBTITLE';

const IOS_VLC_SUBTITLE_LINES = [
  '":freetype-rel-fontsize=24"',
  '":freetype-color=16777215"',
];

const VLC_ENGINE_LOAD_PATCH = `  func load(_ request: MediaRequest) {
    let media = VLCMedia(url: request.url)
    Self.foxIosSubtitleOptions(from: request.options).forEach { media.addOption($0) }
    player.media = media
  }

  /// ${MARK} — iOS VLCKit uses inverted freetype-rel-fontsize (higher = smaller text).
  private static func foxIosSubtitleOptions(from options: [String]) -> [String] {
    #if os(iOS)
    let stripped = options.filter {
      !$0.hasPrefix(":freetype-fontsize=") && !$0.hasPrefix(":freetype-rel-fontsize=")
        && !$0.hasPrefix(":freetype-color=")
    }
    return stripped + [
      ":freetype-rel-fontsize=24",
      ":freetype-color=16777215",
    ]
    #else
    return options
    #endif
  }
`;

function patchVlcEngine(projectRoot) {
  const file = path.join(projectRoot, 'node_modules', 'rn-vlc-plyr', 'ios', 'Sources', 'Player', 'VlcEngine.swift');
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');

  if (content.includes(MARK) && content.includes(':freetype-rel-fontsize=24')) {
    return;
  }

  if (content.includes(MARK)) {
    content = content.replace(
      /return stripped \+ \[[\s\S]*?\]\n    #else/,
      `return stripped + [
      ":freetype-rel-fontsize=24",
      ":freetype-color=16777215",
    ]
    #else`,
    );
    fs.writeFileSync(file, content);
    return;
  }

  content = content.replace(
    /  func load\(_ request: MediaRequest\) \{\n    let media = VLCMedia\(url: request\.url\)\n    request\.options\.forEach \{ media\.addOption\(\$0\) \}\n    player\.media = media\n  \}\n/,
    `${VLC_ENGINE_LOAD_PATCH}\n`,
  );
  fs.writeFileSync(file, content);
}

function withFoxVlcIosSubtitleSize(config) {
  return withDangerousMod(config, [
    'ios',
    async (configProps) => {
      patchVlcEngine(configProps.modRequest.projectRoot);
      return configProps;
    },
  ]);
}

module.exports = createRunOncePlugin(withFoxVlcIosSubtitleSize, 'withFoxVlcIosSubtitleSize');

if (require.main === module) {
  patchVlcEngine(path.join(__dirname, '..'));
}
