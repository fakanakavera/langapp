import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function HubScreen() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <Screen tabInset>
      <View style={styles.heading}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          YOUR PERSONAL HUB
        </ThemedText>
        <ThemedText type="subtitle">What would you like to work on?</ThemedText>
        <ThemedText themeColor="textSecondary">
          Choose an app. Your language-learning tools and money tracker live together here.
        </ThemedText>
      </View>

      <CardBlock style={[styles.appCard, { borderColor: theme.tint }]}>
        <ThemedText type="title" style={styles.icon}>
          Aa
        </ThemedText>
        <ThemedText type="smallBold">LANGAPP</ThemedText>
        <ThemedText type="subtitle">Learn a language</ThemedText>
        <ThemedText themeColor="textSecondary">
          Pick up where you left off with today&apos;s reviews, decks, and books.
        </ThemedText>
        <UiButton label="Open Langapp" onPress={() => router.push('/today')} />
      </CardBlock>

      <CardBlock style={[styles.appCard, { borderColor: theme.backgroundSelected }]}>
        <ThemedText type="title" style={styles.icon}>
          $
        </ThemedText>
        <ThemedText type="smallBold">MONEY TRACKER</ThemedText>
        <ThemedText type="subtitle">Track your money</ThemedText>
        <ThemedText themeColor="textSecondary">
          A separate space for your spending and income. Ready to grow as we build it.
        </ThemedText>
        <UiButton
          label="Open Money Tracker"
          variant="secondary"
          onPress={() => router.push('/money')}
        />
      </CardBlock>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  appCard: {
    borderWidth: 1,
    gap: Spacing.two,
  },
  icon: {
    fontSize: 36,
    lineHeight: 44,
  },
});
