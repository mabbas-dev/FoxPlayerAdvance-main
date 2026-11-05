import React, { useState, useMemo, useCallback, useEffect, Component } from 'react';
import { View, StyleSheet, Platform, Image as RNImage } from 'react-native';
import Colors from '../constants/colors';
import { normalizeImageUrl, resolvePosterUrl } from '../utils/imageHelpers';
import { getCategoryArtUri } from '../constants/categoryArt';
import CategoryArtImage from './CategoryArtImage';

let ExpoImageComponent = null;
try {
  const mod = require('expo-image');
  if (mod && (mod.Image || mod.default)) {
    ExpoImageComponent = mod.Image || mod.default;
  }
} catch (_e) {
  ExpoImageComponent = null;
}

const failedUriCache = new Map();
const FAILED_CACHE_TTL_MS = 30000;

class SafeImageWrapper extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError || !ExpoImageComponent) {
      return this.props.renderFallback();
    }
    return this.props.children;
  }
}

const IMAGE_REQUEST_HEADERS = Platform.select({
  ios: {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1 FOX-PLAYER/1.0',
    Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8',
  },
  default: {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 FOX-PLAYER/1.0',
    Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8',
  },
});

export const IPTVImage = React.memo(function IPTVImage({
  uri,
  item = null,
  serverUrl = null,
  type = 'movie',
  title = null,
  style,
  borderRadius = 8,
  resizeMode = 'cover',
  placeholderResizeMode = null,
  priority = 'normal',
}) {
  const cleanUri = useMemo(() => {
    let resolved = null;
    if (uri && typeof uri === 'string' && uri.trim().length > 0) {
      resolved = normalizeImageUrl(uri, serverUrl);
    }
    if (!resolved && item) {
      resolved = resolvePosterUrl(item, serverUrl);
    }
    return resolved;
  }, [uri, item, serverUrl]);

  const [usePlainUri, setUsePlainUri] = useState(false);
  const [runtimeErrorUri, setRuntimeErrorUri] = useState(null);

  useEffect(() => {
    setUsePlainUri(false);
    setRuntimeErrorUri(null);
  }, [cleanUri]);

  useEffect(() => {
    setUsePlainUri(false);
    setRuntimeErrorUri(null);
  }, [cleanUri]);

  const isCachedFailed = useMemo(() => {
    if (!cleanUri) return true;
    const failedAt = failedUriCache.get(cleanUri);
    return Boolean(failedAt && Date.now() - failedAt < FAILED_CACHE_TTL_MS);
  }, [cleanUri]);

  const hasError = !cleanUri || isCachedFailed || runtimeErrorUri === cleanUri;
  const categoryArtUri = getCategoryArtUri(type);
  const isLive = type === 'live' || type === 'channel';
  const resolvedPlaceholderResizeMode = placeholderResizeMode || (isLive ? 'contain' : 'cover');
  const resolvedContentFit =
    resizeMode === 'contain' ? 'contain' : resizeMode === 'stretch' || resizeMode === 'fill' ? 'fill' : 'cover';

  const handleLoad = useCallback(() => {
    if (cleanUri) failedUriCache.delete(cleanUri);
  }, [cleanUri]);

  const handleError = useCallback(() => {
    if (!cleanUri) return;
    if (!usePlainUri && ExpoImageComponent) {
      setUsePlainUri(true);
      return;
    }
    failedUriCache.set(cleanUri, Date.now());
    setRuntimeErrorUri(cleanUri);
  }, [cleanUri, usePlainUri]);

  const imageSource = useMemo(() => {
    if (!cleanUri) return null;
    if (usePlainUri) return { uri: cleanUri };
    return { uri: cleanUri, headers: IMAGE_REQUEST_HEADERS };
  }, [cleanUri, usePlainUri]);

  if (!cleanUri || hasError) {
    return (
      <View style={[styles.container, { borderRadius }, style]}>
        <CategoryArtImage type={type} style={StyleSheet.absoluteFill} borderRadius={borderRadius} />
      </View>
    );
  }

  const renderFallback = () => (
    <RNImage
      source={imageSource}
      style={[styles.image, { borderRadius }]}
      resizeMode={resizeMode === 'contain' ? 'contain' : 'cover'}
      onLoad={handleLoad}
      onError={handleError}
    />
  );

  return (
    <View style={[styles.container, { borderRadius }, style]}>
      {ExpoImageComponent ? (
        <SafeImageWrapper renderFallback={renderFallback}>
          <ExpoImageComponent
            source={imageSource}
            placeholder={{ uri: categoryArtUri }}
            placeholderContentFit="cover"
            style={[styles.image, { borderRadius }]}
            contentFit={resolvedContentFit}
            transition={200}
            priority={priority}
            cachePolicy="memory-disk"
            allowDownscaling
            recyclingKey={`${cleanUri}|${usePlainUri ? 'plain' : 'hdr'}`}
            onLoad={handleLoad}
            onError={handleError}
          />
        </SafeImageWrapper>
      ) : (
        renderFallback()
      )}
    </View>
  );
});

export default IPTVImage;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: Colors.background.card,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
});
