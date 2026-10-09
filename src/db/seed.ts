import type { SQLiteDatabase } from 'expo-sqlite';

import { createId } from '@/lib/id';
import { nowIso } from '@/lib/dates';
import { normalizeRussian, RU_STARTER_DICTIONARY } from '@/morphology/dictionary';
import { emptyFsrsCard } from '@/srs/scheduler';

export async function seedIfNeeded(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
    'seeded',
  ]);
  if (row?.value === '1') return;

  const createdAt = nowIso();
  const deckId = createId();
  const fsrs = emptyFsrsCard(new Date(createdAt));

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO decks (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      deckId,
      'Russian starter',
      'A small seeded deck so reviews and morphology work immediately.',
      createdAt,
      createdAt,
    );

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

      await db.runAsync(
        `INSERT INTO cards (
          id, deck_id, entry_id, card_type, front, back,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, last_review, created_at
        ) VALUES (?, ?, ?, 'recognition', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        createId(),
        deckId,
        entryId,
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
        createdAt,
      );
    }

    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'seeded', '1');
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'schema_version', '1');
  });
}
