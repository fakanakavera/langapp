import type { Grade } from 'ts-fsrs';
import { Rating } from 'ts-fsrs';

import { getDb } from '@/db/client';
import type {
  BackupPayload,
  Book,
  CardRow,
  Deck,
  DeckSummary,
  DueCard,
  Entry,
  Example,
  FaceResponse,
  Inflection,
  ReviewRow,
  ReviewSource,
  UnknownWord,
} from '@/db/types';
import { nowIso, toIso } from '@/lib/dates';
import { createId } from '@/lib/id';
import { normalizeRussian, stripAccents } from '@/morphology/dictionary';
import {
  MAX_MASTERY_TIER,
  MASTERY_FREE_REVIEW_TIER,
  MASTERY_GRADUATION_TIER,
  masteryIntervalMs,
  masteryTierAfterQuiz,
} from '@/lib/mastery';
import { emptyFsrsCard, ladderDelayMs, ladderScheduledDays, scheduleReview, streakIncludingCurrent } from '@/srs/scheduler';

function parseReviewHistory(raw: string | FaceResponse[] | null | undefined): FaceResponse[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function parseFaces(raw: unknown): FaceResponse[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as FaceResponse[];
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FaceResponse[]) : [];
  } catch {
    return [];
  }
}

/** Normalize faces for storage: arrays stay, JSON strings pass through, else '[]'. */
function facesToJson(value: unknown): string {
  if (typeof value === 'string') return parseFaces(value).length ? value : '[]';
  if (Array.isArray(value)) return JSON.stringify(value);
  return '[]';
}

function mapCardRow(raw: any): CardRow & { lemma?: string; gloss?: string; deck_name?: string } {
  return {
    ...raw,
    mastery_tier: Number(raw.mastery_tier ?? 0),
    quiz_due: String(raw.quiz_due || raw.due),
    review_history: parseReviewHistory(raw.review_history),
  };
}

export function mapFaceResponsesToRating(history: FaceResponse[]): Grade {

  const face1 = history.find((h) => h.face === 1);
  const face2 = history.find((h) => h.face === 2);
  const face3 = history.find((h) => h.face === 3);

  if (face1?.response === 'know') {
    return Rating.Easy;
  }
  if (face2?.response === 'know') {
    return Rating.Good;
  }
  if (face3) {
    switch (face3.response) {
      case 'knew_confirm':
        return Rating.Hard;
      case 'vague_idea':
        return Rating.Hard;
      case 'no_idea':
      default:
        return Rating.Again;
    }
  }
  return Rating.Again;
}

export async function listDeckSummaries(): Promise<DeckSummary[]> {
  const db = getDb();
  const now = nowIso();
  return db.getAllAsync<DeckSummary>(
    `SELECT d.*,
            (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count,
            (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.due <= ? AND c.locked = 0) AS due_count,
            (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.locked = 0 AND c.mastery_tier < ?) AS studying_count
     FROM decks d
     ORDER BY d.updated_at DESC`,
    now,
    MASTERY_GRADUATION_TIER,
  );
}

export async function getDeck(id: string): Promise<Deck | null> {
  return getDb().getFirstAsync<Deck>('SELECT * FROM decks WHERE id = ?', id);
}

/**
 * Delete a deck with its cards and reviews. Vocabulary entries (with their
 * inflections and examples) that no other deck uses are removed as well;
 * shared ones are kept.
 */
export async function deleteDeck(deckId: string): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)',
      deckId,
    );
    await db.runAsync('DELETE FROM cards WHERE deck_id = ?', deckId);
    await db.runAsync('DELETE FROM examples WHERE entry_id NOT IN (SELECT entry_id FROM cards)');
    await db.runAsync(
      'DELETE FROM inflections WHERE entry_id NOT IN (SELECT entry_id FROM cards)',
    );
    await db.runAsync('DELETE FROM entries WHERE id NOT IN (SELECT entry_id FROM cards)');
    await db.runAsync('DELETE FROM decks WHERE id = ?', deckId);
  });
}

export async function createDeck(name: string, description = ''): Promise<Deck> {
  const db = getDb();
  const createdAt = nowIso();
  const studyingLimit = await getStudyingLimit();
  const deck: Deck = {
    id: createId(),
    name: name.trim(),
    description: description.trim(),
    pos_category: null,
    studying_limit: studyingLimit,
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db.runAsync(
    `INSERT INTO decks (id, name, description, pos_category, studying_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    deck.id,
    deck.name,
    deck.description,
    deck.pos_category,
    deck.studying_limit,
    deck.created_at,
    deck.updated_at,
  );
  return deck;
}

export async function listDueCards(deckId?: string): Promise<DueCard[]> {
  const db = getDb();
  const now = nowIso();
  if (deckId) {
    const rows = await db.getAllAsync<any>(
      `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
       FROM cards c
       JOIN entries e ON e.id = c.entry_id
       JOIN decks d ON d.id = c.deck_id
       WHERE c.deck_id = ? AND c.due <= ? AND c.locked = 0
       ORDER BY c.due ASC`,
      deckId,
      now,
    );
    return rows.map(mapCardRow) as DueCard[];
  }
  const rows = await db.getAllAsync<any>(
    `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
     FROM cards c
     JOIN entries e ON e.id = c.entry_id
     JOIN decks d ON d.id = c.deck_id
     WHERE c.due <= ? AND c.locked = 0
     ORDER BY c.due ASC`,
    now,
  );
  return rows.map(mapCardRow) as DueCard[];
}

export async function listQuizDueCards(deckId?: string): Promise<DueCard[]> {
  const now = nowIso();
  const rows = deckId
    ? await getDb().getAllAsync<any>(
        `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
         FROM cards c
         JOIN entries e ON e.id = c.entry_id
         JOIN decks d ON d.id = c.deck_id
         WHERE c.deck_id = ? AND c.quiz_due <= ? AND c.locked = 0
         ORDER BY c.quiz_due ASC`,
        deckId,
        now,
      )
    : await getDb().getAllAsync<any>(
        `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
         FROM cards c
         JOIN entries e ON e.id = c.entry_id
         JOIN decks d ON d.id = c.deck_id
         WHERE c.quiz_due <= ? AND c.locked = 0
         ORDER BY c.quiz_due ASC`,
        now,
      );
  return rows.map(mapCardRow) as DueCard[];
}

export async function countDueCards(): Promise<number> {
  const row = await getDb().getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cards WHERE due <= ?',
    nowIso(),
  );
  return row?.count ?? 0;
}

export type DeckEntry = {
  entry_id: string;
  lemma: string;
  gloss: string;
  pos: string;
};

export async function listEntriesForDeck(deckId: string): Promise<DeckEntry[]> {
  return getDb().getAllAsync<DeckEntry>(
    `SELECT e.id AS entry_id, e.lemma AS lemma, e.gloss AS gloss, e.pos AS pos
     FROM entries e
     JOIN cards c ON c.entry_id = e.id
     WHERE c.deck_id = ?
     GROUP BY e.id
     ORDER BY e.lemma COLLATE NOCASE`,
    deckId,
  );
}

export async function listCardsForDeck(deckId: string): Promise<DueCard[]> {
  const rows = await getDb().getAllAsync<any>(
    `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
     FROM cards c
     JOIN entries e ON e.id = c.entry_id
     JOIN decks d ON d.id = c.deck_id
     WHERE c.deck_id = ?
     ORDER BY e.lemma COLLATE NOCASE`,
    deckId,
  );
  return rows.map(mapCardRow) as DueCard[];
}

export type CardStats = {
  card_id: string;
  review_count: number;
  success_count: number;
  fail_count: number;
  /** 0..1 share of non-Again reviews. */
  accuracy: number;
  /** Consecutive non-Again reviews, newest-first. */
  streak: number;
};

/**
 * Per-card right/wrong + streak for a deck in a single query (deck
 * screen stats bars). Small decks: a few hundred review rows at most.
 */
export async function listCardStatsForDeck(deckId: string): Promise<CardStats[]> {
  const rows = await getDb()
    .getAllAsync<{ card_id: string; rating: number }>(
      `SELECT r.card_id, r.rating
        FROM reviews r
        JOIN cards c ON c.id = r.card_id
        WHERE c.deck_id = ?
        ORDER BY r.reviewed_at DESC`,
      deckId,
    )
    .catch(() => [] as { card_id: string; rating: number }[]);
  const byCard = new Map<
    string,
    { count: number; fail: number; streak: number; streakOpen: boolean }
  >();
  for (const row of rows) {
    let acc = byCard.get(row.card_id);
    if (!acc) {
      acc = { count: 0, fail: 0, streak: 0, streakOpen: true };
      byCard.set(row.card_id, acc);
    }
    acc.count += 1;
    if (row.rating === Rating.Again) {
      acc.fail += 1;
      acc.streakOpen = false;
    } else if (acc.streakOpen) {
      acc.streak += 1;
    }
  }
  return [...byCard.entries()].map(([card_id, acc]) => ({
    card_id,
    review_count: acc.count,
    success_count: acc.count - acc.fail,
    fail_count: acc.fail,
    accuracy: acc.count > 0 ? (acc.count - acc.fail) / acc.count : 1,
    streak: acc.streak,
  }));
}

export async function getEntry(id: string): Promise<Entry | null> {
  return getDb().getFirstAsync<Entry>('SELECT * FROM entries WHERE id = ?', id);
}

export async function listInflections(entryId: string): Promise<Inflection[]> {
  return getDb().getAllAsync<Inflection>(
    'SELECT * FROM inflections WHERE entry_id = ? ORDER BY form',
    entryId,
  );
}

export async function listExamples(entryId: string): Promise<Example[]> {
  return getDb().getAllAsync<Example>(
    'SELECT * FROM examples WHERE entry_id = ? ORDER BY created_at DESC',
    entryId,
  );
}

export async function lookupForm(form: string): Promise<(Entry & { tags: string; matched_form: string })[]> {
  const normalized = normalizeRussian(form);
  if (!normalized) return [];
  return getDb().getAllAsync<Entry & { tags: string; matched_form: string }>(
    `SELECT e.*, i.tags, i.form AS matched_form
     FROM inflections i
     JOIN entries e ON e.id = i.entry_id
     WHERE i.form = ?`,
    normalized,
  );
}

export async function addVocabulary(input: {
  deckId: string;
  lemma: string;
  gloss: string;
  pos?: string;
  notes?: string;
  surfaceForm?: string;
}): Promise<{ entry: Entry; card: CardRow }> {
  const db = getDb();
  const createdAt = nowIso();
  const fsrs = emptyFsrsCard(new Date(createdAt));
  const lemma = input.lemma.trim();
  const gloss = input.gloss.trim();
  const entry: Entry = {
    id: createId(),
    lemma,
    language: 'ru',
    pos: input.pos?.trim() ?? '',
    gloss,
    notes: input.notes?.trim() ?? '',
    created_at: createdAt,
  };

  // New cards start locked. They are unlocked by the unlock scheduler when
  // a studying slot frees up. unlock_order is sequential within the deck.
  const maxOrderRow = await db.getFirstAsync<{ max_order: number }>(
    'SELECT COALESCE(MAX(unlock_order), 0) AS max_order FROM cards WHERE deck_id = ?',
    input.deckId,
  );
  const unlockOrder = Number(maxOrderRow?.max_order ?? 0) + 1;

  const card: CardRow = {
    id: createId(),
    deck_id: input.deckId,
    entry_id: entry.id,
    card_type: 'recognition',
    front: lemma,
    back: gloss,
    due: fsrs.due.toISOString(),
    stability: fsrs.stability,
    difficulty: fsrs.difficulty,
    elapsed_days: fsrs.elapsed_days,
    scheduled_days: fsrs.scheduled_days,
    learning_steps: fsrs.learning_steps,
    reps: fsrs.reps,
    lapses: fsrs.lapses,
    state: fsrs.state,
    mastery_tier: 0,
    quiz_due: fsrs.due.toISOString(),
    last_review: null,
    review_face: 1,
    review_history: [],
    locked: 1,
    unlock_order: unlockOrder,
    created_at: createdAt,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO entries (id, lemma, language, pos, gloss, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.lemma,
      entry.language,
      entry.pos,
      entry.gloss,
      entry.notes,
      entry.created_at,
    );

    const forms = new Set([normalizeRussian(lemma)]);
    if (input.surfaceForm) forms.add(normalizeRussian(input.surfaceForm));
    for (const form of forms) {
      if (!form) continue;
      await db.runAsync(
        `INSERT INTO inflections (id, entry_id, form, tags) VALUES (?, ?, ?, ?)`,
        createId(),
        entry.id,
        form,
        form === normalizeRussian(lemma) ? 'lemma' : 'observed',
      );
    }

    await db.runAsync(
      `INSERT INTO cards (
        id, deck_id, entry_id, card_type, front, back,
        due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
        reps, lapses, state, mastery_tier, quiz_due, last_review, review_face, review_history, locked, unlock_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      card.id,
      card.deck_id,
      card.entry_id,
      card.card_type,
      card.front,
      card.back,
      card.due,
      card.stability,
      card.difficulty,
      card.elapsed_days,
      card.scheduled_days,
      card.learning_steps,
      card.reps,
      card.lapses,
      card.state,
      card.mastery_tier,
      card.quiz_due,
      card.last_review,
      card.review_face,
      JSON.stringify(card.review_history),
      card.locked,
      card.unlock_order,
      card.created_at,
    );

    await db.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', createdAt, input.deckId);
  });

  return { entry, card };
}

