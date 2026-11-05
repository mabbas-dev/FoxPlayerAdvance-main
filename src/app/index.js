import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useApp } from '../state/AppContext';
import LoadingScreen from '../components/LoadingScreen';
import ProfilePickerModal from '../components/ProfilePickerModal';
import { REFRESH_STATE } from '../constants';

export default function IndexScreen() {
  const {
    isInitialized,
    isConfigured,
    initialize,
    deviceId,
    refreshState,
    profiles,
    activeProfile,
    selectProfile,
  } = useApp();
  const router = useRouter();
  const navigatedRef = useRef(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStep, setSelectionStep] = useState('');
  const [profilePickerVisible, setProfilePickerVisible] = useState(true);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isInitialized || navigatedRef.current) return;
    if (refreshState === REFRESH_STATE.EXPIRED) return;

    if (!isConfigured) {
      navigatedRef.current = true;
      const timer = setTimeout(() => {
        try {
          router.replace('/pairing');
        } catch (_e) {}
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isInitialized, isConfigured, refreshState, router]);

  useEffect(() => {
    if (isInitialized && isConfigured && refreshState !== REFRESH_STATE.EXPIRED) {
      setProfilePickerVisible(true);
    }
  }, [isInitialized, isConfigured, refreshState]);

  const handleSelectProfile = useCallback(async (profile) => {
    if (!profile?.id) return;
    setIsSelecting(true);
    setSelectionStep(`Loading ${profile.name || profile.playlist_name || 'Profile'}...`);

    try {
      const res = await selectProfile(profile);
      if (res && res.success) {
        navigatedRef.current = true;
        router.replace('/(tabs)');
      } else {
        setIsSelecting(false);
      }
    } catch (_err) {
      setIsSelecting(false);
    }
  }, [selectProfile, router]);

  const handleAddNewProfile = useCallback(() => {
    setProfilePickerVisible(false);
    requestAnimationFrame(() => {
      try {
        router.replace('/pairing?mode=add');
      } catch (_e) {}
    });
  }, [router]);

  const showProfilePicker = isInitialized && isConfigured && refreshState !== REFRESH_STATE.EXPIRED;

  return (
    <>
      <LoadingScreen
        step={selectionStep || 'Starting FOX PLAYER'}
        progress={isSelecting ? 0.6 : 0.1}
        deviceId={deviceId}
        showDeviceId={true}
      />
      {showProfilePicker && !isSelecting && profilePickerVisible && (
        <ProfilePickerModal
          visible={profilePickerVisible}
          profiles={profiles}
          activeProfileId={activeProfile?.id}
          onSelectProfile={handleSelectProfile}
          onAddNewProfile={handleAddNewProfile}
          isDismissable={false}
        />
      )}
    </>
  );
}
