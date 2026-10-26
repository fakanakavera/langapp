import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';
import { getDeck, listEntriesForDeck, listQuizDueCards, reviewCard } from '@/db/queries';
import type { Deck, DueCard, FaceResponse } from '@/db/types';
import type { DeckEntry } from '@/db/queries';
import { pickDistractorGlosses, createAiSession, closeAiSession } from '@/lib/distractors';
import { speakRussian, stopSpeech } from '@/lib/speech';

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A multiple-choice button: gloss text plus the entry it came from
 *  (undefined when several entries share the gloss). */
type QuizOption = { gloss: string; entry_id?: string };

async function buildOptions(
  entry: DeckEntry,
  entries: DeckEntry[],
  sessionId: string | null,
): Promise<{ options: QuizOption[]; aiUsed: boolean }> {
  const candidates = entries
    .filter((e) => e.entry_id !== entry.entry_id)
    .map((e) => ({ lemma: e.lemma, gloss: e.gloss, pos: e.pos }));
  const { glosses, aiUsed } = await pickDistractorGlosses(
    { lemma: entry.lemma, gloss: entry.gloss, pos: entry.pos },
    candidates,
    sessionId,
  );
  // Belt-and-braces: option texts (and React keys) must be unique.
  // Keep the source entry for each distractor so a miss can penalize
  // the confused word too — not just the tested one. Ambiguous glosses
  // shared by several entries carry no id and are never penalized.
  const byGloss = new Map<string, DeckEntry[]>();
  for (const e of entries) {
    const key = e.gloss.toLowerCase();
    const list = byGloss.get(key) ?? [];
    list.push(e);
    byGloss.set(key, list);
  }
  const toOption = (gloss: string): QuizOption => {
    const owners = byGloss.get(gloss.toLowerCase()) ?? [];
    const owner = owners.length === 1 ? owners[0] : undefined;
    return owner ? { gloss, entry_id: owner.entry_id } : { gloss };
  };
  const unique = [...new Set([entry.gloss, ...glosses])];
  return { options: shuffle(unique.map(toOption)), aiUsed };
}

function elapsedSince(shownAt: { current: number }): number {
  return Date.now() - shownAt.current;
}

// Sentinel for the "Don't Know" pick: never equals a real option, so the
// correct option still highlights green during feedback with no red pick.
const DONT_KNOW_OPTION: QuizOption = { gloss: '\0dont_know' };

/**
 * Multiple-choice drill over the deck's due cards. A correct answer is
 * recorded like face 1 "Know" (Easy); a wrong one is "Don't know" (Again).
 * Correct answers raise quiz mastery by one tier; misses demote by two and
 * bring the word due again in about a minute. Tier 10 waits 90 days after a
 * correct answer. Picking a wrong option also demotes the confused word.
 */
