import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { verifyAdultPin } from '../storage/pinStorage';
import { useApp } from '../state/AppContext';
import { LockIcon } from './Icons';

/**
 * AdultPinLockView
 * Minimalist, modern 4-digit PIN lock view.
 * Designed to fit within landscape & compact screens without overflowing.
 */
export default function AdultPinLockView({ categoryName, onSuccess, compact = false }) {
  const { unlockAdult } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef(null);

  // Auto-focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus?.();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleVerify = useCallback(async (codeToVerify) => {
    const targetPin = (codeToVerify != null ? codeToVerify : pin).trim();
    if (targetPin.length !== 4) return;

    setError('');
    setVerifying(true);

    try {
      const isValid = await verifyAdultPin(targetPin);
      if (isValid) {
        unlockAdult();
        if (typeof onSuccess === 'function') {
          onSuccess();
        }
      } else {
        setError('Incorrect PIN');
        setTimeout(() => {
          setPin('');
          setError('');
          inputRef.current?.focus?.();
        }, 500);
      }
    } catch (e) {
      setError(e?.message || 'Verification failed');
      setTimeout(() => {
        setPin('');
        setError('');
      }, 700);
    } finally {
      setVerifying(false);
    }
  }, [pin, unlockAdult, onSuccess]);

  const handleNumberPress = useCallback((digit) => {
    if (verifying) return;
    setError('');
    setPin((prev) => {
      if (prev.length >= 4) return prev;
      const next = prev + digit;
      if (next.length === 4) {
        setTimeout(() => handleVerify(next), 60);
      }
      return next;
    });
  }, [verifying, handleVerify]);

  const handleBackspace = useCallback(() => {
    if (verifying) return;
    setError('');
    setPin((prev) => prev.slice(0, -1));
  }, [verifying]);

  const handleClear = useCallback(() => {
    if (verifying) return;
    setError('');
    setPin('');
  }, [verifying]);

  const handleTextChange = useCallback((text) => {
    if (verifying) return;
    const clean = text.replace(/[^0-9]/g, '').slice(0, 4);
    setError('');
    setPin(clean);
    if (clean.length === 4) {
      setTimeout(() => handleVerify(clean), 60);
    }
  }, [verifying, handleVerify]);

  const isWide = !compact;

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, compact && styles.scrollContentCompact]}
      showsVerticalScrollIndicator={false}
      bounces={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Hidden input for device keyboard */}
      <TextInput
        ref={inputRef}
        value={pin}
        onChangeText={handleTextChange}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        style={styles.hiddenInput}
        accessibilityLabel="4-digit adult PIN input"
        autoFocus={Platform.OS !== 'web'}
      />

      <View style={[styles.card, isWide ? styles.cardWide : styles.cardCompact]}>
        {/* Info Column (Left on wide, Top on compact) */}
        <View style={[styles.infoSection, isWide && styles.infoSectionWide]}>
          <View style={styles.iconBox}>
            <LockIcon size={compact ? 16 : 20} color={error ? '#EF4444' : '#FFFFFF'} />
          </View>

          <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>
            {categoryName ? `${categoryName}` : 'Parental Lock'}
          </Text>

          <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
            Enter 4-digit PIN
          </Text>

          {/* 4 Minimalist Dots */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => inputRef.current?.focus?.()}
            style={styles.dotsRow}
          >
            {[0, 1, 2, 3].map((idx) => {
              const isFilled = idx < pin.length;
              return (
                <View
                  key={idx}
                  style={[
                    styles.dot,
                    compact && styles.dotCompact,
                    isFilled && styles.dotFilled,
                    !!error && styles.dotError,
                  ]}
                />
              );
            })}
          </TouchableOpacity>

          {/* Status / Error or Verifying */}
          <View style={styles.statusBox}>
            {verifying ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : !!error ? (
              <Text style={styles.errorText} numberOfLines={1}>
                {error}
              </Text>
            ) : (
              <Text style={styles.hintText}>
                Protected content
              </Text>
            )}
          </View>
        </View>

        {/* Minimal Number Pad */}
        <View style={[styles.keypad, compact && styles.keypadCompact]}>
          <View style={styles.keypadRow}>
            {['1', '2', '3'].map((n) => (
              <KeypadButton key={n} label={n} onPress={() => handleNumberPress(n)} compact={compact} disabled={verifying} />
            ))}
          </View>
          <View style={styles.keypadRow}>
            {['4', '5', '6'].map((n) => (
              <KeypadButton key={n} label={n} onPress={() => handleNumberPress(n)} compact={compact} disabled={verifying} />
            ))}
          </View>
          <View style={styles.keypadRow}>
            {['7', '8', '9'].map((n) => (
              <KeypadButton key={n} label={n} onPress={() => handleNumberPress(n)} compact={compact} disabled={verifying} />
            ))}
          </View>
          <View style={styles.keypadRow}>
            <KeypadButton label="C" onPress={handleClear} compact={compact} isAction disabled={verifying} />
            <KeypadButton label="0" onPress={() => handleNumberPress('0')} compact={compact} disabled={verifying} />
            <KeypadButton label="⌫" onPress={handleBackspace} compact={compact} isAction disabled={verifying} />
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const KeypadButton = React.memo(function KeypadButton({ label, onPress, compact, isAction, disabled }) {
  return (
    <TouchableOpacity
      style={[
        styles.keypadBtn,
        compact && styles.keypadBtnCompact,
        isAction && styles.keypadBtnAction,
        disabled && styles.keypadBtnDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.6}
    >
      <Text
        style={[
          styles.keypadBtnText,
          compact && styles.keypadBtnTextCompact,
          isAction && styles.keypadBtnTextAction,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  scrollContentCompact: {
    padding: 4,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  card: {
    backgroundColor: '#18181B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 16,
    alignItems: 'center',
  },
  cardWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    maxWidth: 420,
    width: '100%',
    paddingVertical: 18,
    paddingHorizontal: 22,
  },
  cardCompact: {
    flexDirection: 'column',
    width: '100%',
    maxWidth: 220,
    padding: 12,
    gap: 10,
  },
  infoSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoSectionWide: {
    flex: 1,
    alignItems: 'center',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
    textAlign: 'center',
  },
  titleCompact: {
    fontSize: 12,
  },
  subtitle: {
    fontSize: 11,
    color: '#A1A1AA',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitleCompact: {
    fontSize: 10,
    marginBottom: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    paddingVertical: 4,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#52525B',
    backgroundColor: 'transparent',
  },
  dotCompact: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.2,
  },
  dotFilled: {
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  dotError: {
    borderColor: '#EF4444',
    backgroundColor: '#EF4444',
  },
  statusBox: {
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 11,
    color: '#EF4444',
    fontWeight: '600',
  },
  hintText: {
    fontSize: 10,
    color: '#71717A',
  },
  keypad: {
    width: 170,
    gap: 6,
  },
  keypadCompact: {
    width: '100%',
    gap: 5,
  },
  keypadRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  keypadBtn: {
    flex: 1,
    height: 34,
    backgroundColor: '#27272A',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keypadBtnCompact: {
    height: 28,
    borderRadius: 6,
  },
  keypadBtnAction: {
    backgroundColor: '#202024',
  },
  keypadBtnDisabled: {
    opacity: 0.5,
  },
  keypadBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  keypadBtnTextCompact: {
    fontSize: 12,
  },
  keypadBtnTextAction: {
    color: '#A1A1AA',
    fontSize: 12,
  },
});
