import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { PieChart, type PieChartSegment } from '@/components/pie-chart';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { getDeck, getDeckStats, listLeechCards, makeCardsDueNow, resetDeckStats } from '@/db/queries';
import type { DeckStats, LeechCard } from '@/db/queries';
import type { Deck } from '@/db/types';
import { formatDuration } from '@/lib/dates';
import { useTheme } from '@/hooks/use-theme';
import { useDatabase } from '@/providers/database-provider';

function percent(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function leechReason(leech: LeechCard): string {
  if (leech.lapses > 0 && leech.fail_count > 0) {
    return `${leech.lapses} lapses · ${leech.fail_count} misses of ${leech.review_count}`;
  }
  if (leech.lapses > 0) return `${leech.lapses} lapses`;
  return `${leech.fail_count} misses · ${Math.round(leech.accuracy * 100)}% right`;
}

export default function DeckStatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [stats, setStats] = useState<DeckStats | null>(null);
  const [leeches, setLeeches] = useState<LeechCard[]>([]);
  const [drilling, setDrilling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const tierColors = {
    new: theme.textSecondary,
    learning: '#E6A23C',
    review: '#2EAD68',
    relearning: theme.error,
  };

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([getDeck(id), getDeckStats(id), listLeechCards(id, 10)]).then(
        ([nextDeck, nextStats, trouble]) => {
          if (cancelled) return;
          setDeck(nextDeck);
          setStats(nextStats);
          setLeeches(trouble);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id, revision]),
  );

  async function onDrillLeeches() {
    if (typeof id !== 'string' || leeches.length === 0) return;
    setDrilling(true);
    try {
      await makeCardsDueNow(leeches.map((l) => l.card_id));
      refresh();
      router.push({ pathname: '/review', params: { deckId: id } });
    } finally {
      setDrilling(false);
    }
  }

  function onResetStats() {
    if (typeof id !== 'string') return;
    Alert.alert(
      'Reset all stats?',
      `All review history, study time, and trouble-word data for "${deck?.name ?? 'Deck'}" are deleted, and every card goes back to new (all due now). Words and examples are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setResetting(true);
            resetDeckStats(id)
              .then(() => refresh())
              .catch((error) => {
                Alert.alert(
                  'Could not reset stats',
                  error instanceof Error ? error.message : String(error),
                );
              })
              .finally(() => setResetting(false));
          },
        },
      ],
    );
  }

  const tierTotal = stats
    ? Object.values(stats.wordTiers).reduce((total, count) => total + count, 0)
    : 0;
  const tierSegments: PieChartSegment[] = stats
    ? [
        { label: 'New', value: stats.wordTiers.new, color: tierColors.new },
        { label: 'Learning', value: stats.wordTiers.learning, color: tierColors.learning },
        { label: 'Known', value: stats.wordTiers.review, color: tierColors.review },
        { label: 'Relearning', value: stats.wordTiers.relearning, color: tierColors.relearning },
      ]
    : [];

  return (
    <Screen>
      <ThemedText type="subtitle">{deck?.name ?? 'Deck'} stats</ThemedText>

      <CardBlock>
        <ThemedText type="smallBold">Words by learning tier</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {stats?.wordTiers.review ?? 0} known of {tierTotal} words (
          {percent(stats?.wordTiers.review ?? 0, tierTotal)})
        </ThemedText>
        <PieChart segments={tierSegments} />
        {tierSegments.map((segment) => (
          <ThemedText key={segment.label} type="small">
            <ThemedText style={{ color: segment.color }}>● </ThemedText>
            {segment.label}: {segment.value} ({percent(segment.value, tierTotal)})
          </ThemedText>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          Each word is counted once at its most advanced current card state.
        </ThemedText>
      </CardBlock>

      {!stats || stats.totalReviews === 0 ? (
        <CardBlock>
          <ThemedText type="small" themeColor="textSecondary">
            No reviews yet — stats appear after the first review session.
          </ThemedText>
        </CardBlock>
      ) : (
        <>
          <CardBlock>
            <ThemedText type="smallBold">Study time</ThemedText>
            <ThemedText type="title">{formatDuration(stats.studyMs)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {stats.totalReviews} cards reviewed · {stats.distinctCards} unique
            </ThemedText>
          </CardBlock>

          <CardBlock>
            <ThemedText type="smallBold">Face 1 — word</ThemedText>
            <ThemedText>
              {stats.face1Know} known of {stats.face1Seen} ({percent(stats.face1Know, stats.face1Seen)})
            </ThemedText>
          </CardBlock>

          <CardBlock>
            <ThemedText type="smallBold">Face 2 — hint</ThemedText>
            <ThemedText>
              {stats.face2Know} known of {stats.face2Seen} ({percent(stats.face2Know, stats.face2Seen)})
            </ThemedText>
          </CardBlock>

          <CardBlock>
            <ThemedText type="smallBold">Face 3 — meaning</ThemedText>
            <ThemedText>Had no idea: {stats.face3NoIdea}</ThemedText>
            <ThemedText>Vague idea: {stats.face3VagueIdea}</ThemedText>
            <ThemedText>Knew, confirmed: {stats.face3KnewConfirm}</ThemedText>
          </CardBlock>

          {stats.timedReviews < stats.totalReviews ? (
            <ThemedText type="small" themeColor="textSecondary">
              Time is tracked for {stats.timedReviews} of {stats.totalReviews} reviews (timing
              started with a later update).
            </ThemedText>
          ) : null}
        </>
      )}

      <CardBlock>
        <ThemedText type="smallBold">
          {leeches.length ? `Trouble words (${leeches.length})` : 'Trouble words'}
        </ThemedText>
        {leeches.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing is struggling — misses and lapses will surface the 10 worst words here.
          </ThemedText>
        ) : (
          <View>
            {leeches.map((leech) => (
              <Pressable
                key={leech.card_id}
                onPress={() => router.push(`/entry/${leech.entry_id}`)}>
                <View>
                  <ThemedText type="smallBold">
                    {leech.lemma} — {leech.gloss}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {leechReason(leech)}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </CardBlock>
      {leeches.length > 0 ? (
        <UiButton
          label={drilling ? 'Making due…' : `Drill ${leeches.length} trouble words`}
          variant="secondary"
          onPress={onDrillLeeches}
          disabled={drilling}
        />
      ) : null}
      <UiButton
        label={resetting ? 'Resetting…' : 'Reset all stats'}
        variant="secondary"
        onPress={onResetStats}
        disabled={resetting}
      />
    </Screen>
  );
}
