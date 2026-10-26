import { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';

import { getAiStatus } from '@/ai/engine';
import { exportBackup, importDeckFile } from '@/backup/backup';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { deckNameExists } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';

type NameStatus = 'idle' | 'checking' | 'taken' | 'ok';

export default function SettingsScreen() {
  const { refresh } = useDatabase();
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [checked, setChecked] = useState<{ name: string; taken: boolean } | null>(null);
  const ai = getAiStatus();

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
          `${imported.cards} cards (${imported.entries} words) imported into "${imported.deckName}". Existing decks were kept.${imported.skipped ? ` ${imported.skipped} rows skipped.` : ''}`,
        );
      }
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
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
