/**
 * FOX PLAYER — About Developer Modal
 *
 * Clean, dark cinema OTT dialogue with dynamic pop animation.
 * Displays developer attribution, credentials, portfolio, and github links.
 * No neumorphic effects used.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Easing,
  Linking,
  useWindowDimensions,
} from 'react-native';
import FoxModal from './FoxModal';
import { Colors } from '../constants/colors';
import { CloseXIcon } from './Icons';

export default function AboutDeveloperModal({ visible = false, onClose }) {
  const { width: windowWidth } = useWindowDimensions();
  const [animValue] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      animValue.setValue(0);
      Animated.spring(animValue, {
        toValue: 1,
        tension: 70,
        friction: 7,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, animValue]);

  const handleDismiss = () => {
    Animated.timing(animValue, {
      toValue: 0,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (typeof onClose === 'function') {
        onClose();
      }
    });
  };

  const handleOpenLink = async (url) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(url);
      }
    } catch (_err) {}
  };

  if (!visible) return null;

  const cardScale = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1],
  });

  const cardOpacity = animValue.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0.7, 1],
  });

  const backdropOpacity = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const maxCardWidth = Math.min(windowWidth - 36, 440);

  return (
    <FoxModal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent={true}
      onRequestClose={handleDismiss}
    >
      <TouchableWithoutFeedback onPress={handleDismiss}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <TouchableWithoutFeedback onPress={(e) => e?.stopPropagation?.()}>
            <Animated.View
              style={[
                styles.modalCard,
                {
                  width: maxCardWidth,
                  opacity: cardOpacity,
                  transform: [{ scale: cardScale }],
                },
              ]}
            >
              {/* Header Bar */}
              <View style={styles.headerBar}>
                <Text style={styles.headerSubtitle}>ABOUT DEVELOPER</Text>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={handleDismiss}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  activeOpacity={0.7}
                >
                  <CloseXIcon size={16} color="#A0A8BA" />
                </TouchableOpacity>
              </View>

              {/* Developer Avatar & Primary Branding */}
              <View style={styles.profileSection}>
                <View style={styles.avatarContainer}>
                  <View style={styles.avatarInner}>
                    <Text style={styles.avatarText}>AH</Text>
                  </View>
                </View>
                <View style={styles.profileMeta}>
                  <Text style={styles.attributionTag}>Developed and Designed by</Text>
                  <Text style={styles.devName}>Azan Haider</Text>
                </View>
              </View>

              {/* Skill Badges */}
              <View style={styles.skillsWrapper}>
                <View style={styles.skillBadgePrimary}>
                  <Text style={styles.skillTextPrimary}>Full stack Professional Developer</Text>
                </View>
                <View style={styles.skillBadgeAccent}>
                  <Text style={styles.skillTextAccent}>AI expert</Text>
                </View>
              </View>

              {/* Links & Connect Section */}
              <View style={styles.linksSection}>
                <Text style={styles.sectionLabel}>ONLINE PRESENCE</Text>

                {/* Portfolio */}
                <TouchableOpacity
                  style={styles.linkCard}
                  onPress={() => handleOpenLink('https://devazu.netlify.app')}
                  activeOpacity={0.75}
                >
                  <View style={styles.linkInfo}>
                    <Text style={styles.linkLabel}>Portfolio</Text>
                    <Text style={styles.linkUrl} numberOfLines={1}>devazu.netlify.app</Text>
                  </View>
                  <View style={styles.actionPill}>
                    <Text style={styles.actionPillText}>VISIT</Text>
                    <Text style={styles.actionPillArrow}>&gt;</Text>
                  </View>
                </TouchableOpacity>

                {/* GitHub */}
                <TouchableOpacity
                  style={styles.linkCard}
                  onPress={() => handleOpenLink('https://github.com/kingazu86-a11y')}
                  activeOpacity={0.75}
                >
                  <View style={styles.linkInfo}>
                    <Text style={styles.linkLabel}>GitHub</Text>
                    <Text style={styles.linkUrl} numberOfLines={1}>github.com/kingazu86-a11y</Text>
                  </View>
                  <View style={styles.actionPill}>
                    <Text style={styles.actionPillText}>VIEW</Text>
                    <Text style={styles.actionPillArrow}>&gt;</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Footer Button */}
              <TouchableOpacity
                style={styles.dismissBtn}
                onPress={handleDismiss}
                activeOpacity={0.8}
              >
                <Text style={styles.dismissBtnText}>Close</Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </FoxModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 12, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#121622',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerSubtitle: {
    color: '#8A92A6',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: Colors.brand.primary,
    padding: 2,
    marginRight: 14,
  },
  avatarInner: {
    flex: 1,
    borderRadius: 24,
    backgroundColor: '#1A2132',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  profileMeta: {
    flex: 1,
  },
  attributionTag: {
    color: Colors.brand.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  devName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  skillsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  skillBadgePrimary: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  skillTextPrimary: {
    color: '#E1E7F0',
    fontSize: 11.5,
    fontWeight: '600',
  },
  skillBadgeAccent: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  skillTextAccent: {
    color: Colors.brand.primary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  linksSection: {
    marginBottom: 18,
  },
  sectionLabel: {
    color: '#717A8C',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  linkInfo: {
    flex: 1,
    marginRight: 10,
  },
  linkLabel: {
    color: '#8F99AD',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  linkUrl: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
  },
  actionPillText: {
    color: Colors.brand.primary,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  actionPillArrow: {
    color: Colors.brand.primary,
    fontSize: 10.5,
    fontWeight: '700',
  },
  dismissBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissBtnText: {
    color: '#D4D8E2',
    fontSize: 13,
    fontWeight: '600',
  },
});
