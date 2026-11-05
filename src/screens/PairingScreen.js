import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Image,
  ScrollView,
  Linking,
  TextInput,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import FoxModal from '../components/FoxModal';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import { PAIRING_BASE_URL } from '../constants';
import Colors from '../constants/colors';
import { RefreshIcon, BackArrowIcon, PlusIcon } from '../components/Icons';
import { useRouter } from 'expo-router';
import { getDevicePairingToken, addDevicePlaylist } from '../services/apiService';
import { validateAndNormalizeM3UUrl, parseXtreamCredentialsFromUrl } from '../utils/m3uUrlHelpers';
import { safeBack } from '../utils/navigation';
import { normalizeServerUrl, xtreamAuthenticate } from '../services/xtreamService';
import { persistPlaylistPassword } from '../storage/playlistStorage';
import { getUserFriendlyErrorMessage } from '../services/networkErrors';

export default function PairingScreen({ isAddMode = false }) {
  const { deviceId, isSyncing, syncStep, syncError, reloadPlaylist, pairingToken, pairingCode } = useApp();
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [localPairingCode, setLocalPairingCode] = useState(pairingCode);
  const [localPairingToken, setLocalPairingToken] = useState(pairingToken);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Manual In-App Add Playlist Modal State
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('m3u'); // 'xtream' | 'm3u'
  const [playlistName, setPlaylistName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [m3uUrl, setM3uUrl] = useState('');
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (pairingCode) setLocalPairingCode(pairingCode);
    if (pairingToken) setLocalPairingToken(pairingToken);
  }, [pairingCode, pairingToken]);

  useEffect(() => {
    if (deviceId && (!localPairingCode || !localPairingToken)) {
      getDevicePairingToken(deviceId)
        .then((res) => {
          if (res?.success) {
            if (res.pairing_code) setLocalPairingCode(res.pairing_code);
            if (res.pairing_token) setLocalPairingToken(res.pairing_token);
          }
        })
        .catch(() => {});
    }
  }, [deviceId, localPairingCode, localPairingToken]);

  const pairingUrl = deviceId
    ? `${PAIRING_BASE_URL}/manage?device_id=${deviceId}${localPairingToken ? `&token=${localPairingToken}` : ''}`
    : null;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  const handleOpenWebsite = async () => {
    if (pairingUrl) {
      try {
        await Linking.openURL(pairingUrl);
      } catch (e) {
        console.warn('[Pairing] Unable to open URL:', e);
      }
    }
  };

  const handleReload = async () => {
    await reloadPlaylist(null, { isManual: true });
  };

  const resetForm = () => {
    setPlaylistName('');
    setServerUrl('');
    setUsername('');
    setPassword('');
    setM3uUrl('');
    setFormError(null);
    setIsSubmitting(false);
  };

  const handleOpenModal = () => {
    resetForm();
    setIsModalVisible(true);
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    try { Keyboard.dismiss(); } catch (_e) {}
    setIsModalVisible(false);
    resetForm();
  };

  const handleSubmitPlaylist = async () => {
    if (isSubmitting) return;
    try { Keyboard.dismiss(); } catch (_e) {}
    setFormError(null);

    const name = playlistName.trim();

    if (activeTab === 'm3u') {
      let normalizedUrl;
      try {
        normalizedUrl = validateAndNormalizeM3UUrl(m3uUrl);
      } catch (valErr) {
        setFormError(valErr.message || 'Please enter a valid playlist URL.');
        return;
      }

      setIsSubmitting(true);
      try {
        const xtreamCreds = parseXtreamCredentialsFromUrl(normalizedUrl);
        const payload = {
          type: 'm3u',
          playlist_name: name || (xtreamCreds ? `${xtreamCreds.username} (M3U)` : 'M3U Playlist'),
          playlist_url: normalizedUrl,
          playlistUrl: normalizedUrl,
        };

        if (xtreamCreds && xtreamCreds.serverUrl && xtreamCreds.username && xtreamCreds.password) {
          payload.server_url = xtreamCreds.serverUrl;
          payload.serverUrl = xtreamCreds.serverUrl;
          payload.username = xtreamCreds.username;
          payload.password = xtreamCreds.password;
        }

        if (xtreamCreds?.serverUrl && xtreamCreds.username && xtreamCreds.password) {
          const m3uSrv = normalizeServerUrl(xtreamCreds.serverUrl);
          await xtreamAuthenticate(m3uSrv, xtreamCreds.username, xtreamCreds.password);
          payload.server_url = m3uSrv;
          payload.serverUrl = m3uSrv;
        }

        const res = await addDevicePlaylist(deviceId, payload);
        const newId = res?.playlist_id || res?.id || res?.playlist?.id || res?.playlist?.playlist_id;
        if (newId && xtreamCreds?.password) {
          await persistPlaylistPassword(newId, xtreamCreds.password);
        }

        setIsModalVisible(false);
        resetForm();
        await reloadPlaylist(newId || null, { isManual: true });
      } catch (err) {
        setFormError(getUserFriendlyErrorMessage(err) || err.message || 'Failed to add M3U playlist.');
        setIsSubmitting(false);
      }
    } else {
      let srv = normalizeServerUrl(serverUrl.trim());
      const usr = username.trim();
      const pwd = password.trim();

      if (!srv) {
        setFormError('Please enter your Xtream server URL.');
        return;
      }
      if (!usr) {
        setFormError('Please enter your username.');
        return;
      }
      if (!pwd) {
        setFormError('Please enter your password.');
        return;
      }

      setIsSubmitting(true);
      try {
        await xtreamAuthenticate(srv, usr, pwd);

        const xtreamPayload = {
          type: 'xtream',
          playlist_name: name || `${usr} (Xtream)`,
          name: name || `${usr} (Xtream)`,
          server_url: srv,
          serverUrl: srv,
          url: srv,
          username: usr,
          password: pwd,
        };

        const res = await addDevicePlaylist(deviceId, xtreamPayload);
        const newId = res?.playlist_id || res?.id || res?.playlist?.id || res?.playlist?.playlist_id;
        if (newId) {
          await persistPlaylistPassword(newId, pwd);
        }

        setIsModalVisible(false);
        resetForm();
        await reloadPlaylist(newId || null, { isManual: true });
      } catch (err) {
        setFormError(getUserFriendlyErrorMessage(err) || err.message || 'Failed to add Xtream playlist.');
        setIsSubmitting(false);
      }
    }
  };

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
      {/* Top Header Toolbar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {isAddMode && (
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => safeBack(router)}
              activeOpacity={0.8}
              accessibilityLabel="Back to previous screen"
            >
              <BackArrowIcon size={14} color="#FFFFFF" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <Image
            source={require('../../assets/inside-app-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <TouchableOpacity
          style={styles.headerAddBtn}
          onPress={handleOpenModal}
          activeOpacity={0.8}
        >
          <PlusIcon size={12} color="#000000" />
          <Text style={styles.headerAddBtnText}>Add Manually</Text>
        </TouchableOpacity>
      </View>

      {/* Main 2-Column Split View for Landscape */}
      <Animated.View style={[styles.mainSplit, { opacity: fadeAnim }]}>
        {/* Left Column: Instructions & Device Code */}
        <View style={styles.leftColumn}>
          <Text style={styles.headline}>
            {isAddMode ? 'ADD NEW PLAYLIST' : 'CONNECT YOUR DEVICE'}
          </Text>
          <Text style={styles.description} numberOfLines={2}>
            {isAddMode
              ? 'Scan the QR code, visit the web portal, or enter your M3U / Xtream details directly.'
              : 'Scan the QR code, visit the web portal, or enter your M3U / Xtream details directly.'}
          </Text>

          <View style={styles.codeRow}>
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>DEVICE ID</Text>
              <Text style={styles.codeValue} selectable numberOfLines={1}>
                {deviceId || '--------'}
              </Text>
            </View>

            <View style={styles.urlCard}>
              <Text style={styles.urlLabel}>WEB PORTAL</Text>
              <Text style={styles.urlValue} selectable numberOfLines={1}>
                {PAIRING_BASE_URL.replace(/^https?:\/\//, '')}/manage
              </Text>
            </View>
          </View>

          {/* Sync Error */}
          {!!syncError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText} numberOfLines={2}>{syncError}</Text>
            </View>
          )}

          {/* Action Row */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.reloadButton, isSyncing && styles.reloadButtonDisabled]}
              onPress={handleReload}
              disabled={isSyncing}
              activeOpacity={0.8}
            >
              {isSyncing ? (
                <View style={styles.btnRow}>
                  <ActivityIndicator color="#000000" size="small" />
                  <Text style={styles.reloadButtonText}>{syncStep || 'Syncing...'}</Text>
                </View>
              ) : (
                <View style={styles.btnRow}>
                  <RefreshIcon size={15} color="#000000" />
                  <Text style={styles.reloadButtonText}>Check Status / Reload</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.manualEntryBtn}
              onPress={handleOpenModal}
              activeOpacity={0.8}
            >
              <View style={styles.btnRow}>
                <PlusIcon size={14} color="#FFFFFF" />
                <Text style={styles.manualEntryBtnText}>Add Playlist</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Right Column: QR Code Box & Open Website Button */}
        <View style={styles.rightColumn}>
          <View style={styles.qrWrapper}>
            {pairingUrl ? (
              <QRCode
                value={pairingUrl}
                size={120}
                color="#000000"
                backgroundColor="#FFFFFF"
                quietZone={6}
              />
            ) : (
              <ActivityIndicator color={Colors.brand.primary} size="large" />
            )}
            <Text style={styles.qrHint}>Scan with Phone Camera</Text>
          </View>

          <TouchableOpacity
            style={styles.openWebsiteBtn}
            onPress={handleOpenWebsite}
            activeOpacity={0.8}
            accessibilityLabel="Open Playlist Website"
          >
            <Text style={styles.openWebsiteBtnText}>Open Web Dashboard</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Bottom Disclaimer */}
      <View style={styles.bottomFooter}>
        <Text style={styles.disclaimerText} numberOfLines={1}>
          FoxPlayer is a media player only, and does not include any content.
        </Text>
      </View>

      {/* In-App Add Playlist Modal */}
      <FoxModal
        visible={isModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseModal}
      >
        <TouchableWithoutFeedback onPress={handleCloseModal}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.modalCard}
              >
                {/* Modal Header */}
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Add Playlist to Device</Text>
                  <TouchableOpacity
                    onPress={handleCloseModal}
                    style={styles.modalCloseBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.modalCloseBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Tabs: M3U PLAYLIST | XTREAM CODES */}
                <View style={styles.modalTabs}>
                  <TouchableOpacity
                    style={[styles.modalTab, activeTab === 'm3u' && styles.modalTabActive]}
                    onPress={() => {
                      setActiveTab('m3u');
                      setFormError(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.modalTabText, activeTab === 'm3u' && styles.modalTabTextActive]}>
                      M3U PLAYLIST
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalTab, activeTab === 'xtream' && styles.modalTabActive]}
                    onPress={() => {
                      setActiveTab('xtream');
                      setFormError(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.modalTabText, activeTab === 'xtream' && styles.modalTabTextActive]}>
                      XTREAM CODES
                    </Text>
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.modalBody}
                  contentContainerStyle={styles.modalBodyContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Playlist Name (Optional) */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>PLAYLIST NAME (OPTIONAL)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={playlistName}
                      onChangeText={setPlaylistName}
                      placeholder={activeTab === 'm3u' ? 'e.g. My M3U Stream' : 'e.g. Primary Xtream'}
                      placeholderTextColor={Colors.text.tertiary}
                      autoCapitalize="words"
                      autoCorrect={false}
                    />
                  </View>

                  {activeTab === 'm3u' ? (
                    /* M3U Panel */
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>M3U / M3U8 PLAYLIST URL *</Text>
                      <TextInput
                        style={styles.textInput}
                        value={m3uUrl}
                        onChangeText={setM3uUrl}
                        placeholder="http://example.com/playlist.m3u8"
                        placeholderTextColor={Colors.text.tertiary}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                      />
                      <Text style={styles.inputHint}>
                        Direct HTTP or HTTPS link to your M3U / M3U8 playlist file.
                      </Text>
                    </View>
                  ) : (
                    /* Xtream Codes Panel */
                    <>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>SERVER URL *</Text>
                        <TextInput
                          style={styles.textInput}
                          value={serverUrl}
                          onChangeText={setServerUrl}
                          placeholder="http://example.com:8080"
                          placeholderTextColor={Colors.text.tertiary}
                          autoCapitalize="none"
                          autoCorrect={false}
                          keyboardType="url"
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>USERNAME *</Text>
                        <TextInput
                          style={styles.textInput}
                          value={username}
                          onChangeText={setUsername}
                          placeholder="Your Xtream username"
                          placeholderTextColor={Colors.text.tertiary}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>PASSWORD *</Text>
                        <TextInput
                          style={styles.textInput}
                          value={password}
                          onChangeText={setPassword}
                          placeholder="Your Xtream password"
                          placeholderTextColor={Colors.text.tertiary}
                          secureTextEntry
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>
                    </>
                  )}

                  {/* Form Error Message */}
                  {!!formError && (
                    <View style={styles.modalErrorBox}>
                      <Text style={styles.modalErrorText}>{formError}</Text>
                    </View>
                  )}
                </ScrollView>

                {/* Modal Footer Actions */}
                <View style={styles.modalFooter}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={handleCloseModal}
                    disabled={isSubmitting}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalSubmitBtn, isSubmitting && styles.modalSubmitBtnDisabled]}
                    onPress={handleSubmitPlaylist}
                    disabled={isSubmitting}
                    activeOpacity={0.8}
                  >
                    {isSubmitting ? (
                      <View style={styles.btnRow}>
                        <ActivityIndicator color="#000000" size="small" />
                        <Text style={styles.modalSubmitText}>Saving...</Text>
                      </View>
                    ) : (
                      <Text style={styles.modalSubmitText}>Add Playlist</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </FoxModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  headerAddBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background.card,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 6,
  },
  backBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  logo: {
    width: 130,
    height: 34,
  },
  mainSplit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 20,
    paddingVertical: 6,
    minHeight: 0,
  },
  leftColumn: {
    flex: 1,
    justifyContent: 'center',
  },
  headline: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  description: {
    fontSize: 12,
    color: Colors.text.secondary,
    lineHeight: 16,
    marginBottom: 8,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  codeCard: {
    flex: 1,
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  codeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.text.tertiary,
    letterSpacing: 1,
    marginBottom: 2,
  },
  codeValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.brand.primary,
    letterSpacing: 1.5,
  },
  urlCard: {
    flex: 1,
    backgroundColor: Colors.background.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  urlLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.text.tertiary,
    letterSpacing: 1,
    marginBottom: 2,
  },
  urlValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 6,
    padding: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.status.error,
  },
  errorText: {
    fontSize: 11,
    color: Colors.status.error,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  reloadButton: {
    flex: 1,
    backgroundColor: Colors.brand.primary,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reloadButtonDisabled: {
    opacity: 0.6,
  },
  manualEntryBtn: {
    flex: 1,
    backgroundColor: '#1E2533',
    borderWidth: 1,
    borderColor: Colors.border.default,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualEntryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reloadButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  rightColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrHint: {
    fontSize: 10,
    fontWeight: '600',
    color: '#080A0F',
    marginTop: 4,
    textAlign: 'center',
  },
  openWebsiteBtn: {
    backgroundColor: '#1E2533',
    borderWidth: 1,
    borderColor: Colors.border.default,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openWebsiteBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.brand.primary,
    letterSpacing: 0.3,
  },
  bottomFooter: {
    alignItems: 'center',
    width: '100%',
    paddingTop: 2,
  },
  disclaimerText: {
    fontSize: 10,
    fontWeight: '500',
    color: Colors.text.gold,
    textAlign: 'center',
  },

  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '90%',
    maxWidth: 380,
    maxHeight: '92%',
    backgroundColor: Colors.background.secondary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border.default,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border.default,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseBtnText: {
    fontSize: 16,
    color: Colors.text.secondary,
    fontWeight: '700',
  },
  modalTabs: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: '#0D111A',
    gap: 8,
  },
  modalTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  modalTabActive: {
    backgroundColor: Colors.brand.primary,
  },
  modalTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text.secondary,
    letterSpacing: 0.5,
  },
  modalTabTextActive: {
    color: '#000000',
  },
  modalBody: {
    maxHeight: 280,
  },
  modalBodyContent: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text.tertiary,
    letterSpacing: 1,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#1B2232',
    borderWidth: 1,
    borderColor: Colors.border.default,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 13,
  },
  inputHint: {
    fontSize: 11,
    color: Colors.text.tertiary,
    marginTop: 4,
  },
  modalErrorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: Colors.status.error,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  modalErrorText: {
    fontSize: 12,
    color: Colors.status.error,
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border.default,
    backgroundColor: '#0F131D',
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
  },
  modalCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text.secondary,
  },
  modalSubmitBtn: {
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSubmitBtnDisabled: {
    opacity: 0.6,
  },
  modalSubmitText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
});
