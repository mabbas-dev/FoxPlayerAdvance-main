const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FOX_MARK = 'FOX_VLC_SUBTITLE_LIVE';

function readWrite(file, mutator) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  const next = mutator(content);
  if (next !== content) fs.writeFileSync(file, next);
}

function patchVlcPlayerNitroSpec(root) {
  const file = path.join(root, 'src', 'specs', 'VlcPlayer.nitro.ts');
  readWrite(file, (content) => {
    if (content.includes('setSubtitleFontSize')) return content;
    return content.replace(
      '  setSubtitleTrack(id: number): void;\n',
      '  setSubtitleTrack(id: number): void;\n  setSubtitleFontSize(fontSizePx: number): void;\n',
    );
  });
}

function patchNitrogen(root) {
  const iosSwift = path.join(root, 'nitrogen/generated/ios/swift/HybridVlcPlayerSpec.swift');
  readWrite(iosSwift, (content) => {
    if (content.includes('setSubtitleFontSize')) return content;
    return content.replace(
      '  func setSubtitleTrack(id: Double) throws -> Void\n',
      '  func setSubtitleFontSize(fontSizePx: Double) throws -> Void\n  func setSubtitleTrack(id: Double) throws -> Void\n',
    );
  });

  const iosCxx = path.join(root, 'nitrogen/generated/ios/swift/HybridVlcPlayerSpec_cxx.swift');
  readWrite(iosCxx, (content) => {
    content = content.replace(/\n  @inline\(__always\)\n\n  @inline\(__always\)\n/g, '\n  @inline(__always)\n');
    if (content.includes('public final func setSubtitleFontSize')) return content;
    const block = `  @inline(__always)
  public final func setSubtitleFontSize(fontSizePx: Double) -> bridge.Result_void_ {
    do {
      try self.__implementation.setSubtitleFontSize(fontSizePx: fontSizePx)
      return bridge.create_Result_void_()
    } catch (let __error) {
      let __exceptionPtr = __error.toCpp()
      return bridge.create_Result_void_(__exceptionPtr)
    }
  }

`;
    return content.replace(
      '  @inline(__always)\n  public final func setSubtitleTrack(id: Double)',
      `${block}  @inline(__always)\n  public final func setSubtitleTrack(id: Double)`,
    );
  });

  const iosCpp = path.join(root, 'nitrogen/generated/ios/c++/HybridVlcPlayerSpecSwift.hpp');
  readWrite(iosCpp, (content) => {
    if (content.includes('setSubtitleFontSize(double fontSizePx)')) return content;
    const block = `    inline void setSubtitleFontSize(double fontSizePx) override {
      auto __result = _swiftPart.setSubtitleFontSize(std::forward<decltype(fontSizePx)>(fontSizePx));
      if (__result.hasError()) [[unlikely]] {
        std::rethrow_exception(__result.error());
      }
    }
`;
    return content.replace('    inline void setSubtitleTrack(double id) override {', `${block}    inline void setSubtitleTrack(double id) override {`);
  });

  const sharedHpp = path.join(root, 'nitrogen/generated/shared/c++/HybridVlcPlayerSpec.hpp');
  readWrite(sharedHpp, (content) => {
    if (content.includes('setSubtitleFontSize(double fontSizePx)')) return content;
    return content.replace(
      '      virtual void setSubtitleTrack(double id) = 0;\n',
      '      virtual void setSubtitleFontSize(double fontSizePx) = 0;\n      virtual void setSubtitleTrack(double id) = 0;\n',
    );
  });

  const sharedCpp = path.join(root, 'nitrogen/generated/shared/c++/HybridVlcPlayerSpec.cpp');
  readWrite(sharedCpp, (content) => {
    if (content.includes('"setSubtitleFontSize"')) return content;
    return content.replace(
      '      prototype.registerHybridMethod("setSubtitleTrack", &HybridVlcPlayerSpec::setSubtitleTrack);\n',
      '      prototype.registerHybridMethod("setSubtitleFontSize", &HybridVlcPlayerSpec::setSubtitleFontSize);\n      prototype.registerHybridMethod("setSubtitleTrack", &HybridVlcPlayerSpec::setSubtitleTrack);\n',
    );
  });

  const androidKt = path.join(
    root,
    'nitrogen/generated/android/kotlin/com/margelo/nitro/rnvlcplyr/HybridVlcPlayerSpec.kt',
  );
  readWrite(androidKt, (content) => {
    if (content.includes('fun setSubtitleFontSize')) return content;
    return content.replace(
      '  abstract fun setSubtitleTrack(id: Double): Unit\n  \n',
      '  @DoNotStrip\n  @Keep\n  abstract fun setSubtitleFontSize(fontSizePx: Double): Unit\n  \n  abstract fun setSubtitleTrack(id: Double): Unit\n  \n',
    );
  });

  const jHpp = path.join(root, 'nitrogen/generated/android/c++/JHybridVlcPlayerSpec.hpp');
  readWrite(jHpp, (content) => {
    if (content.includes('setSubtitleFontSize(double fontSizePx)')) return content;
    return content.replace(
      '    void setSubtitleTrack(double id) override;\n',
      '    void setSubtitleFontSize(double fontSizePx) override;\n    void setSubtitleTrack(double id) override;\n',
    );
  });

  const jCpp = path.join(root, 'nitrogen/generated/android/c++/JHybridVlcPlayerSpec.cpp');
  readWrite(jCpp, (content) => {
    if (content.includes('JHybridVlcPlayerSpec::setSubtitleFontSize')) return content;
    const block = `
  void JHybridVlcPlayerSpec::setSubtitleFontSize(double fontSizePx) {
    static const auto method = _javaPart->javaClassStatic()->getMethod<void(double /* fontSizePx */)>("setSubtitleFontSize");
    method(_javaPart, fontSizePx);
  }
`;
    return content.replace('  void JHybridVlcPlayerSpec::setSubtitleTrack(double id) {', `${block}  void JHybridVlcPlayerSpec::setSubtitleTrack(double id) {`);
  });
}

