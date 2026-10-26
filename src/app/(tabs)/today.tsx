import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  computeStreak,
  countDueCards,
  getDailyGoal,
  getReviewActivity,
  listDeckSummaries,
  listLeechCards,
  makeCardsDueNow,
  setDailyGoal,
  type DailyCount,
  type LeechCard,
} from '@/db/queries';
import type { DeckSummary } from '@/db/types';
import { useDatabase } from '@/providers/database-provider';

function leechReason(leech: LeechCard): string {
  if (leech.lapses > 0 && leech.fail_count > 0) {
    return `${leech.lapses} lapses · ${leech.fail_count} misses`;
  }
  if (leech.lapses > 0) return `${leech.lapses} lapses`;
  if (leech.fail_count > 0) {
    const pct = Math.round(leech.accuracy * 100);
    return `${leech.fail_count} misses · ${pct}% right`;
  }
  return `${Math.round(leech.accuracy * 100)}% right`;
}

export default function TodayScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [dueCount, setDueCount] = useState(0);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [activity, setActivity] = useState<DailyCount[]>([]);
  const [goal, setGoal] = useState(20);
  const [leeches, setLeeches] = useState<LeechCard[]>([]);
  const [drilling, setDrilling] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      Promise.all([
        countDueCards(),
        listDeckSummaries(),
        getReviewActivity(14),
        getDailyGoal(),
        listLeechCards(undefined, 5),
      ]).then(([due, deckRows, days, savedGoal, trouble]) => {
        if (cancelled) return;
        setDueCount(due);
        setDecks(deckRows);
        setActivity(days);
        setGoal(savedGoal);
        setLeeches(trouble);
      });
      return () => {
        cancelled = true;
      };
    }, [revision]),
  );

  const cardTotal = decks.reduce((sum, deck) => sum + deck.card_count, 0);
  const todayCount = activity.length > 0 ? activity[activity.length - 1].count : 0;
  const streak = computeStreak(activity, goal);
  const progress = goal > 0 ? Math.min(1, todayCount / goal) : 0;
  const maxBar = Math.max(goal, ...activity.map((d) => d.count), 1);

  async function changeGoal(delta: number) {
    const next = await setDailyGoal(goal + delta);
    setGoal(next);
  }

  async function onDrillLeeches() {
    if (leeches.length === 0) return;
    setDrilling(true);
    try {
      await makeCardsDueNow(leeches.map((l) => l.card_id));
      refresh();
      router.push('/review');
    } finally {
      setDrilling(false);
    }
  }

  return (
    <Screen tabInset>
      <ThemedText type="subtitle">Today</ThemedText>
      <ThemedText themeColor="textSecondary">
        Review due cards. FSRS schedules the next time based on how well you remember.
      </ThemedText>

      <CardBlock>
        <ThemedText type="title">{dueCount}</ThemedText>
        <ThemedText>cards due</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {cardTotal} cards across {decks.length} decks
        </ThemedText>
      </CardBlock>

      <UiButton
        label={dueCount ? 'Start reviews' : 'Nothing due'}
        disabled={!dueCount}
        onPress={() => router.push('/review')}
      />

      <CardBlock>
        <View style={styles.row}>
          <View>
            <ThemedText type="smallBold">Daily goal</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {todayCount} of {goal} reviews · {streak}-day streak
            </ThemedText>
          </View>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => void changeGoal(-5)}
              style={[styles.step, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">−5</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => void changeGoal(5)}
              style={[styles.step, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">+5</ThemedText>
            </Pressable>
          </View>
        </View>
        <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.tint },
            ]}
          />
        </View>
        <View style={styles.chart}>
          {activity.map((d) => {
            const height = Math.max(4, Math.round((d.count / maxBar) * 56));
            const met = d.count >= goal;
            return (
              <View key={d.day} style={styles.chartCol}>
                <View
                  style={[
                    styles.chartBar,
                    {
                      height,
                      backgroundColor: met ? theme.tint : theme.backgroundSelected,
                    },
                  ]}
                />
                <ThemedText type="small" themeColor="textSecondary" style={styles.chartDay}>
                  {d.day.slice(8)}
                </ThemedText>
              </View>
            );
          })}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Last 14 days · tinted bars met the goal.
        </ThemedText>
      </CardBlock>

      <CardBlock>
        <ThemedText type="smallBold">
          {leeches.length ? 'Trouble words' : 'No trouble words yet'}
        </ThemedText>
        {leeches.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Words you miss repeatedly will appear here for extra drills.
          </ThemedText>
        ) : (
          <>
            {leeches.map((leech) => (
              <Pressable key={leech.card_id} onPress={() => router.push(`/entry/${leech.entry_id}`)}>
                <View style={styles.leechRow}>
                  <ThemedText type="smallBold">
                    {leech.lemma} — {leech.gloss}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {leechReason(leech)} · {leech.deck_name}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
            <UiButton
              label={drilling ? 'Making due…' : `Drill ${leeches.length} trouble words now`}
              variant="secondary"
              onPress={onDrillLeeches}
              disabled={drilling}
            />
          </>
        )}
      </CardBlock>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  stepper: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  step: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  bar: {
    borderRadius: 999,
    height: 10,
    overflow: 'hidden',
  },
  fill: {
    height: 10,
    borderRadius: 999,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
    paddingTop: Spacing.two,
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  chartBar: {
    width: '100%',
    borderRadius: 3,
  },
  chartDay: {
    fontSize: 10,
  },
  leechRow: {
    paddingVertical: Spacing.one,
  },
});
