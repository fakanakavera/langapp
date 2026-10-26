import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { createDeck, deleteDeck, listDeckSummaries } from '@/db/queries';
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
        <DeckRow
          key={deck.id}
          deck={deck}
          onOpen={() => router.push(`/deck/${deck.id}`)}
          onDeleted={(id) => {
            // Remove immediately; the focus-effect refetch confirms it.
            // (Same local-first pattern as the review/quiz queues.)
            setDecks((prev) => prev.filter((d) => d.id !== id));
            refresh();
          }}
        />
      ))}
    </Screen>
  );
}

function DeckRow({
  deck,
  onOpen,
  onDeleted,
}: {
  deck: DeckSummary;
  onOpen: () => void;
  onDeleted: (id: string) => void;
}) {
  const theme = useTheme();
  const swipeable = useRef<Swipeable | null>(null);

  function confirmDelete() {
    swipeable.current?.close();
    Alert.alert(
      'Delete deck?',
      `"${deck.name}" and its ${deck.card_count} cards will be removed. Words used by other decks are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteDeck(deck.id)
              .then(() => onDeleted(deck.id))
              .catch((error) => {
                Alert.alert(
                  'Could not delete deck',
                  error instanceof Error ? error.message : String(error),
                );
              });
          },
        },
      ],
    );
  }

  return (
    <Swipeable
      ref={swipeable}
      renderRightActions={() => (
        <Pressable
          onPress={confirmDelete}
          style={[styles.deleteAction, { backgroundColor: theme.error }]}>
          <ThemedText type="smallBold" style={styles.deleteLabel}>
            Delete
          </ThemedText>
        </Pressable>
      )}>
      <CardBlock onPress={onOpen}>
        <ThemedText type="smallBold">{deck.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {deck.due_count} due · {deck.card_count} cards
        </ThemedText>
      </CardBlock>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
  },
  deleteAction: {
    width: 88,
    borderRadius: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Spacing.two,
  },
  deleteLabel: {
    color: '#ffffff',
  },
});
