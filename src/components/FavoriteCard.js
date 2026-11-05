import React from 'react';
import MediaCard from './MediaCard';

/**
 * Standardized FavoriteCard using unified MediaCard architecture.
 */
export const FavoriteCard = React.memo(function FavoriteCard({
  item,
  serverUrl = null,
  onPress,
  onRemove,
  style,
}) {
  return (
    <MediaCard
      item={item}
      type={item?.type}
      isFav={true}
      showTypeBadge={true}
      serverUrl={serverUrl}
      onPress={onPress}
      onToggleFav={onRemove}
      style={style}
    />
  );
});

export default FavoriteCard;
