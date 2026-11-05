import React, { useMemo } from 'react';
import { View, StyleSheet, Image as RNImage } from 'react-native';
import { getCategoryArtUri, getLocalFallbackAsset } from '../constants/categoryArt';

let ExpoImageComponent = null;
try {
  const mod = require('expo-image');
  if (mod && (mod.Image || mod.default)) {
    ExpoImageComponent = mod.Image || mod.default;
  }
} catch (_e) {
  ExpoImageComponent = null;
}

export default function CategoryArtImage({
  type = 'movie',
  style,
  borderRadius = 0,
  contentFit = 'cover',
}) {
  const uri = useMemo(() => getCategoryArtUri(type), [type]);
  const localFallback = useMemo(() => getLocalFallbackAsset(type), [type]);
  const fit =
    contentFit === 'contain' ? 'contain' : contentFit === 'fill' ? 'fill' : 'cover';

  if (ExpoImageComponent) {
    return (
      <View style={[styles.wrap, { borderRadius }, style]}>
        <ExpoImageComponent
          source={{ uri }}
          style={[styles.image, { borderRadius }]}
          contentFit={fit}
          cachePolicy="memory-disk"
          transition={250}
          recyclingKey={uri}
          placeholder={localFallback}
          placeholderContentFit={fit}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { borderRadius }, style]}>
      <RNImage
        source={{ uri }}
        defaultSource={localFallback}
        style={[styles.image, { borderRadius }]}
        resizeMode={fit === 'contain' ? 'contain' : 'cover'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#12141a' },
  image: { width: '100%', height: '100%' },
});
