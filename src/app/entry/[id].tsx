import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { generateExamplePhrases, getAiStatus } from '@/ai/engine';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { addExample, getEntry, listExamples, listInflections, listKnownLemmas } from '@/db/queries';
import type { Entry, Example, Inflection } from '@/db/types';
import { useDatabase } from '@/providers/database-provider';

export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { revision, refresh } = useDatabase();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [forms, setForms] = useState<Inflection[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [busy, setBusy] = useState(false);
  const ai = getAiStatus();

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([getEntry(id), listInflections(id), listExamples(id)]).then(
        ([nextEntry, nextForms, nextExamples]) => {
          if (cancelled) return;
          setEntry(nextEntry);
          setForms(nextForms);
          setExamples(nextExamples);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id, revision]),
  );

  async function onGenerate() {
    if (!entry) return;
    setBusy(true);
    try {
      const knownLemmas = await listKnownLemmas();
      const generated = await generateExamplePhrases({
        lemma: entry.lemma,
        gloss: entry.gloss,
        knownLemmas,
      });
      for (const item of generated) {
        await addExample({
          entryId: entry.id,
          text: item.text,
          translation: item.translation,
          source: ai.available ? 'ai' : 'ai',
        });
      }
      refresh();
    } catch (error) {
      Alert.alert('Could not generate examples', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ThemedText type="subtitle">{entry?.lemma ?? 'Word'}</ThemedText>
      <ThemedText>{entry?.gloss}</ThemedText>
      {entry?.pos ? (
        <ThemedText type="small" themeColor="textSecondary">
          {entry.pos}
          {entry.notes ? ` · ${entry.notes}` : ''}
        </ThemedText>
      ) : null}

      <CardBlock>
        <ThemedText type="smallBold">Known forms</ThemedText>
        {forms.length ? (
          forms.map((form) => (
            <ThemedText key={form.id} type="small" themeColor="textSecondary">
              {form.form}
              {form.tags ? ` · ${form.tags}` : ''}
            </ThemedText>
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No inflections stored yet.
          </ThemedText>
        )}
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">Examples</ThemedText>
        {examples.length ? (
          examples.map((example) => (
            <ThemedText key={example.id} type="small" themeColor="textSecondary">
              {example.text}
              {example.translation ? ` — ${example.translation}` : ''}
            </ThemedText>
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No example phrases yet.
          </ThemedText>
        )}
      </CardBlock>

      <UiButton
        label={ai.available ? 'Generate with on-device Qwen' : 'Generate placeholder examples'}
        onPress={onGenerate}
        disabled={busy || !entry}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {ai.reason}
      </ThemedText>
    </Screen>
  );
}
