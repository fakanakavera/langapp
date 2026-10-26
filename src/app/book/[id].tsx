import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import {
  getBook,
  listBookWordForms,
  listUnknownWords,
  toggleUnknownWord,
  type KnownForm,
} from '@/db/queries';
import type { Book } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import {
  classifyBookWord,
  normalizeBookWord,
  sentenceAt,
  splitParagraphs,
  tokenizeParagraph,
} from '@/lib/book-text';
import { speakMixed, stopSpeech, type MixedPlayback } from '@/lib/speech';
import { literalTranslate } from '@/lib/literal-translate';
import { ruEnLookup } from '@/lib/ru-en-dictionary';
import { useDatabase } from '@/providers/database-provider';

const PARAGRAPHS_PER_PAGE = 8;

/**
 * Words in any deck stay Russian; words outside decks are translated where
 * a gloss is available. Tapping a deck word reveals its meaning and link.
 */
export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { refresh } = useDatabase();
  const [book, setBook] = useState<Book | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(0);
  const [known, setKnown] = useState<Map<string, KnownForm>>(new Map());
  const [deckForms, setDeckForms] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  const playbackRef = useRef<MixedPlayback | null>(null);

  function stopListening() {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(false);
  }

  useFocusEffect(
    useCallback(() => {
      if (typeof id !== 'string') return;
      let cancelled = false;
      Promise.all([getBook(id), listBookWordForms(), listUnknownWords(id)]).then(
        ([nextBook, forms, unknown]) => {
          if (cancelled) return;
          setBook(nextBook);
          const map = new Map<string, KnownForm>();
          for (const form of forms) {
            const normalized = normalizeBookWord(form.form);
            if (!map.has(normalized)) map.set(normalized, form);
          }
          setKnown(map);
          setDeckForms(new Set(map.keys()));
          setMarks(new Set(unknown.map((w) => w.normalized)));
          setLoaded(true);
        },
        () => {
          if (!cancelled) setLoaded(true);
        },
      );
      return () => {
        cancelled = true;
        // Never leave orphaned audio running after leaving the reader.
        playbackRef.current?.stop();
        playbackRef.current = null;
        stopSpeech();
      };
    }, [id]),
  );

  const paragraphs = useMemo(() => (book ? splitParagraphs(book.body) : []), [book]);
  const pageCount = Math.max(1, Math.ceil(paragraphs.length / PARAGRAPHS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = paragraphs.slice(
    safePage * PARAGRAPHS_PER_PAGE,
    (safePage + 1) * PARAGRAPHS_PER_PAGE,
  );

  function goToPage(next: number) {
    // A new page means new audio: stop first so chains never overlap.
    stopListening();
    setPage(Math.max(0, Math.min(pageCount - 1, next)));
  }

  function toggleListen() {
    if (playing) {
      stopListening();
      return;
    }
    // Parenthetical asides (e.g. gloss notes) are unreadable aloud.
    const text = visible.join('\n').replace(/\s*\([^()]*\)/g, '');
    if (!text.trim()) return;
    const playback = speakMixed(text, {
      onDone: () => {
        playbackRef.current = null;
        setPlaying(false);
      },
    });
    playbackRef.current = playback;
    setPlaying(true);
  }

  async function markUnknown(surface: string, normalized: string, paragraph: string, offset: number) {
    if (typeof id !== 'string') return;
    const context = sentenceAt(paragraph, offset);
    const marked = await toggleUnknownWord({
      bookId: id,
      surface,
      normalized,
      context,
    }).catch(() => null);
    if (marked == null) return;
    setMarks((prev) => {
      const next = new Set(prev);
      if (marked) next.add(normalized);
      else next.delete(normalized);
      return next;
    });
    refresh();

    // Leave words already covered by a deck in Russian in the sentence translation.
    if (marked) {
      const translation = literalTranslate(context, { known: deckForms });
      Alert.alert(surface, translation, [{ text: 'OK', style: 'cancel' }]);
    }
  }
  function onTapWord(surface: string, paragraph: string, offset: number) {
    const normalized = normalizeBookWord(surface);
    if (!normalized) return;
    if (marks.has(normalized)) {
      void markUnknown(surface, normalized, paragraph, offset);
      return;
    }
    const info = known.get(normalized);
    if (info) {
      Alert.alert(info.lemma, `${info.gloss}${info.deck_name ? ` · ${info.deck_name}` : ''}`, [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'View word',
          onPress: () => router.push(`/entry/${info.entry_id}`),
        },
        {
          text: 'Mark unknown',
          onPress: () => void markUnknown(surface, normalized, paragraph, offset),
        },
      ]);
      return;
    }
    void markUnknown(surface, normalized, paragraph, offset);
  }

  if (!loaded) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Opening book…</ThemedText>
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

  return (
    <Screen>
      <ThemedText type="subtitle">{book.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        Page {safePage + 1} of {pageCount} · {marks.size} marked unknown
      </ThemedText>
      <UiButton
        label={marks.size ? `Unknown words (${marks.size}) →` : 'Unknown words'}
        variant="secondary"
        onPress={() => router.push({ pathname: '/book-words/[id]', params: { id: book.id } })}
      />
      <UiButton
        label={playing ? 'Stop' : 'Listen'}
        variant="secondary"
        onPress={toggleListen}
      />

      {visible.map((paragraph, paragraphIndex) => {
        const tokens = tokenizeParagraph(paragraph);
        let offset = 0;
        return (
          <Text key={`${safePage}-${paragraphIndex}`} style={[styles.paragraph, { color: theme.text }]}>
            {tokens.map((token, tokenIndex) => {
              const tokenOffset = offset;
              offset += token.text.length;
              if (!token.isWord) {
                return <Text key={tokenIndex}>{token.text}</Text>;
              }
        const normalized = normalizeBookWord(token.text);
        const visibility = classifyBookWord(token.text, deckForms, marks);
        const isMarked = marks.has(normalized);
        const isKnown = visibility === 'known';

        // Words already in a deck stay in Russian; everything else gets the
        // bad literal English translation inline (or stays Russian if we
        // have no gloss for it).
        let displayText = token.text;
        let translated = false;
        if (visibility === 'translated') {
          displayText = ruEnLookup(normalized) ?? token.text;
          translated = true;
        }

        return (
          <Text
            key={tokenIndex}
            onPress={() => onTapWord(token.text, paragraph, tokenOffset)}
            style={
              isMarked
                ? { backgroundColor: theme.tint, color: '#ffffff', borderRadius: 4 }
                : isKnown
                  ? { color: theme.tint, fontWeight: '600' }
                  : translated
                    ? { color: theme.textSecondary, fontStyle: 'italic' }
                    : undefined
            }>
            {displayText}
          </Text>
              );
            })}
          </Text>
        );
      })}

      <View style={styles.navRow}>
        <UiButton
          label="← Prev"
          variant="secondary"
          onPress={() => goToPage(safePage - 1)}
          disabled={safePage === 0}
          style={styles.nav}
        />
        <UiButton
          label="Next →"
          variant="secondary"
          onPress={() => goToPage(safePage + 1)}
          disabled={safePage >= pageCount - 1}
          style={styles.nav}
        />
      </View>
      <UiButton
        label={marks.size ? `Unknown words (${marks.size})` : 'Unknown words'}
        onPress={() => router.push({ pathname: '/book-words/[id]', params: { id: book.id } })}
      />
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        Tap a word to mark it · tap again to unmark · tinted words are already in your decks
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    textAlign: 'center',
  },
  paragraph: {
    fontSize: 18,
    lineHeight: 28,
  },
  navRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    width: '100%',
  },
  nav: {
    flexGrow: 0,
    flexShrink: 0,
    minWidth: 110,
  },
});
