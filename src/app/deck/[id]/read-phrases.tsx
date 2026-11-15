import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UiButton } from '@/components/ui-button';
import {
  getBookMinTranslationTier,
  getDeck,
  listBookWordForms,
  listCardsForDeck,
  listExamplesForDeck,
} from '@/db/queries';
import type { Example } from '@/db/types';
import { literalTranslate } from '@/lib/literal-translate';
import { normalizeRussian, stripAccents } from '@/morphology/dictionary';
import { useDatabase } from '@/providers/database-provider';

type Card = {
  id: string;
  entry_id: string;
  front: string;
  back: string;
  lemma: string;
};

/**
 * Read phrases: one card at a time, like reading practice. Each phrase is
 * shown in Russian with a word-by-word render underneath where words below
 * the book tier become English (when a gloss exists). The card's own word —
 * and every word at/above the book tier — stays in Russian.
 */
export default function ReadPhrasesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { revision } = useDatabase();
  const [deck, setDeck] = useState<{ id: string; name: string } | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [examplesByEntry, setExamplesByEntry] = useState<Map<string, Example[]>>(
    new Map(),
  );
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [lang, setLang] = useState<'ru' | 'en' | 'both'>('ru');

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([
        getDeck(id),
        listCardsForDeck(id),
        getBookMinTranslationTier(),
      ]).then(
        async ([nextDeck, nextCards, nextTier]) => {
          if (cancelled) return;
          if (!nextDeck) return;
          setDeck({ id: nextDeck.id, name: nextDeck.name });
          setCards(
            nextCards.map((c) => ({
              id: c.id,
              entry_id: c.entry_id,
              front: c.front,
              back: c.back,
              lemma: c.lemma,
            })),
          );
          // Words at/above the book tier stay Russian in phrases; everything
          // below it gets a word-by-word English render (when a gloss exists).
          const forms = await listBookWordForms(nextTier);
          if (cancelled) return;
          const baseKnown = new Set(forms.map((f) => f.form));
          setKnown(baseKnown);

          const examples = await listExamplesForDeck(id);
          if (cancelled) return;
          const byEntry = new Map<string, Example[]>();
          for (const ex of examples) {
            const list = byEntry.get(ex.entry_id) ?? [];
            list.push(ex);
            byEntry.set(ex.entry_id, list);
          }
          setExamplesByEntry(byEntry);
          setLoaded(true);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id, revision]),
  );

  // Per-card "keep Russian" set: the tier-based known words plus this card's
  // own word, so the target word always stays Russian even below the tier.
  function knownForCard(lemma: string, front: string): Set<string> {
    const next = new Set(known);
    next.add(normalizeRussian(stripAccents(lemma)));
    next.add(normalizeRussian(stripAccents(front)));
    return next;
  }

  const current = cards[cardIndex] ?? null;
  const currentExamples = current
    ? (examplesByEntry.get(current.entry_id) ?? [])
    : [];
  const usable = currentExamples
    .map((e) => ({ text: e.text.trim(), translation: e.translation.trim() }))
    .filter((p) => p.text.length > 0);
  const phrase = usable[phraseIndex % Math.max(usable.length, 1)] ?? null;

  const phraseText = phrase?.text ?? '';
  const phraseRender = phrase
    ? literalTranslate(phrase.text, { known: knownForCard(current?.lemma ?? '', current?.front ?? '') })
    : '';

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading phrases…</ThemedText>
      </Screen>
    );
  }

  if (!deck) {
    return (
      <Screen>
        <ThemedText type="subtitle">Deck not found</ThemedText>
        <UiButton label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (cards.length === 0) {
    return (
      <Screen>
        <ThemedText type="subtitle">Read phrases</ThemedText>
        <ThemedText themeColor="textSecondary">No cards in this deck yet.</ThemedText>
        <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <ThemedText type="subtitle">Read complete</ThemedText>
        <CardBlock>
          <ThemedText type="title">{cards.length}</ThemedText>
          <ThemedText themeColor="textSecondary">words read</ThemedText>
        </CardBlock>
        <UiButton label="Retry" onPress={() => setCardIndex(0)} />
        <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const hasPhrases = usable.length > 0;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {deck.name} · {cardIndex + 1} of {cards.length}
      </ThemedText>
      <CardBlock>
        <ThemedText type="title" style={styles.wordText}>
          {current.front}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.gloss}>
          {current.back}
        </ThemedText>
      </CardBlock>

      {hasPhrases ? (
        <>
          <CardBlock>
            <ThemedText type="subtitle" style={styles.phraseText}>
              {lang === 'ru' || lang === 'both' ? phraseText : phraseRender}
            </ThemedText>
            {lang === 'both' && phraseRender ? (
              <ThemedText themeColor="textSecondary" style={styles.translationText}>
                {phraseRender}
              </ThemedText>
            ) : null}
          </CardBlock>
          <ViewToggle
            lang={lang}
            onLangChange={setLang}
            hasRender={!!phraseRender}
          />
          <UiButton
            label={
              usable.length > 1 ? 'Another phrase' : 'No more phrases'
            }
            onPress={() =>
              setPhraseIndex((i) => (i + 1) % usable.length)
            }
            disabled={usable.length <= 1}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
            {usable.length > 1
              ? `Phrase ${1 + (phraseIndex % usable.length)} of ${usable.length}`
              : ''}
          </ThemedText>
        </>
      ) : (
        <ThemedText themeColor="textSecondary">
          No phrases saved for this word yet.
        </ThemedText>
      )}

      <UiButton
        label="Next card"
        variant="secondary"
        onPress={() => {
          setPhraseIndex(0);
          setCardIndex((i) => (i + 1) % cards.length);
        }}
      />
      <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

function ViewToggle({
  lang,
  onLangChange,
  hasRender,
}: {
  lang: 'ru' | 'en' | 'both';
  onLangChange: (value: 'ru' | 'en' | 'both') => void;
  hasRender: boolean;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.toggleContainer}>
      <UiButton
        label="RU"
        variant={lang === 'ru' ? 'primary' : 'secondary'}
        onPress={() => onLangChange('ru')}
        style={styles.toggle}
      />
      <UiButton
        label="EN"
        variant={lang === 'en' ? 'primary' : 'secondary'}
        onPress={() => onLangChange('en')}
        disabled={!hasRender}
        style={styles.toggle}
      />
      <UiButton
        label="BOTH"
        variant={lang === 'both' ? 'primary' : 'secondary'}
        onPress={() => onLangChange('both')}
        disabled={!hasRender}
        style={styles.toggle}
      />
    </ThemedView>
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
  gloss: {
    textAlign: 'center',
    marginBottom: 16,
  },
  phraseText: {
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 32,
    minHeight: 64,
  },
  translationText: {
    fontSize: 18,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 26,
    minHeight: 52,
  },
  toggleContainer: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    width: '100%',
    marginVertical: 12,
  },
  toggle: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 80,
  },
});
