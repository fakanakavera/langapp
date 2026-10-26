import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';
import {
  getDeck,
  listCardsForDeck,
  listDueCards,
  listInflectionsForDeck,
  reviewCard,
} from '@/db/queries';
import type { CaseInflection } from '@/db/queries';
import type { Deck, DueCard, FaceResponse } from '@/db/types';
import {
  buildCaseQuestion,
  caseMeta,
  groupFormsByCase,
  isCasePos,
  starterCasePool,
  type CaseQuestion,
} from '@/lib/cases';
import { speakRussian, stopSpeech } from '@/lib/speech';

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function elapsedSince(shownAt: { current: number }): number {
  return Date.now() - shownAt.current;
}

type TrainableEntry = {
  entryId: string;
  lemma: string;
  gloss: string;
  rows: CaseInflection[];
};

function toTrainable(rows: CaseInflection[]): TrainableEntry[] {
  const byEntry = new Map<string, TrainableEntry>();
  for (const row of rows) {
    if (!isCasePos(row.pos)) continue;
    const existing = byEntry.get(row.entry_id) ?? {
      entryId: row.entry_id,
      lemma: row.lemma,
      gloss: row.gloss,
      rows: [],
    };
    existing.rows.push(row);
    byEntry.set(row.entry_id, existing);
  }
  // Only entries with at least 2 distinct case slots can make a question.
  return [...byEntry.values()].filter((e) => groupFormsByCase(e.rows).length >= 2);
}

const DONT_KNOW = '\0dont_know';

/**
 * Case trainer: pick the correct case form of the SAME word.
 * Deck-powered when the deck has nouns/pronouns/adjectives with case
 * inflections (distractors are other cases of the same lemma); falls back
 * to built-in starter nouns for practice when it doesn't. Graded answers
 * record like face 1 (source 'cases') so the streak ladder treats case
 * skill as word knowledge; fallback rounds are practice-only.
 */