export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { refresh, revision } = useDatabase();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [optionsCache, setOptionsCache] = useState<Record<string, QuizOption[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<QuizOption | null>(null);
  const [score, setScore] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef<number>(0);
  const sessionRef = useRef<string | null>(null);
  const aiFailedRef = useRef<boolean>(false);
  const queueRef = useRef<DueCard[]>([]);
  const cacheRef = useRef<Record<string, QuizOption[]>>({});
  const firstLoadRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(false);
  const completedThisSessionRef = useRef<Set<string>>(new Set());

  // Mirror the queue for background pre-generation (refs stay out of render).
  useEffect(() => {
    queueRef.current = queue;
  });

  // Load deck + quiz-due queue + distractor pool. Re-runs on global refresh so
  // the queue stays in sync (answered cards drop out via rescheduling).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [nextDeck, due, deckEntries] = await Promise.all([
        getDeck(id),
        listQuizDueCards(id),
        listEntriesForDeck(id),
      ]);
      if (cancelled) return;
      setDeck(nextDeck);
      setQueue(due.filter((card) => !completedThisSessionRef.current.has(card.id)));
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
      // NOTE: do NOT clear the answer-advance timer here. This effect
      // re-runs on every global refresh (right after answering), and
      // clearing it would strand the next question in a locked state.
      stopSpeech();
    };
  }, [id, revision]);

  // One shared Apple-AI session for the whole quiz.
  useEffect(() => {
    if (!id) return;
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      const session = await createAiSession();
      if (cancelled) {
        await closeAiSession(session);
        return;
      }
      sessionRef.current = session;
    })().catch(() => {
      // Offline pool covers everything.
    });
    return () => {
      mountedRef.current = false;
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      const openSession = sessionRef.current;
      sessionRef.current = null;
      if (openSession) {
        void closeAiSession(openSession);
      }
    };
  }, [id]);

  const current = queue[0] ?? null;
  const currentId = current?.id;
  const currentEntryId = current?.entry_id;
  const spokenFront = current?.front ?? '';
  const correctGloss =
    entries.find((e) => e.entry_id === currentEntryId)?.gloss ?? current?.back ?? '';
  const options = current ? optionsCache[current.entry_id] : undefined;

  // Prepare options for the current card (and the next one in the
  // background) as soon as it becomes current. Skips already-cached cards
  // so refreshes never trigger duplicate AI calls.
  useEffect(() => {
    const card = queueRef.current.find((c) => c.id === currentId) ?? null;
    if (!card || entries.length === 0) return;
    let cancelled = false;
    const entryFor = (c: DueCard): DeckEntry =>
      entries.find((e) => e.entry_id === c.entry_id) ?? {
        entry_id: c.entry_id,
        lemma: c.front,
        gloss: c.back,
        pos: '',
      };
    const build = async (c: DueCard): Promise<void> => {
      if (cacheRef.current[c.entry_id]) return;
      const { options: built, aiUsed } = await buildOptions(
        entryFor(c),
        entries,
        aiFailedRef.current ? null : sessionRef.current,
      );
      if (!aiUsed && sessionRef.current) aiFailedRef.current = true;
      if (cancelled) return;
      cacheRef.current = { ...cacheRef.current, [c.entry_id]: built };
      setOptionsCache(cacheRef.current);
    };
    const next = queueRef.current.find((c) => c.id !== card.id) ?? null;
    void build(card).then(() => {
      if (!cancelled && next && next.entry_id !== card.entry_id) {
        void build(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, entries]);

  // Read each word aloud and stamp the answer timer when it appears.
  useEffect(() => {
    if (!currentEntryId || !spokenFront) return;
    shownAt.current = Date.now();
    void speakRussian(spokenFront);
    return () => {
      stopSpeech();
    };
  }, [currentEntryId, spokenFront]);

  function onPick(option: QuizOption) {
    if (!current || !options || picked) return;
    const correct = option.gloss === correctGloss;
    const history: FaceResponse[] = [
      {
        face: 1,
        response: correct ? 'know' : 'dont_know',
        duration_ms: elapsedSince(shownAt),
        source: 'quiz',
      },
    ];
    const done = current;
    setPicked(option);
    if (correct) setScore((s) => s + 1);
    // Record immediately so leaving mid-feedback never loses the answer,
    // but sync global state only after advancing: an early refresh would
    // pull the next question in while this tap is still held, flashing
    // its correct answer. A miss also lapses the picked word inside the
    // same transaction (one write — overlapping transactions roll back).
    const distractor =
      !correct && option.entry_id && typeof id === 'string'
        ? {
            deckId: id,
            entryId: option.entry_id,
            source: 'quiz-distractor' as const,
          }
        : undefined;
    const review = reviewCard(done, history, { source: 'quiz', distractor }).then(
      (updated) => ({ updated, error: null }),
      (error: unknown) => ({ updated: null, error }),
    );
    advanceTimer.current = setTimeout(() => {
      if (!mountedRef.current) return;
      void review
        .then((result) => {
          if (!mountedRef.current) return;
          if (!result.updated) {
            setPicked(null);
            Alert.alert(
              'Could not save quiz answer',
              result.error instanceof Error ? result.error.message : String(result.error),
            );
            return;
          }
          setPicked(null);
          if (correct) completedThisSessionRef.current.add(done.id);
          // Keep persisted mastery and FSRS values if the card is retried.
          setQueue((cards) => {
            const rest = cards.filter((c) => c.id !== done.id);
            return correct ? rest : [...rest, { ...done, ...result.updated }];
          });
          refresh();
        });
    }, 900);
  }

  function onDontKnow() {
    if (!current || !options || picked) return;
    const history: FaceResponse[] = [
      {
        face: 1,
        response: 'dont_know',
        duration_ms: elapsedSince(shownAt),
        source: 'quiz',
      },
    ];
    const done = current;
    setPicked(DONT_KNOW_OPTION);
    // Recorded as "Don't know" so a lucky guess can never count as known.
    const review = reviewCard(done, history, { source: 'quiz' }).then(
      (updated) => ({ updated, error: null }),
      (error: unknown) => ({ updated: null, error }),
    );
    advanceTimer.current = setTimeout(() => {
      if (!mountedRef.current) return;
      void review
        .then((result) => {
          if (!mountedRef.current) return;
          if (!result.updated) {
            setPicked(null);
            Alert.alert(
              'Could not save quiz answer',
              result.error instanceof Error ? result.error.message : String(result.error),
            );
            return;
          }
          setPicked(null);
          setQueue((cards) => [
            ...cards.filter((c) => c.id !== done.id),
            { ...done, ...result.updated },
          ]);
          refresh();
        });
    }, 900);
  }

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading quiz…</ThemedText>
      </Screen>
    );
  }

  if (entries.length < 2) {
    return (
      <Screen>
        <ThemedText type="subtitle">Quiz</ThemedText>
        <ThemedText themeColor="textSecondary">
          Add at least 2 words to this deck to play multiple choice.
        </ThemedText>
        <UiButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <ThemedText type="subtitle">Quiz complete</ThemedText>
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
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {deck?.name ?? 'Quiz'} · {queue.length} left · score {score}
      </ThemedText>
      <Pressable onPress={() => void speakRussian(spokenFront)}>
        <ThemedText type="title" style={styles.wordText}>
          {spokenFront}
        </ThemedText>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        Quiz mastery: Tier {current.mastery_tier} / 10
      </ThemedText>
      {!options ? (
        <ThemedText themeColor="textSecondary" style={styles.wordText}>
          Preparing options…
        </ThemedText>
      ) : (
        <View style={styles.options}>
          {options.map((option, optionIndex) => {
            const isCorrect = option.gloss === correctGloss;
            const isPicked = option.gloss === picked?.gloss;
            const backgroundColor =
              picked && isCorrect
                ? theme.tint
                : picked && isPicked
                  ? theme.error
                  : theme.backgroundElement;
            const color = picked && (isCorrect || isPicked) ? '#ffffff' : theme.text;
            return (
              <Pressable
                key={`${option.gloss}-${optionIndex}`}
                onPress={() => onPick(option)}
                disabled={!!picked}
                style={[styles.option, { backgroundColor, opacity: picked && !isCorrect && !isPicked ? 0.6 : 1 }]}>
                <ThemedText style={[styles.optionLabel, { color }]}>{option.gloss}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}
      <UiButton
        label="Don't Know"
        variant="secondary"
        onPress={onDontKnow}
        disabled={!options || !!picked}
      />
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
  options: {
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  option: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  optionLabel: {
    fontWeight: 600,
    textAlign: 'center',
  },
});
