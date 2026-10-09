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