export async function resetCardReviewState(cardId: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE cards SET review_face = 1, review_history = '[]' WHERE id = ?`,
    cardId,
  );
}

export async function resetAllDueCardsReviewState(deckId?: string): Promise<void> {
  const db = getDb();
  const now = nowIso();
  if (deckId) {
    await db.runAsync(
      `UPDATE cards SET review_face = 1, review_history = '[]' WHERE deck_id = ? AND due <= ?`,
      deckId,
      now,
    );
  } else {
    await db.runAsync(
      `UPDATE cards SET review_face = 1, review_history = '[]' WHERE due <= ?`,
      now,
    );
  }
}

export async function resetCardDueDate(cardId: string): Promise<void> {
  const db = getDb();
  const now = nowIso();
  await db.runAsync(
    `UPDATE cards SET due = ?, quiz_due = ?, review_face = 1, review_history = '[]' WHERE id = ?`,
    now,
    now,
    cardId,
  );
}

/**
 * Reset ALL stats for a deck: deletes its review history and restores every
 * card to a fresh FSRS state (due now, zero reps/lapses, default
 * stability/difficulty). Vocabulary (entries, inflections, examples) and the
 * cards themselves are kept — only scheduling + history are wiped. Returns
 * how many cards were reset.
 */
export async function resetDeckStats(deckId: string): Promise<number> {
  const db = getDb();
  const fresh = emptyFsrsCard(new Date());
  const cards = await db
    .getAllAsync<{ id: string }>('SELECT id FROM cards WHERE deck_id = ?', deckId)
    .catch(() => [] as { id: string }[]);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM reviews WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ?)',
      deckId,
    );
    await db.runAsync(
      `UPDATE cards SET
         due = ?, quiz_due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
         learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = NULL,
         mastery_tier = 0, review_face = 1, review_history = '[]', locked = 1, unlock_order = 0
       WHERE deck_id = ?`,
      fresh.due.toISOString(),
      fresh.due.toISOString(),
      fresh.stability,
      fresh.difficulty,
      fresh.elapsed_days,
      fresh.scheduled_days,
      fresh.learning_steps,
      0,
      0,
      fresh.state,
      deckId,
    );
  });
  return cards.length;
}

/**
 * Fast-forward scheduling: make the soonest-due future cards of a deck
 * due right now, until `count` more are due. Only the timing moves —
 * stability, difficulty, and history stay untouched, so reviews still
 * record normally. Returns how many cards were pulled forward.
 */
export async function pullDueForward(deckId: string, count: number): Promise<number> {
  if (count <= 0) return 0;
  const db = getDb();
  const now = nowIso();
  const rows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM cards WHERE deck_id = ? AND due > ? ORDER BY due ASC LIMIT ?',
    deckId,
    now,
    count,
  );
  if (rows.length === 0) return 0;
  const ids = rows.map((row) => row.id);
  await db.runAsync(
    `UPDATE cards SET due = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    now,
    ...ids,
  );
  return rows.length;
}

export type DistractorLapse = {
  deckId: string;
  entryId: string;
  source: 'quiz-distractor' | 'judge-distractor';
};

/**
 * Negative bonus on a miss (Again): FSRS alone re-schedules in ~10 min,
 * which lets a wrong card sit out the rest of the session. Clamp the due
 * date to ~1 min so the card is due again almost immediately, and haircut
 * stability so the *next* intervals stay short too. Applied to both the
 * tested card and the confused (distractor) word.
 */
export const MISS_DUE_DELAY_MS = 60_000;
export const MISS_STABILITY_FACTOR = 0.5;

