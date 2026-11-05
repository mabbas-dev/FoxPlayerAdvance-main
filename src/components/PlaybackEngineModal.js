/**
 * FOX PLAYER — Playback Engine Selection Modal
 *
 * Minimalist, modern "Khaali UI" design:
 * - Clean dark surface with zero visual clutter
 * - No SVG icons/logos
 * - Minimized, essential text
 * - Instant selection and seamless engine switching
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import FoxModal from './FoxModal';
import Colors from '../constants/colors';
import { ENGINE_MODE, ENGINE_TYPE } from '../playback/playbackTypes';
import { getAvailablePlayerEngines } from '../playback/playerSettings';

export default function PlaybackEngineModal({
  visible = false,
  onClose,
  onDismiss,
  engineMode = ENGINE_MODE.AUTO,
  activeEngineType = ENGINE_TYPE.NATIVE,
  onSelectMode,
  onSwitchEngine,
  isSwitching = false,
}) {
  const handleClose = onClose || onDismiss || (() => {});

  const availableEngines = useMemo(() => {
    return getAvailablePlayerEngines(activeEngineType);
  }, [activeEngineType, visible]);

  if (!visible) return null;

  const handleSelect = (selectedId) => {
    try {
      const target = availableEngines.find((e) => e.id === selectedId);
      if (target && target.isAvailable === false) {
        return;
      }
      if (typeof onSelectMode === 'function') {
        onSelectMode(selectedId);
      } else if (typeof onSwitchEngine === 'function') {
        const targetEngine = selectedId === ENGINE_MODE.VLC ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
        if (targetEngine !== activeEngineType) {
          onSwitchEngine(targetEngine);
        }
      }
      handleClose();
    } catch (_err) {}
  };

  return (
    <FoxModal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback onPress={(e) => e?.stopPropagation?.()}>
            <View style={styles.modalCard}>
              {/* Header: Clean Minimalist Title + Simple Close Text */}
              <View style={styles.header}>
                <Text style={styles.title}>Playback Engine</Text>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={handleClose}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.closeText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Minimal Engine Options */}
              <View style={styles.optionsList}>
                {availableEngines.map((item) => {
                  const isSelected = engineMode === item.id;
                  const isAvailable = item.isAvailable !== false;
                  const displayName = item.id === ENGINE_MODE.AUTO
                    ? 'Auto'
                    : item.id === ENGINE_MODE.NATIVE
                      ? (Platform.OS === 'ios' ? 'Native Player (AVPlayer)' : 'Native Player (ExoPlayer)')
                      : 'VLC Player';

                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.optionRow,
                        isSelected && styles.optionRowSelected,
                        !isAvailable && styles.optionRowDisabled,
                      ]}
                      onPress={() => isAvailable && handleSelect(item.id)}
                      disabled={!isAvailable}
                      activeOpacity={isAvailable ? 0.75 : 1}
                    >
                      <View style={styles.optionTitleRow}>
                        <Text
                          style={[
                            styles.optionTitle,
                            isSelected && styles.optionTitleSelected,
                            !isAvailable && styles.optionTitleDisabled,
                          ]}
                        >
                          {displayName}
                        </Text>
                        {!isAvailable && (
                          <Text style={styles.disabledBadge}>Disabled</Text>
                        )}
                      </View>

                      {/* Pure CSS Radio Indicator (No SVGs) */}
                      <View
                        style={[
                          styles.radioCircle,
                          isSelected && styles.radioCircleSelected,
                          !isAvailable && styles.radioCircleDisabled,
                        ]}
                      >
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#111215',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: '#8A92A6',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 14,
  },
  optionsList: {
    gap: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  optionRowSelected: {
    backgroundColor: 'rgba(229, 9, 20, 0.08)',
    borderColor: Colors.brand.primary,
  },
  optionTitle: {
    color: '#C0C5D0',
    fontSize: 14,
    fontWeight: '500',
  },
  optionTitleSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#4A5060',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: Colors.brand.primary,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.brand.primary,
  },
  optionRowDisabled: {
    opacity: 0.42,
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
    borderColor: 'transparent',
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexShrink: 1,
  },
  optionTitleDisabled: {
    color: '#555C6E',
  },
  disabledBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: '#606678',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  radioCircleDisabled: {
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
});
