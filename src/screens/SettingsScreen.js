import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Switch,
  useWindowDimensions,
} from 'react-native';
import FoxModal from '../components/FoxModal';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackArrowIcon } from '../components/Icons';
import { useApp } from '../state/AppContext';
import { useSubscription, SUBSCRIPTION_STATUS } from '../state/SubscriptionContext';
import SubscriptionDetailsModal from '../components/SubscriptionDetailsModal';
import PlaybackEngineModal from '../components/PlaybackEngineModal';
import { ENGINE_MODE, ENGINE_TYPE } from '../playback/playbackTypes';
import {
  getPlayerSettings,
  savePlayerSettings,
  resetPlayerSettings,
  subscribePlayerSettings,
  getAvailablePlayerEngines,
  validateEngineSelection,
  BUFFER_PROFILE,
} from '../playback/playerSettings';
import {
  setAdultPin,
  changeAdultPin,
  removeAdultPin,
  verifyAdultPin,
} from '../storage/pinStorage';
import { clearAllCache } from '../storage/cacheStorage';
import { APP_VERSION } from '../constants';
import Colors from '../constants/colors';
import NativePlayerTestHarness from '../components/NativePlayerTestHarness';
import { safeBack } from '../utils/navigation';

export default function SettingsScreen() {
  const {
    deviceId,
    installationId,
    configType,
    isConfigured,
    playlistConfig,
    activePlaylist,
    isSyncing,
    adultPinEnabled,
    idLock,
    toggleIdLock,
    reloadPlaylist,
    refreshAdultPinStatus,
    activeProfile,
    openProfilePicker,
  } = useApp();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isMultiColumn = windowWidth >= 720;

  const {
    subscription,
    subscriptionStatus,
    appExpiresAt,
    remainingDays,
    isSubscriptionValid,
    isTrialEligible,
    trialDurationDays,
    refreshSubscription,
    openTrialDisclaimer,
  } = useSubscription();

  const providerExpiryText = useMemo(() => {
    if (!isConfigured) return 'Not connected';
    const isM3u = configType === 'm3u' || playlistConfig?.type === 'm3u' || playlistConfig?.config?.type === 'm3u';
    if (isM3u) return 'Unlimited (M3U)';
    const rawExp = playlistConfig?.expirationDate || playlistConfig?.config?.expirationDate || activePlaylist?.expirationDate;
    if (!rawExp) return 'Not provided';
    if (/^\d+$/.test(String(rawExp))) {
      const num = parseInt(rawExp, 10);
      const ms = num > 1e11 ? num : num * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    return String(rawExp);
  }, [isConfigured, configType, playlistConfig, activePlaylist]);

  const [isUpdatingIdLock, setIsUpdatingIdLock] = useState(false);
  const [showPinModal, setShowPinModal] = useState(null); // 'set' | 'change' | 'disable'
  const [pin, setPin] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);
  const [showSubscriptionDetailsModal, setShowSubscriptionDetailsModal] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);

  // Live Player Settings
  const [playerSettings, setPlayerSettingsState] = useState(getPlayerSettings());

  useEffect(() => {
    const unsub = subscribePlayerSettings((settings) => {
      setPlayerSettingsState(settings);
    });
    return unsub;
  }, []);

  const availableEngines = useMemo(() => {
    const activeType = playerSettings.preferredEngine === ENGINE_MODE.VLC ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE;
    return getAvailablePlayerEngines(activeType);
  }, [playerSettings.preferredEngine]);


  const formatDate = (ts) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleString();
  };

  const handleReload = async () => {
    try {
      await reloadPlaylist(null, { isManual: true });
      router.replace('/(tabs)');
    } catch (_e) {}
  };

  const handleSelectEngine = async (mode) => {
    const validation = validateEngineSelection(mode);
    if (!validation.valid) {
      Alert.alert('Engine Unavailable', validation.error);
      return;
    }
    try {
      const res = await savePlayerSettings({ preferredEngine: mode });
      if (!res.success && res.error) {
        Alert.alert('Configuration Error', res.error);
      }
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to update player preference.');
    }
  };

  const handleUpdateSetting = async (partial) => {
    try {
      await savePlayerSettings(partial);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to save playback setting.');
    }
  };

  const handleResetDefaults = () => {
    Alert.alert(
      'Restore Defaults',
      'Reset all playback and player settings to factory defaults?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            await resetPlayerSettings();
            Alert.alert('Success', 'Playback settings restored to factory defaults.');
          },
        },
      ]
    );
  };

  const handleSetPin = async () => {
    setPinError('');
    if (pin.length !== 4) { setPinError('PIN must be exactly 4 digits.'); return; }
    if (pin !== confirmPin) { setPinError('PINs do not match.'); return; }
    setPinLoading(true);
    try {
      await setAdultPin(pin);
      await refreshAdultPinStatus();
      setShowPinModal(null);
      setPin(''); setConfirmPin('');
      Alert.alert('Success', 'Adult content PIN has been set.');
    } catch (e) {
      setPinError(e.message);
    } finally {
      setPinLoading(false);
    }
  };

  const handleChangePin = async () => {
    setPinError('');
    if (oldPin.length !== 4) { setPinError('Current PIN must be 4 digits.'); return; }
    if (pin.length !== 4) { setPinError('New PIN must be exactly 4 digits.'); return; }
    if (pin !== confirmPin) { setPinError('PINs do not match.'); return; }
    setPinLoading(true);
    try {
      await changeAdultPin(oldPin, pin);
      await refreshAdultPinStatus();
      setShowPinModal(null);
      setPin(''); setOldPin(''); setConfirmPin('');
      Alert.alert('Success', 'PIN changed successfully.');
    } catch (e) {
      setPinError(e.message);
    } finally {
      setPinLoading(false);
    }
  };

  const handleDisablePin = async () => {
    setPinError('');
    if (pin.length !== 4) { setPinError('PIN must be 4 digits.'); return; }
    setPinLoading(true);
    try {
      const ok = await verifyAdultPin(pin);
      if (!ok) {
        setPinError('Incorrect PIN.');
        setPinLoading(false);
        return;
      }
      await removeAdultPin();
      await refreshAdultPinStatus();
      setShowPinModal(null);
      setPin('');
      Alert.alert('Success', 'Adult content PIN has been removed.');
    } catch (e) {
      setPinError(e.message);
    } finally {
      setPinLoading(false);
    }
  };

  const handleClearCache = async () => {
    Alert.alert(
      'Clear Cache',
      'This will clear local cache and re-sync device status. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllCache();
              Alert.alert('Success', 'Cache cleared successfully.');
            } catch (_e) {
              Alert.alert('Error', 'Failed to clear cache.');
            }
          },
        },
      ]
    );
  };

  // Column 1: System & Provider Connection
  const renderColumn1 = () => (
    <>
      <SettingsSection title="Profiles">
        <SettingsRow label="Active Profile" value={activeProfile?.name || activePlaylist?.name || 'Primary Profile'} />
        <SettingsRow label="Playlist Format" value={activeProfile?.type === 'm3u' ? 'M3U Playlist' : 'Xtream Codes'} />
        <TouchableOpacity
          style={styles.switchProfileSettingsBtn}
          onPress={() => {
            if (typeof openProfilePicker === 'function') {
              openProfilePicker();
            }
          }}
          activeOpacity={0.75}
        >
          <Text style={styles.switchProfileSettingsBtnText}>Switch Profile</Text>
        </TouchableOpacity>
      </SettingsSection>

      <SettingsSection title="Device & Subscription">
        <SettingsRow label="Device ID" value={deviceId || 'Unknown'} mono />
        <SettingsRow
          label="Installation UUID"
          value={installationId ? `${installationId.slice(0, 8)}...${installationId.slice(-4)}` : 'Not registered'}
          mono
        />
        <SettingsRow
          label="App Subscription"
          value={
            subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE_TRIAL
              ? `${subscription?.duration_days || 7}-Day Free Trial`
              : subscriptionStatus === SUBSCRIPTION_STATUS.ACTIVE_PAID
              ? 'Paid Subscription'
              : subscriptionStatus === SUBSCRIPTION_STATUS.TRIAL_AVAILABLE
              ? 'Free Trial Available'
              : subscriptionStatus === SUBSCRIPTION_STATUS.EXPIRED
              ? 'Subscription Expired'
              : 'Free Trial'
          }
        />
        <SettingsRow
          label="App Status"
          value={
            isSubscriptionValid
              ? `Active (${remainingDays}d remaining)`
              : subscriptionStatus === SUBSCRIPTION_STATUS.TRIAL_AVAILABLE
              ? `Eligible (${trialDurationDays} Days)`
              : subscriptionStatus === SUBSCRIPTION_STATUS.EXPIRED
              ? 'Expired'
              : 'Inactive'
          }
        />
        <TouchableOpacity
          onPress={() => setShowSubscriptionDetailsModal(true)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="View subscription and expiry details"
        >
          <SettingsRow
            label="App Expiry"
            value={appExpiresAt ? formatDate(appExpiresAt) : (isTrialEligible ? 'Available upon activation' : 'N/A')}
          />
        </TouchableOpacity>
        {isTrialEligible && !isSubscriptionValid && (
          <TouchableOpacity
            style={styles.actionRow}
            onPress={openTrialDisclaimer}
            activeOpacity={0.8}
          >
            <Text style={[styles.actionRowLabel, { color: Colors.brand.primary }]}>Activate Free Trial</Text>
            <Text style={styles.actionRowChevron}>&gt;</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={async () => {
            const refreshed = await refreshSubscription();
            if (refreshed) {
              Alert.alert(
                'Subscription Checked',
                `Status: ${String(refreshed.status || '').toUpperCase()}\nValid: ${refreshed.is_valid ? 'Yes' : 'No'}\nApp Expiry: ${refreshed.expires_at ? new Date(refreshed.expires_at).toLocaleString() : 'N/A'}`
              );
            } else if (isTrialEligible) {
              Alert.alert(
                'Trial Eligible',
                `Your device is eligible for a ${trialDurationDays}-day free trial.\nTap "Activate Free Trial" to begin.`
              );
            } else {
              Alert.alert('Subscription Checked', 'Unable to reach backend subscription server.');
            }
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.actionRowLabel}>Refresh Subscription</Text>
          <Text style={styles.actionRowChevron}>&gt;</Text>
        </TouchableOpacity>
      </SettingsSection>

      <SettingsSection title="IPTV Source">
        <SettingsRow label="Source Type" value={configType ? configType.toUpperCase() : 'Not configured'} />
        <SettingsRow label="Status" value={isConfigured ? 'Connected' : 'Not connected'} />
        <SettingsRow label="Provider Expiry" value={providerExpiryText} />
        <TouchableOpacity
          style={[styles.actionRow, isSyncing && styles.actionRowDisabled]}
          onPress={handleReload}
          disabled={isSyncing}
          activeOpacity={0.8}
        >
          {isSyncing ? (
            <View style={styles.actionRowContent}>
              <ActivityIndicator color={Colors.brand.primary} size="small" />
              <Text style={styles.actionRowLabel}>Reloading...</Text>
            </View>
          ) : (
            <Text style={styles.actionRowLabel}>Reload Playlist</Text>
          )}
          <Text style={styles.actionRowChevron}>&gt;</Text>
        </TouchableOpacity>
      </SettingsSection>
    </>
  );

  // Column 2: Dedicated Playback & Player Engine Settings
  const renderColumn2 = () => (
    <>
      <SettingsSection title="Playback">
        <Text style={styles.subSectionTitle}>STREAMING & STABILITY</Text>

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <Text style={styles.settingsRowLabel} numberOfLines={1}>Automatic Fallback</Text>
            <Text style={styles.toggleSubtitle} numberOfLines={1}>
              Auto-switch if stream codec fails
            </Text>
          </View>
          <Switch
            value={playerSettings.autoFallbackEnabled}
            onValueChange={(val) => handleUpdateSetting({ autoFallbackEnabled: val })}
            trackColor={{ false: '#262D3D', true: Colors.brand.primary }}
            thumbColor={playerSettings.autoFallbackEnabled ? '#FFFFFF' : '#8A92A6'}
            style={styles.switchControl}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <Text style={styles.settingsRowLabel} numberOfLines={1}>Retry Dropped Streams</Text>
            <Text style={styles.toggleSubtitle} numberOfLines={1}>
              Auto-reconnect on network timeout
            </Text>
          </View>
          <Switch
            value={playerSettings.retryFailedStreams}
            onValueChange={(val) => handleUpdateSetting({ retryFailedStreams: val })}
            trackColor={{ false: '#262D3D', true: Colors.brand.primary }}
            thumbColor={playerSettings.retryFailedStreams ? '#FFFFFF' : '#8A92A6'}
            style={styles.switchControl}
          />
        </View>

        {/* Max Retry Attempts */}
        <View style={styles.selectorStackedRow}>
          <View style={styles.selectorHeaderCol}>
            <Text style={styles.settingsRowLabel} numberOfLines={1}>Max Retry Attempts</Text>
            <Text style={styles.toggleSubtitle} numberOfLines={1}>Sequential reconnection limit</Text>
          </View>
          <View style={styles.pillGroup}>
            {[
              { count: 1, label: '1x' },
              { count: 2, label: '2x' },
              { count: 3, label: '3x' },
              { count: 5, label: '5x' },
            ].map(({ count, label }) => {
              const isCur = (playerSettings.maxRetryAttempts || 3) === count;
              return (
                <TouchableOpacity
                  key={count}
                  style={[styles.pillBtn, styles.pillBtnFlex, isCur && styles.pillBtnSelected]}
                  onPress={() => handleUpdateSetting({ maxRetryAttempts: count })}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillBtnText, isCur && styles.pillBtnTextSelected]} numberOfLines={1}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Buffering Behavior */}
        <View style={styles.selectorStackedRow}>
          <View style={styles.selectorHeaderCol}>
            <Text style={styles.settingsRowLabel} numberOfLines={1}>Buffering Profile</Text>
            <Text style={styles.toggleSubtitle} numberOfLines={1}>Stream cache vs startup delay</Text>
          </View>
          <View style={styles.pillGroup}>
            {[
              { id: BUFFER_PROFILE.LOW_LATENCY, label: 'Fast' },
              { id: BUFFER_PROFILE.NORMAL, label: 'Standard' },
              { id: BUFFER_PROFILE.STABLE, label: 'Stable' },
            ].map((prof) => {
              const isCur = (playerSettings.bufferProfile || BUFFER_PROFILE.NORMAL) === prof.id;
              return (
                <TouchableOpacity
                  key={prof.id}
                  style={[styles.pillBtn, styles.pillBtnFlex, isCur && styles.pillBtnSelected]}
                  onPress={() => handleUpdateSetting({ bufferProfile: prof.id })}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pillBtnText, isCur && styles.pillBtnTextSelected]} numberOfLines={1}>
                    {prof.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <Text style={styles.settingsRowLabel} numberOfLines={1}>Remember Selection</Text>
            <Text style={styles.toggleSubtitle} numberOfLines={1}>
              Persist player engine across restarts
            </Text>
          </View>
          <Switch
            value={playerSettings.rememberPlayerPreference}
            onValueChange={(val) => handleUpdateSetting({ rememberPlayerPreference: val })}
            trackColor={{ false: '#262D3D', true: Colors.brand.primary }}
            thumbColor={playerSettings.rememberPlayerPreference ? '#FFFFFF' : '#8A92A6'}
            style={styles.switchControl}
          />
        </View>

        {/* Restore Defaults */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={handleResetDefaults}
          activeOpacity={0.8}
        >
          <Text style={[styles.actionRowLabel, { color: Colors.brand.primary }]} numberOfLines={1}>
            Restore Playback Defaults
          </Text>
          <Text style={styles.actionRowChevron}>&gt;</Text>
        </TouchableOpacity>

        {/* Diagnostics Modal Trigger */}
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => setShowDiagnosticModal(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.actionRowLabel} numberOfLines={1}>Native Diagnostics</Text>
          <Text style={styles.actionRowChevron}>&gt;</Text>
        </TouchableOpacity>
      </SettingsSection>
    </>
  );

  // Column 3: Security, Data & Storage, Version Info
  const renderColumn3 = () => (
    <>
      <SettingsSection title="Security">
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <Text style={styles.settingsRowLabel}>ID Lock</Text>
            <Text style={styles.toggleSubtitle}>
              {idLock
                ? 'Locked: Website cannot add/remove playlists'
                : 'Unlocked: Website can manage playlists'}
            </Text>
          </View>
          {isUpdatingIdLock ? (
            <ActivityIndicator size="small" color={Colors.brand.primary} />
          ) : (
            <Switch
              value={idLock}
              onValueChange={async (newVal) => {
                setIsUpdatingIdLock(true);
                try {
                  await toggleIdLock(newVal);
                } catch (err) {
                  Alert.alert('Error', err?.message || 'Failed to update ID Lock on server.');
                } finally {
                  setIsUpdatingIdLock(false);
                }
              }}
              trackColor={{ false: '#262D3D', true: Colors.brand.primary }}
              thumbColor={idLock ? '#FFFFFF' : '#8A92A6'}
            />
          )}
        </View>

        <SettingsRow label="Adult PIN" value={adultPinEnabled ? 'Enabled' : 'Disabled'} />
        {!adultPinEnabled ? (
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => { setShowPinModal('set'); setPin(''); setConfirmPin(''); setPinError(''); }}
            activeOpacity={0.8}
          >
            <Text style={styles.actionRowLabel}>Set PIN</Text>
            <Text style={styles.actionRowChevron}>&gt;</Text>
          </TouchableOpacity>
        ) : (
          <View>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => { setShowPinModal('change'); setOldPin(''); setPin(''); setConfirmPin(''); setPinError(''); }}
              activeOpacity={0.8}
            >
              <Text style={styles.actionRowLabel}>Change PIN</Text>
              <Text style={styles.actionRowChevron}>&gt;</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => { setShowPinModal('disable'); setPin(''); setPinError(''); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.actionRowLabel, { color: Colors.status.error }]}>Disable PIN</Text>
              <Text style={styles.actionRowChevron}>&gt;</Text>
            </TouchableOpacity>
          </View>
        )}
      </SettingsSection>

      <SettingsSection title="Data & Storage">
        <TouchableOpacity style={styles.actionRow} onPress={handleClearCache} activeOpacity={0.8}>
          <Text style={[styles.actionRowLabel, { color: Colors.status.error }]}>Clear Cache</Text>
          <Text style={styles.actionRowChevron}>&gt;</Text>
        </TouchableOpacity>
      </SettingsSection>

      <SettingsSection title="About Us">
        <SettingsRow label="Application" value="FOX PLAYER" />
        <SettingsRow label="Version" value={APP_VERSION} />
        <SettingsRow label="Build" value="Production" />
      </SettingsSection>
    </>
  );

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: 4,
          paddingBottom: Math.max(insets.bottom, 4),
          paddingLeft: Math.max(insets.left, 16),
          paddingRight: Math.max(insets.right, 16),
        },
      ]}
    >
      {/* Pinned Top Toolbar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => safeBack(router)}
          activeOpacity={0.8}
        >
          <BackArrowIcon size={16} color={Colors.brand.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* Responsive Settings Layout */}
      {isMultiColumn ? (
        // 3-Column Grid for Landscape / TV / Tablet
        <View style={styles.settingsGrid}>
          <ScrollView style={styles.settingsCol} showsVerticalScrollIndicator={false} contentContainerStyle={styles.colContent}>
            {renderColumn1()}
          </ScrollView>
          <ScrollView style={styles.settingsCol} showsVerticalScrollIndicator={false} contentContainerStyle={styles.colContent}>
            {renderColumn2()}
          </ScrollView>
          <ScrollView style={styles.settingsCol} showsVerticalScrollIndicator={false} contentContainerStyle={styles.colContent}>
            {renderColumn3()}
          </ScrollView>
        </View>
      ) : (
        // Single-Column Scrollable for Mobile Phones
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.colContent}>
          {renderColumn1()}
          {renderColumn2()}
          {renderColumn3()}
        </ScrollView>
      )}

      {/* PIN Modals */}
      {showPinModal && (
        <FoxModal
          visible={true}
          transparent
          animationType="fade"
          statusBarTranslucent={true}
          onRequestClose={() => setShowPinModal(null)}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {showPinModal === 'set' && (
              <PinModal
                title="Set Adult Content PIN"
                onCancel={() => setShowPinModal(null)}
                onConfirm={handleSetPin}
                loading={pinLoading}
                error={pinError}
                confirmLabel="Set PIN"
              >
                <PinInput label="New 4-Digit PIN" value={pin} onChange={setPin} />
                <PinInput label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} />
              </PinModal>
            )}
            {showPinModal === 'change' && (
              <PinModal
                title="Change Adult PIN"
                onCancel={() => setShowPinModal(null)}
                onConfirm={handleChangePin}
                loading={pinLoading}
                error={pinError}
                confirmLabel="Change PIN"
              >
                <PinInput label="Current PIN" value={oldPin} onChange={setOldPin} />
                <PinInput label="New 4-Digit PIN" value={pin} onChange={setPin} />
                <PinInput label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} />
              </PinModal>
            )}
            {showPinModal === 'disable' && (
              <PinModal
                title="Disable Adult PIN"
                onCancel={() => setShowPinModal(null)}
                onConfirm={handleDisablePin}
                loading={pinLoading}
                error={pinError}
                confirmLabel="Disable PIN"
                confirmDanger
              >
                <PinInput label="Enter Current PIN to Disable" value={pin} onChange={setPin} />
              </PinModal>
            )}
          </KeyboardAvoidingView>
        </FoxModal>
      )}

      {/* Native Player Diagnostics Modal (ONLY shown when opened) */}
      {showDiagnosticModal && (
        <FoxModal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setShowDiagnosticModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { maxWidth: 640, maxHeight: '90%' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={styles.modalTitle}>Native Player Diagnostics</Text>
                <TouchableOpacity
                  onPress={() => setShowDiagnosticModal(false)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <NativePlayerTestHarness autoStart={true} />
              </ScrollView>
              <TouchableOpacity
                style={[styles.modalCancel, { marginTop: 12 }]}
                onPress={() => setShowDiagnosticModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Close Diagnostics</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FoxModal>
      )}

      {/* Subscription Details Modal */}
      <SubscriptionDetailsModal
        visible={showSubscriptionDetailsModal}
        onClose={() => setShowSubscriptionDetailsModal(false)}
      />

      {/* Dual Playback Engine Selection Modal */}
      <PlaybackEngineModal
        visible={showEngineModal}
        activeEngineType={playerSettings.preferredEngine === ENGINE_MODE.VLC ? ENGINE_TYPE.VLC : ENGINE_TYPE.NATIVE}
        engineMode={playerSettings.preferredEngine}
        onSelectMode={handleSelectEngine}
        onSwitchEngine={handleSelectEngine}
        onClose={() => setShowEngineModal(false)}
        onDismiss={() => setShowEngineModal(false)}
      />
    </View>
  );
}

function SettingsSection({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionBody}>
        {children}
      </View>
    </View>
  );
}

