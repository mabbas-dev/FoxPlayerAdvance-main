import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Colors from '../constants/colors';

export default function ErrorState({
  title = 'Something went wrong',
  message,
  primaryLabel = 'Retry',
  onPrimary,
  secondaryLabel,
  onSecondary,
}) {
  return (
    <View style={styles.container}>
      <View style={styles.iconBox}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>!</Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {!!message && <Text style={styles.message}>{message}</Text>}
      <View style={styles.actions}>
        {!!onPrimary && (
          <TouchableOpacity style={styles.primaryBtn} onPress={onPrimary} activeOpacity={0.8}>
            <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
          </TouchableOpacity>
        )}
        {!!onSecondary && !!secondaryLabel && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={onSecondary} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    backgroundColor: Colors.background.primary,
  },
  iconBox: {
    marginBottom: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.status.errorGlow,
    borderWidth: 1,
    borderColor: Colors.status.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 28,
    color: Colors.status.error,
    fontWeight: '700',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text.primary,
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: Colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: Colors.brand.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    backgroundColor: Colors.glass.background,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: Colors.text.secondary,
    fontWeight: '600',
    fontSize: 15,
  },
});
