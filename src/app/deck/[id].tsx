import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { getDeck, listCardsForDeck } from '@/db/queries';
import type { Deck, DueCard } from '@/db/types';
import { formatDue } from '@/lib/dates';
import { useDatabase } from '@/providers/database-provider';

export default function DeckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { revision } = useDatabase();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<DueCard[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([getDeck(id), listCardsForDeck(id)]).then(([nextDeck, nextCards]) => {
        if (cancelled) return;
        setDeck(nextDeck);
        setCards(nextCards);
      });
      return () => {
        cancelled = true;
      };
    }, [id, revision]),
  );

  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(timer);
  }, []);

  const dueCount = useMemo(
    () => cards.filter((card) => new Date(card.due).getTime() <= now).length,
    [cards, now]
  );

  return (
    <Screen>
      <ThemedText type="subtitle">{deck?.name ?? 'Deck'}</ThemedText>
      {deck?.description ? (
        <ThemedText themeColor="textSecondary">{deck.description}</ThemedText>
      ) : null}

      <UiButton
        label={dueCount ? `Review ${dueCount} due` : 'No cards due'}
        disabled={!dueCount}
        onPress={() => router.push({ pathname: '/review', params: { deckId: id } })}
      />

      {cards.map((card) => (
        <CardBlock key={card.id} onPress={() => router.push(`/entry/${card.entry_id}`)}>
          <ThemedText type="smallBold">
            {card.front} — {card.back}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDue(card.due)}
          </ThemedText>
        </CardBlock>
      ))}
    </Screen>
  );
}
