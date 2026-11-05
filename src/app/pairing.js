import React, { useEffect, useRef } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useApp } from '../state/AppContext';
import PairingScreen from '../screens/PairingScreen';
import { View } from 'react-native';

export default function PairingRoute() {
  const { isConfigured, isSyncing } = useApp();
  const router = useRouter();
  const params = useLocalSearchParams();
  const isAddMode = params?.mode === 'add';
  const wasSyncingRef = useRef(false);

  useEffect(() => {
    if (isSyncing) {
      wasSyncingRef.current = true;
    }
  }, [isSyncing]);

  useEffect(() => {
    if (!isAddMode) {
      if (isConfigured && !isSyncing) {
        router.replace('/(tabs)');
      }
    } else {
      // In add mode, return to tabs once a sync has been triggered and completed
      if (wasSyncingRef.current && !isSyncing && isConfigured) {
        router.replace('/(tabs)');
      }
    }
  }, [isConfigured, isSyncing, isAddMode, router]);

  if (isSyncing) {
    return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
  }

  return <PairingScreen isAddMode={isAddMode} />;
}
