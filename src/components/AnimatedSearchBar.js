import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import Colors from '../constants/colors';
import { SearchIcon, CloseIcon } from './Icons';

const AnimatedSearchBar = React.memo(function AnimatedSearchBar({
  value = '',
  onChangeText,
  onClear,
  placeholders = ['Search channels...', 'Search movies...', 'Search series...', 'Type to find content...'],
  style,
  autoFocus = false,
  debounceMs = 160,
}) {
  const [localText, setLocalText] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const debounceTimerRef = useRef(null);
  const onChangeTextRef = useRef(onChangeText);
  onChangeTextRef.current = onChangeText;

  // Keep localText synchronized if parent value changes externally
  useEffect(() => {
    if (value !== localText) {
      setLocalText(value);
    }
  }, [value]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const fadeAnimRef = useRef(new Animated.Value(1));

  // Cycle animated placeholder smoothly every 3.5s if not typing or focused
  useEffect(() => {
    if (localText || isFocused) return;

    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnimRef.current, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(fadeAnimRef.current, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();

      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3500);

    return () => clearInterval(interval);
  }, [localText, isFocused, placeholders.length]);

  const handleChangeText = useCallback(
    (text) => {
      setLocalText(text);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (debounceMs <= 0) {
        if (onChangeTextRef.current) onChangeTextRef.current(text);
        return;
      }

      debounceTimerRef.current = setTimeout(() => {
        if (onChangeTextRef.current) {
          onChangeTextRef.current(text);
        }
      }, debounceMs);
    },
    [debounceMs]
  );

  const handleClear = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setLocalText('');
    if (onChangeTextRef.current) onChangeTextRef.current('');
    if (onClear) onClear();
  }, [onClear]);

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);

  return (
    <View
      style={[
        styles.container,
        isFocused && styles.containerFocused,
        style,
      ]}
    >
      <View style={styles.iconWrapper}>
        <SearchIcon
          size={16}
          color={isFocused || localText ? Colors.brand.primary : Colors.text.secondary}
        />
      </View>

      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={localText}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholderTextColor="transparent"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          autoFocus={autoFocus}
          accessibilityLabel="Search"
        />

        {!localText && (
          <Animated.Text
            pointerEvents="none"
            style={[styles.placeholderText, { opacity: fadeAnimRef.current }]}
            numberOfLines={1}
          >
            {placeholders[placeholderIndex]}
          </Animated.Text>
        )}
      </View>

      {!!localText && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={handleClear}
          activeOpacity={0.7}
          accessibilityLabel="Clear search text"
        >
          <CloseIcon size={14} color={Colors.text.secondary} />
        </TouchableOpacity>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border.default,
    backgroundColor: Colors.background.card,
    paddingHorizontal: 10,
    height: 36,
    overflow: 'hidden',
  },
  containerFocused: {
    borderColor: Colors.brand.primary,
    backgroundColor: Colors.background.cardActive,
  },
  iconWrapper: {
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrapper: {
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
    height: '100%',
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  placeholderText: {
    position: 'absolute',
    left: 0,
    right: 0,
    color: Colors.text.tertiary,
    fontSize: 13,
    fontWeight: '400',
  },
  clearBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AnimatedSearchBar;
