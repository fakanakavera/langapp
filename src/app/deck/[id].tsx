import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { exportDeckBackup } from '@/backup/backup';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { Slider } from '@/components/slider';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { useTheme } from '@/hooks/use-theme';
import {
  getDeck,
  listCardStatsForDeck,
  listCardsForDeck,
  pullDueForward,
  resetDeckStats,
} from '@/db/queries';
import type { CardStats } from '@/db/queries';
import type { Deck, DueCard } from '@/db/types';
import { formatDue } from '@/lib/dates';
import { MASTERY_GRADUATION_TIER } from '@/lib/mastery';
import { useDatabase } from '@/providers/database-provider';

type SortKey = 'due' | 'accuracy' | 'streak' | 'fails' | 'reviews' | 'name';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'due', label: 'Due' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'streak', label: 'Streak' },
  { key: 'fails', label: 'Wrongs' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'name', label: 'Name' },
];

/** Sensible first-tap direction per key: worst/due first, counts high first. */
const SORT_DEFAULT_ASC: Record<SortKey, boolean> = {
  due: true,
  accuracy: true,
  streak: true,
  fails: false,
  reviews: false,
  name: true,
};

export default function DeckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<DueCard[]>([]);
  const [stats, setStats] = useState<Map<string, CardStats>>(new Map());
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [exporting, setExporting] = useState(false);
  const [targetPct, setTargetPct] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [resetting, setResetting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      Promise.all([getDeck(id), listCardsForDeck(id), listCardStatsForDeck(id)]).then(
        ([nextDeck, nextCards, nextStats]) => {
          if (cancelled) return;
          setDeck(nextDeck);
          setCards(nextCards);
          setStats(new Map(nextStats.map((s) => [s.card_id, s])));
        },
      );
      return () => {
        cancelled = true;
      };
    }, [id, revision]),
  );

  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(timer);
  }, []);

  const dueCount = useMemo(
    () => cards.filter((card) => new Date(card.due).getTime() <= now).length,
    [cards, now]
  );

  // Fast-forward preview: slider defaults to today's due share until the
  // user drags it. Target counts round up so the share is at least the
  // selected percentage.
  const total = cards.length;
  const studyingCount = cards.filter(
    (card) => card.locked === 0 && card.mastery_tier < MASTERY_GRADUATION_TIER,
  ).length;
  const currentPct = total === 0 ? 0 : Math.round((dueCount / total) * 100);
  const selectedPct = targetPct ?? currentPct;
  const targetCount = Math.ceil((total * selectedPct) / 100);
  const need = targetCount - dueCount;

  function onSortPress(key: SortKey) {
    // Tapping the active key flips direction; a new key takes its default.
    if (key === sortKey) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(SORT_DEFAULT_ASC[key]);
    }
  }

  const sortedCards = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...cards].sort((a, b) => {
      switch (sortKey) {
        case 'due':
          return dir * (new Date(a.due).getTime() - new Date(b.due).getTime());
        case 'name':
          return dir * a.lemma.localeCompare(b.lemma);
        case 'accuracy': {
          // Unreviewed cards always sink to the bottom.
          const sa = stats.get(a.id);
          const sb = stats.get(b.id);
          const aa = sa && sa.review_count > 0 ? sa.accuracy : null;
          const ab = sb && sb.review_count > 0 ? sb.accuracy : null;
          if (aa === null && ab === null) return 0;
          if (aa === null) return 1;
          if (ab === null) return -1;
          return dir * (aa - ab);
        }
        case 'streak':
          return dir * ((stats.get(a.id)?.streak ?? 0) - (stats.get(b.id)?.streak ?? 0));
        case 'fails':
          return dir * ((stats.get(a.id)?.fail_count ?? 0) - (stats.get(b.id)?.fail_count ?? 0));
        case 'reviews':
          return dir * ((stats.get(a.id)?.review_count ?? 0) - (stats.get(b.id)?.review_count ?? 0));
      }
    });
  }, [cards, stats, sortKey, sortAsc]);

  async function onPullForward() {
    if (typeof id !== 'string' || need <= 0) return;
    setPulling(true);
    try {
      await pullDueForward(id, need);
      setTargetPct(null);
      refresh();
    } catch (error) {
      Alert.alert('Could not update schedule', error instanceof Error ? error.message : String(error));
    } finally {
      setPulling(false);
    }
  }

  async function onExportDeck() {
    if (typeof id !== 'string') return;
    setExporting(true);
    try {
      await exportDeckBackup(id);
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  function onResetStats() {
    if (typeof id !== 'string' || total === 0) return;
    Alert.alert(
      'Reset all stats?',
      `"${deck?.name ?? 'Deck'}": ${total} cards go back to new (all due now), quiz mastery resets to Tier 0, and all review history, study time, and trouble-word data for this deck are deleted. Words and examples are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            setResetting(true);
            resetDeckStats(id)
              .then(() => {
                setTargetPct(null);
                refresh();
              })
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

  return (
    <Screen>
      <ThemedText type="subtitle">{deck?.name ?? 'Deck'}</ThemedText>
      {deck?.description ? (
        <ThemedText themeColor="textSecondary">{deck.description}</ThemedText>
      ) : null}

      {deck ? (
        <CardBlock>
          <ThemedText type="smallBold">Studying card limit</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {studyingCount} of {deck.studying_limit} active cards. Settings applies the same
            limit separately to every deck; other cards enter studying as cards graduate.
          </ThemedText>
        </CardBlock>
      ) : null}

      <UiButton
        label={dueCount ? `Review ${dueCount} due` : 'No cards due'}
        disabled={!dueCount}
        onPress={() => router.push({ pathname: '/review', params: { deckId: id } })}
      />
      <UiButton
        label="Deck stats"
        variant="secondary"
        onPress={() => router.push({ pathname: '/deck-stats/[id]', params: { id } })}
      />
      <UiButton
        label="Multiple choice quiz"
        variant="secondary"
        onPress={() => router.push({ pathname: '/quiz/[id]', params: { id } })}
      />
      <UiButton
        label="True or false"
        variant="secondary"
        onPress={() => router.push({ pathname: '/judge/[id]', params: { id } })}
      />
      <UiButton
        label="Say the meaning"
        variant="secondary"
        onPress={() => router.push({ pathname: '/recall/[id]', params: { id } })}
      />
      <UiButton
        label="Reading practice"
        variant="secondary"
        onPress={() => router.push({ pathname: '/reading/[id]', params: { id } })}
      />
      <UiButton
        label="Case trainer"
        variant="secondary"
        onPress={() => router.push({ pathname: '/cases/[id]', params: { id } })}
      />
      <UiButton
        label={exporting ? 'Exporting…' : 'Export this deck (JSON)'}
        variant="secondary"
        onPress={onExportDeck}
        disabled={exporting}
      />
      <UiButton
        label={resetting ? 'Resetting…' : 'Reset all stats'}
        variant="secondary"
        onPress={onResetStats}
        disabled={resetting || total === 0}
      />

      {total > 0 ? (
        <CardBlock>
          <ThemedText type="smallBold">Due now: {dueCount} of {total} ({currentPct}%)</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Slide to pull reviews forward — the soonest cards become due until {selectedPct}%
            is ready. Memory scheduling is untouched, only timing moves.
          </ThemedText>
          <Slider value={selectedPct} onChange={setTargetPct} />
          <UiButton
            label={
              pulling
                ? 'Updating…'
                : need > 0
                  ? `Make ${need} more due (${selectedPct}%)`
                  : `Already ${currentPct}% due`
            }
            variant="secondary"
            onPress={onPullForward}
            disabled={pulling || need <= 0}
          />
        </CardBlock>
      ) : null}

      {total > 0 ? (
        <CardBlock>
          <ThemedText type="smallBold">Sort cards</ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortRow}>
            {SORT_OPTIONS.map((o) => {
              const active = o.key === sortKey;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => onSortPress(o.key)}
                  style={[
                    styles.chip,
                    { backgroundColor: active ? theme.tint : theme.backgroundSelected },
                  ]}>
                  <ThemedText
                    type="smallBold"
                    style={{ color: active ? '#ffffff' : theme.text }}>
                    {o.label}
                    {active ? (sortAsc ? ' ▲' : ' ▼') : ''}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </CardBlock>
      ) : null}

      {sortedCards.map((card) => {
        const s = stats.get(card.id);
        const reviewed = !!s && s.review_count > 0;
        const pct = reviewed && s ? Math.round(s.accuracy * 100) : 0;
        return (
          <CardBlock key={card.id} onPress={() => router.push(`/entry/${card.entry_id}`)}>
            <ThemedText type="smallBold">
              {card.front} — {card.back}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDue(card.due)}
            </ThemedText>
            {reviewed && s ? (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  Streak {s.streak} · {s.success_count} right · {s.fail_count} wrong · {pct}%
                </ThemedText>
                <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
                  <View
                    style={[styles.fill, { width: `${pct}%`, backgroundColor: theme.tint }]}
                  />
                </View>
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No reviews yet
              </ThemedText>
            )}
          </CardBlock>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
  },
  fill: {
    borderRadius: 2,
    height: 4,
  },
  sortRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
});
