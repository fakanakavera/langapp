import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { countDueCards, listDeckSummaries } from '@/db/queries';
import type { DeckSummary } from '@/db/types';
import { useDatabase } from '@/providers/database-provider';

export default function TodayScreen() {
  const router = useRouter();
  const { revision } = useDatabase();
  const [dueCount, setDueCount] = useState(0);
  const [decks, setDecks] = useState<DeckSummary[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([countDueCards(), listDeckSummaries()]).then(([due, deckRows]) => {
        if (cancelled) return;
        setDueCount(due);
        setDecks(deckRows);
      });
      return () => {
        cancelled = true;
      };
    }, [revision]),
  );

  const cardTotal = decks.reduce((sum, deck) => sum + deck.card_count, 0);

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Today</ThemedText>
      <ThemedText themeColor="textSecondary">
        Review due cards. FSRS schedules the next time based on how well you remember.
      </ThemedText>

      <CardBlock>
        <ThemedText type="title">{dueCount}</ThemedText>
        <ThemedText>cards due</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {cardTotal} cards across {decks.length} decks
        </ThemedText>
      </CardBlock>

      <UiButton
        label={dueCount ? 'Start reviews' : 'Nothing due'}
        disabled={!dueCount}
        onPress={() => router.push('/review')}
      />
    </Screen>
  );
}
