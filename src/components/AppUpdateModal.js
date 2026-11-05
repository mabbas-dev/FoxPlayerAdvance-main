import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  ScrollView,
  Platform,
} from 'react-native';
import FoxModal from './FoxModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '../constants/colors';
import { APP_VERSION, APP_BUILD } from '../constants';

export default function AppUpdateModal({ visible, forceUpdate, latest, onDismiss }) {
  const insets = useSafeAreaInsets();
  if (!visible || !latest) return null;

  const openStore = () => {
    const url = latest.store_url;
    if (url && /^https?:\/\//i.test(String(url))) {
      Linking.openURL(url).catch(() => {});
    }
  };

  const hasValidStoreUrl = latest.store_url && /^https?:\/\//i.test(String(latest.store_url));

  return (
    <FoxModal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={forceUpdate ? undefined : onDismiss}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <Text style={styles.title}>{forceUpdate ? 'Update required' : 'Update available'}</Text>
          <Text style={styles.subtitle}>
            Version {latest.version_name} (build {latest.version_code}) is available. You are on {APP_VERSION}
            {Platform.OS !== 'web' ? ` (build ${APP_BUILD})` : ''}.
          </Text>
          {latest.release_notes ? (
            <ScrollView style={styles.notesBox}>
              <Text style={styles.notes}>{latest.release_notes}</Text>
            </ScrollView>
          ) : null}
          <View style={styles.actions}>
            {hasValidStoreUrl ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={openStore}>
                <Text style={styles.primaryText}>Update now</Text>
              </TouchableOpacity>
            ) : forceUpdate ? (
              <Text style={styles.storeHint}>
                Install the latest build from your provider. This version cannot continue until you update.
              </Text>
            ) : null}
            {!forceUpdate ? (
              <TouchableOpacity style={styles.secondaryBtn} onPress={onDismiss}>
                <Text style={styles.secondaryText}>{hasValidStoreUrl ? 'Later' : 'Continue'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Colors.background.secondary,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text.primary, marginBottom: 8 },
  subtitle: { fontSize: 14, color: Colors.text.secondary, marginBottom: 16, lineHeight: 20 },
  notesBox: { maxHeight: 120, marginBottom: 16 },
  notes: { fontSize: 13, color: Colors.text.secondary, lineHeight: 18 },
  actions: { gap: 10 },
  primaryBtn: {
    backgroundColor: Colors.brand.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: { color: '#000', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: Colors.text.secondary, fontSize: 15 },
  storeHint: { fontSize: 13, color: Colors.text.secondary, lineHeight: 18, marginBottom: 4, textAlign: 'center' },
});