function patchImplementations(root) {
  const iosHybrid = path.join(root, 'ios/Sources/Player/HybridVlcPlayer.swift');
  readWrite(iosHybrid, (content) => {
    if (content.includes(FOX_MARK)) return content;
    return content.replace(
      '  func setSubtitleTrack(id: Double) throws {\n    onMain { $0.selectSubtitleTrack(Int(id)) }\n  }\n',
      `  func setSubtitleTrack(id: Double) throws {
    onMain { $0.selectSubtitleTrack(Int(id)) }
  }

  // ${FOX_MARK}
  func setSubtitleFontSize(fontSizePx: Double) throws {
    onMain { $0.setSubtitleFontSize(px: Int(fontSizePx)) }
  }
`,
    );
  });

  const iosEngine = path.join(root, 'ios/Sources/Player/VlcEngine.swift');
  readWrite(iosEngine, (content) => {
    if (content.includes(FOX_MARK)) return content;
    return content.replace(
      '  func selectSubtitleTrack(_ id: Int) {\n    player.currentVideoSubTitleIndex = Int32(id)\n  }\n',
      `  func selectSubtitleTrack(_ id: Int) {
    player.currentVideoSubTitleIndex = Int32(id)
  }

  // ${FOX_MARK}
  func setSubtitleFontSize(px: Int) {
    let clamped = max(8, min(px, 96))
    let rel = Self.vlcRelFontsize(forPx: clamped)
    player.media?.addOption(":freetype-fontsize=\\(clamped)")
    player.media?.addOption(":freetype-rel-fontsize=\\(rel)")
    let sel = player.currentVideoSubTitleIndex
    if sel >= 0 {
      player.currentVideoSubTitleIndex = -1
      player.currentVideoSubTitleIndex = sel
    }
  }

  private static func vlcRelFontsize(forPx px: Int) -> Int {
    switch px {
    case ..<14: return -3
    case 14..<22: return 0
    case 22..<34: return 2
    default: return 4
    }
  }
`,
    );
  });

  const iosPlayback = path.join(root, 'ios/Sources/Player/PlaybackController.swift');
  readWrite(iosPlayback, (content) => {
    if (content.includes('func setSubtitleFontSize(px:')) return content;
    return content.replace(
      `  func selectSubtitleTrack(_ id: Int) {
    guard isActive, TrackList.canSelect(id, in: store.media.tracks.subtitleTracks) else { return }
    engine.selectSubtitleTrack(id)
    refreshReadout()
  }

  func addSubtitle(uri: String, select: Bool) {`,
      `  func selectSubtitleTrack(_ id: Int) {
    guard isActive, TrackList.canSelect(id, in: store.media.tracks.subtitleTracks) else { return }
    engine.selectSubtitleTrack(id)
    refreshReadout()
  }

  func setSubtitleFontSize(px: Int) {
    guard isActive, px > 0 else { return }
    engine.setSubtitleFontSize(px: px)
  }

  func addSubtitle(uri: String, select: Bool) {`,
    );
  });

  const androidHybrid = path.join(
    root,
    'android/src/main/java/com/margelo/nitro/rnvlcplyr/HybridVlcPlayer.kt',
  );
  readWrite(androidHybrid, (content) => {
    if (content.includes('setSubtitleFontSize')) return content;
    return content.replace(
      '  override fun setSubtitleTrack(id: Double) = controller.setSubtitleTrack(id)\n\n',
      '  override fun setSubtitleTrack(id: Double) = controller.setSubtitleTrack(id)\n\n  override fun setSubtitleFontSize(fontSizePx: Double) = controller.setSubtitleFontSize(fontSizePx)\n\n',
    );
  });

  const androidController = path.join(
    root,
    'android/src/main/java/com/margelo/nitro/rnvlcplyr/PlayerController.kt',
  );
  readWrite(androidController, (content) => {
    if (content.includes('fun setSubtitleFontSize')) return content;
    return content.replace(
      `  fun setSubtitleTrack(id: Double) = onMain {
    val trackId = id.toInt()
    if (locked { isSelectable(media.tracks.subtitleTracks, trackId) }) {
      engine.selectSubtitleTrack(trackId)
      refreshMediaInfo()
    }
  }

  fun addSubtitle(uri: String, select: Boolean) {`,
      `  fun setSubtitleTrack(id: Double) = onMain {
    val trackId = id.toInt()
    if (locked { isSelectable(media.tracks.subtitleTracks, trackId) }) {
      engine.selectSubtitleTrack(trackId)
      refreshMediaInfo()
    }
  }

  fun setSubtitleFontSize(fontSizePx: Double) = onMain {
    engine.setSubtitleFontSizePx(fontSizePx.toInt().coerceIn(8, 96))
  }

  fun addSubtitle(uri: String, select: Boolean) {`,
    );
  });

  const androidEngine = path.join(
    root,
    'android/src/main/java/com/margelo/nitro/rnvlcplyr/engine/PlayerEngine.kt',
  );
  readWrite(androidEngine, (content) => {
    if (content.includes('fun setSubtitleFontSizePx')) return content;
    return content.replace(
      `  fun selectSubtitleTrack(id: Int) {
    player?.setSpuTrack(id)
  }

  fun addSubtitle(uri: String, select: Boolean) {`,
      `  fun selectSubtitleTrack(id: Int) {
    player?.setSpuTrack(id)
  }

  fun setSubtitleFontSizePx(px: Int) {
    val clamped = px.coerceIn(8, 96)
    val rel = vlcRelFontsize(clamped)
    mediaRequest?.let { req ->
      val stripped = req.options.filterNot {
        it.startsWith(":freetype-fontsize=") || it.startsWith(":freetype-rel-fontsize=")
      }
      mediaRequest = MediaRequest(req.uri, stripped + listOf(
        ":freetype-fontsize=$clamped",
        ":freetype-rel-fontsize=$rel",
      ))
    }
    val mp = player ?: return
    try {
      mp.media?.addOption(":freetype-fontsize=$clamped")
      mp.media?.addOption(":freetype-rel-fontsize=$rel")
    } catch (_: Throwable) {}
    val spu = mp.spuTrack
    if (spu >= 0) {
      mp.setSpuTrack(-1)
      mp.setSpuTrack(spu)
    }
  }

  private fun vlcRelFontsize(px: Int): Int = when {
    px < 14 -> -3
    px < 22 -> 0
    px < 34 -> 2
    else -> 4
  }

  fun addSubtitle(uri: String, select: Boolean) {`,
    );
  });
}

function patchRnVlcPlyr(projectRoot) {
  const root = path.join(projectRoot, 'node_modules', 'rn-vlc-plyr');
  if (!fs.existsSync(root)) return;
  patchVlcPlayerNitroSpec(root);
  patchNitrogen(root);
  patchImplementations(root);
}

function withFoxVlcSubtitleFontSize(config) {
  for (const platform of ['ios', 'android']) {
    config = withDangerousMod(config, [
      platform,
      async (configProps) => {
        patchRnVlcPlyr(configProps.modRequest.projectRoot);
        return configProps;
      },
    ]);
  }
  return config;
}

module.exports = createRunOncePlugin(withFoxVlcSubtitleFontSize, 'withFoxVlcSubtitleFontSize');

if (require.main === module) {
  patchRnVlcPlyr(path.join(__dirname, '..'));
}
