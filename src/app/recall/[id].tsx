import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { getDeck, listDueCards } from '@/db/queries';
import type { Deck, DueCard } from '@/db/types';
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
  const [deck, setDeck] = useState<Deck | null>(null);
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<'en' | 'ru' | 'both'>('en');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getDeck(id), listDueCards(id)]).then(([nextDeck, due]) => {
      if (cancelled) return;
      setDeck(nextDeck);
      setQueue(due);
      setLoaded(true);
    }).catch(() => {
      // Loading errors leave the empty state below.
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const current = queue[index] ?? null;
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

  function onRetry() {
    setQueue((prev) => shuffle(prev));
    setIndex(0);
  }

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading drill…</ThemedText>
      </Screen>
    );
  }

  if (queue.length === 0) {
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
          <ThemedText type="title">{queue.length}</ThemedText>
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
        {deck?.name ?? 'Drill'} · {index + 1} of {queue.length}
      </ThemedText>
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
});
