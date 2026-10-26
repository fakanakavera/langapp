import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';

import type { CardRow } from '@/db/types';

export const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
});

export { Rating };

export function emptyFsrsCard(now = new Date()): Card {
  return createEmptyCard(now);
}

export function cardFromRow(row: CardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function scheduleReview(row: CardRow, rating: Grade, now = new Date()) {
  return scheduler.next(cardFromRow(row), now, rating);
}

export const RATING_LABELS: { rating: Grade; label: string }[] = [
  { rating: Rating.Again, label: 'Again' },
  { rating: Rating.Hard, label: 'Hard' },
  { rating: Rating.Good, label: 'Good' },
  { rating: Rating.Easy, label: 'Easy' },
];

/**
 * Streak ladder: every consecutive non-Again stretches the next review
 * exponentially; a single Again resets the streak to zero.
 *
 * Anchored at 5 straight rights -> 24h, each step multiplies by 3:
 * 1 -> ~18min, 2 -> ~53min, 3 -> ~2.7h, 4 -> ~8h, 5 -> 24h, 6 -> 3d,
 * 7 -> 9d, 8 -> 27d, ... clamped to `maximum_interval` (36500d).
 */
export const STREAK_LADDER_ANCHOR = 5;
export const STREAK_LADDER_FACTOR = 3;
export const STREAK_LADDER_MAX_DAYS = 36500;

export function ladderDelayMs(streak: number): number {
  if (streak <= 0) return 0;
  const days = Math.pow(STREAK_LADDER_FACTOR, streak - STREAK_LADDER_ANCHOR);
  const clamped = Math.min(days, STREAK_LADDER_MAX_DAYS);
  return Math.round(clamped * 86_400_000);
}

export function ladderScheduledDays(streak: number): number {
  return Math.round(ladderDelayMs(streak) / 86_400_000);
}

/** Consecutive non-Again count including the current attempt. Again -> 0. */
export function streakIncludingCurrent(
  priorNewestFirst: { rating: number }[],
  currentRating: number,
): number {
  if (currentRating === Rating.Again) return 0;
  let streak = 1;
  for (const prior of priorNewestFirst) {
    if (prior.rating === Rating.Again) break;
    streak += 1;
  }
  return streak;
}
