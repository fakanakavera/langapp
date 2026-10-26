import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import {
  addVocabulary,
  clearUnknownWords,
  createDeck,
  getBook,
  listDeckSummaries,
  listUnknownWords,
  removeUnknownWord,
} from '@/db/queries';
import type { Book, DeckSummary, UnknownWord } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { buildAiDeckPrompt } from '@/lib/book-text';
import { ruEnLookup } from '@/lib/ru-en-dictionary';
import { PLACEHOLDER_GLOSS } from '@/lib/csv-import';
import { normalizeRussian, stripAccents } from '@/morphology/dictionary';
import { useDatabase } from '@/providers/database-provider';

/**
 * Unknown words marked in a book. Two ways out:
 * 1) type glosses and create real deck cards right here, or
 * 2) share an AI-ready prompt (word + sentence each) to any chat AI and
 *    re-import its "Front","Back" CSV via Settings → Import.
 */
export default function BookWordsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { refresh, revision } = useDatabase();
  const [book, setBook] = useState<Book | null>(null);
  const [words, setWords] = useState<UnknownWord[]>([]);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [newDeckName, setNewDeckName] = useState('');
  const [glosses, setGlosses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (typeof id !== 'string') return Promise.resolve();
    return Promise.all([getBook(id), listUnknownWords(id), listDeckSummaries()]).then(
      ([nextBook, nextWords, nextDecks]) => {
        setBook(nextBook);
        setWords(nextWords);
        setDecks(nextDecks);
        setDeckId((current) => current ?? nextDecks[0]?.id ?? null);
        // Pre-fill English glosses from the offline dictionary so new cards
        // get a meaning automatically. User-typed glosses are never overwritten.
        setGlosses((prev) => {
          const next = { ...prev };
          for (const word of nextWords) {
            if (next[word.id]) continue;
            const key = word.normalized || normalizeRussian(stripAccents(word.lemma_guess ?? word.surface));
            const en = ruEnLookup(key);
            if (en) next[word.id] = en;
          }
          return next;
        });
      },
      () => {
        // Loading errors leave the empty state below.
      },
    );
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload, revision]),
  );

  async function onCreateDeck() {
    const name = newDeckName.trim();
    if (!name) {
      Alert.alert('Name the deck first');
      return;
    }
    setBusy(true);
    try {
      const deck = await createDeck(name);
      setNewDeckName('');
      setDeckId(deck.id);
      refresh();
      await reload();
    } catch (error) {
      Alert.alert('Could not create deck', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateCards() {
    if (!deckId) {
      Alert.alert('Pick a deck first');
      return;
    }
    if (words.length === 0) return;
    setBusy(true);
    try {
      let created = 0;
      // Words alone are enough: a missing meaning becomes the visible
      // "(no translation yet)" placeholder, filled in while reviewing.
      for (const word of words) {
        const gloss = (glosses[word.id] ?? '').trim() || PLACEHOLDER_GLOSS;
        await addVocabulary({
          deckId,
          lemma: word.lemma_guess.trim() || word.surface,
          gloss,
          surfaceForm: word.surface,
          notes: word.context,
        });
        await removeUnknownWord(word.id);
        created += 1;
      }
      setGlosses({});
      refresh();
      await reload();
      Alert.alert('Cards created', `${created} card${created === 1 ? '' : 's'} added to the deck.`);
    } catch (error) {
      Alert.alert('Could not create cards', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onSharePrompt() {
    if (!book || words.length === 0) return;
    setBusy(true);
    try {
      const prompt = buildAiDeckPrompt(book.title, words);
      const file = new File(Paths.cache, 'unknown-words-prompt.txt');
      if (file.exists) file.delete();
      file.create();
      file.write(prompt);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/plain',
          dialogTitle: 'Share unknown words for AI deck',
        });
        return;
      }
      throw new Error('Sharing is not available on this device.');
    } catch (error) {
      Alert.alert('Share failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmClear() {
    if (typeof id !== 'string') return;
    Alert.alert(
      'Remove all marked words?',
      'They stay out of every deck — this only clears the list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearUnknownWords(id)
              .then(() => {
                refresh();
                return reload();
              })
              .catch((error) => {
                Alert.alert('Could not clear', error instanceof Error ? error.message : String(error));
              });
          },
        },
      ],
    );
  }

  const inputStyle = [
    styles.input,
    { color: theme.text, backgroundColor: theme.backgroundElement },
  ];

  return (
    <Screen>
      <ThemedText type="subtitle">Unknown words{book ? ` · ${book.title}` : ''}</ThemedText>
      <ThemedText themeColor="textSecondary">
        Words alone are enough — meanings are optional and become a placeholder until you
        fill them in. Or share the list to an AI and re-import its CSV as a proper deck.
      </ThemedText>

      <ThemedText type="smallBold">Deck for new cards</ThemedText>
      <View style={styles.deckRow}>
        {decks.map((deck) => (
          <CardBlock
            key={deck.id}
            onPress={() => setDeckId(deck.id)}
            style={deck.id === deckId ? { backgroundColor: theme.backgroundSelected } : undefined}>
            <ThemedText type="small">{deck.name}</ThemedText>
          </CardBlock>
        ))}
      </View>
      <TextInput
        value={newDeckName}
        onChangeText={setNewDeckName}
        placeholder="Or a new deck name"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        style={inputStyle}
      />
      <UiButton label="Create deck" variant="secondary" onPress={onCreateDeck} disabled={busy} />
      {words.length > 0 ? (
        <UiButton
          label={`Create ${words.length} card${words.length === 1 ? '' : 's'} in picked deck`}
          onPress={onCreateCards}
          disabled={busy}
        />
      ) : null}

      {words.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          Nothing marked — go back to the book and tap words you don&apos;t know.
        </ThemedText>
      ) : (
        words.map((word) => (
          <CardBlock key={word.id}>
            <ThemedText type="smallBold">
              {word.surface}
              {word.lemma_guess && word.lemma_guess !== word.surface
                ? ` (${word.lemma_guess})`
                : ''}
            </ThemedText>
            {word.context ? (
              <ThemedText type="small" themeColor="textSecondary">
                “{word.context}”
              </ThemedText>
            ) : null}
            <TextInput
              value={glosses[word.id] ?? ''}
              onChangeText={(value) => setGlosses((prev) => ({ ...prev, [word.id]: value }))}
              placeholder="Meaning in English (optional)"
              placeholderTextColor={theme.textSecondary}
              style={inputStyle}
            />
            <UiButton
              label="Remove"
              variant="secondary"
              onPress={() => {
                removeUnknownWord(word.id)
                  .then(() => {
                    refresh();
                    return reload();
                  })
                  .catch((error) => {
                    Alert.alert(
                      'Could not remove',
                      error instanceof Error ? error.message : String(error),
                    );
                  });
              }}
            />
          </CardBlock>
        ))
      )}

      {words.length > 0 ? (
        <>
          <UiButton
            label={`Create cards (${words.length})`}
            onPress={onCreateCards}
            disabled={busy}
          />
          <UiButton
            label="Share AI prompt for these words"
            variant="secondary"
            onPress={onSharePrompt}
            disabled={busy}
          />
          <UiButton label="Clear list" variant="secondary" onPress={confirmClear} disabled={busy} />
        </>
      ) : null}
      <UiButton label="Back to book" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
  },
  deckRow: {
    gap: Spacing.two,
  },
});
