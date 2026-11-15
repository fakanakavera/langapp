import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { useTheme } from '@/hooks/use-theme';
import {
  getBook,
  getBookMinTranslationTier,
  listBookWordForms,
} from '@/db/queries';
import type { Book } from '@/db/types';
import { literalTranslate } from '@/lib/literal-translate';
import { useDatabase } from '@/providers/database-provider';

/**
 * Read a book one sentence at a time. Shows the full Russian sentence,
 * then a tier-filtered translation below (words below the book tier become
 * English where a gloss exists). Tap Next to advance.
 */
export default function ReadSentencesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { revision } = useDatabase();
  const [book, setBook] = useState<Book | null>(null);
  const [sentences, setSentences] = useState<string[]>([]);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([getBook(id), getBookMinTranslationTier()]).then(
        async ([nextBook, nextTier]) => {
          if (cancelled) return;
          if (!nextBook) return;
          setBook(nextBook);
          setSentences(splitIntoSentences(nextBook.body));

          // Words at/above the book tier stay Russian; everything below it
          // gets translated where a gloss exists.
          const forms = await listBookWordForms(nextTier);
          if (cancelled) return;
          setKnown(new Set(forms.map((f) => f.form)));
          setLoaded(true);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id, revision]),
  );

  const current = sentences[index] ?? null;
  const translation = current ? literalTranslate(current, { known }) : '';

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Loading book…</ThemedText>
      </Screen>
    );
  }

  if (!book) {
    return (
      <Screen>
        <ThemedText type="subtitle">Book not found</ThemedText>
        <UiButton label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (sentences.length === 0) {
    return (
      <Screen>
        <ThemedText type="subtitle">Read by sentence</ThemedText>
        <ThemedText themeColor="textSecondary">No sentences in this book.</ThemedText>
        <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!current) {
    return (
      <Screen>
        <ThemedText type="subtitle">Finished</ThemedText>
        <CardBlock>
          <ThemedText type="title">{sentences.length}</ThemedText>
          <ThemedText themeColor="textSecondary">sentences read</ThemedText>
        </CardBlock>
        <UiButton label="Restart" onPress={() => setIndex(0)} />
        <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {book.title} · {index + 1} of {sentences.length}
      </ThemedText>

      <CardBlock>
        <ThemedText type="subtitle" style={styles.sentenceText}>
          {current}
        </ThemedText>
      </CardBlock>

      <CardBlock>
        <ThemedText type="small" themeColor="textSecondary" style={styles.translationText}>
          {translation}
        </ThemedText>
      </CardBlock>

      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
        {index + 1} of {sentences.length}
      </ThemedText>

      <UiButton
        label={index >= sentences.length - 1 ? 'Restart' : 'Next'}
        onPress={() => {
          if (index >= sentences.length - 1) {
            setIndex(0);
          } else {
            setIndex(index + 1);
          }
        }}
      />
      <UiButton label="Done" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

/**
 * Split book body into sentences on . ! ? … and paragraph breaks.
 */
function splitIntoSentences(body: string): string[] {
  const normalized = body.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.includes('\n\n')
    ? normalized.split(/\n{2,}/)
    : normalized.split(/\n/);

  const sentences: string[] = [];
  const sentenceRe = /([^.!?…]*[.!?…]+["»)]?\s*)/g;

  for (const para of paragraphs) {
    const trimmed = para.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!trimmed) continue;

    sentenceRe.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = sentenceRe.exec(trimmed)) !== null) {
      const sentence = match[0]?.trim() ?? '';
      if (sentence) sentences.push(sentence);
      lastIndex = sentenceRe.lastIndex;
    }

    const remaining = trimmed.slice(lastIndex).trim();
    if (remaining) sentences.push(remaining);
  }

  return sentences.filter((s) => s.length > 0);
}

const styles = StyleSheet.create({
  counter: {
    marginBottom: 16,
    textAlign: 'center',
  },
  sentenceText: {
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
});
