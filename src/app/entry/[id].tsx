import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { generateExamplePhrases, getAiStatus } from '@/ai/engine';
import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { addExample, getEntry, listExamples, listInflections, listKnownLemmas, listReviewsForEntry, resetCardDueDate } from '@/db/queries';
import type { Entry, Example, Inflection } from '@/db/types';
import type { EntryReview } from '@/db/queries';
import { formatDateTime } from '@/lib/dates';
import { RATING_LABELS } from '@/srs/scheduler';
import { useDatabase } from '@/providers/database-provider';

const RESPONSE_LABELS: Record<string, string> = {
  know: 'Know',
  dont_know: "Don't know",
  no_idea: 'No idea',
  vague_idea: 'Vague idea',
  knew_confirm: 'Knew it',
};

function formatSecs(durationMs?: number): string {
  if (durationMs == null) return '—';
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ratingLabel(rating: number): string {
  return RATING_LABELS.find((r) => r.rating === rating)?.label ?? `#${rating}`;
}

export default function EntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { revision, refresh } = useDatabase();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [forms, setForms] = useState<Inflection[]>([]);
  const [examples, setExamples] = useState<Example[]>([]);
  const [reviews, setReviews] = useState<EntryReview[]>([]);
  const [busy, setBusy] = useState(false);
  const ai = getAiStatus();

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([getEntry(id), listInflections(id), listExamples(id), listReviewsForEntry(id)]).then(
        ([nextEntry, nextForms, nextExamples, nextReviews]) => {
          if (cancelled) return;
          setEntry(nextEntry);
          setForms(nextForms);
          setExamples(nextExamples);
          setReviews(nextReviews);
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

  async function onResetDueDate() {
    if (!entry) return;
    Alert.alert(
      'Reset review schedule?',
      'This will make the card due for review immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: async () => {
            try {
              const db = (await import('@/db/client')).getDb();
              const card = await db.getFirstAsync<{ id: string }>(
                'SELECT id FROM cards WHERE entry_id = ?',
                entry.id,
              );
              if (card) {
                await resetCardDueDate(card.id);
                refresh();
              }
            } catch (error) {
              Alert.alert('Error', error instanceof Error ? error.message : String(error));
            }
          },
        },
      ],
    );
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

      <CardBlock>
        <ThemedText type="smallBold">Review history</ThemedText>
        {reviews.length ? (
          reviews.map((review) => {
            const durations = review.faces.map((f) => f.duration_ms).filter((d) => d != null);
            const total = durations.length
              ? ` · ${formatSecs(durations.reduce((a, b) => (a ?? 0) + (b ?? 0), 0))} total`
              : '';
            return (
              <ThemedText key={review.id} type="small" themeColor="textSecondary">
                {ratingLabel(review.rating)} · {formatDateTime(review.reviewed_at)}
                {total}
                {review.faces.length
                  ? ` · ${review.faces.map((f) => `${f.face}:${RESPONSE_LABELS[f.response] ?? f.response} ${formatSecs(f.duration_ms)}`).join(' → ')}`
                  : ''}
              </ThemedText>
            );
          })
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            No reviews yet.
          </ThemedText>
        )}
      </CardBlock>

      <UiButton
        label={ai.available ? 'Generate with on-device Qwen' : 'Generate placeholder examples'}
        onPress={onGenerate}
        disabled={busy || !entry}
      />
      <UiButton
        label="Reset review schedule (make due now)"
        variant="secondary"
        onPress={onResetDueDate}
        disabled={!entry}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {ai.reason}
      </ThemedText>
    </Screen>
  );
}