export default function CasesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { refresh, revision } = useDatabase();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [questions, setQuestions] = useState<CaseQuestion[]>([]);
  const [cardsByEntry, setCardsByEntry] = useState<Map<string, DueCard>>(new Map());
  const [isFallback, setIsFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const shownAt = useRef<number>(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const firstLoadRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      const [nextDeck, inflections, due, allCards] = await Promise.all([
        getDeck(id),
        listInflectionsForDeck(id),
        listDueCards(id),
        listCardsForDeck(id),
      ]);
      if (cancelled) return;
      const trainable = toTrainable(inflections);
      const dueEntryIds = new Set(due.map((c) => c.entry_id));
      // Due words first (they need work anyway), then the rest — shuffled.
      const ordered = shuffle(trainable).sort((a, b) => {
        const aDue = dueEntryIds.has(a.entryId) ? 0 : 1;
        const bDue = dueEntryIds.has(b.entryId) ? 0 : 1;
        return aDue - bDue;
      });
      const built: CaseQuestion[] = [];
      for (const entry of ordered) {
        const q = buildCaseQuestion(
          entry.entryId,
          entry.lemma,
          entry.gloss,
          groupFormsByCase(entry.rows),
        );
        if (q) built.push(q);
        if (built.length >= 20) break;
      }
      if (built.length > 0) {
        setDeck(nextDeck);
        setQuestions(built);
        setCardsByEntry(new Map(allCards.map((c) => [c.entry_id, c])));
        setIsFallback(false);
        if (!firstLoadRef.current) {
          firstLoadRef.current = true;
          setTotal(built.length);
        }
      } else {
        // Standalone fallback: built-in nouns so the drill always works.
        const pool = starterCasePool();
        const byEntry = new Map<string, CaseInflection[]>();
        for (const row of pool) {
          const list = byEntry.get(row.entry_id) ?? [];
          list.push(row);
          byEntry.set(row.entry_id, list);
        }
        const fallback: CaseQuestion[] = [];
        for (const [entryId, rows] of shuffle([...byEntry.entries()])) {
          const q = buildCaseQuestion(rows[0].lemma, rows[0].lemma, rows[0].gloss, groupFormsByCase(rows));
          if (q) fallback.push({ ...q, entryId });
          if (fallback.length >= 10) break;
        }
        setDeck(nextDeck);
        setQuestions(fallback);
        setCardsByEntry(new Map());
        setIsFallback(true);
        if (!firstLoadRef.current) {
          firstLoadRef.current = true;
          setTotal(fallback.length);
        }
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

  const current = questions[0] ?? null;
  const meta = current ? caseMeta(current.targetCase) : null;

  const prompt = useMemo(() => {
    if (!current || !meta) return '';
    const number = current.number === 'sg' ? 'singular' : 'plural';
    return `${meta.en} (${meta.ru}), ${number}`;
  }, [current, meta]);

  useEffect(() => {
    if (!current) return;
    shownAt.current = Date.now();
    void speakRussian(current.lemma);
    return () => {
      stopSpeech();
    };
  }, [current]);

  function advance() {
    if (!mountedRef.current) return;
    setPicked(null);
    setQuestions((qs) => qs.slice(1));
  }

  function record(pick: string | null) {
    if (!current) return;
    const correct = pick === current.correctForm;
    if (correct) setScore((s) => s + 1);
    const card = cardsByEntry.get(current.entryId);
    // Fallback rounds have no card: practice only, nothing recorded.
    if (card) {
      const history: FaceResponse[] = [
        {
          face: 1,
          response: correct ? 'know' : 'dont_know',
          duration_ms: elapsedSince(shownAt),
          source: 'cases',
        },
      ];
      void reviewCard(card, history, { source: 'cases' });
    }
    if (correct) {
      void speakRussian(current.correctForm);
      advanceTimer.current = setTimeout(() => {
        advance();
        refresh();
      }, 900);
    } else {
      // Freeze on the correction until the user moves on.
      void speakRussian(current.correctForm);
    }
  }

  function onPick(option: string) {
    if (!current || picked) return;
    setPicked(option);
    record(option);
  }

  function onDontKnow() {
    if (!current || picked) return;
    setPicked(DONT_KNOW);
    record(null);
  }

  function onNext() {
    // Next only shows after a miss: cycle the question to the back for
    // an immediate re-drill (DB due is ~1 min, so it survives a reload).
    setQuestions((qs) => {
      const head = qs[0];
      if (qs.length <= 1 || !head) return qs.slice(1);
      return [...qs.slice(1), head];
    });
    setPicked(null);
    refresh();
  }

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading cases…</ThemedText>
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <ThemedText type="subtitle">Case drill complete</ThemedText>
        <CardBlock>
          <ThemedText type="title">
            {score} / {total}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {isFallback ? 'practice round — no cards graded' : 'correct — saved to history'}
          </ThemedText>
        </CardBlock>
        <UiButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {deck?.name ?? 'Cases'} · {questions.length} left · score {score}
      </ThemedText>
      {isFallback ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
          Built-in nouns — add nouns with cases to this deck for personal drills.
        </ThemedText>
      ) : null}
      <Pressable onPress={() => void speakRussian(current.lemma)}>
        <ThemedText type="title" style={styles.wordText}>
          {current.lemma}
        </ThemedText>
      </Pressable>
      <ThemedText themeColor="textSecondary" style={styles.glossText}>
        “{current.gloss}” — pick the {prompt}
      </ThemedText>
      {meta ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
          {meta.hint} · {meta.preps}
        </ThemedText>
      ) : null}
      <View style={styles.options}>
        {current.options.map((option, i) => {
          const isCorrect = option === current.correctForm;
          const isPicked = option === picked;
          const backgroundColor =
            picked && isCorrect
              ? theme.tint
              : picked && isPicked
                ? theme.error
                : theme.backgroundElement;
          const color = picked && (isCorrect || isPicked) ? '#ffffff' : theme.text;
          return (
            <Pressable
              key={`${option}-${i}`}
              onPress={() => onPick(option)}
              disabled={!!picked}
              style={[
                styles.option,
                { backgroundColor, opacity: picked && !isCorrect && !isPicked ? 0.6 : 1 },
              ]}>
              <ThemedText style={[styles.optionLabel, { color }]}>{option}</ThemedText>
            </Pressable>
          );
        })}
      </View>
      {picked && picked !== current.correctForm ? (
        <>
          <ThemedText type="smallBold" style={[styles.result, { color: theme.error }]}>
            Correct: {current.correctForm}
          </ThemedText>
          <UiButton label="Next word" onPress={onNext} />
        </>
      ) : (
        <UiButton
          label="Don't Know"
          variant="secondary"
          onPress={onDontKnow}
          disabled={!!picked}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  counter: {
    marginBottom: 8,
    textAlign: 'center',
  },
  wordText: {
    fontSize: 36,
    textAlign: 'center',
  },
  glossText: {
    fontSize: 18,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 26,
  },
  result: {
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
