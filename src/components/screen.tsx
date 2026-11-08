import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenProps = {
  children: ReactNode;
  tabInset?: boolean;
  footer?: ReactNode;
  scrollKey?: string;
};

export function Screen({ children, tabInset = false, footer, scrollKey }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const previousScrollKey = useRef(scrollKey);
  const bottom = footer
    ? Spacing.three
    : insets.bottom + (tabInset ? BottomTabInset : 0) + Spacing.three;

  useEffect(() => {
    if (previousScrollKey.current === scrollKey) return;
    previousScrollKey.current = scrollKey;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scrollKey]);

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
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
      {footer != null && (
        <ThemedView
          style={[
            styles.footer,
            {
              borderTopColor: theme.backgroundSelected,
              paddingBottom: insets.bottom + Spacing.two,
              paddingLeft: insets.left + Spacing.three,
              paddingRight: insets.right + Spacing.three,
            },
          ]}>
          <ThemedView style={styles.footerInner}>{footer}</ThemedView>
        </ThemedView>
      )}
    </ThemedView>
  );
}

export function RowGap({ children }: { children: ReactNode }) {
  return <View style={styles.gap}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
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
  footer: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    width: '100%',
  },
  footerInner: {
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  gap: {
    gap: Spacing.two,
  },
});
