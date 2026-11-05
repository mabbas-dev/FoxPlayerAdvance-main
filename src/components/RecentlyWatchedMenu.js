import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../state/AppContext';
import Colors from '../constants/colors';
import { ClockIcon } from './Icons';

export default function RecentlyWatchedMenu({ compact = false }) {
  const router = useRouter();
  const { activePlaylistId, isConfigured } = useApp();

  const openScreen = () => {
    if (!isConfigured || !activePlaylistId) return;
    router.push('/recently-watched');
  };

  return (
    <View>
      <TouchableOpacity
        style={[styles.button, compact && styles.buttonCompact]}
        onPress={openScreen}
        activeOpacity={0.8}
        accessibilityLabel="Recently watched"
        accessibilityRole="button"
      >
        <ClockIcon size={compact ? 14 : 16} color={Colors.brand.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border.default,
    backgroundColor: Colors?.surface?.elevated || Colors.background.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
});
