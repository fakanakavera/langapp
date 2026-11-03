import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { MultiFaceCard } from '@/components/multi-face-card';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { useTheme } from '@/hooks/use-theme';
import { listCardStatsForDeck, listDueCards, listExamples, listKnownWords, mapFaceResponsesToRating, reviewCard } from '@/db/queries';
import type { CardStats } from '@/db/queries';
import type { DueCard, FaceResponse } from '@/db/types';
import { Rating } from '@/srs/scheduler';
import { buildHintPhrase, type KnownWord } from '@/lib/hint-phrase';
import { sortCards, type CardSortKey, CARD_SORT_DEFAULT_ASC, CARD_SORT_OPTIONS } from '@/lib/card-sort';
import { useDatabase } from '@/providers/database-provider';

export default function ReviewScreen() {
  const { deckId } = useLocalSearchParams<{ deckId?: string }>();
  const router = useRouter();
  const { refresh, revision } = useDatabase();
  const theme = useTheme();
  const [rawQueue, setRawQueue] = useState<DueCard[]>([]);
  const [stats, setStats] = useState<Map<string, CardStats>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [phraseTranslation, setPhraseTranslation] = useState('');
  const [exampleHint, setExampleHint] = useState('');
  const [knownWords, setKnownWords] = useState<KnownWord[]>([]);
  const [sortKey, setSortKey] = useState<CardSortKey>('due');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    Promise.all([listDueCards(deckId), listCardStatsForDeck(deckId ?? '')]).then(
      ([cards, deckStats]) => {
        setStats(new Map(deckStats.map((s) => [s.card_id, s])));
        setRawQueue(cards);
        setLoaded(true);
      },
    );
    listKnownWords().then(setKnownWords);
  }, [deckId, revision]);

  // Re-order all due cards by the chosen key. Nothing is pulled in that
  // isn't already due — the user's schedule is respected.
  const sortedQueue = useMemo(() => {
    return sortCards(rawQueue, stats, sortKey, sortAsc);
  }, [rawQueue, stats, sortKey, sortAsc]);

  const current = sortedQueue[0];
  const currentId = current?.id;
  const currentEntryId = current?.entry_id;
  const currentFront = current?.front ?? '';

  // Face-2 hint: English context with the target word — and every
  // already-known word — shown in Russian.
  const hint = useMemo(
    () =>
      current
        ? buildHintPhrase(current.front, current.back, phraseTranslation, knownWords, exampleHint)
        : '',
    [current, phraseTranslation, knownWords, exampleHint],
  );

  // Load the example phrase for the current card. Depends on stable ids —
  // not the `current` object identity — so re-renders don't refetch in a loop.
  useEffect(() => {
    if (!currentId || !currentEntryId) return;
    let cancelled = false;
    listExamples(currentEntryId).then((examples) => {
      if (cancelled) return;
      if (examples.length > 0) {
        setPhraseTranslation(examples[0].translation);
        setExampleHint(examples[0].hint ?? '');
      } else {
        setPhraseTranslation(`Translation for ${currentFront}`);
        setExampleHint('');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, currentEntryId, currentFront]);

  async function onComplete(history: FaceResponse[]) {
    if (!current) return;
    const completedId = current.id;
    const missed = mapFaceResponsesToRating(history) === Rating.Again;
    // Advance immediately so the next card mounts fresh at face 1,
    // then persist + refresh in the background. A miss cycles to the
    // back of the queue for an immediate re-drill (DB due is ~1 min,
    // so it also survives a reload).
    setRawQueue((cards) => {
      const rest = cards.filter((c) => c.id !== completedId);
      return missed ? [...rest, current] : rest;
    });
    await reviewCard(current, history, { source: 'review' });
    refresh();
  }

  function onSortPress(key: CardSortKey) {
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(CARD_SORT_DEFAULT_ASC[key]);
    }
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
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {sortedQueue.length} left · {current.deck_name}
      </ThemedText>
      {sortedQueue.length > 0 && (
        <CardBlock>
          <ThemedText type="smallBold">Order by</ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortRow}>
            {CARD_SORT_OPTIONS.map((o) => {
              const active = o.key === sortKey;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => onSortPress(o.key)}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? theme.tint : theme.backgroundSelected },
                  ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: active ? '#ffffff' : theme.text }}>
                  {o.label}
                  {active ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </ThemedText>
              </Pressable>
              );
            })}
          </ScrollView>
        </CardBlock>
      )}
      <MultiFaceCard
        key={current.id}
        card={current}
        hint={hint}
        onComplete={onComplete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  counter: {
    marginBottom: 16,
    textAlign: 'center',
  },
  sortRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
