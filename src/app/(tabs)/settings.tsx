import { useState } from 'react';
import { Alert } from 'react-native';

import { getAiStatus } from '@/ai/engine';
import { exportBackup, importBackup } from '@/backup/backup';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { useDatabase } from '@/providers/database-provider';

export default function SettingsScreen() {
  const { refresh } = useDatabase();
  const [busy, setBusy] = useState(false);
  const ai = getAiStatus();

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
      const imported = await importBackup();
      if (imported) {
        refresh();
        Alert.alert('Restore complete', 'Your decks and reviews were imported.');
      }
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Settings</ThemedText>

      <CardBlock>
        <ThemedText type="smallBold">Backup</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Export or import a JSON file with decks, vocabulary, reviews, and examples.
        </ThemedText>
      </CardBlock>
      <UiButton label="Export JSON backup" onPress={onExport} disabled={busy} />
      <UiButton label="Import JSON backup" onPress={onImport} variant="secondary" disabled={busy} />

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