export async function reviewCard(
  card: CardRow,
  history: FaceResponse[],
  opts?: { source?: ReviewSource; distractor?: DistractorLapse },
): Promise<CardRow> {
  const db = getDb();
  // Stamp the graded feature for history/stats. Old rows without a
  // source read as 'review'. Normal reviews use the streak ladder;
  // multiple-choice reviews use their separate mastery tiers.
  const stamped: FaceResponse[] = history.map((h) => ({
    ...h,
    source: h.source ?? opts?.source ?? 'review',
  }));
  const rating = mapFaceResponsesToRating(stamped);
  const now = new Date();

  // Resolve the confused word up front (reads only): on a miss the user
  // mixed up the target with the word a distractor gloss came from, so
  // both lapse. It is recorded inside the SAME transaction below —
  // expo-sqlite cannot run two transactions concurrently, and two
  // overlapping writes here used to roll each other back (wrong answers
  // never advanced while correct ones did).
  let other: CardRow | null = null;
  if (opts?.distractor) {
    const row = await db
      .getFirstAsync<any>('SELECT * FROM cards WHERE deck_id = ? AND entry_id = ? LIMIT 1', opts.distractor.deckId, opts.distractor.entryId)
      .catch(() => null);
    if (row && row.id !== card.id) other = mapCardRow(row) as CardRow;
  }

  // Newest-first stored history for the streak check (long limit so
  // high streaks are counted fully).
  const priorRows = await db.getAllAsync<any>(
    `SELECT rating, reviewed_at, faces FROM reviews WHERE card_id = ? ORDER BY reviewed_at DESC LIMIT 100`,
    card.id,
  ).catch(() => []);
  const priorReviews = priorRows.map((row) => ({
    rating: row.rating as number,
    reviewed_at: row.reviewed_at as string,
    faces: parseFaces(row.faces),
  }));

  const result = scheduleReview(card, rating, now);
  // Streak ladder: FSRS still accrues stability/difficulty (used for
  // leech ranking), but the due date comes from consecutive rights —
  // every straight success stretches it x3, one miss resets it.
  let dueDate = result.card.due;
  let scheduledDays = result.card.scheduled_days;
  let stability = result.card.stability;
  const quizReview = stamped.some((face) => face.source === 'quiz');
  const masteryTier = quizReview
    ? masteryTierAfterQuiz(card.mastery_tier, rating !== Rating.Again)
    : card.mastery_tier;
  const quizDue = quizReview
    ? new Date(
        now.getTime() +
          (rating === Rating.Again
            ? masteryTier <= MASTERY_FREE_REVIEW_TIER ? 0 : MISS_DUE_DELAY_MS
            : masteryIntervalMs(masteryTier)),
      ).toISOString()
    : card.quiz_due;
  if (rating === Rating.Again) {
    // Negative bonus: force the miss back into rotation. Due beats FSRS
    // (~10 min) down to ~1 min; stability is haircut so the following
    // Good/Easy intervals start from weaker memory too.
    const penaltyDue = new Date(now.getTime() + MISS_DUE_DELAY_MS);
    if (penaltyDue.getTime() < dueDate.getTime()) {
      dueDate = penaltyDue;
      scheduledDays = 0;
    }
    stability = Math.max(0.01, stability * MISS_STABILITY_FACTOR);
  } else {
    const streak = streakIncludingCurrent(priorReviews, rating);
    dueDate = new Date(now.getTime() + ladderDelayMs(streak));
    scheduledDays = ladderScheduledDays(streak);
  }
  const updated: CardRow = {
    ...card,
    due: dueDate.toISOString(),
    stability,
    difficulty: result.card.difficulty,
    elapsed_days: result.card.elapsed_days,
    scheduled_days: scheduledDays,
    learning_steps: result.card.learning_steps,
    reps: result.card.reps,
    lapses: result.card.lapses,
    state: result.card.state,
    mastery_tier: masteryTier,
    quiz_due: quizDue,
    last_review: toIso(result.card.last_review) ?? now.toISOString(),
    review_face: 1,
    review_history: [],
  };

  // Full Again lapse for the confused word (same ~1-min negative
  // bonus as a direct miss).
  const otherFaces: FaceResponse[] = other && opts?.distractor
    ? [{ face: 1, response: 'dont_know', source: opts.distractor.source }]
    : [];
  const otherResult = other ? scheduleReview(other, Rating.Again, now) : null;
  // Same negative bonus for the confused word: due ~1 min, weaker memory.
  const otherPenaltyDue = new Date(now.getTime() + MISS_DUE_DELAY_MS);
  const otherUpdated: CardRow | null =
    other && otherResult
      ? {
          ...other,
          mastery_tier:
            opts?.distractor?.source === 'quiz-distractor'
              ? masteryTierAfterQuiz(other.mastery_tier, false)
              : other.mastery_tier,
          quiz_due:
            opts?.distractor?.source === 'quiz-distractor'
              ? new Date(
                  now.getTime() +
                    (masteryTierAfterQuiz(other.mastery_tier, false) <= MASTERY_FREE_REVIEW_TIER
                      ? 0
                      : MISS_DUE_DELAY_MS),
                ).toISOString()
              : other.quiz_due,
          due:
            otherPenaltyDue.getTime() < otherResult.card.due.getTime()
              ? otherPenaltyDue.toISOString()
              : otherResult.card.due.toISOString(),
          stability: Math.max(0.01, otherResult.card.stability * MISS_STABILITY_FACTOR),
          difficulty: otherResult.card.difficulty,
          elapsed_days: otherResult.card.elapsed_days,
          scheduled_days:
            otherPenaltyDue.getTime() < otherResult.card.due.getTime()
              ? 0
              : otherResult.card.scheduled_days,
          learning_steps: otherResult.card.learning_steps,
          reps: otherResult.card.reps,
          lapses: otherResult.card.lapses,
          state: otherResult.card.state,
          last_review: toIso(otherResult.card.last_review) ?? now.toISOString(),
          review_face: 1,
          review_history: [],
        }
      : null;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cards SET
        due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
        learning_steps = ?, reps = ?, lapses = ?, state = ?, mastery_tier = ?, quiz_due = ?, last_review = ?,
        review_face = ?, review_history = ?
       WHERE id = ?`,
      updated.due,
      updated.stability,
      updated.difficulty,
      updated.elapsed_days,
      updated.scheduled_days,
      updated.learning_steps,
      updated.reps,
      updated.lapses,
      updated.state,
      updated.mastery_tier,
      updated.quiz_due,
      updated.last_review,
      updated.review_face,
      JSON.stringify(updated.review_history),
      updated.id,
    );

    await db.runAsync(
      `INSERT INTO reviews (
        id, card_id, rating, state, due, stability, difficulty,
        elapsed_days, scheduled_days, learning_steps, reviewed_at, faces
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      createId(),
      card.id,
      result.log.rating,
      result.log.state,
      updated.due,
      result.log.stability,
      result.log.difficulty,
      result.log.elapsed_days,
      scheduledDays,
      result.log.learning_steps,
      result.log.review.toISOString(),
      JSON.stringify(stamped),
    );

    if (other && otherUpdated && otherResult) {
      await db.runAsync(
        `UPDATE cards SET
          due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
          learning_steps = ?, reps = ?, lapses = ?, state = ?, mastery_tier = ?, quiz_due = ?, last_review = ?,
          review_face = ?, review_history = ?
         WHERE id = ?`,
        otherUpdated.due,
        otherUpdated.stability,
        otherUpdated.difficulty,
        otherUpdated.elapsed_days,
        otherUpdated.scheduled_days,
        otherUpdated.learning_steps,
        otherUpdated.reps,
        otherUpdated.lapses,
        otherUpdated.state,
        otherUpdated.mastery_tier,
        otherUpdated.quiz_due,
        otherUpdated.last_review,
        otherUpdated.review_face,
        JSON.stringify(otherUpdated.review_history),
        otherUpdated.id,
      );

      await db.runAsync(
        `INSERT INTO reviews (
          id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reviewed_at, faces
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        other.id,
        otherResult.log.rating,
        otherResult.log.state,
        otherUpdated.due,
        otherResult.log.stability,
        otherResult.log.difficulty,
        otherResult.log.elapsed_days,
        otherResult.log.scheduled_days,
        otherResult.log.learning_steps,
        otherResult.log.review.toISOString(),
        JSON.stringify(otherFaces),
      );
    }
  });

  // When a card graduates out of the studying stage, unlock the next card(s)
  // to keep the user's studying limit filled.
  const justGraduated =
    card.mastery_tier < MASTERY_GRADUATION_TIER &&
    masteryTier >= MASTERY_GRADUATION_TIER;
  if (justGraduated) {
    await unlockNextCards(card.deck_id);
  }

  return updated;
}

/** Find the card for an entry in a deck (one card per entry per deck). */
export async function getCardForEntry(deckId: string, entryId: string): Promise<CardRow | null> {
  const row = await getDb().getFirstAsync<any>(
    'SELECT * FROM cards WHERE deck_id = ? AND entry_id = ? LIMIT 1',
    deckId,
    entryId,
  );
  return row ? (mapCardRow(row) as CardRow) : null;
}

/**
 * One-time repair for the old mastery-cap era: any card due later than
 * its streak ladder allows is pulled back to the ladder due date.
 * A miss (streak 0) clamps to the ~1-min negative bonus. Returns the
 * repaired count.
 */
export async function repairInflatedIntervals(): Promise<number> {
  const db = getDb();
  const now = new Date();
  let candidates: any[] = [];
  try {
    candidates = await db.getAllAsync<any>('SELECT * FROM cards WHERE due > ?', now.toISOString());
  } catch {
    return 0;
  }
  let repaired = 0;
  for (const raw of candidates) {
    const card = mapCardRow(raw) as CardRow;
    let priorRows: any[] = [];
    try {
      priorRows = await db.getAllAsync<any>(
        'SELECT rating FROM reviews WHERE card_id = ? ORDER BY reviewed_at DESC LIMIT 100',
        card.id,
      );
    } catch {
      continue;
    }
    if (priorRows.length === 0) continue;
    let streak = 0;
    for (const row of priorRows) {
      if (row.rating === Rating.Again) break;
      streak += 1;
    }
    const capDue =
      streak === 0
        ? new Date(now.getTime() + MISS_DUE_DELAY_MS)
        : new Date(now.getTime() + ladderDelayMs(streak));
    const capDays = streak === 0 ? 0 : ladderScheduledDays(streak);
    if (new Date(card.due).getTime() <= capDue.getTime()) continue;
    try {
      await db.runAsync('UPDATE cards SET due = ?, scheduled_days = ? WHERE id = ?', capDue.toISOString(), capDays, card.id);
      repaired += 1;
    } catch {
      // Leave this card alone; the ladder still applies going forward.
    }
  }
  return repaired;
}

export async function addExample(input: {
  entryId: string;
  text: string;
  translation: string;
  hint?: string;
  source: Example['source'];
}): Promise<Example> {
  const example: Example = {
    id: createId(),
    entry_id: input.entryId,
    text: input.text.trim(),
    translation: input.translation.trim(),
    hint: input.hint?.trim() ?? '',
    source: input.source,
    created_at: nowIso(),
  };
  await getDb().runAsync(
    `INSERT INTO examples (id, entry_id, text, translation, hint, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    example.id,
    example.entry_id,
    example.text,
    example.translation,
    example.hint,
    example.source,
    example.created_at,
  );
  return example;
}

export async function listKnownWords(): Promise<{ entry_id: string; lemma: string; gloss: string }[]> {
  // A word counts as known once the user answered "Know" on face 1 for it,
  // which is the only path that records an Easy rating (see
  // mapFaceResponsesToRating).
  return getDb().getAllAsync<{ entry_id: string; lemma: string; gloss: string }>(
    `SELECT DISTINCT e.id AS entry_id, e.lemma AS lemma, e.gloss AS gloss
     FROM reviews r
     JOIN cards c ON c.id = r.card_id
     JOIN entries e ON e.id = c.entry_id
     WHERE r.rating = ?`,
    Rating.Easy,
  );
}

export async function listKnownLemmas(limit = 80): Promise<string[]> {
  const rows = await getDb().getAllAsync<{ lemma: string }>(
    'SELECT lemma FROM entries ORDER BY created_at DESC LIMIT ?',
    limit,
  );
  return rows.map((row) => row.lemma);
}

export type EntryReview = {
  id: string;
  card_id: string;
  rating: number;
  reviewed_at: string;
  faces: FaceResponse[];
};

export async function listReviewsForEntry(entryId: string, limit = 20): Promise<EntryReview[]> {
  const rows = await getDb().getAllAsync<any>(
    `SELECT r.id, r.card_id, r.rating, r.reviewed_at, r.faces
     FROM reviews r
     JOIN cards c ON c.id = r.card_id
     WHERE c.entry_id = ?
     ORDER BY r.reviewed_at DESC
     LIMIT ?`,
    entryId,
    limit,
  );
  return rows.map((row) => ({ ...row, faces: parseFaces(row.faces) }));
}

export type DeckStats = {
  totalReviews: number;
  distinctCards: number;
  masteryTiers: number[];
  /** Summed face durations (ms). Only reviews recorded with timings count. */
  studyMs: number;
  timedReviews: number;
  face1Know: number;
  face1Seen: number;
  face2Know: number;
  face2Seen: number;
  face3NoIdea: number;
  face3VagueIdea: number;
  face3KnewConfirm: number;
};

export async function getDeckStats(deckId: string): Promise<DeckStats> {
  const db = getDb();
  const [rows, cards] = await Promise.all([
    db.getAllAsync<{ card_id: string; faces: unknown }>(
      `SELECT r.card_id, r.faces
       FROM reviews r
       JOIN cards c ON c.id = r.card_id
       WHERE c.deck_id = ?`,
      deckId,
    ),
    db.getAllAsync<{ entry_id: string; mastery_tier: number }>(
      'SELECT entry_id, mastery_tier FROM cards WHERE deck_id = ?',
      deckId,
    ),
  ]);
  const stats: DeckStats = {
    totalReviews: rows.length,
    distinctCards: 0,
    masteryTiers: Array.from({ length: 11 }, () => 0),
    studyMs: 0,
    timedReviews: 0,
    face1Know: 0,
    face1Seen: 0,
    face2Know: 0,
    face2Seen: 0,
    face3NoIdea: 0,
    face3VagueIdea: 0,
    face3KnewConfirm: 0,
  };

  const wordTiers = new Map<string, number>();
  for (const card of cards) {
    const tier = Math.max(0, Math.min(10, Math.trunc(card.mastery_tier ?? 0)));
    wordTiers.set(card.entry_id, Math.max(tier, wordTiers.get(card.entry_id) ?? 0));
  }
  for (const tier of wordTiers.values()) {
    stats.masteryTiers[tier] += 1;
  }

  const seenCards = new Set<string>();
  for (const row of rows) {
    seenCards.add(row.card_id);
    const faces = parseFaces(row.faces);
    if (faces.some((f) => f.duration_ms != null)) stats.timedReviews += 1;
    for (const f of faces) {
      if (f.duration_ms != null) stats.studyMs += f.duration_ms;
      if (f.face === 1) {
        stats.face1Seen += 1;
        if (f.response === 'know') stats.face1Know += 1;
      } else if (f.face === 2) {
        stats.face2Seen += 1;
        if (f.response === 'know') stats.face2Know += 1;
      } else if (f.face === 3) {
        if (f.response === 'no_idea') stats.face3NoIdea += 1;
        else if (f.response === 'vague_idea') stats.face3VagueIdea += 1;
        else if (f.response === 'knew_confirm') stats.face3KnewConfirm += 1;
      }
    }
  }
  stats.distinctCards = seenCards.size;
  return stats;
}

export async function deckNameExists(name: string): Promise<boolean> {
  const normalized = name.trim();
  if (!normalized) return false;
  const row = await getDb().getFirstAsync<{ id: string }>(
    'SELECT id FROM decks WHERE name = ? COLLATE NOCASE',
    normalized,
  );
  return !!row;
}

// ---------------------------------------------------------------------------
// Reader books + tapped unknown words.
// ---------------------------------------------------------------------------

export type BookSummary = Book & { unknown_count: number };
export type BookUnknownForm = { book_id: string; normalized: string };

export async function createBook(title: string, body: string): Promise<Book> {
  const createdAt = nowIso();
  const book: Book = { id: createId(), title: title.trim(), body, created_at: createdAt };
  await getDb().runAsync(
    'INSERT INTO books (id, title, body, created_at) VALUES (?, ?, ?, ?)',
    book.id,
    book.title,
    book.body,
    book.created_at,
  );
  return book;
}

export async function listBooks(): Promise<BookSummary[]> {
  return getDb().getAllAsync<BookSummary>(
    `SELECT b.*,
            (SELECT COUNT(*) FROM unknown_words u WHERE u.book_id = b.id) AS unknown_count
      FROM books b
      ORDER BY b.created_at ASC`,
  );
}

export async function listBookUnknownForms(): Promise<BookUnknownForm[]> {
  return getDb().getAllAsync<BookUnknownForm>(
    'SELECT book_id, normalized FROM unknown_words',
  );
}

export async function getBook(id: string): Promise<Book | null> {
  return getDb().getFirstAsync<Book>('SELECT * FROM books WHERE id = ?', id);
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM unknown_words WHERE book_id = ?', bookId);
    await db.runAsync('DELETE FROM books WHERE id = ?', bookId);
  });
}

