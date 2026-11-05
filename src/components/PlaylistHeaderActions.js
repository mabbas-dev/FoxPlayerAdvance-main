import React from 'react';
import { View, StyleSheet } from 'react-native';
import ProfileDropdown from './ProfileDropdown';
import RecentlyWatchedMenu from './RecentlyWatchedMenu';

export default function PlaylistHeaderActions({
  compact = false,
  showRecentlyWatched = true,
}) {
  return (
    <View style={styles.row}>
      {showRecentlyWatched ? <RecentlyWatchedMenu compact={compact} /> : null}
      <ProfileDropdown compact={compact} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
