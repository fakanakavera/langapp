import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenProps = {
  children: ReactNode;
  tabInset?: boolean;
};

export function Screen({ children, tabInset = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const bottom = insets.bottom + (tabInset ? BottomTabInset : 0) + Spacing.three;

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.three,
          paddingBottom: bottom,
          paddingLeft: insets.left + Spacing.three,
          paddingRight: insets.right + Spacing.three,
        },
      ]}
      keyboardShouldPersistTaps="handled">
      <ThemedView style={styles.inner}>{children}</ThemedView>
    </ScrollView>
  );
}

export function RowGap({ children }: { children: ReactNode }) {
  return <View style={styles.gap}>{children}</View>;
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Spacing.three,
  },
  gap: {
    gap: Spacing.two,
  },
});
