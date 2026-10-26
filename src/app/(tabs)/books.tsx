import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import {
  createBook,
  deleteBook,
  listBookUnknownForms,
  listBooks,
  listKnownWordForms,
} from '@/db/queries';
import type { BookSummary, BookUnknownForm, KnownForm } from '@/db/queries';
import { calculateBookProgress, normalizeBookWord } from '@/lib/book-text';
import { useDatabase } from '@/providers/database-provider';

const MAX_CHARS = 500_000;

export default function BooksScreen() {
  const router = useRouter();
  const { revision, refresh } = useDatabase();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [knownWordForms, setKnownWordForms] = useState<KnownForm[]>([]);
  const [unknownForms, setUnknownForms] = useState<BookUnknownForm[]>([]);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([listBooks(), listKnownWordForms(), listBookUnknownForms()]).then(
        ([rows, forms, unknown]) => {
          if (cancelled) return;
          setBooks(rows);
          setKnownWordForms(forms);
          setUnknownForms(unknown);
        },
        (error: unknown) => {
          if (!cancelled) {
            Alert.alert('Could not load books', error instanceof Error ? error.message : String(error));
          }
        },
      );
      return () => {
        cancelled = true;
      };
    }, [revision]),
  );

  const knownForms = useMemo(
    () => new Set(knownWordForms.map((form) => normalizeBookWord(form.form))),
    [knownWordForms],
  );
  const unknownByBook = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const unknown of unknownForms) {
      let forms = map.get(unknown.book_id);
      if (!forms) {
        forms = new Set<string>();
        map.set(unknown.book_id, forms);
      }
      forms.add(unknown.normalized);
    }
    return map;
  }, [unknownForms]);
  const progressByBook = useMemo(
    () =>
      new Map(
        books.map((book) => [
          book.id,
          calculateBookProgress(book.body, knownForms, unknownByBook.get(book.id) ?? new Set()),
        ]),
      ),
    [books, knownForms, unknownByBook],
  );

  async function onImport() {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', '.txt'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const text = await new File(asset.uri).text();
      const body = text.replace(/\r\n?/g, '\n').trim();
      if (!body) throw new Error('This file has no readable text.');
      if (body.length > MAX_CHARS) {
        throw new Error('This file is too big (over ~500KB of text). Split it first.');
      }
      const title = (asset.name ?? 'Book').replace(/\.[^.]+$/, '').trim() || 'Book';
      const book = await createBook(title, body);
      refresh();
      router.push({ pathname: '/book/[id]', params: { id: book.id } });
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(book: BookSummary) {
    Alert.alert(
      'Delete book?',
      `"${book.title}" and its ${book.unknown_count} marked words will be removed. Decks are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteBook(book.id)
              .then(() => refresh())
              .catch((error) => {
                Alert.alert(
                  'Could not delete book',
                  error instanceof Error ? error.message : String(error),
                );
              });
          },
        },
      ],
    );
  }

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Books</ThemedText>
      <ThemedText themeColor="textSecondary">
        Open a book, tap the words you don&apos;t know, then turn them into deck cards or send
        them to an AI for a full deck.
      </ThemedText>

      <UiButton label="Import a .txt book" onPress={onImport} disabled={busy} />

      {books.length === 0 ? (
        <ThemedText themeColor="textSecondary">No books yet — import one to start reading.</ThemedText>
      ) : (
        books.map((book) => {
          const progress = progressByBook.get(book.id);
          const knownPercent = progress?.totalWords
            ? Math.round((progress.knownWords / progress.totalWords) * 100)
            : 0;
          const russianPercent = progress?.totalWords
            ? Math.round((progress.russianWords / progress.totalWords) * 100)
            : 0;
          const translatedPercent = progress?.totalWords
            ? Math.round((progress.translatedWords / progress.totalWords) * 100)
            : 0;
          return (
            <View key={book.id} style={styles.row}>
              <CardBlock
                onPress={() => router.push({ pathname: '/book/[id]', params: { id: book.id } })}
                style={styles.card}>
                <ThemedText type="smallBold">{book.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  ≈{(progress?.totalWords ?? 0).toLocaleString()} words · {book.unknown_count}{' '}
                  marked unknown
                </ThemedText>
                <ThemedText type="small">
                  Known: {knownPercent}% ({progress?.knownWords ?? 0} words)
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  In Russian: {russianPercent}% · translated: {translatedPercent}%
                </ThemedText>
              </CardBlock>
              <UiButton
                label="Delete"
                variant="secondary"
                onPress={() => confirmDelete(book)}
                style={styles.delete}
              />
            </View>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
  },
  card: {
    width: '100%',
  },
  delete: {
    alignSelf: 'flex-end',
  },
});
