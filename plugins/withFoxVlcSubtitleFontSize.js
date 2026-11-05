const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const FOX_MARK = 'FOX_VLC_SUBTITLE_RELOAD';
const LEGACY_MARK = 'FOX_VLC_SUBTITLE_LIVE';

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
    content = content.replace(
      /\n  @DoNotStrip\n  @Keep\n  @DoNotStrip\n  @Keep\n  abstract fun setSubtitleFontSize/g,
      '\n  @DoNotStrip\n  @Keep\n  abstract fun setSubtitleFontSize',
    );
    // Upstream rn-vlc-plyr may ship setSubtitleFontSize already — never insert a duplicate.
    if (content.includes('fun setSubtitleFontSize')) {
      return content.replace(
        /\n  @DoNotStrip\n  @Keep\n  abstract fun setSubtitleFontSize\(fontSizePx: Double\): Unit\n\n  abstract fun setSubtitleTrack/g,
        '\n  @DoNotStrip\n  @Keep\n  abstract fun setSubtitleFontSize(fontSizePx: Double): Unit\n\n  @DoNotStrip\n  @Keep\n  abstract fun setSubtitleTrack',
      );
    }
    return content.replace(
      '  abstract fun setAudioTrack(id: Double): Unit\n  \n',
      '  abstract fun setAudioTrack(id: Double): Unit\n  \n  @DoNotStrip\n  @Keep\n  abstract fun setSubtitleFontSize(fontSizePx: Double): Unit\n  \n',
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

function upgradeLegacyFoxVlcPatches(root) {
  const iosEngine = path.join(root, 'ios/Sources/Player/VlcEngine.swift');
  readWrite(iosEngine, (content) => {
    if (!content.includes(LEGACY_MARK)) return content;
    return content.replace(
      /\n  \/\/ FOX_VLC_SUBTITLE_LIVE[\s\S]*?  private static func vlcRelFontsize\(forPx px: Int\) -> Int \{[\s\S]*?    \}\n  \}\n/,
      '\n',
    );
  });

  const iosPlayback = path.join(root, 'ios/Sources/Player/PlaybackController.swift');
  readWrite(iosPlayback, (content) => {
    if (content.includes(FOX_MARK)) return content;
    if (!content.includes('func setSubtitleFontSize(px:')) return content;
    return content.replace(
      /  func setSubtitleFontSize\(px: Int\) \{[\s\S]*?  \}\n\n  func addSubtitle/,
      `  // ${FOX_MARK} — freetype options only apply when media is opened
  func setSubtitleFontSize(px: Int) {
    guard isActive, px > 0, let existing = currentRequest else { return }
    let updated = Self.updatedRequest(existing, subtitleFontPx: px)
    currentRequest = updated
    guard Self.mediaActiveStatuses.contains(machine.status) else { return }

    let readout = engine.readout
    pendingSeekMs = max(readout.timeMs, 0)
    pendingRestoreAudioTrack = readout.tracks.selectedAudioTrack
    pendingRestoreSubtitleTrack = readout.tracks.selectedSubtitleTrack
    pendingPauseAfterSubtitleFontReload = machine.status == .paused
    let shouldResume =
      machine.status == .playing || machine.status == .buffering || machine.status == .paused

    replaceEngine().load(updated)
    if shouldResume {
      engine.play()
    }
  }

  func addSubtitle`,
    );
  });

  readWrite(iosPlayback, (content) => {
    if (!content.includes(FOX_MARK) || content.includes('applyPendingTrackRestoreIfNeeded')) return content;
    if (!content.includes('pendingRestoreAudioTrack')) {
      content = content.replace(
        '  private var pendingSeekMs: Int?\n  private var pendingSubtitles:',
        '  private var pendingSeekMs: Int?\n  private var pendingRestoreAudioTrack: Int?\n  private var pendingRestoreSubtitleTrack: Int?\n  private var pendingSubtitles:',
      );
    }
    content = content.replace(
      '    pendingSeekMs = nil\n    pendingSubtitles.removeAll()',
      '    pendingSeekMs = nil\n    pendingRestoreAudioTrack = nil\n    pendingRestoreSubtitleTrack = nil\n    pendingSubtitles.removeAll()',
    );
    content = content.replace(
      '    emitTracksIfChanged(readout.tracks)\n    revealVideoOnceRendered(readout.videoSize)',
      '    emitTracksIfChanged(readout.tracks)\n    applyPendingTrackRestoreIfNeeded()\n    revealVideoOnceRendered(readout.videoSize)',
    );
    if (!content.includes('applyPendingTrackRestoreIfNeeded')) {
      content = content.replace(
        '  private static func makeVideoContainer() -> UIView {',
        `  private func applyPendingTrackRestoreIfNeeded() {
    guard let engineInstance else { return }
    if let audio = pendingRestoreAudioTrack, TrackList.canSelect(audio, in: store.media.tracks.audioTracks) {
      pendingRestoreAudioTrack = nil
      engineInstance.selectAudioTrack(audio)
    }
    if let subtitle = pendingRestoreSubtitleTrack, TrackList.canSelect(subtitle, in: store.media.tracks.subtitleTracks) {
      pendingRestoreSubtitleTrack = nil
      engineInstance.selectSubtitleTrack(subtitle)
    }
  }

  private static func updatedRequest(_ request: MediaRequest, subtitleFontPx: Int) -> MediaRequest {
    let clamped = max(8, min(subtitleFontPx, 96))
    let rel = vlcRelFontsize(forPx: clamped)
    var options = request.options.filter {
      !$0.hasPrefix(":freetype-fontsize=") && !$0.hasPrefix(":freetype-rel-fontsize=")
    }
    options.append(":freetype-fontsize=\\(clamped)")
    options.append(":freetype-rel-fontsize=\\(rel)")
    return MediaRequest(url: request.url, options: options)
  }

  private static func vlcRelFontsize(forPx px: Int) -> Int {
    switch px {
    case ..<11: return -3
    case 11..<15: return 0
    case 15..<22: return 2
    default: return 4
    }
  }

  private static func makeVideoContainer() -> UIView {`,
      );
    }
    return content;
  });

  const androidEngine = path.join(
    root,
    'android/src/main/java/com/margelo/nitro/rnvlcplyr/engine/PlayerEngine.kt',
  );
  readWrite(androidEngine, (content) => {
    if (content.includes('reloadWithSubtitleFontSize')) return content;
    if (!content.includes('fun setSubtitleFontSizePx')) return content;
    return content.replace(
      /  fun setSubtitleFontSizePx\(px: Int\) \{[\s\S]*?  private fun vlcRelFontsize\(px: Int\): Int = when \{[\s\S]*?  \}\n/,
      `  /** ${FOX_MARK} — rebuild player so freetype options take effect */
  fun updateSubtitleFontOptionsOnly(px: Int) {
    val request = mediaRequest ?: return
    mediaRequest = updatedMediaRequest(request, px)
  }

  fun reloadWithSubtitleFontSize(px: Int) {
    val request = mediaRequest ?: return
    mediaRequest = updatedMediaRequest(request, px)
    replacePlayerWithFreshMedia()
  }

  private fun updatedMediaRequest(request: MediaRequest, px: Int): MediaRequest {
    val clamped = px.coerceIn(8, 96)
    val rel = vlcRelFontsize(clamped)
    val stripped = request.options.filterNot {
      it.startsWith(":freetype-fontsize=") || it.startsWith(":freetype-rel-fontsize=")
    }
    return MediaRequest(
      request.uri,
      stripped + listOf(
        ":freetype-fontsize=$clamped",
        ":freetype-rel-fontsize=$rel",
      ),
    )
  }

  private fun vlcRelFontsize(px: Int): Int = when {
    px < 11 -> -3
    px < 15 -> 0
    px < 22 -> 2
    else -> 4
  }

`,
    );
  });

  const androidController = path.join(
    root,
    'android/src/main/java/com/margelo/nitro/rnvlcplyr/PlayerController.kt',
  );
  readWrite(androidController, (content) => {
    if (content.includes('reloadWithSubtitleFontSize(px)')) return content;
    if (!content.includes('fun setSubtitleFontSize')) return content;
    return content.replace(
      /  fun setSubtitleFontSize\(fontSizePx: Double\) = onMain \{[\s\S]*?  \}\n\n  fun addSubtitle/,
      `  fun setSubtitleFontSize(fontSizePx: Double) = onMain {
    val px = fontSizePx.toInt().coerceIn(8, 96)
    if (!locked { machine.isPlaybackActive() }) {
      engine.updateSubtitleFontOptionsOnly(px)
      return@onMain
    }
    val seekMs = locked { media.currentTimeMs }
    val wasPlaying = locked { machine.status == VlcStatus.PLAYING }
    val tracks = locked { media.tracks.selectedAudioTrack to media.tracks.selectedSubtitleTrack }
    pendingSeekMs = seekMs
    val audioId = tracks.first.toInt()
    val subtitleId = tracks.second.toInt()
    pendingRestoreAudioTrack = if (audioId == VlcContract.NO_TRACK_ID) null else audioId
    pendingRestoreSubtitleTrack = if (subtitleId == VlcContract.NO_TRACK_ID) null else subtitleId
    engine.reloadWithSubtitleFontSize(px)
    if (wasPlaying) engine.play()
  }

  fun addSubtitle`,
    );
  });
}

function patchImplementations(root) {
  upgradeLegacyFoxVlcPatches(root);

  const iosHybrid = path.join(root, 'ios/Sources/Player/HybridVlcPlayer.swift');
  readWrite(iosHybrid, (content) => {
    if (content.includes('setSubtitleFontSize(fontSizePx:')) return content;
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

  const iosPlayback = path.join(root, 'ios/Sources/Player/PlaybackController.swift');
  readWrite(iosPlayback, (content) => {
    if (content.includes(FOX_MARK)) return content;
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

  // ${FOX_MARK} — freetype options only apply when media is opened
  func setSubtitleFontSize(px: Int) {
    guard isActive, px > 0, let existing = currentRequest else { return }
    let updated = Self.updatedRequest(existing, subtitleFontPx: px)
    currentRequest = updated
    guard Self.mediaActiveStatuses.contains(machine.status) else { return }

    let readout = engine.readout
    pendingSeekMs = max(readout.timeMs, 0)
    pendingRestoreAudioTrack = readout.tracks.selectedAudioTrack
    pendingRestoreSubtitleTrack = readout.tracks.selectedSubtitleTrack
    pendingPauseAfterSubtitleFontReload = machine.status == .paused
    let shouldResume =
      machine.status == .playing || machine.status == .buffering || machine.status == .paused

    replaceEngine().load(updated)
    if shouldResume {
      engine.play()
    }
  }

  func addSubtitle(uri: String, select: Bool) {`,
    );
  });

  readWrite(iosPlayback, (content) => {
    if (!content.includes(FOX_MARK) || content.includes('applyPendingTrackRestoreIfNeeded')) return content;
    content = content.replace(
      '  private var pendingSeekMs: Int?\n  private var pendingSubtitles:',
      '  private var pendingSeekMs: Int?\n  private var pendingRestoreAudioTrack: Int?\n  private var pendingRestoreSubtitleTrack: Int?\n  private var pendingSubtitles:',
    );
    content = content.replace(
      '    pendingSeekMs = nil\n    pendingSubtitles.removeAll()',
      '    pendingSeekMs = nil\n    pendingRestoreAudioTrack = nil\n    pendingRestoreSubtitleTrack = nil\n    pendingSubtitles.removeAll()',
    );
    content = content.replace(
      '    emitTracksIfChanged(readout.tracks)\n    revealVideoOnceRendered(readout.videoSize)',
      '    emitTracksIfChanged(readout.tracks)\n    applyPendingTrackRestoreIfNeeded()\n    revealVideoOnceRendered(readout.videoSize)',
    );
    return content.replace(
      '  private static func makeVideoContainer() -> UIView {',
      `  private func applyPendingTrackRestoreIfNeeded() {
    guard let engineInstance else { return }
    if let audio = pendingRestoreAudioTrack, TrackList.canSelect(audio, in: store.media.tracks.audioTracks) {
      pendingRestoreAudioTrack = nil
      engineInstance.selectAudioTrack(audio)
    }
    if let subtitle = pendingRestoreSubtitleTrack, TrackList.canSelect(subtitle, in: store.media.tracks.subtitleTracks) {
      pendingRestoreSubtitleTrack = nil
      engineInstance.selectSubtitleTrack(subtitle)
    }
  }

  private static func updatedRequest(_ request: MediaRequest, subtitleFontPx: Int) -> MediaRequest {
    let clamped = max(8, min(subtitleFontPx, 96))
    let rel = vlcRelFontsize(forPx: clamped)
    var options = request.options.filter {
      !$0.hasPrefix(":freetype-fontsize=") && !$0.hasPrefix(":freetype-rel-fontsize=")
    }
    options.append(":freetype-fontsize=\\(clamped)")
    options.append(":freetype-rel-fontsize=\\(rel)")
    return MediaRequest(url: request.url, options: options)
  }

  private static func vlcRelFontsize(forPx px: Int) -> Int {
    switch px {
    case ..<11: return -3
    case 11..<15: return 0
    case 15..<22: return 2
    default: return 4
    }
  }

  private static func makeVideoContainer() -> UIView {`,
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
    if (content.includes('reloadWithSubtitleFontSize')) return content;
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
    val px = fontSizePx.toInt().coerceIn(8, 96)
    if (!locked { machine.isPlaybackActive() }) {
      engine.updateSubtitleFontOptionsOnly(px)
      return@onMain
    }
    val seekMs = locked { media.currentTimeMs }
    val wasPlaying = locked { machine.status == VlcStatus.PLAYING }
    val tracks = locked { media.tracks.selectedAudioTrack to media.tracks.selectedSubtitleTrack }
    pendingSeekMs = seekMs
    val audioId = tracks.first.toInt()
    val subtitleId = tracks.second.toInt()
    pendingRestoreAudioTrack = if (audioId == VlcContract.NO_TRACK_ID) null else audioId
    pendingRestoreSubtitleTrack = if (subtitleId == VlcContract.NO_TRACK_ID) null else subtitleId
    engine.reloadWithSubtitleFontSize(px)
    if (wasPlaying) engine.play()
  }

  fun addSubtitle(uri: String, select: Boolean) {`,
    );
  });

  readWrite(androidController, (content) => {
    if (!content.includes('reloadWithSubtitleFontSize') || content.includes('applyPendingTrackRestores')) {
      return content;
    }
    if (!content.includes('pendingRestoreAudioTrack')) {
      content = content.replace(
        '  private var pendingSeekMs: Long? = null\n  private var released = false',
        '  private var pendingSeekMs: Long? = null\n  private var pendingRestoreAudioTrack: Int? = null\n  private var pendingRestoreSubtitleTrack: Int? = null\n  private var released = false',
      );
    }
    content = content.replace(
      '      pendingSeekMs = null\n      previous',
      '      pendingSeekMs = null\n      pendingRestoreAudioTrack = null\n      pendingRestoreSubtitleTrack = null\n      previous',
    );
    content = content.replace(
      '    pendingSeekMs = null\n    throttle.reset()',
      '    pendingSeekMs = null\n    pendingRestoreAudioTrack = null\n    pendingRestoreSubtitleTrack = null\n    throttle.reset()',
    );
    content = content.replace(
      '      pendingSeekMs = null\n      add { applyPendingTrackRestores() }',
      '      pendingSeekMs = null\n      add { applyPendingTrackRestores() }',
    );
    if (!content.includes('applyPendingTrackRestores()')) {
      content = content.replace(
        '      pendingSeekMs?.let { target -> add { engine.setTime(target) } }\n      pendingSeekMs = null\n    }',
        '      pendingSeekMs?.let { target -> add { engine.setTime(target) } }\n      pendingSeekMs = null\n      add { applyPendingTrackRestores() }\n    }',
      );
    }
    return content.replace(
      '  private fun refreshMediaInfo() {',
      `  private fun applyPendingTrackRestores() {
    pendingRestoreAudioTrack?.let { id ->
      if (isSelectable(media.tracks.audioTracks, id)) {
        engine.selectAudioTrack(id)
        pendingRestoreAudioTrack = null
      }
    }
    pendingRestoreSubtitleTrack?.let { id ->
      if (isSelectable(media.tracks.subtitleTracks, id)) {
        engine.selectSubtitleTrack(id)
        pendingRestoreSubtitleTrack = null
      }
    }
  }

  private fun refreshMediaInfo() {`,
    ).replace(
      '      queueVideoSize(info.videoWidth, info.videoHeight)\n    }\n  }',
      '      queueVideoSize(info.videoWidth, info.videoHeight)\n      add { applyPendingTrackRestores() }\n    }\n  }',
    );
  });

  const androidEngine = path.join(
    root,
    'android/src/main/java/com/margelo/nitro/rnvlcplyr/engine/PlayerEngine.kt',
  );
  readWrite(androidEngine, (content) => {
    if (content.includes('reloadWithSubtitleFontSize')) return content;
    return content.replace(
      `  fun selectSubtitleTrack(id: Int) {
    player?.setSpuTrack(id)
  }

  fun addSubtitle(uri: String, select: Boolean) {`,
      `  fun selectSubtitleTrack(id: Int) {
    player?.setSpuTrack(id)
  }

  /** ${FOX_MARK} — rebuild player so freetype options take effect */
  fun updateSubtitleFontOptionsOnly(px: Int) {
    val request = mediaRequest ?: return
    mediaRequest = updatedMediaRequest(request, px)
  }

  fun reloadWithSubtitleFontSize(px: Int) {
    val request = mediaRequest ?: return
    mediaRequest = updatedMediaRequest(request, px)
    replacePlayerWithFreshMedia()
  }

  private fun updatedMediaRequest(request: MediaRequest, px: Int): MediaRequest {
    val clamped = px.coerceIn(8, 96)
    val rel = vlcRelFontsize(clamped)
    val stripped = request.options.filterNot {
      it.startsWith(":freetype-fontsize=") || it.startsWith(":freetype-rel-fontsize=")
    }
    return MediaRequest(
      request.uri,
      stripped + listOf(
        ":freetype-fontsize=$clamped",
        ":freetype-rel-fontsize=$rel",
      ),
    )
  }

  private fun vlcRelFontsize(px: Int): Int = when {
    px < 11 -> -3
    px < 15 -> 0
    px < 22 -> 2
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
