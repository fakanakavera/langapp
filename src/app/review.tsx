import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Grade } from 'ts-fsrs';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { listDueCards, reviewCard } from '@/db/queries';
import type { DueCard } from '@/db/types';
import { useDatabase } from '@/providers/database-provider';
import { RATING_LABELS } from '@/srs/scheduler';

export default function ReviewScreen() {
  const { deckId } = useLocalSearchParams<{ deckId?: string }>();
  const router = useRouter();
  const { refresh } = useDatabase();
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listDueCards(deckId).then((cards) => {
      setQueue(cards);
      setLoaded(true);
    });
  }, [deckId]);

  const current = queue[0];

  async function onGrade(rating: Grade) {
    if (!current) return;
    await reviewCard(current, rating);
    setRevealed(false);
    setQueue((cards) => cards.slice(1));
    refresh();
  }

  if (loaded && !current) {
    return (
      <Screen>
        <ThemedText type="subtitle">Caught up</ThemedText>
        <ThemedText themeColor="textSecondary">No more cards are due right now.</ThemedText>
        <UiButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading reviews…</ThemedText>
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {queue.length} left · {current.deck_name}
      </ThemedText>
      <CardBlock>
        <ThemedText type="subtitle">{current.front}</ThemedText>
        {revealed ? (
          <ThemedText>{current.back}</ThemedText>
        ) : (
          <ThemedText themeColor="textSecondary">Tap reveal when you have an answer.</ThemedText>
        )}
      </CardBlock>

      {!revealed ? (
        <UiButton label="Reveal" onPress={() => setRevealed(true)} />
      ) : (
        <View style={styles.grades}>
          {RATING_LABELS.map((item) => (
            <View key={item.rating} style={styles.grade}>
              <UiButton
                label={item.label}
                variant={item.rating === 3 ? 'primary' : 'secondary'}
                onPress={() => onGrade(item.rating)}
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grades: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  grade: {
    flexGrow: 1,
    minWidth: '45%',
  },
});
