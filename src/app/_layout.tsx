import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DatabaseProvider, useDatabase } from '@/providers/database-provider';
import { listUserDictionary } from '@/db/queries';
import { setUserDictionary } from '@/lib/ru-en-dictionary';

SplashScreen.preventAutoHideAsync();

function UserDictionaryLoader() {
  const { ready, revision } = useDatabase();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    listUserDictionary().then((entries) => {
      if (!cancelled) setUserDictionary(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, revision]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AnimatedSplashOverlay />
        <DatabaseProvider>
          <UserDictionaryLoader />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="money" options={{ headerShown: false }} />
            <Stack.Screen name="deck/[id]" options={{ title: 'Deck' }} />
            <Stack.Screen name="entry/[id]" options={{ title: 'Word' }} />
            <Stack.Screen name="review" options={{ title: 'Review', presentation: 'modal' }} />
          </Stack>
        </DatabaseProvider>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
