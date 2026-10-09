import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { DatabaseProvider } from '@/providers/database-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <DatabaseProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="deck/[id]" options={{ title: 'Deck' }} />
          <Stack.Screen name="entry/[id]" options={{ title: 'Word' }} />
          <Stack.Screen name="review" options={{ title: 'Review', presentation: 'modal' }} />
        </Stack>
      </DatabaseProvider>
    </ThemeProvider>
  );
}
