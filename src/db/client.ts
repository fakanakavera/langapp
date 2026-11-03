import * as SQLite from 'expo-sqlite';

import { SCHEMA_SQL } from '@/db/schema';
import { seedIfNeeded } from '@/db/seed';
import {
  MASTERY_FREE_REVIEW_TIER,
  masteryIntervalMs,
  masteryTierAfterQuiz,
} from '@/lib/mastery';

let database: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const cards = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(cards)"
  );
  const cardColumns = new Set(cards.map((c) => c.name));
  const needsMasteryBackfill = !cardColumns.has('mastery_tier');
  const needsQuizDueBackfill = !cardColumns.has('quiz_due');

  if (!cardColumns.has('review_face')) {
    await db.execAsync(`
      ALTER TABLE cards ADD COLUMN review_face INTEGER NOT NULL DEFAULT 1;
    `);
  }
  if (!cardColumns.has('review_history')) {
    await db.execAsync(`
      ALTER TABLE cards ADD COLUMN review_history TEXT NOT NULL DEFAULT '[]';
    `);
  }
  const reviews = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(reviews)"
  );
  const reviewColumns = new Set(reviews.map((c) => c.name));

  if (!reviewColumns.has('faces')) {
    await db.execAsync(`
      ALTER TABLE reviews ADD COLUMN faces TEXT NOT NULL DEFAULT '[]';
    `);
  }
  if (needsMasteryBackfill || needsQuizDueBackfill) {
    await db.withTransactionAsync(async () => {
      if (needsMasteryBackfill) {
        await db.execAsync(`
          ALTER TABLE cards ADD COLUMN mastery_tier INTEGER NOT NULL DEFAULT 0;
        `);
      }
      if (needsQuizDueBackfill) {
        await db.execAsync(`
          ALTER TABLE cards ADD COLUMN quiz_due TEXT NOT NULL DEFAULT '';
        `);
        await db.execAsync("UPDATE cards SET quiz_due = due WHERE quiz_due = ''");
      }
      const rows = needsMasteryBackfill
        ? await db.getAllAsync<{ card_id: string; faces: string; reviewed_at: string }>(
            `SELECT r.card_id, r.faces, r.reviewed_at
             FROM reviews r
             ORDER BY r.reviewed_at ASC`,
          )
        : [];
      const tiers = new Map<string, number>();
      const lastQuizReviews = new Map<string, { reviewedAt: string; correct: boolean }>();
      for (const row of rows) {
        let faces: unknown;
        try {
          faces = JSON.parse(row.faces);
        } catch {
          continue;
        }
        if (!Array.isArray(faces)) continue;
        for (const face of faces) {
          if (face?.source === 'quiz' && face.face === 1) {
            const correct = face.response === 'know';
            tiers.set(
              row.card_id,
              masteryTierAfterQuiz(tiers.get(row.card_id) ?? 0, correct),
            );
            lastQuizReviews.set(row.card_id, { reviewedAt: row.reviewed_at, correct });
          } else if (face?.source === 'quiz-distractor') {
            tiers.set(
              row.card_id,
              masteryTierAfterQuiz(tiers.get(row.card_id) ?? 0, false),
            );
            lastQuizReviews.set(row.card_id, { reviewedAt: row.reviewed_at, correct: false });
          }
        }
      }
      for (const [cardId, lastReview] of lastQuizReviews) {
        const tier = tiers.get(cardId) ?? 0;
        const delay = lastReview.correct
          ? masteryIntervalMs(tier)
          : tier <= MASTERY_FREE_REVIEW_TIER ? 0 : 60_000;
        const reviewedAt = new Date(lastReview.reviewedAt).getTime();
        const quizDue = Number.isFinite(reviewedAt)
          ? new Date(reviewedAt + delay).toISOString()
          : undefined;
        if (needsMasteryBackfill && quizDue) {
          await db.runAsync(
            'UPDATE cards SET mastery_tier = ?, quiz_due = ? WHERE id = ?',
            tier,
            quizDue,
            cardId,
          );
        } else if (needsMasteryBackfill) {
          await db.runAsync('UPDATE cards SET mastery_tier = ? WHERE id = ?', tier, cardId);
        } else if (quizDue) {
          await db.runAsync('UPDATE cards SET quiz_due = ? WHERE id = ?', quizDue, cardId);
        }
      }
    });
  }

  const scheduleVersion = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'quiz_schedule_version'",
  );
  if (scheduleVersion?.value !== '2') {
    const rows = await db.getAllAsync<{
      card_id: string;
      faces: string;
      reviewed_at: string;
    }>(
      `SELECT r.card_id, r.faces, r.reviewed_at
       FROM reviews r
       ORDER BY r.reviewed_at DESC`,
    );
    const latestQuizReview = new Map<string, { reviewedAt: string; correct: boolean }>();
    for (const row of rows) {
      if (latestQuizReview.has(row.card_id)) continue;
      let faces: unknown;
      try {
        faces = JSON.parse(row.faces);
      } catch {
        continue;
      }
      if (!Array.isArray(faces)) continue;
      const quizFace = faces.find(
        (face) =>
          (face?.source === 'quiz' && face.face === 1) ||
          face?.source === 'quiz-distractor',
      );
      if (quizFace) {
        latestQuizReview.set(row.card_id, {
          reviewedAt: row.reviewed_at,
          correct: quizFace.source === 'quiz' && quizFace.response === 'know',
        });
      }
    }
    await db.withTransactionAsync(async () => {
      const cards = await db.getAllAsync<{ id: string; mastery_tier: number }>(
        'SELECT id, mastery_tier FROM cards',
      );
      const now = new Date();
      for (const card of cards) {
        const tier = Math.max(0, Math.min(10, Math.trunc(card.mastery_tier)));
        const latest = latestQuizReview.get(card.id);
        if (tier <= MASTERY_FREE_REVIEW_TIER) {
          await db.runAsync('UPDATE cards SET quiz_due = ? WHERE id = ?', now.toISOString(), card.id);
        } else if (latest) {
          const reviewedAt = new Date(latest.reviewedAt).getTime();
          if (!Number.isFinite(reviewedAt)) continue;
          const delay = latest.correct
            ? masteryIntervalMs(tier)
            : 60_000;
          await db.runAsync(
            'UPDATE cards SET quiz_due = ? WHERE id = ?',
            new Date(reviewedAt + delay).toISOString(),
            card.id,
          );
        }
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('quiz_schedule_version', '2')",
      );
    });
  }

  const examples = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(examples)"
  );
  const exampleColumns = new Set(examples.map((c) => c.name));

  if (!exampleColumns.has('hint')) {
    await db.execAsync(`
      ALTER TABLE examples ADD COLUMN hint TEXT NOT NULL DEFAULT '';
    `);
  }

  // --- New columns: decks.pos_category ---
  const decks = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(decks)"
  );
  const deckColumns = new Set(decks.map((c) => c.name));
  if (!deckColumns.has('pos_category')) {
    await db.execAsync(`
      ALTER TABLE decks ADD COLUMN pos_category TEXT;
    `);
  }
  if (!deckColumns.has('studying_limit')) {
    const oldLimit = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'studying_limit'",
    );
    const parsedLimit = oldLimit ? Number.parseInt(oldLimit.value, 10) : NaN;
    const migratedLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(1000, parsedLimit))
      : 60;
    await db.execAsync(`
      ALTER TABLE decks ADD COLUMN studying_limit INTEGER NOT NULL DEFAULT 60;
    `);
    if (Number.isFinite(parsedLimit)) {
      await db.runAsync('UPDATE decks SET studying_limit = ?', migratedLimit);
    }
  }

  // --- New columns: cards.locked, cards.unlock_order ---
  const cardCols2 = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(cards)"
  );
  const cardColumnSet2 = new Set(cardCols2.map((c) => c.name));
  if (!cardColumnSet2.has('locked')) {
    await db.execAsync(`
      ALTER TABLE cards ADD COLUMN locked INTEGER NOT NULL DEFAULT 1;
    `);
  }
  if (!cardColumnSet2.has('unlock_order')) {
    await db.execAsync(`
      ALTER TABLE cards ADD COLUMN unlock_order INTEGER NOT NULL DEFAULT 0;
    `);
  }

  // Reader books + tapped unknown words (fresh installs get these from
  // SCHEMA_SQL; older installs pick them up here).
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS unknown_words (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      normalized TEXT NOT NULL,
      lemma_guess TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_unknown_words_book ON unknown_words(book_id);
    CREATE INDEX IF NOT EXISTS idx_unknown_words_normalized ON unknown_words(normalized);
  `);
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync('langapp.db');
    await db.execAsync(SCHEMA_SQL);
    await runMigrations(db);
    await seedIfNeeded(db);
    database = db;
    return db;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!database) {
    throw new Error('Database is not ready yet.');
  }
  return database;
}
