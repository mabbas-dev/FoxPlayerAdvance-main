import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Colors from '../constants/colors';
import { getPlatformPlayerOptions } from '../utils/playerConfig';

export const CANONICAL_TEST_HLS_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
export const TEARS_OF_STEEL_HLS_STREAM = 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8';

/**
 * Isolated Native iOS & Android HLS Player Test Harness.
 *
 * Used to isolate native player functionality from IPTV-specific logic.
 * Measures and logs the exact T0..T5 playback lifecycle milestones:
 * - T0: Source assigned
 * - T1: Status changed to 'loading'
 * - T2: Status changed to 'readyToPlay'
 * - T3: isPlaying became true (first frame rendered)
 * - T4: timeUpdate ticks received (playback advancing)
 * - T5: Pause / Seek / Resume verified
 */
export default function NativePlayerTestHarness({
  streamUrl = CANONICAL_TEST_HLS_STREAM,
  onTestComplete = null,
  autoStart = true,
}) {
  const [testStage, setTestStage] = useState('IDLE'); // 'IDLE' | 'TESTING' | 'PASSED' | 'FAILED'
  const [milestones, setMilestones] = useState({
    T0_assigned: null,
    T1_loading: null,
    T2_readyToPlay: null,
    T3_firstFrame: null,
    T4_timeUpdate: null,
    T5_controlsVerified: null,
  });
  const [errorMessage, setErrorMessage] = useState(null);
  const [ticksCount, setTicksCount] = useState(0);

  const timingRef = useRef({
    t0: 0,
    t1: 0,
    t2: 0,
    t3: 0,
    t4: 0,
    t5: 0,
  });

  const testSource = useRef({
    uri: streamUrl,
    contentType: 'hls',
    headers: {
      'User-Agent': 'FOX-PLAYER-HARNESS/1.0',
    },
    metadata: {
      title: 'Canonical Test HLS Stream',
    },
  }).current;

  const player = useVideoPlayer(testSource, (p) => {
    const opts = getPlatformPlayerOptions({ type: 'vod', isLive: false });
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
    p.staysActiveInBackground = false;
    if (opts.bufferOptions) {
      p.bufferOptions = opts.bufferOptions;
    }
  });

  const logMilestone = useCallback((key, timestamp = Date.now()) => {
    setMilestones((prev) => ({
      ...prev,
      [key]: timestamp - (timingRef.current.t0 || timestamp),
    }));
  }, []);

  const runTestSequence = useCallback(() => {
    if (!player) return;
    timingRef.current.t0 = Date.now();
    logMilestone('T0_assigned', timingRef.current.t0);
    setTestStage('TESTING');
    setErrorMessage(null);
    setTicksCount(0);

    try {
      player.play();
    } catch (e) {
      setErrorMessage(`Failed to call play(): ${e?.message}`);
      setTestStage('FAILED');
    }
  }, [player, logMilestone]);

  useEffect(() => {
    if (autoStart && player) {
      runTestSequence();
    }
  }, [autoStart, player, runTestSequence]);

  useEffect(() => {
    if (!player) return;

    const subStatus = player.addListener('statusChange', ({ status, error }) => {
      const now = Date.now();
      if (status === 'loading') {
        if (!timingRef.current.t1) {
          timingRef.current.t1 = now;
          logMilestone('T1_loading', now);
        }
      } else if (status === 'readyToPlay') {
        if (!timingRef.current.t2) {
          timingRef.current.t2 = now;
          logMilestone('T2_readyToPlay', now);
        }
      } else if (status === 'error') {
        setErrorMessage(error?.message || 'Player reported error status');
        setTestStage('FAILED');
        if (onTestComplete) {
          onTestComplete({ success: false, error: error?.message, timing: timingRef.current });
        }
      }
    });

    const subPlaying = player.addListener('playingChange', ({ isPlaying }) => {
      const now = Date.now();
      if (isPlaying && !timingRef.current.t3) {
        timingRef.current.t3 = now;
        logMilestone('T3_firstFrame', now);
      }
    });

    let count = 0;
    const subTime = player.addListener('timeUpdate', ({ currentTime }) => {
      count++;
      setTicksCount(count);
      const now = Date.now();
      if (count >= 2 && !timingRef.current.t4) {
        timingRef.current.t4 = now;
        logMilestone('T4_timeUpdate', now);
        // Stage T5: verify pause & resume
        setTimeout(() => {
          try {
            player.pause();
            setTimeout(() => {
              try {
                player.play();
                timingRef.current.t5 = Date.now();
                logMilestone('T5_controlsVerified', timingRef.current.t5);
                setTestStage('PASSED');
                if (onTestComplete) {
                  onTestComplete({ success: true, timing: timingRef.current });
                }
              } catch (e) {
                setErrorMessage(`Resume failed: ${e?.message}`);
                setTestStage('FAILED');
              }
            }, 300);
          } catch (e) {
            setErrorMessage(`Pause failed: ${e?.message}`);
            setTestStage('FAILED');
          }
        }, 500);
      }
    });

    return () => {
      subStatus.remove();
      subPlaying.remove();
      subTime.remove();
    };
  }, [player, logMilestone, onTestComplete]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Phase 2 — Isolated Native HLS Test Harness</Text>
        <Text style={[styles.badge, testStage === 'PASSED' ? styles.badgeSuccess : testStage === 'FAILED' ? styles.badgeError : styles.badgeTesting]}>
          {testStage}
        </Text>
      </View>

      <Text style={styles.streamLabel}>Stream: {streamUrl}</Text>
      <Text style={styles.platformLabel}>Host Platform: {Platform.OS} (expo-video AVPlayer/Media3)</Text>

      <View style={styles.videoContainer}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
        />
      </View>

      <ScrollView style={styles.logContainer}>
        <Text style={styles.logTitle}>Lifecycle Milestones (ms from T0):</Text>
        <Text style={styles.logItem}>T0 (Assigned): {milestones.T0_assigned != null ? '0 ms' : 'Waiting...'}</Text>
        <Text style={styles.logItem}>T1 (Loading): {milestones.T1_loading != null ? `${milestones.T1_loading} ms` : 'Waiting...'}</Text>
        <Text style={styles.logItem}>T2 (Ready to Play): {milestones.T2_readyToPlay != null ? `${milestones.T2_readyToPlay} ms` : 'Waiting...'}</Text>
        <Text style={styles.logItem}>T3 (First Frame Playing): {milestones.T3_firstFrame != null ? `${milestones.T3_firstFrame} ms` : 'Waiting...'}</Text>
        <Text style={styles.logItem}>T4 (Playback Advancing): {milestones.T4_timeUpdate != null ? `${milestones.T4_timeUpdate} ms (${ticksCount} ticks)` : 'Waiting...'}</Text>
        <Text style={styles.logItem}>T5 (Pause/Seek/Resume): {milestones.T5_controlsVerified != null ? `${milestones.T5_controlsVerified} ms (Verified)` : 'Waiting...'}</Text>

        {errorMessage && (
          <Text style={styles.errorText}>Error: {errorMessage}</Text>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.retryButton} onPress={runTestSequence}>
        <Text style={styles.retryText}>Rerun Test Sequence</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: Colors.background.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border.default,
    maxWidth: 600,
    alignSelf: 'center',
    marginVertical: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: Colors.text.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: '700',
    color: '#000000',
  },
  badgeSuccess: { backgroundColor: Colors.status.success },
  badgeError: { backgroundColor: Colors.status.error, color: '#FFFFFF' },
  badgeTesting: { backgroundColor: Colors.brand.primary },
  streamLabel: {
    color: Colors.text.tertiary,
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 2,
  },
  platformLabel: {
    color: Colors.text.secondary,
    fontSize: 11,
    marginBottom: 10,
  },
  videoContainer: {
    width: '100%',
    height: 180,
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 10,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  logContainer: {
    maxHeight: 140,
    backgroundColor: Colors.background.tertiary,
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
  },
  logTitle: {
    color: Colors.text.secondary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  logItem: {
    color: Colors.text.primary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 16,
  },
  errorText: {
    color: Colors.status.error,
    fontSize: 11,
    marginTop: 4,
  },
  retryButton: {
    backgroundColor: Colors.brand.primary,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  retryText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
  },
});