/**
 * Toggle an unknown-word mark for one normalized form in a book.
 * Returns true when the word is now marked, false when it was unmarked.
 */
export async function toggleUnknownWord(input: {
  bookId: string;
  surface: string;
  normalized: string;
  lemmaGuess?: string;
  context?: string;
}): Promise<boolean> {
  const db = getDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM unknown_words WHERE book_id = ? AND normalized = ? LIMIT 1',
    input.bookId,
    input.normalized,
  );
  if (existing) {
    await db.runAsync('DELETE FROM unknown_words WHERE id = ?', existing.id);
    return false;
  }
  let lemmaGuess = input.lemmaGuess?.trim() ?? '';
  if (!lemmaGuess) {
    // Best effort: an inflection we already know maps the form to a lemma.
    const rows = await lookupForm(input.normalized).catch(() => []);
    lemmaGuess = rows[0]?.lemma ?? '';
  }
  await db.runAsync(
    `INSERT INTO unknown_words (id, book_id, surface, normalized, lemma_guess, context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    createId(),
    input.bookId,
    input.surface,
    input.normalized,
    lemmaGuess,
    (input.context ?? '').trim(),
    nowIso(),
  );
  return true;
}

export async function listUnknownWords(bookId: string): Promise<UnknownWord[]> {
  return getDb().getAllAsync<UnknownWord>(
    'SELECT * FROM unknown_words WHERE book_id = ? ORDER BY created_at ASC',
    bookId,
  );
}

export async function removeUnknownWord(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM unknown_words WHERE id = ?', id);
}

export async function clearUnknownWords(bookId: string): Promise<void> {
  await getDb().runAsync('DELETE FROM unknown_words WHERE book_id = ?', bookId);
}

// ---------------------------------------------------------------------------
// User dictionary (imported word -> translation pairs used by the reader).
// ---------------------------------------------------------------------------

export type UserDictionaryEntry = {
  id: string;
  lemma: string;
  gloss: string;
  created_at: string;
};

export async function upsertUserDictionaryEntry(input: {
  lemma: string;
  gloss: string;
}): Promise<UserDictionaryEntry> {
  const db = getDb();
  const lemma = normalizeRussian(input.lemma.trim());
  const gloss = input.gloss.trim();
  if (!lemma || !gloss) {
    throw new Error('Word and meaning are required.');
  }
  const now = nowIso();
  const entry: UserDictionaryEntry = {
    id: createId(),
    lemma,
    gloss,
    created_at: now,
  };
  await db.runAsync(
    `INSERT INTO user_dictionary (id, lemma, gloss, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(lemma) DO UPDATE SET gloss = excluded.gloss, created_at = user_dictionary.created_at`,
    entry.id,
    entry.lemma,
    entry.gloss,
    entry.created_at,
  );
  return entry;
}

export async function listUserDictionary(): Promise<UserDictionaryEntry[]> {
  return getDb().getAllAsync<UserDictionaryEntry>(
    'SELECT * FROM user_dictionary ORDER BY lemma COLLATE NOCASE',
  );
}

export async function removeUserDictionaryEntry(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM user_dictionary WHERE id = ?', id);
}

export async function clearUserDictionary(): Promise<void> {
  await getDb().runAsync('DELETE FROM user_dictionary');
}

export type KnownForm = {
  form: string;
  lemma: string;
  gloss: string;
  entry_id: string;
  deck_name: string;
  mastery_tier: number;
};

/**
 * Word forms belonging to cards in any deck, for book lookup and progress.
 * When `minMasteryTier` is given, only forms whose highest card mastery
 * tier meets or exceed it are returned — this is what the book reader uses
 * to decide whether to show a translation (e.g. tier 4+).
 */
export async function listBookWordForms(
  minMasteryTier?: number,
): Promise<KnownForm[]> {
  const db = getDb();
  const tierFilter = minMasteryTier != null
    ? `HAVING MAX(c.mastery_tier) >= ?`
    : '';
  const tierParams = minMasteryTier != null ? [minMasteryTier] : [];

  const rows = await db.getAllAsync<any>(
    `SELECT i.form AS form, e.id AS entry_id, e.lemma AS lemma, e.gloss AS gloss,
            d.name AS deck_name, MAX(c.mastery_tier) AS mastery_tier
      FROM inflections i
      JOIN entries e ON e.id = i.entry_id
      JOIN cards c ON c.entry_id = e.id
      JOIN decks d ON d.id = c.deck_id
      GROUP BY i.form, e.id, e.lemma, e.gloss, d.name
      ${tierFilter}`,
    ...tierParams,
  );
  const out: KnownForm[] = rows.map((row) => ({
    form: row.form,
    lemma: row.lemma,
    gloss: row.gloss,
    entry_id: row.entry_id,
    deck_name: row.deck_name,
    mastery_tier: Number(row.mastery_tier ?? 0),
  }));
  // Include dictionary lemmas even when no inflection row spells them exactly.
  const seen = new Set(out.map((r) => r.form));
  const lemmas = await db.getAllAsync<any>(
    `SELECT e.id AS entry_id, e.lemma AS lemma, e.gloss AS gloss,
            d.name AS deck_name, MAX(c.mastery_tier) AS mastery_tier
      FROM entries e
      JOIN cards c ON c.entry_id = e.id
      JOIN decks d ON d.id = c.deck_id
      GROUP BY e.id, e.lemma, e.gloss, d.name
      ${tierFilter}`,
    ...tierParams,
  );
  for (const row of lemmas) {
    const form = normalizeRussian(stripAccents(String(row.lemma)));
    if (!form || seen.has(form)) continue;
    seen.add(form);
    out.push({
      form,
      lemma: String(row.lemma),
      gloss: String(row.gloss),
      entry_id: String(row.entry_id),
      deck_name: String(row.deck_name),
      mastery_tier: Number(row.mastery_tier ?? 0),
    });
  }
  return out;
}

/**
 * Merge-import: bring a backup file's content into a NEW deck without
 * touching existing decks. All ids are regenerated (no collisions) and
 * foreign keys are rewritten; review history is preserved so stats and
 * known-word detection keep working. If the file holds several decks,
 * their cards are combined into the one new deck.
 */
export async function importDeckPayload(
  payload: BackupPayload,
  deckName: string,
): Promise<{ deck: Deck; entries: number; cards: number }> {
  const name = deckName.trim();
  if (!name) {
    throw new Error('Name the new deck first.');
  }
  if (await deckNameExists(name)) {
    throw new Error(`A deck named "${name}" already exists.`);
  }

  const db = getDb();
  const now = nowIso();
  const studyingLimit = await getStudyingLimit();
  const deck: Deck = {
    id: createId(),
    name,
    description: payload.decks[0]?.description ?? '',
    pos_category: (payload.decks[0] as any)?.pos_category ?? null,
    studying_limit: studyingLimit,
    created_at: now,
    updated_at: now,
  };

  const entryIds = new Map<string, string>();
  const entryLemmas = new Map<string, string>();
  const nextEntryId = (oldId: string): string => {
    let next = entryIds.get(oldId);
    if (!next) {
      next = createId();
      entryIds.set(oldId, next);
    }
    return next;
  };
  const cardIds = new Map<string, string>();
  const sourceDeckIds = new Set(payload.decks.map((d) => d.id));

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO decks (id, name, description, pos_category, studying_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      deck.id,
      deck.name,
      deck.description,
      (payload.decks[0] as any)?.pos_category ?? null,
      deck.studying_limit,
      deck.created_at,
      deck.updated_at,
    );

    for (const entry of payload.entries) {
      // Strip stress accents ("она́" -> "она") so words match lookups and
      // don't duplicate unaccented entries. Display sentences keep theirs.
      const lemma = stripAccents(entry.lemma);
      const newEntryId = nextEntryId(entry.id);
      entryLemmas.set(entry.id, lemma);
      await db.runAsync(
        `INSERT INTO entries (id, lemma, language, pos, gloss, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newEntryId,
        lemma,
        entry.language ?? 'ru',
        entry.pos ?? '',
        entry.gloss,
        entry.notes ?? '',
        entry.created_at ?? now,
      );
    }

    for (const inflection of payload.inflections) {
      const entryId = entryIds.get(inflection.entry_id);
      if (!entryId) continue;
      const rawTags = (inflection as any).tags;
      const tags = Array.isArray(rawTags) ? rawTags.join(' ') : (rawTags ?? '');
      await db.runAsync(
        `INSERT INTO inflections (id, entry_id, form, tags) VALUES (?, ?, ?, ?)`,
        createId(),
        entryId,
        stripAccents(inflection.form),
        tags,
      );
    }

    for (const card of payload.cards) {
      if (!sourceDeckIds.has(card.deck_id)) continue;
      const entryId = entryIds.get(card.entry_id);
      if (!entryId) continue;
      const newCardId = createId();
      cardIds.set(card.id, newCardId);
      const importUnlockOrder = (card as any).unlock_order ?? cardIds.size;
      await db.runAsync(
        `INSERT INTO cards (
          id, deck_id, entry_id, card_type, front, back,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, mastery_tier, quiz_due, last_review, review_face, review_history, locked, unlock_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newCardId,
        deck.id,
        entryId,
        card.card_type ?? 'recognition',
        entryLemmas.get(card.entry_id) ?? stripAccents(card.front),
        card.back,
        card.due ?? now,
        card.stability ?? 0,
        card.difficulty ?? 0,
        card.elapsed_days ?? 0,
        card.scheduled_days ?? 0,
        card.learning_steps ?? 0,
        card.reps ?? 0,
        card.lapses ?? 0,
        card.state ?? 0,
        card.mastery_tier ?? 0,
        card.quiz_due || card.due || now,
        card.last_review ?? null,
        1,
        '[]',
        1,
        importUnlockOrder,
        card.created_at ?? now,
      );
    }

    for (const example of payload.examples) {
      const entryId = entryIds.get(example.entry_id);
      if (!entryId) continue;
      await db.runAsync(
        `INSERT INTO examples (id, entry_id, text, translation, hint, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        entryId,
        example.text,
        example.translation ?? '',
        (example as any).hint ?? '',
        example.source ?? 'user',
        example.created_at ?? now,
      );
    }

    for (const review of payload.reviews) {
      const cardId = cardIds.get(review.card_id);
      if (!cardId) continue;
      await db.runAsync(
        `INSERT INTO reviews (
          id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reviewed_at, faces
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        cardId,
        review.rating,
        review.state,
        review.due,
        review.stability,
        review.difficulty,
        review.elapsed_days,
        review.scheduled_days,
        review.learning_steps,
        review.reviewed_at,
        facesToJson((review as any).faces),
      );
    }
  });

  // Cards start locked on import. Unlock the initial studying batch for the new deck.
  await unlockNextCards(deck.id);

  return { deck, entries: entryIds.size, cards: cardIds.size };
}

/**
 * Merge-import: bring a backup file's cards into an EXISTING deck.
 * Words already in the target deck (same lemma) are skipped so the same
 * word never gets two cards. All ids are regenerated, foreign keys are
 * rewritten, and review history is preserved so stats keep working.
 * Existing decks and cards are never deleted or overwritten.
 */
export async function importDeckIntoDeck(
  payload: BackupPayload,
  targetDeckId: string,
): Promise<{ deck: Deck; entries: number; cards: number; skipped: number }> {
  const db = getDb();
  const deck = await db.getFirstAsync<Deck>('SELECT * FROM decks WHERE id = ?', targetDeckId);
  if (!deck) {
    throw new Error('Target deck not found.');
  }

  const now = nowIso();

  // Lemmas already in the target deck — skip them to avoid duplicate cards.
  const existing = new Map<string, string>(); // normalized lemma -> entry_id
  const rows = await db.getAllAsync<{ id: string; lemma: string }>(
    `SELECT e.id, e.lemma
     FROM entries e
     JOIN cards c ON c.entry_id = e.id
     WHERE c.deck_id = ?`,
    targetDeckId,
  );
  for (const row of rows) {
    const key = normalizeRussian(stripAccents(row.lemma)).toLocaleLowerCase('ru-RU');
    if (key && !existing.has(key)) existing.set(key, row.id);
  }

  const entryIds = new Map<string, string>(); // old id -> target entry id
  const entryLemmas = new Map<string, string>(); // old id -> stored lemma
  const cardIds = new Map<string, string>(); // old id -> new card id

  let entriesImported = 0;
  let cardsImported = 0;
  let skipped = 0;

  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, targetDeckId);

    for (const entry of payload.entries) {
      const lemma = stripAccents(entry.lemma);
      const key = normalizeRussian(lemma).toLocaleLowerCase('ru-RU');
      const existingId = existing.get(key);
      let newEntryId: string;
      if (existingId) {
        newEntryId = existingId;
      } else {
        newEntryId = createId();
        await db.runAsync(
          `INSERT INTO entries (id, lemma, language, pos, gloss, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          newEntryId,
          lemma,
          entry.language ?? 'ru',
          entry.pos ?? '',
          entry.gloss,
          entry.notes ?? '',
          entry.created_at ?? now,
        );
        const forms = new Set([normalizeRussian(lemma)]);
        for (const form of forms) {
          if (!form) continue;
          await db.runAsync(
            `INSERT INTO inflections (id, entry_id, form, tags) VALUES (?, ?, ?, ?)`,
            createId(),
            newEntryId,
            form,
            'lemma',
          );
        }
        entriesImported += 1;
        existing.set(key, newEntryId);
      }
      entryIds.set(entry.id, newEntryId);
      entryLemmas.set(entry.id, lemma);
    }

    for (const card of payload.cards) {
      const entryId = entryIds.get(card.entry_id);
      if (!entryId) continue;

      // Don't create a second card for a word already in this deck.
      const haveCard = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM cards WHERE deck_id = ? AND entry_id = ? LIMIT 1',
        targetDeckId,
        entryId,
      );
      if (haveCard) {
        skipped += 1;
        continue;
      }

      const fsrs = emptyFsrsCard(new Date(now));
      const maxOrderRow = await db.getFirstAsync<{ max_order: number }>(
        'SELECT COALESCE(MAX(unlock_order), 0) AS max_order FROM cards WHERE deck_id = ?',
        targetDeckId,
      );
      const unlockOrder = Number(maxOrderRow?.max_order ?? 0) + 1;
      const newCardId = createId();
      cardIds.set(card.id, newCardId);

      await db.runAsync(
        `INSERT INTO cards (
          id, deck_id, entry_id, card_type, front, back,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, mastery_tier, quiz_due, last_review, review_face, review_history, locked, unlock_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newCardId,
        targetDeckId,
        entryId,
        card.card_type ?? 'recognition',
        entryLemmas.get(card.entry_id) ?? stripAccents(card.front),
        card.back,
        card.due ?? now,
        fsrs.stability,
        fsrs.difficulty,
        fsrs.elapsed_days,
        fsrs.scheduled_days,
        fsrs.learning_steps,
        fsrs.reps,
        fsrs.lapses,
        fsrs.state,
        card.mastery_tier ?? 0,
        card.quiz_due || card.due || now,
        card.last_review ?? null,
        1,
        '[]',
        1,
        unlockOrder,
        card.created_at ?? now,
      );

      cardsImported += 1;
    }

    for (const example of payload.examples) {
      const entryId = entryIds.get(example.entry_id);
      if (!entryId) continue;
      await db.runAsync(
        `INSERT INTO examples (id, entry_id, text, translation, hint, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        entryId,
        example.text,
        example.translation ?? '',
        (example as any).hint ?? '',
        example.source ?? 'user',
        example.created_at ?? now,
      );
    }

    for (const review of payload.reviews) {
      const cardId = cardIds.get(review.card_id);
      if (!cardId) continue;
      await db.runAsync(
        `INSERT INTO reviews (
          id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reviewed_at, faces
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        cardId,
        review.rating,
        review.state,
        review.due,
        review.stability,
        review.difficulty,
        review.elapsed_days,
        review.scheduled_days,
        review.learning_steps,
        review.reviewed_at,
        facesToJson((review as any).faces),
      );
    }
  });

  // Cards start locked on import. Unlock the initial studying batch for the deck.
  await unlockNextCards(targetDeckId);

  return { deck, entries: entriesImported, cards: cardsImported, skipped };
}

export async function dumpBackup(): Promise<BackupPayload> {
  const db = getDb();
  const [decks, entries, inflections, cards, reviewRows, examples] = await Promise.all([
    db.getAllAsync<Deck>('SELECT * FROM decks'),
    db.getAllAsync<Entry>('SELECT * FROM entries'),
    db.getAllAsync<Inflection>('SELECT * FROM inflections'),
    db.getAllAsync<CardRow>('SELECT * FROM cards'),
    db.getAllAsync<any>('SELECT * FROM reviews'),
    db.getAllAsync<Example>('SELECT * FROM examples'),
  ]);
  // Store faces as arrays in the JSON (they are TEXT in SQLite).
  // Old backups predate the column: default to [].
  const reviews: ReviewRow[] = reviewRows.map((row) => ({
    ...row,
    faces: parseFaces(row.faces),
  }));

  return {
    version: 1,
    exportedAt: nowIso(),
    decks,
    entries,
    inflections,
    cards,
    reviews,
    examples,
  };
}

/**
 * Single-deck export: same v1 shape as a full backup but scoped to one
 * deck — its cards, their entries (shared entries are included, and on
 * re-import become deck-local copies), plus related inflections,
 * examples, and review history. Re-imports through the normal
 * Settings → Import path.
 */
export async function dumpDeckBackup(deckId: string): Promise<BackupPayload> {
  const db = getDb();
  const deck = await db.getFirstAsync<Deck>('SELECT * FROM decks WHERE id = ?', deckId);
  if (!deck) throw new Error('Deck not found.');
  const cards = await db.getAllAsync<CardRow>('SELECT * FROM cards WHERE deck_id = ?', deckId);
  const entryIds = [...new Set(cards.map((c) => c.entry_id))];
  const cardIds = cards.map((c) => c.id);
  const placeholders = (values: string[]): string => values.map(() => '?').join(',');
  const [entries, inflections, examples, reviewRows] = await Promise.all([
    entryIds.length
      ? db.getAllAsync<Entry>(
          `SELECT * FROM entries WHERE id IN (${placeholders(entryIds)})`,
          ...entryIds,
        )
      : Promise.resolve([] as Entry[]),
    entryIds.length
      ? db.getAllAsync<Inflection>(
          `SELECT * FROM inflections WHERE entry_id IN (${placeholders(entryIds)})`,
          ...entryIds,
        )
      : Promise.resolve([] as Inflection[]),
    entryIds.length
      ? db.getAllAsync<Example>(
          `SELECT * FROM examples WHERE entry_id IN (${placeholders(entryIds)})`,
          ...entryIds,
        )
      : Promise.resolve([] as Example[]),
    cardIds.length
      ? db.getAllAsync<any>(
          `SELECT * FROM reviews WHERE card_id IN (${placeholders(cardIds)})`,
          ...cardIds,
        )
      : Promise.resolve([] as any[]),
  ]);
  const reviews: ReviewRow[] = reviewRows.map((row) => ({
    ...row,
    faces: parseFaces(row.faces),
  }));
  return {
    version: 1,
    exportedAt: nowIso(),
    decks: [deck],
    entries,
    inflections,
    cards,
    reviews,
    examples,
  };
}

export async function restoreBackup(payload: BackupPayload): Promise<void> {
  if (payload.version !== 1) {
    throw new Error(`Unsupported backup version: ${String(payload.version)}`);
  }

  const db = getDb();
  const studyingLimit = await getStudyingLimit();
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM reviews;
      DELETE FROM examples;
      DELETE FROM cards;
      DELETE FROM inflections;
      DELETE FROM entries;
      DELETE FROM decks;
    `);

    for (const deck of payload.decks) {
      await db.runAsync(
        `INSERT INTO decks (id, name, description, pos_category, studying_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        deck.id,
        deck.name,
        deck.description,
        (deck as any).pos_category ?? null,
        studyingLimit,
        deck.created_at,
        deck.updated_at,
      );
    }
    for (const entry of payload.entries) {
      await db.runAsync(
        `INSERT INTO entries (id, lemma, language, pos, gloss, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        entry.id,
        entry.lemma,
        entry.language,
        entry.pos,
        entry.gloss,
        entry.notes,
        entry.created_at,
      );
    }
    for (const inflection of payload.inflections) {
      // Be tolerant of AI-generated files: tags is a TEXT column, but
      // generators sometimes emit an array like ["lemma"], which SQLite
      // cannot bind and fails the whole import.
      const rawTags = (inflection as any).tags;
      const tags = Array.isArray(rawTags) ? rawTags.join(' ') : (rawTags ?? '');
      await db.runAsync(
        `INSERT INTO inflections (id, entry_id, form, tags) VALUES (?, ?, ?, ?)`,
        inflection.id,
        inflection.entry_id,
        inflection.form,
        tags,
      );
    }
    for (const card of payload.cards) {
      const reviewFace = (card as any).review_face ?? 1;
      const reviewHistory = (card as any).review_history ?? [];
      await db.runAsync(
        `INSERT INTO cards (
          id, deck_id, entry_id, card_type, front, back,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, mastery_tier, quiz_due, last_review, review_face, review_history, locked, unlock_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        card.id,
        card.deck_id,
        card.entry_id,
        card.card_type,
        card.front,
        card.back,
        card.due,
        card.stability,
        card.difficulty,
        card.elapsed_days,
        card.scheduled_days,
        card.learning_steps,
        card.reps,
        card.lapses,
        card.state,
        card.mastery_tier ?? 0,
        card.quiz_due ?? card.due,
        card.last_review,
        reviewFace,
        JSON.stringify(reviewHistory),
        (card as any).locked ?? 1,
        (card as any).unlock_order ?? 0,
        card.created_at,
      );
    }
    for (const review of payload.reviews) {
      await db.runAsync(
        `INSERT INTO reviews (
          id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reviewed_at, faces
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        review.id,
        review.card_id,
        review.rating,
        review.state,
        review.due,
        review.stability,
        review.difficulty,
        review.elapsed_days,
        review.scheduled_days,
        review.learning_steps,
        review.reviewed_at,
        facesToJson((review as any).faces),
      );
    }
    for (const example of payload.examples) {
      await db.runAsync(
        `INSERT INTO examples (id, entry_id, text, translation, hint, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        example.id,
        example.entry_id,
        example.text,
        example.translation,
        (example as any).hint ?? '',
        example.source,
        example.created_at,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Leech / weak-spot detection, daily goal + activity, case-trainer data.
// ---------------------------------------------------------------------------

export type LeechCard = {
  card_id: string;
  deck_id: string;
  deck_name: string;
  entry_id: string;
  lemma: string;
  gloss: string;
  front: string;
  back: string;
  due: string;
  lapses: number;
  reps: number;
  difficulty: number;
  last_review: string | null;
  review_count: number;
  fail_count: number;
  /** 0..1 share of non-Again reviews (1 when never reviewed). */
  accuracy: number;
};

/**
 * "10 worst words": cards with the most lapses / Again reviews first.
 * Only cards with some evidence of struggle are returned (lapses > 0,
 * an Again, or accuracy < 70% over 2+ reviews). Small decks: cheap query.
 */
export async function listLeechCards(deckId?: string, limit = 10): Promise<LeechCard[]> {
  const db = getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT c.id AS card_id, c.deck_id, c.entry_id, c.front, c.back, c.due,
            c.lapses, c.reps, c.difficulty, c.last_review,
            e.lemma AS lemma, e.gloss AS gloss, d.name AS deck_name,
            (SELECT COUNT(*) FROM reviews r WHERE r.card_id = c.id) AS review_count,
            (SELECT COUNT(*) FROM reviews r WHERE r.card_id = c.id AND r.rating = ?) AS fail_count
     FROM cards c
     JOIN entries e ON e.id = c.entry_id
     JOIN decks d ON d.id = c.deck_id
     ${deckId ? 'WHERE c.deck_id = ?' : ''}
     ORDER BY c.lapses DESC, fail_count DESC, c.difficulty DESC
     LIMIT 60`,
    ...(deckId ? [Rating.Again, deckId] : [Rating.Again]),
  );
  const leeches: LeechCard[] = rows.map((row) => {
    const reviewCount = Number(row.review_count ?? 0);
    const failCount = Number(row.fail_count ?? 0);
    return {
      card_id: String(row.card_id),
      deck_id: String(row.deck_id),
      deck_name: String(row.deck_name ?? ''),
      entry_id: String(row.entry_id),
      lemma: String(row.lemma ?? row.front ?? ''),
      gloss: String(row.gloss ?? row.back ?? ''),
      front: String(row.front ?? ''),
      back: String(row.back ?? ''),
      due: String(row.due ?? ''),
      lapses: Number(row.lapses ?? 0),
      reps: Number(row.reps ?? 0),
      difficulty: Number(row.difficulty ?? 0),
      last_review: (row.last_review as string | null) ?? null,
      review_count: reviewCount,
      fail_count: failCount,
      accuracy: reviewCount > 0 ? (reviewCount - failCount) / reviewCount : 1,
    };
  });
  const struggling = leeches.filter(
    (c) => c.lapses > 0 || c.fail_count > 0 || (c.review_count >= 2 && c.accuracy < 0.7),
  );
  return struggling.slice(0, limit);
}

/** MakeCards due now so the user can re-drill them immediately. */
export async function makeCardsDueNow(cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0;
  const db = getDb();
  const now = nowIso();
  await db.runAsync(
    `UPDATE cards SET due = ? WHERE id IN (${cardIds.map(() => '?').join(',')})`,
    now,
    ...cardIds,
  );
  return cardIds.length;
}

export type DailyCount = { day: string; count: number };

function dayIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Review counts per day for the last `days` days (inclusive, zero-filled,
 * oldest-first). `reviewed_at` is ISO, so substr(...,1,10) is YYYY-MM-DD.
 */
export async function getReviewActivity(days = 14): Promise<DailyCount[]> {
  const db = getDb();
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (safeDays - 1));
  const cutoffDay = dayIso(cutoff);
  let rows: { day: string; count: number }[] = [];
  try {
    rows = await db.getAllAsync<{ day: string; count: number }>(
      `SELECT substr(reviewed_at, 1, 10) AS day, COUNT(*) AS count
       FROM reviews
       WHERE substr(reviewed_at, 1, 10) >= ?
       GROUP BY day
       ORDER BY day ASC`,
      cutoffDay,
    );
  } catch {
    rows = [];
  }
  const byDay = new Map(rows.map((r) => [r.day, Number(r.count)]));
  const out: DailyCount[] = [];
  for (let i = safeDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = dayIso(d);
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

/**
 * Total cards that have "graduated" — reached mastery tier 4+ (the
 * studying limit no longer applies to them). These are the words the
 * user has effectively learned.
 */
export async function countLearnedWords(): Promise<number> {
  const row = await getDb().getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cards WHERE mastery_tier >= ?',
    MASTERY_GRADUATION_TIER,
  );
  return row?.count ?? 0;
}

/**
 * Cards that reached mastery tier 4+ and had a review within the last 7
 * days — a practical proxy for "newly learned this week".
 */
export async function countLearnedThisWeek(): Promise<number> {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM cards
     WHERE mastery_tier >= ? AND last_review >= ?`,
    MASTERY_GRADUATION_TIER,
    cutoff.toISOString(),
  );
  return row?.count ?? 0;
}

export type Tier4Retention = {
  totalReviews: number;
  nonMissedReviews: number;
  /** Share of reviews on tier 4+ cards that were not misses (Again). */
  ratio: number;
};

/**
 * Of all reviews on cards that are currently tier 4+, how many were not
 * misses? 1.0 (100%) is perfect retention — every review on a learned
 * word was successful.
 */
export async function getTier4Retention(): Promise<Tier4Retention> {
  const rows = await getDb().getAllAsync<any>(
    `SELECT r.rating
     FROM reviews r
     JOIN cards c ON c.id = r.card_id
     WHERE c.mastery_tier >= ?`,
    MASTERY_GRADUATION_TIER,
  );
  let total = 0;
  let notMissed = 0;
  for (const row of rows) {
    total += 1;
    if (row.rating !== Rating.Again) notMissed += 1;
  }
  return {
    totalReviews: total,
    nonMissedReviews: notMissed,
    ratio: total > 0 ? notMissed / total : 1,
  };
}

export const DEFAULT_DAILY_GOAL = 20;

export async function getDailyGoal(): Promise<number> {
  try {
    const row = await getDb().getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      'daily_goal',
    );
    const parsed = row ? parseInt(row.value, 10) : NaN;
    if (Number.isFinite(parsed)) return Math.max(1, Math.min(500, parsed));
  } catch {
    // Fresh DB or locked: fall through to the default.
  }
  return DEFAULT_DAILY_GOAL;
}

export async function setDailyGoal(goal: number): Promise<number> {
  const clamped = Math.max(1, Math.min(500, Math.floor(goal)));
  await getDb().runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'daily_goal',
    String(clamped),
  ]);
  return clamped;
}

export const DEFAULT_STUDYING_LIMIT = 60;
export const DEFAULT_BOOK_MIN_TRANSLATION_TIER = MASTERY_GRADUATION_TIER;

export async function getStudyingLimit(): Promise<number> {
  try {
    const row = await getDb().getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      'studying_limit',
    );
    const parsed = Number.parseInt(row?.value ?? '', 10);
    if (Number.isFinite(parsed)) return Math.max(1, Math.min(1000, parsed));
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_STUDYING_LIMIT;
}

export async function setStudyingLimit(limit: number): Promise<number> {
  const clamped = Math.max(1, Math.min(1000, Math.floor(limit)));
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'studying_limit',
      String(clamped),
    );
    await db.runAsync('UPDATE decks SET studying_limit = ?', clamped);
  });
  return clamped;
}

export async function getBookMinTranslationTier(): Promise<number> {
  try {
    const row = await getDb().getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      'book_min_translation_tier',
    );
    const parsed = row ? parseInt(row.value, 10) : NaN;
    if (Number.isFinite(parsed))
      return Math.max(0, Math.min(MAX_MASTERY_TIER, parsed));
  } catch {
    // Fall through to default.
  }
  return DEFAULT_BOOK_MIN_TRANSLATION_TIER;
}

export async function setBookMinTranslationTier(tier: number): Promise<number> {
  const clamped = Math.max(0, Math.min(MAX_MASTERY_TIER, Math.floor(tier)));
  await getDb().runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'book_min_translation_tier',
    String(clamped),
  ]);
  return clamped;
}

/**
 * Count active, not-yet-graduated cards for one deck.
 */
export async function countStudyingCards(deckId: string): Promise<number> {
  const row = await getDb().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM cards
     WHERE deck_id = ? AND locked = 0 AND mastery_tier < ?`,
    deckId,
    MASTERY_GRADUATION_TIER,
  );
  return row?.count ?? 0;
}

/**
 * Keep active studying cards within a deck's limit, then fill open slots.
 * When reducing the limit, the newest active cards are locked first; when
 * increasing it or graduating cards, the next locked cards are unlocked.
 * Returns how many cards were unlocked.
 */
export async function unlockNextCards(preferDeckId?: string): Promise<number> {
  const db = getDb();
  const limit = await getStudyingLimit();
  const deckIds = preferDeckId
    ? [preferDeckId]
    : (
        await db.getAllAsync<{ id: string }>('SELECT id FROM decks ORDER BY created_at ASC')
      ).map((deck) => deck.id);
  let totalUnlocked = 0;

  for (const deckId of deckIds) {
    let current = await countStudyingCards(deckId);
    if (current > limit) {
      const excess = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM cards
         WHERE deck_id = ? AND locked = 0 AND mastery_tier < ?
         ORDER BY unlock_order DESC
         LIMIT ?`,
        deckId,
        MASTERY_GRADUATION_TIER,
        current - limit,
      );
      if (excess.length > 0) {
        await db.runAsync(
          `UPDATE cards SET locked = 1 WHERE id IN (${excess.map(() => '?').join(',')})`,
          ...excess.map((row) => row.id),
        );
        current -= excess.length;
      }
    }
    const slots = limit - current;
    if (slots <= 0) continue;

    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM cards
       WHERE deck_id = ? AND locked = 1
       ORDER BY unlock_order ASC
       LIMIT ?`,
      deckId,
      slots,
    );
    if (rows.length === 0) continue;

    const ids = rows.map((row) => row.id);
    await db.runAsync(
      `UPDATE cards SET locked = 0, due = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
      nowIso(),
      ...ids,
    );
    totalUnlocked += rows.length;
  }
  return totalUnlocked;
}

/**
 * List all cards currently in the active studying stage (unlocked and
 * below graduation tier), optionally scoped to one deck.
 */
export type StudyingCard = DueCard;

export async function listStudyingCards(deckId?: string): Promise<StudyingCard[]> {
  const db = getDb();
  if (deckId) {
    const rows = await db.getAllAsync<any>(
      `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
       FROM cards c
       JOIN entries e ON e.id = c.entry_id
       JOIN decks d ON d.id = c.deck_id
       WHERE c.deck_id = ? AND c.locked = 0 AND c.mastery_tier < ?
       ORDER BY c.unlock_order ASC`,
      deckId,
      MASTERY_GRADUATION_TIER,
    );
    return rows.map(mapCardRow) as StudyingCard[];
  }
  const rows = await db.getAllAsync<any>(
    `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
     FROM cards c
     JOIN entries e ON e.id = c.entry_id
     JOIN decks d ON d.id = c.deck_id
     WHERE c.locked = 0 AND c.mastery_tier < ?
     ORDER BY d.created_at ASC, c.unlock_order ASC`,
    MASTERY_GRADUATION_TIER,
  );
  return rows.map(mapCardRow) as StudyingCard[];
}

/**
 * Current streak of consecutive days meeting `goal` (today counts when met,
 * otherwise the streak may still be alive via yesterday). Pure + testable.
 */
export function computeStreak(counts: DailyCount[], goal: number): number {
  const today = dayIso(new Date());
  const met = new Set(counts.filter((c) => c.count >= goal).map((c) => c.day));
  let streak = 0;
  // Start today, or yesterday when today is not met yet (streak alive).
  const cursor = new Date();
  if (!met.has(dayIso(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (met.has(dayIso(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  void today;
  return streak;
}

export type CaseInflection = {
  entry_id: string;
  lemma: string;
  gloss: string;
  pos: string;
  form: string;
  tags: string;
};

/** All inflections for a deck's entries in one query (case-trainer pool). */
export async function listInflectionsForDeck(deckId: string): Promise<CaseInflection[]> {
  return getDb().getAllAsync<CaseInflection>(
    `SELECT e.id AS entry_id, e.lemma AS lemma, e.gloss AS gloss, e.pos AS pos,
            i.form AS form, i.tags AS tags
     FROM entries e
     JOIN cards c ON c.entry_id = e.id
     JOIN inflections i ON i.entry_id = e.id
     WHERE c.deck_id = ?
     ORDER BY e.lemma COLLATE NOCASE`,
    deckId,
  );
}
