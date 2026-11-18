import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { PanGestureHandler } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useAnimatedReaction,
  runOnJS,
} from 'react-native-reanimated';
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

const ROW_HEIGHT = 110;

export default function DecksScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [name, setName] = useState('');
  const [reorderMode, setReorderMode] = useState(false);
  // Index of the deck currently being dragged (-1 when none).
  const [draggedIndex, setDraggedIndex] = useState(-1);

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

  /**
   * Move the deck at `fromIndex` to `toIndex` and persist the new order.
   * Called live while dragging so the list updates under the finger.
   */
  function reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= decks.length) return;
    setDecks((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      void setDeckPositions(next.map((d) => d.id));
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
            Hold the ≡ handle and slide a deck up or down to reorder, then tap Done.
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
      {decks.map((deck, index) => (
        <DeckRow
          key={deck.id}
          index={index}
          total={decks.length}
          deck={deck}
          isDragging={draggedIndex === index}
          reorderMode={reorderMode}
          onOpen={() => router.push(`/deck/${deck.id}`)}
          onDeleted={(id) => {
            // Remove immediately; the focus-effect refetch confirms it.
            // (Same local-first pattern as the review/quiz queues.)
            setDecks((prev) => prev.filter((d) => d.id !== id));
            refresh();
          }}
          setDraggedIndex={setDraggedIndex}
          onReorder={reorder}
        />
      ))}
    </Screen>
  );
}

function DeckRow({
  index,
  total,
  deck,
  isDragging,
  reorderMode,
  onOpen,
  onDeleted,
  setDraggedIndex,
  onReorder,
}: {
  index: number;
  total: number;
  deck: DeckSummary;
  isDragging: boolean;
  reorderMode: boolean;
  onOpen: () => void;
  onDeleted: (id: string) => void;
  setDraggedIndex: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  const theme = useTheme();
  const swipeable = useRef<Swipeable | null>(null);
  // Vertical offset of this card while it is being dragged. Local to each row
  // since only one card is ever dragged at a time.
  const dragY = useSharedValue(0);
  // Logical index of the dragged card as it moves through the list during a
  // single drag gesture (resets to `index` when a new drag starts).
  const logicalIndex = useRef(index);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: isDragging ? dragY.value : 0,
      },
      {
        scale: isDragging ? 1.05 : 1,
      },
    ],
    ...(isDragging
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.35,
          shadowRadius: 12,
          elevation: 12,
          zIndex: 100,
        }
      : {}),
  }));

  // Live reorder: as the card is dragged past a neighbor, swap them in state.
  useAnimatedReaction(
    () => (isDragging ? dragY.value : 0),
    (y) => {
      if (!reorderMode || !isDragging) return;
      const target = Math.round(y / ROW_HEIGHT) + logicalIndex.current;
      const clamped = Math.max(0, Math.min(total - 1, target));
      if (clamped !== logicalIndex.current) {
        runOnJS(onReorder)(logicalIndex.current, clamped);
        logicalIndex.current = clamped;
        // eslint-disable-next-line react-hooks/immutability
        dragY.value = 0;
      }
    },
    [],
  );

  const handleGestureEvent = (event: {
    nativeEvent: { translationY: number };
  }) => {
    // eslint-disable-next-line react-hooks/immutability
    dragY.value = event.nativeEvent.translationY;
  };

  const handleStateChange = (event: {
    nativeEvent: { state: number; oldState: number };
  }) => {
    if (!reorderMode) return;
    const { state } = event.nativeEvent;
    // 4 = State.ACTIVE (gesture handler state constants)
    if (state === 4) {
      setDraggedIndex(index);
      logicalIndex.current = index;
      // eslint-disable-next-line react-hooks/immutability
      dragY.value = 0;
    } else if (state === 5 || state === 6) {
      // END or CANCELLED
      dragY.value = withSpring(0);
      setDraggedIndex(-1);
    }
  };

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
        <PanGestureHandler
          onGestureEvent={handleGestureEvent}
          onHandlerStateChange={handleStateChange}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 12 }}>
          <Animated.View style={[styles.dragHandle, cardStyle]}>
            <View style={styles.dash} />
            <View style={styles.dash} />
            <View style={styles.dash} />
          </Animated.View>
        </PanGestureHandler>
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
        <Animated.View style={cardStyle}>
          <CardBlock
            onPress={onOpen}
            style={[styles.reorderCard, { opacity: isDragging ? 0.9 : 1 }]}
          >
            <ThemedText type="smallBold">{deck.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {deck.due_count} due · {deck.studying_count}/{deck.studying_limit} studying · {deck.card_count} total
            </ThemedText>
          </CardBlock>
        </Animated.View>
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
    paddingHorizontal: Spacing.three,
  },
  dragHandle: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.one,
  },
  dash: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#9AA0A6',
    marginVertical: 3,
  },
  reorderCard: {
    flex: 1,
  },
});
