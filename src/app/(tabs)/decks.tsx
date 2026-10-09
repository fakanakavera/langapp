import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, TextInput, StyleSheet } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { createDeck, listDeckSummaries } from '@/db/queries';
import type { DeckSummary } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';

export default function DecksScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [name, setName] = useState('');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listDeckSummaries().then((rows) => {
        if (!cancelled) setDecks(rows);
      });
      return () => {
        cancelled = true;
      };
    }, [revision]),
  );

  async function onCreate() {
    if (!name.trim()) {
      Alert.alert('Name a deck first');
      return;
    }
    const deck = await createDeck(name);
    setName('');
    refresh();
    router.push(`/deck/${deck.id}`);
  }

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Decks</ThemedText>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="New deck name"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <UiButton label="Create deck" onPress={onCreate} />

      {decks.map((deck) => (
        <CardBlock key={deck.id} onPress={() => router.push(`/deck/${deck.id}`)}>
          <ThemedText type="smallBold">{deck.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {deck.due_count} due · {deck.card_count} cards
          </ThemedText>
        </CardBlock>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
  },
});
