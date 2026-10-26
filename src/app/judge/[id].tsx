import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { CardBlock } from '@/components/card-block';
import { useTheme } from '@/hooks/use-theme';
import { getDeck, listDueCards, listEntriesForDeck, reviewCard } from '@/db/queries';
import type { Deck, DueCard, FaceResponse } from '@/db/types';
import type { DeckEntry } from '@/db/queries';
import { useDatabase } from '@/providers/database-provider';
import { speakRussian, stopSpeech } from '@/lib/speech';

function elapsedSince(shownAt: { current: number }): number {
  return Date.now() - shownAt.current;
}

/** Stable 0..1 hash: same input always decides the same way within a review. */
function hash01(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

type Shown = { text: string; isCorrect: boolean; lieEntryId?: string };

/**
 * True/false drill: a Russian word with a translation that is wrong ~60% of
 * the time. Judging correctly counts like face 1 "Know" (Easy), missing it
 * like face 1 "Don't know" — straight successes stretch the next review
 * on the streak ladder, one miss resets it. A false accept also lapses the word the
 * lie came from: believing "хотеть" means "car" proves confusion about
 * both words. Results land in history, stats, known words, and scheduling
 * like a normal review.
 */
export default function JudgeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { refresh, revision } = useDatabase();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<'correct' | 'wrong' | 'dont_know' | null>(null);
  const [score, setScore] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef<number>(0);
  const mountedRef = useRef<boolean>(false);
  const firstLoadRef = useRef<boolean>(false);

  // Due queue + full entry pool for wrong options. Re-runs on refresh so
  // answered cards drop out via rescheduling.
  useEffect(() => {
    if (!id) return;
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      const [nextDeck, due, deckEntries] = await Promise.all([
        getDeck(id),
        listDueCards(id),
        listEntriesForDeck(id),
      ]);
      if (cancelled) return;
      setDeck(nextDeck);
      setQueue(due);
      setEntries(deckEntries);
      if (!firstLoadRef.current) {
        firstLoadRef.current = true;
        setTotal(due.length);
      }
      setLoaded(true);
    })().catch(() => {
      // Loading errors leave the empty state below.
    });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      stopSpeech();
    };
  }, [id, revision]);

  const current = queue[0] ?? null;
  const currentEntryId = current?.entry_id;
  const spokenFront = current?.front ?? '';
  const correctGloss =
    entries.find((e) => e.entry_id === currentEntryId)?.gloss ?? current?.back ?? '';

  // Decide once per card whether to show the truth or a lie (60% lies).
  // Pure function of the card + its scheduling stamp: stable while the
  // question is on screen, re-rolled next review. Wrong options prefer the
  // same part of speech so they aren't trivially dismissable.
  const shown: Shown | null = (() => {
    if (!current) return null;
    const entry = entries.find((e) => e.entry_id === current.entry_id) ?? {
      entry_id: current.entry_id,
      lemma: current.front,
      gloss: current.back,
      pos: '',
    };
    const pool = entries.filter(
      (e) =>
        e.entry_id !== entry.entry_id &&
        e.gloss.toLowerCase() !== entry.gloss.toLowerCase(),
    );
    const samePos = entry.pos ? pool.filter((e) => e.pos && e.pos === entry.pos) : [];
    const ordered = [...samePos, ...pool.filter((e) => !samePos.includes(e))];
    const salt = `${entry.entry_id}:${current.due}`;
    const lieEntry =
      ordered.length > 0 && hash01(`${salt}:lie`) < 0.6
        ? ordered[Math.floor(hash01(`${salt}:pick`) * ordered.length)] ?? null
        : null;
    const lie = lieEntry?.gloss ?? null;
    if (lie && lieEntry && lie.toLowerCase() !== entry.gloss.toLowerCase()) {
      return { text: lie, isCorrect: false, lieEntryId: lieEntry.entry_id };
    }
    return { text: entry.gloss, isCorrect: true };
  })();

  // Read the word aloud and stamp the answer timer when it appears.
  useEffect(() => {
    if (!currentEntryId || !spokenFront) return;
    shownAt.current = Date.now();
    void speakRussian(spokenFront);
    return () => {
      stopSpeech();
    };
  }, [currentEntryId, spokenFront]);

  function onPick(judgment: 'correct' | 'wrong') {
    if (!current || !shown || picked) return;
    const right = (judgment === 'correct') === shown.isCorrect;
    const history: FaceResponse[] = [
      {
        face: 1,
        response: right ? 'know' : 'dont_know',
        duration_ms: elapsedSince(shownAt),
        source: 'judge',
      },
    ];
    const done = current;
    setPicked(judgment);
    if (right) setScore((s) => s + 1);
    // Record immediately; sync globally only after advancing, so a refresh
    // can never yank the next question in mid-feedback. A false accept
    // also lapses the lied-about word in the same transaction (one write —
    // overlapping transactions roll back).
    const distractor =
      !right && !shown.isCorrect && shown.lieEntryId && typeof id === 'string'
        ? {
            deckId: id,
            entryId: shown.lieEntryId,
            source: 'judge-distractor' as const,
          }
        : undefined;
    void reviewCard(done, history, { source: 'judge', distractor });
    if (!right) {
      // Freeze on the correction until the user moves on.
      return;
    }
    advanceTimer.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setPicked(null);
      setQueue((cards) => cards.filter((c) => c.id !== done.id));
      refresh();
    }, 900);
  }

  function onDontKnow() {
    if (!current || !shown || picked) return;
    const history: FaceResponse[] = [
      {
        face: 1,
        response: 'dont_know',
        duration_ms: elapsedSince(shownAt),
        source: 'judge',
      },
    ];
    const done = current;
    setPicked('dont_know');
    // Never scores: a lucky guess must not count as known. Freezes on the
    // correction like a wrong answer until the user moves on.
    void reviewCard(done, history, { source: 'judge' });
  }

  function onNextWord() {
    if (!current || !picked) return;
    const done = current;
    // Missed words cycle to the back for an immediate re-drill (DB due
    // is ~1 min, so they also survive a reload). Exit via Done to stop.
    const judgedRight =
      picked === 'correct' ? shown?.isCorrect : picked === 'wrong' ? !shown?.isCorrect : false;
    const miss = !judgedRight;
    setPicked(null);
    setQueue((cards) => {
      const rest = cards.filter((c) => c.id !== done.id);
      return miss ? [...rest, done] : rest;
    });
    refresh();
  }

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading drill…</ThemedText>
      </Screen>
    );
  }

  if (entries.length < 2) {
    return (
      <Screen>
        <ThemedText type="subtitle">True or false</ThemedText>
        <ThemedText themeColor="textSecondary">
          Add at least 2 words to this deck — lies need alternatives.
        </ThemedText>
        <UiButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!current || !shown) {
    if (!current) {
      return (
        <Screen>
          <ThemedText type="subtitle">Drill complete</ThemedText>
          <CardBlock>
            <ThemedText type="title">
              {score} / {total}
            </ThemedText>
            <ThemedText themeColor="textSecondary">correct — saved to history</ThemedText>
          </CardBlock>
          <UiButton label="Done" onPress={() => router.back()} />
        </Screen>
      );
    }
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Preparing…</ThemedText>
      </Screen>
    );
  }

  const judgedRight =
    picked === 'correct' ? shown.isCorrect : picked === 'wrong' ? !shown.isCorrect : false;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {deck?.name ?? 'Drill'} · {queue.length} left · score {score}
      </ThemedText>
      <Pressable onPress={() => void speakRussian(spokenFront)}>
        <ThemedText type="title" style={styles.wordText}>
          {spokenFront}
        </ThemedText>
      </Pressable>
      <ThemedText themeColor="textSecondary" style={styles.translationText}>
        {shown.text}
      </ThemedText>
      <ThemedText
        type="smallBold"
        style={[styles.result, picked ? { color: judgedRight ? theme.tint : theme.error } : null]}>
        {picked ? (judgedRight ? 'Right!' : `It means "${correctGloss}"`) : ' '}
      </ThemedText>
      {picked && !judgedRight ? (
        <UiButton label="Next word" onPress={onNextWord} />
      ) : (
        <>
          <UiButton
            label="Correct"
            variant="primary"
            onPress={() => onPick('correct')}
            disabled={!!picked}
          />
          <UiButton
            label="Wrong"
            variant="secondary"
            onPress={() => onPick('wrong')}
            disabled={!!picked}
          />
          <UiButton
            label="Don't Know"
            variant="secondary"
            onPress={onDontKnow}
            disabled={!!picked}
          />
        </>
      )}
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
  translationText: {
    fontSize: 22,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 32,
    minHeight: 64,
  },
  result: {
    textAlign: 'center',
    minHeight: 20,
  },
});