function SettingsRow({ label, value, mono = false }) {
  return (
    <View style={styles.settingsRow}>
      <Text style={styles.settingsRowLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.settingsRowValue, mono && styles.settingsRowMono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function PinModal({ title, children, onCancel, onConfirm, loading, error, confirmLabel = 'Save', confirmDanger = false }) {
  return (
    <View style={styles.modalBox}>
      <Text style={styles.modalTitle}>{title}</Text>
      {children}
      {!!error && <Text style={styles.modalError}>{error}</Text>}
      <View style={styles.modalActions}>
        <TouchableOpacity style={styles.modalCancel} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.modalCancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modalConfirm, confirmDanger && styles.modalConfirmDanger]}
          onPress={onConfirm}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color={confirmDanger ? '#FFFFFF' : '#000000'} size="small" />
            : <Text style={[styles.modalConfirmText, confirmDanger && styles.modalConfirmDangerText]}>{confirmLabel}</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PinInput({ label, value, onChange }) {
  return (
    <View style={styles.pinInputRow}>
      <Text style={styles.pinInputLabel}>{label}</Text>
      <TextInput
        style={styles.pinInput}
        value={value}
        onChangeText={(txt) => onChange(txt.replace(/[^0-9]/g, '').slice(0, 4))}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={4}
        placeholderTextColor={Colors.text.tertiary}
        placeholder="Enter 4-digit PIN"
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    width: 120,
    height: 32,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 6,
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  settingsGrid: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  settingsCol: {
    flex: 1,
    minWidth: 0,
  },
  colContent: {
    paddingBottom: 36,
  },
  section: {
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text.tertiary,
    letterSpacing: 1.2,
    marginBottom: 3,
  },
  subSectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.text.tertiary,
    letterSpacing: 1.1,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  sectionBody: {
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border.subtle,
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5.5,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
    gap: 6,
  },
  settingsRowLabel: {
    fontSize: 11.5,
    color: Colors.text.primary,
    fontWeight: '500',
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  settingsRowValue: {
    fontSize: 11,
    color: Colors.text.secondary,
    maxWidth: '55%',
    textAlign: 'right',
    flexShrink: 0,
  },
  settingsRowMono: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: Colors.brand.primary,
    fontSize: 11,
    letterSpacing: 1,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
    gap: 6,
  },
  actionRowDisabled: { opacity: 0.6 },
  actionRowContent: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  actionRowLabel: {
    fontSize: 11.5,
    color: Colors.brand.primary,
    fontWeight: '600',
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  switchProfileSettingsBtn: {
    backgroundColor: Colors.brand.glow,
    borderWidth: 1,
    borderColor: Colors.brand.primary,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 4,
  },
  switchProfileSettingsBtnText: {
    color: Colors.brand.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  actionRowChevron: {
    color: Colors.text.tertiary,
    fontSize: 11,
    flexShrink: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
    gap: 8,
  },
  toggleTextCol: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  toggleSubtitle: {
    fontSize: 9.5,
    color: Colors.text.tertiary,
    marginTop: 1,
    lineHeight: 12,
  },
  switchControl: {
    flexShrink: 0,
    transform: Platform.OS === 'ios' ? [{ scaleX: 0.8 }, { scaleY: 0.8 }] : [{ scaleX: 0.9 }, { scaleY: 0.9 }],
  },
  selectorStackedRow: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
  },
  selectorHeaderCol: {
    marginBottom: 5,
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
  },
  pillGroup: {
    flexDirection: 'row',
    gap: 5,
    width: '100%',
  },
  pillBtn: {
    backgroundColor: '#1E222D',
    paddingHorizontal: 4,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtnFlex: {
    flex: 1,
    minWidth: 0,
  },
  pillBtnSelected: {
    backgroundColor: Colors.brand.primary,
    borderColor: Colors.brand.primary,
  },
  pillBtnText: {
    color: '#8A92A6',
    fontSize: 10.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  pillBtnTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  // Player Cards UI
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.subtle,
    backgroundColor: 'transparent',
  },
  playerCardSelected: {
    backgroundColor: 'rgba(229, 9, 20, 0.08)',
  },
  playerCardDisabled: {
    opacity: 0.55,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  radioCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#4A5063',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  radioCircleSelected: {
    borderColor: Colors.brand.primary,
  },
  radioCircleDisabled: {
    borderColor: '#262D3D',
  },
  radioDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.brand.primary,
  },
  playerCardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C4C9D6',
    flex: 1,
    flexShrink: 1,
  },
  playerCardTitleSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  playerCardTitleDisabled: {
    color: '#555C6E',
  },
  disabledTagText: {
    color: '#606678',
    fontSize: 9.5,
    fontWeight: '600',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 3,
    marginLeft: 6,
    flexShrink: 0,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.brand.primary,
    marginLeft: 6,
    flexShrink: 0,
  },
  distinctionLabel: {
    color: '#8A92A6',
    fontSize: 10.5,
    flexShrink: 0,
  },
  distinctionValue: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalBox: {
    width: '90%',
    maxWidth: 420,
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text.primary,
    marginBottom: 10,
    textAlign: 'center',
  },
  modalError: {
    color: Colors.status.error,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    alignItems: 'center',
  },
  modalCancelText: { color: Colors.text.secondary, fontWeight: '600', fontSize: 13 },
  modalConfirm: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
  },
  modalConfirmDanger: { backgroundColor: Colors.status.error },
  modalConfirmText: { color: '#000000', fontWeight: '700', fontSize: 13 },
  modalConfirmDangerText: { color: '#FFFFFF' },
  pinInputRow: { marginBottom: 12 },
  pinInputLabel: { fontSize: 11, color: Colors.text.tertiary, marginBottom: 4 },
  pinInput: {
    backgroundColor: Colors.background.tertiary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text.primary,
    borderWidth: 1,
    borderColor: Colors.border.subtle,
    letterSpacing: 3,
  },
});
