import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../../constants/colors';

function TabIcon({ label, focused, color }) {
  return (
    <View style={styles.tabIcon}>
      <View style={[styles.tabIconDot, focused && { backgroundColor: color }]} />
      <Text style={[styles.tabIconLabel, { color: focused ? color : Colors.text.tertiary }]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
        sceneContainerStyle: { backgroundColor: Colors.background.primary },
        detachInactiveScreens: true,
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused, color }) => <TabIcon label="HOME" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          tabBarIcon: ({ focused, color }) => <TabIcon label="LIVE" focused={focused} color={Colors.brand.primary} />,
          tabBarActiveTintColor: Colors.brand.primary,
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          tabBarIcon: ({ focused, color }) => <TabIcon label="MOVIES" focused={focused} color={Colors.brand.primary} />,
          tabBarActiveTintColor: Colors.brand.primary,
        }}
      />
      <Tabs.Screen
        name="series"
        options={{
          tabBarIcon: ({ focused, color }) => <TabIcon label="SERIES" focused={focused} color={Colors.brand.primary} />,
          tabBarActiveTintColor: Colors.brand.primary,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          tabBarIcon: ({ focused, color }) => <TabIcon label="FAVORITES" focused={focused} color={Colors.brand.primary} />,
          tabBarActiveTintColor: Colors.brand.primary,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.background.secondary,
    borderTopColor: Colors.border.subtle,
    borderTopWidth: 1,
    paddingTop: 8,
    paddingBottom: 8,
    height: 64,
  },
  tabIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabIconDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  tabIconLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
});
