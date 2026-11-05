import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Colors from '../constants/colors';
import FoxModal from './FoxModal';

export default function ClearHistoryConfirmModal({
  visible,
  onCancel,
  onConfirm,
  busy = false,
  title = 'Clear watch history?',
  message = 'This removes all recently watched movies and series for the current playlist. This cannot be undone.',
  confirmLabel = 'Clear all',
}) {
  return (
    <FoxModal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={() => {
        if (!busy) onCancel?.();
      }}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!busy) onCancel?.();
          }}
          accessibilityLabel="Dismiss dialog"
        />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.cancelBtn, busy && styles.btnDisabled]}
              onPress={onCancel}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, busy && styles.btnDisabled]}
              onPress={onConfirm}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.background.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 18,
    paddingVertical: 16,
    zIndex: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 10 },
    }),
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.text.secondary,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.surface.elevated,
    borderWidth: 1,
    borderColor: Colors.border.default,
    minWidth: 88,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text.secondary,
  },
  confirmBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.status.error,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
    minWidth: 108,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  confirmText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.65,
  },
});
