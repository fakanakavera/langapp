import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import {
  createDeck,
  deleteDeck,
  listDeckSummaries,
  setDeckPositions,
} from '@/db/queries';
import type { DeckSummary } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';

export default function DecksScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [name, setName] = useState('');
  const [reorderMode, setReorderMode] = useState(false);

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

  function moveDeck(id: string, direction: 'up' | 'down') {
    setDecks((current) => {
      const index = current.findIndex((deck) => deck.id === id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      void setDeckPositions(next.map((deck) => deck.id));
      return next;
    });
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

      {reorderMode && (
        <View style={styles.reorderBanner}>
          <ThemedText type="small" themeColor="textSecondary">
            Tap the arrows to move a deck up or down, then tap Done.
          </ThemedText>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => setReorderMode((current) => !current)}
        style={styles.reorderButton}>
        <ThemedText type="small" style={{ color: theme.tint, fontWeight: '600' }}>
          {reorderMode ? 'Done reordering' : 'Reorder decks'}
        </ThemedText>
      </Pressable>
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
          reorderMode={reorderMode}
          isFirst={decks[0]?.id === deck.id}
          isLast={decks[decks.length - 1]?.id === deck.id}
          onMoveUp={() => void moveDeck(deck.id, 'up')}
          onMoveDown={() => void moveDeck(deck.id, 'down')}
        />
      ))}
    </Screen>
  );
}

function DeckRow({
  deck,
  onOpen,
  onDeleted,
  reorderMode,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  deck: DeckSummary;
  onOpen: () => void;
  onDeleted: (id: string) => void;
  reorderMode: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
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
    <View style={styles.deckContainer}>
      {reorderMode ? (
        <View style={styles.moveButtons}>
          <Pressable
            accessibilityLabel={`Move ${deck.name} up`}
            onPress={(event) => {
              event.stopPropagation();
              onMoveUp();
            }}
            disabled={isFirst}
            style={[styles.moveButton, { borderColor: theme.backgroundSelected }]}>
            <ThemedText style={{ color: theme.tint, fontWeight: '700', fontSize: 18 }}>
              ▲
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityLabel={`Move ${deck.name} down`}
            onPress={(event) => {
              event.stopPropagation();
              onMoveDown();
            }}
            disabled={isLast}
            style={[styles.moveButton, { borderColor: theme.backgroundSelected }]}>
            <ThemedText style={{ color: theme.tint, fontWeight: '700', fontSize: 18 }}>
              ▼
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
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
        <CardBlock onPress={onOpen} style={reorderMode ? styles.reorderCard : undefined}>
          <ThemedText type="smallBold">{deck.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {deck.due_count} due · {deck.studying_count}/{deck.studying_limit} studying · {deck.card_count} total
          </ThemedText>
        </CardBlock>
      </Swipeable>
    </View>
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
  reorderBanner: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  reorderButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.one,
  },
  deckContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  moveButtons: {
    gap: Spacing.one,
  },
  moveButton: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderCard: {
    flex: 1,
  },
});
