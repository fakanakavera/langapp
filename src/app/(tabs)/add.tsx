import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { addVocabulary, listDeckSummaries } from '@/db/queries';
import type { DeckSummary } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { analyzeRussian, type MorphologyMatch } from '@/morphology/analyzer';
import { useDatabase } from '@/providers/database-provider';

export default function AddScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [surface, setSurface] = useState('');
  const [lemma, setLemma] = useState('');
  const [gloss, setGloss] = useState('');
  const [pos, setPos] = useState('');
  const [matches, setMatches] = useState<MorphologyMatch[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listDeckSummaries().then((rows) => {
        if (cancelled) return;
        setDecks(rows);
        setDeckId((current) => current ?? rows[0]?.id ?? null);
      });
      return () => {
        cancelled = true;
      };
    }, [revision]),
  );

  async function onSurfaceChange(value: string) {
    setSurface(value);
    const found = await analyzeRussian(value);
    setMatches(found);
    if (found[0] && !lemma) {
      setLemma(found[0].lemma);
      setGloss(found[0].gloss);
      setPos(found[0].pos);
    }
  }

  async function onSave() {
    if (!deckId) {
      Alert.alert('Create a deck first');
      return;
    }
    if (!lemma.trim() || !gloss.trim()) {
      Alert.alert('Lemma and meaning are required');
      return;
    }
    const { entry } = await addVocabulary({
      deckId,
      lemma,
      gloss,
      pos,
      surfaceForm: surface,
    });
    refresh();
    setSurface('');
    setLemma('');
    setGloss('');
    setPos('');
    setMatches([]);
    router.push(`/entry/${entry.id}`);
  }

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Add a word</ThemedText>
      <ThemedText themeColor="textSecondary">
        Type an inflected Russian form. The local analyzer maps it to a dictionary lemma when it
        knows the word.
      </ThemedText>

      <TextInput
        value={surface}
        onChangeText={onSurfaceChange}
        placeholder="Russian form, e.g. книгу"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        style={inputStyle}
      />
      <TextInput
        value={lemma}
        onChangeText={setLemma}
        placeholder="Dictionary lemma, e.g. книга"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        style={inputStyle}
      />
      <TextInput
        value={gloss}
        onChangeText={setGloss}
        placeholder="Meaning in English"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
      />
      <TextInput
        value={pos}
        onChangeText={setPos}
        placeholder="Part of speech (optional)"
        placeholderTextColor={theme.textSecondary}
        style={inputStyle}
      />

      <ThemedText type="smallBold">Deck</ThemedText>
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

      {matches.length > 0 ? (
        <CardBlock>
          <ThemedText type="smallBold">Morphology</ThemedText>
          {matches.map((match) => (
            <ThemedText key={`${match.entryId}-${match.tags}`} type="small" themeColor="textSecondary">
              {match.matchedForm} → {match.lemma} ({match.tags || 'unspecified'}) · {match.gloss}
            </ThemedText>
          ))}
        </CardBlock>
      ) : null}

      <UiButton label="Save word" onPress={onSave} />
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
