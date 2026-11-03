import { useLocalSearchParams, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { generateReadingPhrases } from '@/ai/engine';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getDeck, listCardStatsForDeck, listDueCards, listExamples, listKnownLemmas } from '@/db/queries';
import type { CardStats } from '@/db/queries';
import type { Deck, DueCard } from '@/db/types';
import { closeAiSession, createAiSession } from '@/lib/distractors';
import { sortCards, type CardSortKey, CARD_SORT_DEFAULT_ASC, CARD_SORT_OPTIONS } from '@/lib/card-sort';
import { speakEnglish, speakRussian, stopSpeech } from '@/lib/speech';

type Phrase = { text: string; translation: string };

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Reading drill: a Russian phrase using the card's word, read aloud on loop
 * (Russian, English, or both, toggleable). "Another phrase" asks on-device Apple AI
 * for a fresh sentence; stored examples cover for it when AI is unavailable.
 * Practice only — nothing is recorded.
 */
export default function ReadingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [rawQueue, setRawQueue] = useState<DueCard[]>([]);
  const [stats, setStats] = useState<Map<string, CardStats>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [lang, setLang] = useState<'ru' | 'en' | 'both'>('ru');
  const [autoAdvanceText, setAutoAdvanceText] = useState('5');
  const [speechStart, setSpeechStart] = useState<{ cardId: string; startedAt: number } | null>(
    null,
  );
  const [stored, setStored] = useState<Phrase[]>([]);
  const [storedIndex, setStoredIndex] = useState(0);
  const [aiPhrase, setAiPhrase] = useState<Phrase | null>(null);
  const [generating, setGenerating] = useState(false);
  const [knownLemmas, setKnownLemmas] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<CardSortKey>('due');
  const [sortAsc, setSortAsc] = useState(true);
  // False in Expo Go / off-iOS: Apple AI can never answer there, so the
  // button can only cycle saved phrases.
  const aiPossible = Platform.OS === 'ios' && Constants.appOwnership !== 'expo';
  const sessionRef = useRef<string | null>(null);
  const mountedRef = useRef<boolean>(false);

  // Deck + due queue + known words; one shared AI session for the visit.
  useEffect(() => {
    if (!id) return;
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      const [nextDeck, due, deckStats, lemmas] = await Promise.all([
        getDeck(id),
        listDueCards(id),
        listCardStatsForDeck(id),
        listKnownLemmas(80),
      ]);
      if (cancelled) return;
      setDeck(nextDeck);
      setStats(new Map(deckStats.map((s) => [s.card_id, s])));
      setRawQueue(due);
      setKnownLemmas(lemmas);
      setLoaded(true);
      const session = await createAiSession(
        'You write short beginner Russian sentences. Follow instructions exactly.',
      );
      if (cancelled) {
        await closeAiSession(session);
        return;
      }
      sessionRef.current = session;
    })().catch(() => {
      // Loading errors leave the empty state below.
    });
    return () => {
      mountedRef.current = false;
      cancelled = true;
      stopSpeech();
      const openSession = sessionRef.current;
      sessionRef.current = null;
      if (openSession) {
        void closeAiSession(openSession);
      }
    };
  }, [id]);

  // Re-order all due cards by the chosen key. Nothing is pulled in that
  // isn't already due — the user's schedule is respected.
  const sortedQueue = useMemo(() => {
    return sortCards(rawQueue, stats, sortKey, sortAsc);
  }, [rawQueue, stats, sortKey, sortAsc]);

  const current = sortedQueue[index] ?? null;
  const currentId = current?.id;
  const currentEntryId = current?.entry_id;

  // Stored phrases for the current card (full Russian text preferred).
  useEffect(() => {
    if (!currentEntryId) return;
    let cancelled = false;
    listExamples(currentEntryId).then((examples) => {
      if (cancelled) return;
      const usable = examples
        .map((e) => ({ text: e.text || e.hint, translation: e.translation }))
        .filter((p) => p.text.trim());
      setStored(usable);
      setStoredIndex(0);
      setAiPhrase(null);
      // Nothing saved: ask AI right away so the card isn't empty.
      if (usable.length === 0) {
        void requestAiPhrase();
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEntryId]);

  async function requestAiPhrase(): Promise<boolean> {
    const card = sortedQueue[index] ?? null;
    if (!card || !mountedRef.current) return false;
    setGenerating(true);
    try {
      const generated = await generateReadingPhrases(
        { lemma: card.front, gloss: card.back, knownLemmas },
        sessionRef.current,
      );
      if (!mountedRef.current) return false;
      if (generated && generated.length > 0) {
        setAiPhrase({ text: generated[0].text, translation: generated[0].translation });
        return true;
      }
      return false;
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }

  async function onAnotherPhrase() {
    if (generating) return;
    const made = await requestAiPhrase();
    // AI unavailable or failed: cycle stored phrases instead.
    if (!made) {
      setAiPhrase(null);
      setStoredIndex((i) => (stored.length > 0 ? (i + 1) % stored.length : 0));
    }
  }

  const phrase: Phrase | null =
    aiPhrase ?? (stored.length > 0 ? stored[storedIndex % stored.length] : null);
  const phraseText = phrase?.text ?? '';
  const phraseTranslation = phrase?.translation ?? '';
  const spoken = phrase
    ? lang === 'ru'
      ? phraseText
      : lang === 'en'
        ? phraseTranslation
        : [phraseText, phraseTranslation].filter(Boolean).join('\n')
    : '';

  const phraseStatus = !phrase
    ? 'No saved phrases — tap below to ask Apple AI.'
    : aiPhrase
      ? 'Fresh phrase, written by Apple AI just now.'
      : stored.length > 1
        ? `Saved phrase ${1 + (storedIndex % stored.length)} of ${stored.length}.`
        : aiPossible
          ? 'Only one saved phrase — Apple AI failed, tap to retry.'
          : 'Only one saved phrase — Apple AI needs a dev build.';

  // Loop the phrase aloud until the card changes or the language toggles.
  useEffect(() => {
    if (!currentId || !spoken) return;
    let cancelled = false;
    let delay: ReturnType<typeof setTimeout> | null = null;
    const onSpeechStart = () => {
      if (cancelled) return;
      setSpeechStart((previous) =>
        previous?.cardId === currentId
          ? previous
          : { cardId: currentId, startedAt: Date.now() },
      );
    };
    const play = () => {
      if (cancelled) return;
      const onDone = () => {
        if (cancelled) return;
        delay = setTimeout(() => {
          if (!cancelled) play();
        }, 900);
      };
      if (lang === 'both' && phraseTranslation) {
        void speakRussian(
          phraseText,
          () => {
            if (!cancelled) void speakEnglish(phraseTranslation, onDone, onSpeechStart);
          },
          onSpeechStart,
        );
      } else if (lang === 'en') {
        void speakEnglish(spoken, onDone, onSpeechStart);
      } else {
        void speakRussian(spoken, onDone, onSpeechStart);
      }
    };
    play();
    return () => {
      cancelled = true;
      if (delay) clearTimeout(delay);
      stopSpeech();
    };
  }, [currentId, lang, phraseText, phraseTranslation, spoken]);

  useEffect(() => {
    const seconds = Number(autoAdvanceText);
    if (
      !currentId ||
      !spoken ||
      !/^\d+$/.test(autoAdvanceText) ||
      seconds < 1 ||
      seconds > 300
    ) {
      return;
    }
    // Count from when speech started for this card. If speechStart was never
    // recorded for the current card (e.g. TTS onStart didn't fire), fall back
    // to now so auto-next still advances instead of stalling forever.
    const startedAt =
      speechStart?.cardId === currentId ? speechStart.startedAt : Date.now();
    const remaining = seconds * 1000 - (Date.now() - startedAt);
    const timer = setTimeout(() => setIndex((i) => i + 1), Math.max(remaining, 0));
    return () => clearTimeout(timer);
  }, [autoAdvanceText, currentId, speechStart, spoken]);

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

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading reading…</ThemedText>
      </Screen>
    );
  }

  if (sortedQueue.length === 0) {
    return (
      <Screen>
        <ThemedText type="subtitle">Reading practice</ThemedText>
        <ThemedText themeColor="textSecondary">No cards due in this deck right now.</ThemedText>
        <UiButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <ThemedText type="subtitle">Reading complete</ThemedText>
        <CardBlock>
          <ThemedText type="title">{sortedQueue.length}</ThemedText>
          <ThemedText themeColor="textSecondary">words read</ThemedText>
        </CardBlock>
        <UiButton label="Retry" onPress={onRetry} />
        <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
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

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {deck?.name ?? 'Reading'} · {index + 1} of {sortedQueue.length}
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
      <ThemedText type="title" style={styles.wordText}>
        {current.front}
      </ThemedText>
      {phrase ? (
        <>
          <ThemedText type="subtitle" style={styles.phraseText}>
            {phrase.text}
          </ThemedText>
          {phrase.translation ? (
            <ThemedText themeColor="textSecondary" style={styles.translationText}>
              {phrase.translation}
            </ThemedText>
          ) : null}
        </>
      ) : (
        <ThemedText themeColor="textSecondary" style={styles.phraseText}>
          {generating ? 'Writing a phrase…' : 'No phrases saved for this word yet.'}
        </ThemedText>
      )}
      <View style={styles.toggleRow}>
        <UiButton
          label="RU"
          variant={lang === 'ru' ? 'primary' : 'secondary'}
          onPress={() => setLang('ru')}
          style={styles.toggle}
        />
        <UiButton
          label="EN"
          variant={lang === 'en' ? 'primary' : 'secondary'}
          onPress={() => setLang('en')}
          disabled={!phrase?.translation}
          style={styles.toggle}
        />
        <UiButton
          label="BOTH"
          variant={lang === 'both' ? 'primary' : 'secondary'}
          onPress={() => setLang('both')}
          disabled={!phrase?.translation}
          style={styles.toggle}
        />
      </View>
      <View style={styles.autoAdvanceRow}>
        <ThemedText type="smallBold">Auto-next (seconds)</ThemedText>
        <TextInput
          accessibilityLabel="Seconds before automatically moving to the next word"
          value={autoAdvanceText}
          onChangeText={(value) => setAutoAdvanceText(value.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          maxLength={3}
          placeholder="0"
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.secondsInput,
            { color: theme.text, backgroundColor: theme.backgroundElement },
          ]}
        />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        Enter 1–300 seconds; leave it at 0 to turn auto-next off.
      </ThemedText>
      <UiButton
        label={generating ? 'Writing…' : 'Another phrase'}
        onPress={onAnotherPhrase}
        disabled={generating}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {generating ? 'Asking Apple AI…' : phraseStatus}
      </ThemedText>
      <UiButton label="Next card" variant="secondary" onPress={() => setIndex((i) => i + 1)} />
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
  phraseText: {
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 32,
    // Fixed two-line slot so 1-line and 2-line phrases don't move the buttons.
    minHeight: 64,
  },
  translationText: {
    fontSize: 18,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 26,
    // Same idea for the translation row below it.
    minHeight: 52,
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
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    width: '100%',
  },
  secondsInput: {
    borderRadius: Spacing.two,
    minWidth: 64,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
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
