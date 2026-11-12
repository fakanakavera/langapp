import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

import { getAiStatus } from '@/ai/engine';
import { exportBackup, importDeckFile } from '@/backup/backup';
import * as DocumentPicker from 'expo-document-picker';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { MAX_MASTERY_TIER } from '@/lib/mastery';
import {
  deckNameExists,
  getBookMinTranslationTier,
  getStudyingLimit,
  listDeckSummaries,
  listWordsWithoutPhrasesForDecks,
  importPhrasesForDecks,
  setBookMinTranslationTier,
  setStudyingLimit,
  unlockNextCards,
} from '@/db/queries';
import type { DeckSummary } from '@/db/types';
import type { WordWithoutPhrase } from '@/db/queries';
import { parsePhraseText } from '@/lib/phrase-import';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';

type PickedFile = { name: string; uri: string };

type NameStatus = 'idle' | 'checking' | 'taken' | 'ok';

export default function SettingsScreen() {
  const { refresh } = useDatabase();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [checked, setChecked] = useState<{ name: string; taken: boolean } | null>(null);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [studyingLimit, setStudyingLimitState] = useState<number | null>(null);
  const [limitDraft, setLimitDraft] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);
  const [bookTier, setBookTierState] = useState<number | null>(null);
  const [tierDraft, setTierDraft] = useState('');
  const [savingTier, setSavingTier] = useState(false);
  const ai = getAiStatus();

  // Export words without phrases
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [exportWords, setExportWords] = useState<WordWithoutPhrase[]>([]);
  const [exportText, setExportText] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  // Import phrases from file into selected decks
  const [phraseFiles, setPhraseFiles] = useState<PickedFile[]>([]);
  const [phraseRows, setPhraseRows] = useState<{ lemma: string; text: string; translation: string }[]>([]);
  const [phraseSkipped, setPhraseSkipped] = useState(0);
  const [phraseBusy, setPhraseBusy] = useState(false);

  function toggleDeck(deckId: string) {
    setSelectedDeckIds((prev) =>
      prev.includes(deckId) ? prev.filter((id) => id !== deckId) : [...prev, deckId],
    );
  }

  async function onGenerateWordList() {
    if (selectedDeckIds.length === 0) {
      Alert.alert('Select decks', 'Pick at least one deck first.');
      return;
    }
    setExportBusy(true);
    try {
      const words = await listWordsWithoutPhrasesForDecks({
        deckIds: selectedDeckIds,
        onlyAvailable,
      });
      setExportWords(words);
      setExportText(
        words.map((w) => w.lemma).join('\n') || '(no words found)',
      );
    } catch (error) {
      Alert.alert('Could not generate list', error instanceof Error ? error.message : String(error));
    } finally {
      setExportBusy(false);
    }
  }

  async function onShareWordList() {
    if (!exportText) return;
    const filename = `langapp-words-without-phrases-${new Date().toISOString().slice(0, 10)}.txt`;
    const file = new File(Paths.cache, filename);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(exportText);
    try {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        UTI: 'public.plain-text',
        dialogTitle: 'Words without phrases',
      });
    } catch (error) {
      Alert.alert('Could not share list', error instanceof Error ? error.message : String(error));
    }
  }

  async function onPhrasePickFiles() {
    setPhraseBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', '.csv', '.txt'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || result.assets.length === 0) return;

      const files: PickedFile[] = result.assets.map((asset: { name?: string | null; uri: string }) => ({
        name: asset.name ?? 'Phrases',
        uri: asset.uri,
      }));

      const byKey = new Map<string, { lemma: string; text: string; translation: string }>();
      let totalSkipped = 0;
      for (const file of files) {
        const text = await new File(file.uri).text();
        const parsed = parsePhraseText(text);
        totalSkipped += parsed.skipped;
        for (const row of parsed.rows) {
          const key = `${row.lemma.toLocaleLowerCase('ru-RU')}||${row.text.toLocaleLowerCase('ru-RU')}`;
          if (!byKey.has(key)) byKey.set(key, row);
        }
      }

      setPhraseFiles(files);
      setPhraseRows([...byKey.values()]);
      setPhraseSkipped(totalSkipped);
    } catch (error) {
      Alert.alert('Could not read file', error instanceof Error ? error.message : String(error));
    } finally {
      setPhraseBusy(false);
    }
  }

  async function onPhraseImport() {
    if (phraseRows.length === 0) return;
    setPhraseBusy(true);
    try {
      const result = await importPhrasesForDecks({
        phrases: phraseRows,
      });

      const lines: string[] = [];
      lines.push(
        `Added ${result.added} phrase${result.added === 1 ? '' : 's'} to ${result.matched} word${result.matched === 1 ? '' : 's'}.`,
      );
      if (result.unmatched.length) {
        lines.push(
          `${result.unmatched.length} word${result.unmatched.length === 1 ? '' : 's'} not found in the selected decks and were skipped:`,
        );
        lines.push(result.unmatched.join(', '));
      }
      if (phraseSkipped) {
        lines.push(`${phraseSkipped} line${phraseSkipped === 1 ? '' : 's'} in the file couldn't be parsed and were skipped.`);
      }

      Alert.alert('Phrases imported', lines.join('\n\n'));
      setPhraseFiles([]);
      setPhraseRows([]);
      setPhraseSkipped(0);
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    } finally {
      setPhraseBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listDeckSummaries(),
      getStudyingLimit(),
      getBookMinTranslationTier(),
    ]).then(
      ([rows, limit, tier]) => {
        if (cancelled) return;
        setDecks(rows);
        setStudyingLimitState(limit);
        setLimitDraft(String(limit));
        setBookTierState(tier);
        setTierDraft(String(tier));
      },
      (error) => {
        if (!cancelled) {
          Alert.alert('Could not load decks', error instanceof Error ? error.message : String(error));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const trimmedName = deckName.trim();
  // Derived during render (no setState in the effect body): the file picker
  // only opens once the trimmed name is confirmed free.
  const nameStatus: NameStatus =
    !trimmedName
      ? 'idle'
      : !checked || checked.name !== trimmedName
        ? 'checking'
        : checked.taken
          ? 'taken'
          : 'ok';

  // Live uniqueness check; writes state only from the async callback.
  useEffect(() => {
    if (!trimmedName) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      deckNameExists(trimmedName).then(
        (taken) => {
          if (!cancelled) setChecked({ name: trimmedName, taken });
        },
        () => {
          if (!cancelled) setChecked(null);
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedName]);

  async function onExport() {
    setBusy(true);
    try {
      await exportBackup();
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    setBusy(true);
    try {
      const imported = await importDeckFile(deckName);
      if (imported) {
        setDeckName('');
        refresh();
        Alert.alert(
          'Deck imported',
          `${imported.cards} cards (${imported.entries} words) imported into "${imported.deckName}". ${imported.studying} are currently active for studying.${imported.studying === 0 && imported.cards > 0 ? ' Change the shared per-deck limit in Settings if you want more active cards.' : ''} Existing decks were kept.${imported.skipped ? ` ${imported.skipped} rows skipped.` : ''}`,
        );
      }
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveStudyingLimit() {
    const parsed = Number.parseInt(limitDraft, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) {
      Alert.alert('Invalid limit', 'Enter a whole number from 1 to 1000.');
      return;
    }
    setSavingLimit(true);
    try {
      const savedLimit = await setStudyingLimit(parsed);
      await unlockNextCards();
      setStudyingLimitState(savedLimit);
      refresh();
      Alert.alert(
        'Studying limit updated',
        `Each deck can now have up to ${savedLimit} active studying card${savedLimit === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      Alert.alert('Could not update limit', error instanceof Error ? error.message : String(error));
    } finally {
      setSavingLimit(false);
    }
  }

  async function onSaveBookTier() {
    const parsed = Number.parseInt(tierDraft, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_MASTERY_TIER) {
      Alert.alert(
        'Invalid tier',
        `Enter a whole number from 0 to ${MAX_MASTERY_TIER}.`,
      );
      return;
    }
    setSavingTier(true);
    try {
      const saved = await setBookMinTranslationTier(parsed);
      setBookTierState(saved);
      refresh();
      Alert.alert(
        'Book reader updated',
        saved === 0
          ? 'Every word from any deck now stays Russian in books.'
          : `Words at tier ${saved}+ now stay Russian in books; lower-tier deck words are translated when a gloss exists.`,
      );
    } catch (error) {
      Alert.alert('Could not update tier', error instanceof Error ? error.message : String(error));
    } finally {
      setSavingTier(false);
    }
  }

  const nameHint =
    nameStatus === 'taken'
      ? 'That name is already used — pick another.'
      : nameStatus === 'checking'
        ? 'Checking…'
        : nameStatus === 'ok'
          ? 'Name is free — you can pick the file next.'
          : 'Type a name for the new deck first.';

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Settings</ThemedText>

      <CardBlock>
        <ThemedText type="smallBold">Studying card limit per deck</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          This number applies separately to every deck. For example, 10 means up to 10 active
          studying cards in each deck. Other cards stay in that deck and unlock as cards graduate.
        </ThemedText>
        {decks.length > 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            {decks.length} deck{decks.length === 1 ? '' : 's'} ·{' '}
            {decks.reduce((sum, deck) => sum + deck.studying_count, 0)} active cards total
          </ThemedText>
        )}
        {decks.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            This limit will also apply to decks you create or import later.
          </ThemedText>
        )}
        <TextInput
          value={limitDraft}
          onChangeText={(value) => setLimitDraft(value.replace(/\D/g, ''))}
          placeholder="Enter a number from 1 to 1000"
          placeholderTextColor={theme.textSecondary}
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Maximum active studying cards per deck"
          style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
        />
        <UiButton
          label={savingLimit ? 'Saving…' : 'Save studying limit'}
          onPress={onSaveStudyingLimit}
          disabled={
            savingLimit ||
            studyingLimit === null ||
            !limitDraft ||
            limitDraft === String(studyingLimit)
          }
        />
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">
          Book reader: keep words in Russian from tier
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Deck words at this mastery tier or higher stay Russian in books.
          Lower-tier deck words (and words not in any deck) are shown
          translated when a gloss exists. 0 = every word from any deck
          stays Russian.{' '}
          {bookTier !== null ? `Currently ${bookTier}.` : ''}
        </ThemedText>
        <TextInput
          value={tierDraft}
          onChangeText={(value) => setTierDraft(value.replace(/\D/g, ''))}
          placeholder={`0 to ${MAX_MASTERY_TIER}`}
          placeholderTextColor={theme.textSecondary}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Minimum mastery tier for book words to stay Russian"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <UiButton
          label={savingTier ? 'Saving…' : 'Save book tier'}
          onPress={onSaveBookTier}
          disabled={
            savingTier ||
            bookTier === null ||
            !tierDraft ||
            tierDraft === String(bookTier)
          }
        />
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">Backup</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Export a full JSON backup, or import a file into a new named deck. Importing never
          deletes your existing decks.
        </ThemedText>
      </CardBlock>
      <UiButton label="Export JSON backup" onPress={onExport} disabled={busy} />
      <TextInput
        value={deckName}
        onChangeText={setDeckName}
        placeholder="New deck name for the import"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {nameHint}
      </ThemedText>
      <UiButton
        label="Import deck from JSON"
        onPress={onImport}
        variant="secondary"
        disabled={busy || nameStatus !== 'ok'}
      />

      <CardBlock>
        <ThemedText type="smallBold">Export words without phrases</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Pick decks and output every word that still has no example phrase.
          Give the list to an LLM to generate a phrase CSV, then import it
          below for all selected decks at once.
        </ThemedText>

        <ThemedText type="smallBold">Select decks</ThemedText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.deckChipRow}>
          {decks.map((deck) => {
            const active = selectedDeckIds.includes(deck.id);
            return (
              <Pressable
                key={deck.id}
                onPress={() => toggleDeck(deck.id)}
                style={[
                  styles.deckChip,
                  active
                    ? { backgroundColor: theme.tint }
                    : { backgroundColor: theme.backgroundSelected },
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: active ? '#ffffff' : theme.text }}>
                  {deck.name}
                  {active ? ' ✓' : ''}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
        {decks.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No decks yet.
          </ThemedText>
        ) : null}

        <ThemedText type="smallBold">Scope</ThemedText>
        <Pressable
          style={styles.scopeRow}
          onPress={() => setOnlyAvailable((v) => !v)}>
          <ThemedText type="small" themeColor="textSecondary">
            {onlyAvailable ? '■' : '□'}
            {' '}
            Only currently available (unlocked & due) words
          </ThemedText>
        </Pressable>

        <UiButton
          label={exportBusy ? 'Generating…' : 'Generate word list'}
          disabled={exportBusy || selectedDeckIds.length === 0}
          onPress={onGenerateWordList}
          variant="secondary"
        />

        {exportWords.length > 0 ? (
          <>
            <ThemedText type="smallBold">
              Words without phrases ({exportWords.length})
            </ThemedText>
            <ScrollView
              contentContainerStyle={styles.wordList}
              showsVerticalScrollIndicator={false}>
              {exportText.split('\n').map((word, i) => (
                <ThemedText key={i} type="small" themeColor="textSecondary">
                  {word}
                </ThemedText>
              ))}
            </ScrollView>
            <TextInput
              value={exportText}
              editable={false}
              multiline
              numberOfLines={6}
              style={[
                styles.exportText,
                { color: theme.text, backgroundColor: theme.backgroundElement },
              ]}
              placeholder="No words selected"
            />
            <UiButton
              label="Share list"
              variant="secondary"
              onPress={onShareWordList}
            />
          </>
        ) : null}
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">Import phrases from file</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Upload a .csv or .txt file with phrase rows. Each row:
          word, Russian sentence, English translation. Phrases are matched
          to your words across every deck — no deck selection needed.
        </ThemedText>

        <UiButton
          label="Pick phrase file(s)"
          onPress={onPhrasePickFiles}
          disabled={phraseBusy}
        />

        {phraseFiles.length > 0 ? (
          <>
            <ThemedText type="smallBold">Files</ThemedText>
            {phraseFiles.map((file) => (
              <CardBlock key={file.uri}>
                <ThemedText type="small">{file.name}</ThemedText>
              </CardBlock>
            ))}
            <UiButton
              label="Clear"
              variant="secondary"
              onPress={() => {
                setPhraseFiles([]);
                setPhraseRows([]);
                setPhraseSkipped(0);
              }}
              disabled={phraseBusy}
            />
          </>
        ) : null}

        {phraseRows.length > 0 ? (
          <>
            <ThemedText type="smallBold">
              Phrases to import ({phraseRows.length})
            </ThemedText>
            {phraseRows.slice(0, 30).map((row, i) => (
              <CardBlock key={i}>
                <ThemedText type="smallBold">{row.lemma}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {row.text}
                  {row.translation ? ` — ${row.translation}` : ''}
                </ThemedText>
              </CardBlock>
            ))}
            {phraseRows.length > 30 ? (
              <ThemedText type="small" themeColor="textSecondary">
                …and {phraseRows.length - 30} more
              </ThemedText>
            ) : null}
            <UiButton
              label={`Import ${phraseRows.length} phrase${phraseRows.length === 1 ? '' : 's'}`}
              disabled={phraseBusy || phraseRows.length === 0}
              onPress={onPhraseImport}
            />
          </>
        ) : null}

        <ThemedText type="small" themeColor="textSecondary">
          Words not found in any of your decks are reported after import —
          check the spelling / lemma matches your cards.
        </ThemedText>
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">On-device AI</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Backend: {ai.backend}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {ai.reason}
        </ThemedText>
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">iOS builds</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Use Expo Go for now. Later, a custom development build will add llama.cpp, and EAS Build
          can produce iPhone binaries from Windows.
        </ThemedText>
      </CardBlock>
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
  deckChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  deckChip: {
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  wordList: {
    paddingHorizontal: 16,
    gap: 4,
  },
  exportText: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 14,
    textAlignVertical: 'top',
    marginTop: 8,
  },
});
