import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Colors from '../../constants/colors';

/**
 * FOX PLAYER — Video Surface Error Boundary
 *
 * Catches any render or native-component instantiation exceptions in the video surface layer
 * (e.g., missing VlcPlayerView host component or VideoView texture failures)
 * and prevents the entire React Native application from crashing.
 */
export class PlayerSurfaceErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[PlayerSurfaceErrorBoundary] Native surface render crashed:', error, errorInfo);
    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error, errorInfo);
      } catch (_e) {}
    }
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (typeof this.props.onReset === 'function') {
      try {
        this.props.onReset();
      } catch (_e) {}
    }
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          resetErrorBoundary: this.resetErrorBoundary,
        });
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isVlcError =
        String(this.state.error?.message || '').includes('Vlc') ||
        String(this.state.error?.message || '').includes('VlcPlayerView');

      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>
            {isVlcError ? 'VLC Surface Unavailable' : 'Video Surface Render Error'}
          </Text>
          <Text style={styles.errorMessage} numberOfLines={3}>
            {this.state.error?.message || 'The native video surface failed to initialize.'}
          </Text>
          {this.props.onRecover && (
            <TouchableOpacity
              style={styles.recoverBtn}
              onPress={() => {
                this.resetErrorBoundary();
                this.props.onRecover();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.recoverBtnText}>Switch to Native Player</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A0C',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 10,
  },
  errorTitle: {
    color: '#FFB800',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    color: '#8A92A6',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 320,
  },
  recoverBtn: {
    backgroundColor: Colors.brand.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  recoverBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default PlayerSurfaceErrorBoundary;
