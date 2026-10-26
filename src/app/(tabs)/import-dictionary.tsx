import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import {
  clearUserDictionary,
  listUserDictionary,
  upsertUserDictionaryEntry,
  type UserDictionaryEntry,
} from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import { parseDictionaryText } from '@/lib/dictionary-import';
import { setUserDictionary } from '@/lib/ru-en-dictionary';
import { useDatabase } from '@/providers/database-provider';

type PickedFile = { name: string; uri: string };

/**
 * Import word -> translation pairs from .txt files. These are stored in the
 * user dictionary and used by the book reader to translate words inline (so
 * words not in any deck show your English meaning instead of Russian).
 * Multiple files can be picked; re-importing a word updates its meaning.
 */
export default function ImportDictionaryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);
  const [rows, setRows] = useState<DictionaryRow[]>([]);
  const [glosses, setGlosses] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<UserDictionaryEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const inputStyle = [
    styles.input,
    { color: theme.text, backgroundColor: theme.backgroundElement },
  ];

  const reload = useCallback(() => {
    listUserDictionary().then((entries) => {
      setStored(entries);
      setUserDictionary(entries);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload, revision]),
  );

  async function onPickFiles() {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', '.txt'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || result.assets.length === 0) return;

      const files: PickedFile[] = result.assets.map((asset) => ({
        name: asset.name ?? 'Dictionary',
        uri: asset.uri,
      }));

      const byLemma = new Map<string, { lemma: string; gloss: string }>();
      for (const file of files) {
        const text = await new File(file.uri).text();
        for (const row of parseDictionaryText(text).rows) {
          if (!byLemma.has(row.lemma.toLocaleLowerCase('ru-RU'))) {
            byLemma.set(row.lemma.toLocaleLowerCase('ru-RU'), row);
          }
        }
      }

      setPickedFiles(files);
      const next = [...byLemma.values()];
      setRows(next);
      setGlosses(
        Object.fromEntries(next.map((row) => [row.lemma.toLocaleLowerCase('ru-RU'), row.gloss])),
      );
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (rows.length === 0) {
      Alert.alert('Nothing to save');
      return;
    }
    setBusy(true);
    try {
      for (const row of rows) {
        const gloss = (glosses[row.lemma.toLocaleLowerCase('ru-RU')] ?? row.gloss).trim();
        await upsertUserDictionaryEntry({ lemma: row.lemma, gloss });
      }
      const entries = await listUserDictionary();
      setStored(entries);
      setUserDictionary(entries);
      setPickedFiles([]);
      setRows([]);
      setGlosses({});
      refresh();
      Alert.alert('Dictionary saved', `${entries.length} word${entries.length === 1 ? '' : 's'} in your dictionary.`);
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function onClear() {
    Alert.alert(
      'Clear dictionary?',
      'Removes all imported word translations. The bundled dictionary is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearUserDictionary()
              .then(() => {
                setStored([]);
                setUserDictionary([]);
                refresh();
              })
              .catch((error) => {
                Alert.alert('Could not clear', error instanceof Error ? error.message : String(error));
              });
          },
        },
      ],
    );
  }

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Import dictionary</ThemedText>
      <ThemedText themeColor="textSecondary">
        Import a .txt file with word translations (one per line). These override the bundled
        dictionary so the book reader shows your English meaning for words not in any deck.
      </ThemedText>

      <UiButton label="Pick dictionary file(s)" onPress={onPickFiles} disabled={busy} />

      {pickedFiles.length > 0 ? (
        <>
          <ThemedText type="smallBold">Files</ThemedText>
          {pickedFiles.map((file) => (
            <CardBlock key={file.uri}>
              <ThemedText type="small">{file.name}</ThemedText>
            </CardBlock>
          ))}
          <UiButton label="Clear" variant="secondary" onPress={() => {
            setPickedFiles([]);
            setRows([]);
            setGlosses({});
          }} disabled={busy} />
        </>
      ) : null}

      {rows.length > 0 ? (
        <>
          <ThemedText type="smallBold">
            New words ({rows.length}) — edit meanings if needed
          </ThemedText>
          {rows.map((row) => {
            const key = row.lemma.toLocaleLowerCase('ru-RU');
            return (
              <CardBlock key={key}>
                <ThemedText type="smallBold">{row.lemma}</ThemedText>
                <TextInput
                  value={glosses[key] ?? row.gloss}
                  onChangeText={(value) =>
                    setGlosses((prev) => ({ ...prev, [key]: value }))
                  }
                  placeholder="Meaning in English"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  style={inputStyle}
                />
              </CardBlock>
            );
          })}
          <UiButton label={`Save ${rows.length} word${rows.length === 1 ? '' : 's'}`} onPress={onSave} disabled={busy} />
        </>
      ) : null}

      <ThemedText type="smallBold">Already imported ({stored.length})</ThemedText>
      {stored.length > 0 ? (
        <>
          {stored.map((entry) => (
            <CardBlock key={entry.id}>
              <ThemedText type="smallBold">{entry.lemma}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {entry.gloss}
              </ThemedText>
            </CardBlock>
          ))}
          <UiButton label="Clear dictionary" variant="secondary" onPress={onClear} disabled={busy} />
        </>
      ) : (
        <ThemedText themeColor="textSecondary">No imported words yet.</ThemedText>
      )}

      <UiButton label="Back" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

type DictionaryRow = { lemma: string; gloss: string };

const styles = StyleSheet.create({
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
  },
});
