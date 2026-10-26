import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';

export default function MoneyHomeScreen() {
  const router = useRouter();

  return (
    <Screen>
      <UiButton label="← Back to hub" variant="secondary" onPress={() => router.replace('/')} />

      <ThemedText type="smallBold" themeColor="textSecondary">
        PERSONAL FINANCE
      </ThemedText>
      <ThemedText type="subtitle">Money Tracker</ThemedText>
      <ThemedText themeColor="textSecondary">
        This space is set up for the money tracker. We can add features here without mixing them
        into Langapp.
      </ThemedText>

      <CardBlock>
        <ThemedText type="smallBold">Overview</ThemedText>
        <ThemedText style={styles.placeholder}>Your balance will go here.</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          We&apos;ll choose your currency when we build the tracker.
        </ThemedText>
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">Transactions</ThemedText>
        <ThemedText themeColor="textSecondary">
          Income and spending entries will appear here once we add transaction tracking.
        </ThemedText>
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">Budgets</ThemedText>
        <ThemedText themeColor="textSecondary">
          A separate place for monthly limits and spending goals.
        </ThemedText>
      </CardBlock>
    </Screen>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    fontSize: 24,
    fontWeight: '600',
    paddingVertical: Spacing.two,
  },
});
