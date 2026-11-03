import type { SQLiteDatabase } from 'expo-sqlite';

import { createId } from '@/lib/id';
import { nowIso } from '@/lib/dates';
import { normalizeRussian, RU_STARTER_DICTIONARY } from '@/morphology/dictionary';
import { emptyFsrsCard } from '@/srs/scheduler';

export async function seedIfNeeded(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    'seeded',
  ]);
  const createdAt = nowIso();

  if (row?.value !== '1') {
  const deckId = createId();
  const fsrs = emptyFsrsCard(new Date(createdAt));

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO decks (id, name, description, pos_category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      deckId,
      'Russian starter',
      'A small seeded deck so reviews and morphology work immediately.',
      null,
      createdAt,
      createdAt,
    );

    let unlockOrder = 0;
    for (const lemma of RU_STARTER_DICTIONARY) {
      const entryId = createId();
      await db.runAsync(
        `INSERT INTO entries (id, lemma, language, pos, gloss, notes, created_at)
         VALUES (?, ?, 'ru', ?, ?, ?, ?)`,
        entryId,
        lemma.lemma,
        lemma.pos,
        lemma.gloss,
        lemma.notes ?? '',
        createdAt,
      );

      const seen = new Set<string>();
      for (const form of lemma.forms) {
        const key = `${normalizeRussian(form.form)}|${form.tags}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await db.runAsync(
          `INSERT INTO inflections (id, entry_id, form, tags) VALUES (?, ?, ?, ?)`,
          createId(),
          entryId,
          normalizeRussian(form.form),
          form.tags,
        );
      }

      for (const example of lemma.examples) {
        await db.runAsync(
          `INSERT INTO examples (id, entry_id, text, translation, source, created_at)
           VALUES (?, ?, ?, ?, 'seed', ?)`,
          createId(),
          entryId,
          example.text,
          example.translation,
          createdAt,
        );
      }

      unlockOrder += 1;
      await db.runAsync(
        `INSERT INTO cards (
          id, deck_id, entry_id, card_type, front, back,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, mastery_tier, quiz_due, last_review, review_face, review_history, locked, unlock_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        deckId,
        entryId,
        'recognition',
        lemma.lemma,
        lemma.gloss,
        fsrs.due.toISOString(),
        fsrs.stability,
        fsrs.difficulty,
        fsrs.elapsed_days,
        fsrs.scheduled_days,
        fsrs.learning_steps,
        fsrs.reps,
        fsrs.lapses,
        fsrs.state,
        0,
        fsrs.due.toISOString(),
        null,
        1,
        '[]',
        1,
        unlockOrder,
        createdAt,
      );
    }

    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'seeded', '1');
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'schema_version', '1');
  });
  }

  const studyingLimit = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'studying_limit'",
  );
  if (!studyingLimit) {
    const firstDeck = await db.getFirstAsync<{ studying_limit: number }>(
      'SELECT studying_limit FROM decks ORDER BY created_at ASC LIMIT 1',
    );
    const parsedLimit = Number(firstDeck?.studying_limit);
    const initialLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(1000, parsedLimit))
      : 60;
    await db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'studying_limit',
      String(initialLimit),
    );
    await db.runAsync('UPDATE decks SET studying_limit = ?', initialLimit);
  }

  // Default settings for the book-tier system.
  const settings = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM meta WHERE key = ?',
    'book_min_translation_tier',
  );
  const settingKeys = new Set(settings.map((s) => s.key));
  if (!settingKeys.has('book_min_translation_tier')) {
    await db.runAsync(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      'book_min_translation_tier',
      String(4),
    );
  }

  // Reader sample book (user-provided text). Seeded once: later launches
  // keep the user's books, marks, and deletions untouched.
  const bookCount =
    (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM books'))?.n ?? 0;
  if (bookCount === 0) {
    try {
      const { SAMPLE_BOOK_TITLE, SAMPLE_BOOK_BODY } = await import('@/data/sample-book');
      if (SAMPLE_BOOK_BODY.trim()) {
        await db.runAsync(
          'INSERT INTO books (id, title, body, created_at) VALUES (?, ?, ?, ?)',
          createId(),
          SAMPLE_BOOK_TITLE,
          SAMPLE_BOOK_BODY,
          createdAt,
        );
      }
    } catch {
      // A missing/unreadable sample must never block first launch.
    }
  }
}
