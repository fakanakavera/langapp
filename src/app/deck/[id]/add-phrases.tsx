import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ActivityIndicator, StyleSheet, View } from 'react-native';

import { generateExamplePhrases } from '@/ai/engine';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { useTheme } from '@/hooks/use-theme';
import {
  addExamplesBulk,
  getDeck,
  listEntriesWithoutExamples,
} from '@/db/queries';
import type { Deck } from '@/db/types';
import { useDatabase } from '@/providers/database-provider';

type WordWithoutPhrases = {
  entry_id: string;
  lemma: string;
  gloss: string;
};

type PhraseResult = {
  entryId: string;
  examples: { text: string; translation: string }[];
};

export default function AddPhrasesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { revision, refresh } = useDatabase();
  const theme = useTheme();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [words, setWords] = useState<WordWithoutPhrases[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([getDeck(id), listEntriesWithoutExamples(id)]).then(
        ([nextDeck, nextWords]) => {
          if (cancelled) return;
          setDeck(nextDeck);
          setWords(nextWords);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id, revision]),
  );

  async function onGenerate() {
    if (!id || words.length === 0) return;
    setBusy(true);
    setProgress({ done: 0, total: words.length });
    try {
      const results: PhraseResult[] = [];
      for (const word of words) {
        try {
          const generated = await generateExamplePhrases({
            lemma: word.lemma,
            gloss: word.gloss,
            knownLemmas: [],
          });
          results.push({
            entryId: word.entry_id,
            examples: generated.map((g) => ({ text: g.text, translation: g.translation })),
          });
        } catch {
          // Skip this word and keep going with the rest.
        }
        setProgress({ done: progress.done + 1, total: progress.total });
      }

      const added = await addExamplesBulk({ entries: results });
      refresh();
      Alert.alert(
        'Phrases added',
        `Added ${added} example phrase${added === 1 ? '' : 's'} to ${results.length} word${
          results.length === 1 ? '' : 's'
        } in "${deck?.name ?? 'this deck'}".`,
      );
      router.back();
    } catch (error) {
      Alert.alert(
        'Could not add phrases',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!deck) return null;

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Add example phrases</ThemedText>
      <ThemedText themeColor="textSecondary">
        Generate beginner sentences for every word in “{deck.name}” that doesn’t have any yet.
      </ThemedText>

      <CardBlock>
        <ThemedText type="smallBold">Words without phrases: {words.length}</ThemedText>
        {words.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Each word gets 3 example sentences (Russian + English translation).
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Every word in this deck already has example phrases.
          </ThemedText>
        )}
      </CardBlock>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="large" color={theme.tint} />
          <ThemedText type="small" themeColor="textSecondary">
            {progress.done} of {progress.total} words…
          </ThemedText>
        </View>
      ) : (
        <UiButton
          label={words.length ? `Add phrases to ${words.length} word${words.length === 1 ? '' : 's'}` : 'No words need phrases'}
          disabled={!words.length || busy}
          onPress={onGenerate}
        />
      )}

      <UiButton label="Back" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  busy: {
    alignItems: 'center',
    paddingVertical: 24,
  },
});
