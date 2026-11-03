import { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';

import { getAiStatus } from '@/ai/engine';
import { exportBackup, importDeckFile } from '@/backup/backup';
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
  setBookMinTranslationTier,
  setStudyingLimit,
  unlockNextCards,
} from '@/db/queries';
import type { DeckSummary } from '@/db/types';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';

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
});
