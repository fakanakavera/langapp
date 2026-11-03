import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getDeck, listCardStatsForDeck, listDueCards } from '@/db/queries';
import type { CardStats } from '@/db/queries';
import type { Deck, DueCard } from '@/db/types';
import { sortCards, type CardSortKey, CARD_SORT_DEFAULT_ASC, CARD_SORT_OPTIONS } from '@/lib/card-sort';
import { speakEnglish, speakRussian, stopSpeech, toSpokenEnglish } from '@/lib/speech';

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Recall drill: the Russian word is shown while TTS repeats its meaning
 * until the user moves on. Voice mode is toggleable: English only,
 * Russian only, or alternating Russian + English. Practice only — nothing
 * is recorded.
 */
export default function RecallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [rawQueue, setRawQueue] = useState<DueCard[]>([]);
  const [stats, setStats] = useState<Map<string, CardStats>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<'en' | 'ru' | 'both'>('en');
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [autoAdvanceText, setAutoAdvanceText] = useState('5');
  const [sortKey, setSortKey] = useState<CardSortKey>('due');
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getDeck(id), listDueCards(id), listCardStatsForDeck(id)]).then(
      ([nextDeck, due, deckStats]) => {
        if (cancelled) return;
        setDeck(nextDeck);
        setStats(new Map(deckStats.map((s) => [s.card_id, s])));
        setRawQueue(due);
        setLoaded(true);
      },
    ).catch(() => {
      // Loading errors leave the empty state below.
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Re-order all due cards by the chosen key. Nothing is pulled in that
  // isn't already due — the user's schedule is respected.
  const sortedQueue = useMemo(() => {
    return sortCards(rawQueue, stats, sortKey, sortAsc);
  }, [rawQueue, stats, sortKey, sortAsc]);

  const current = sortedQueue[index] ?? null;
  const currentId = current?.id;
  const russian = current?.front ?? '';
  const english = current ? toSpokenEnglish(current.back) : '';

  // Repeat aloud until the user moves to the next word. "both" alternates
  // Russian once, English once, forever.
  useEffect(() => {
    if (!currentId) return;
    if (mode === 'en' && !english) return;
    if (mode === 'ru' && !russian) return;
    if (mode === 'both' && (!russian || !english)) return;
    let cancelled = false;
    let delay: ReturnType<typeof setTimeout> | null = null;
    let step = 0;
    const play = () => {
      if (cancelled) return;
      const useRussian = mode === 'ru' || (mode === 'both' && step % 2 === 0);
      const speak = useRussian ? speakRussian : speakEnglish;
      const text = useRussian ? russian : english;
      void speak(text, () => {
        if (cancelled) return;
        step += 1;
        delay = setTimeout(() => {
          if (!cancelled) play();
        }, 900);
      });
    };
    play();
    return () => {
      cancelled = true;
      if (delay) clearTimeout(delay);
      stopSpeech();
    };
  }, [currentId, english, russian, mode]);

  useEffect(() => {
    const seconds = Number(autoAdvanceText);
    if (
      !currentId ||
      !autoAdvance ||
      !/^\d+$/.test(autoAdvanceText) ||
      seconds < 1 ||
      seconds > 300
    ) {
      return;
    }
    const timer = setTimeout(() => setIndex((i) => i + 1), seconds * 1000);
    return () => clearTimeout(timer);
  }, [autoAdvance, autoAdvanceText, currentId]);

  function onRetry() {
    setRawQueue((prev) => shuffle(prev));
    setIndex(0);
    setSortKey('due');
    setSortAsc(true);
  }

  function onSortPress(key: CardSortKey) {
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(CARD_SORT_DEFAULT_ASC[key]);
    }
  }

  // Pre-render sort chips outside JSX to keep the expression simple.
  const sortChips = CARD_SORT_OPTIONS.map((o) => {
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
  });

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading drill…</ThemedText>
      </Screen>
    );
  }

  if (sortedQueue.length === 0) {
    return (
      <Screen>
        <ThemedText type="subtitle">Recall drill</ThemedText>
        <ThemedText themeColor="textSecondary">No cards due in this deck right now.</ThemedText>
        <UiButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <ThemedText type="subtitle">Drill complete</ThemedText>
        <CardBlock>
          <ThemedText type="title">{sortedQueue.length}</ThemedText>
          <ThemedText themeColor="textSecondary">words practiced</ThemedText>
        </CardBlock>
        <UiButton label="Retry" onPress={onRetry} />
        <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {deck?.name ?? 'Drill'} · {index + 1} of {sortedQueue.length}
      </ThemedText>
      {sortedQueue.length > 0 && (
        <CardBlock>
          <ThemedText type="smallBold">Order by</ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortRow}>
            {sortChips}
          </ScrollView>
        </CardBlock>
      )}
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        Say the meaning out loud
      </ThemedText>
      <ThemedText type="title" style={styles.wordText}>
        {current.front}
      </ThemedText>
      <View style={styles.toggleRow}>
        <UiButton
          label="EN"
          variant={mode === 'en' ? 'primary' : 'secondary'}
          onPress={() => setMode('en')}
          style={styles.toggle}
        />
        <UiButton
          label="RU"
          variant={mode === 'ru' ? 'primary' : 'secondary'}
          onPress={() => setMode('ru')}
          style={styles.toggle}
        />
        <UiButton
          label="RU+EN"
          variant={mode === 'both' ? 'primary' : 'secondary'}
          onPress={() => setMode('both')}
          style={styles.toggle}
        />
      </View>
      <CardBlock>
        <ThemedText type="smallBold">Auto-advance</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Move to the next word after this many seconds. Speech keeps playing between words.
        </ThemedText>
        <View style={styles.autoAdvanceRow}>
          <UiButton
            label={autoAdvance ? 'On' : 'Off'}
            variant={autoAdvance ? 'primary' : 'secondary'}
            onPress={() => setAutoAdvance((enabled) => !enabled)}
            style={styles.autoAdvanceToggle}
          />
          <TextInput
            accessibilityLabel="Seconds per word"
            keyboardType="number-pad"
            maxLength={3}
            value={autoAdvanceText}
            onChangeText={(value) => setAutoAdvanceText(value.replace(/[^0-9]/g, ''))}
            selectTextOnFocus
            style={[
              styles.secondsInput,
              {
                backgroundColor: theme.backgroundElement,
                color: theme.text,
                borderColor: theme.backgroundSelected,
              },
            ]}
          />
          <ThemedText>seconds</ThemedText>
        </View>
        {autoAdvance &&
        (!/^\d+$/.test(autoAdvanceText) ||
          Number(autoAdvanceText) < 1 ||
          Number(autoAdvanceText) > 300) ? (
          <ThemedText type="small" themeColor="error">
            Choose a time from 1 to 300 seconds.
          </ThemedText>
        ) : null}
      </CardBlock>
      <UiButton label="Next word" onPress={() => setIndex((i) => i + 1)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  counter: {
    marginBottom: 16,
    textAlign: 'center',
  },
  wordText: {
    fontSize: 36,
    textAlign: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    width: '100%',
  },
  toggle: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 80,
  },
  autoAdvanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  autoAdvanceToggle: {
    minWidth: 88,
  },
  secondsInput: {
    minWidth: 72,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    textAlign: 'center',
    fontSize: 16,
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
