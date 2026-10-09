import type { Grade } from 'ts-fsrs';

import { getDb } from '@/db/client';
import type {
  BackupPayload,
  CardRow,
  Deck,
  DeckSummary,
  DueCard,
  Entry,
  Example,
  Inflection,
  ReviewRow,
} from '@/db/types';
import { nowIso, toIso } from '@/lib/dates';
import { createId } from '@/lib/id';
import { normalizeRussian } from '@/morphology/dictionary';
import { emptyFsrsCard, scheduleReview } from '@/srs/scheduler';

export async function listDeckSummaries(): Promise<DeckSummary[]> {
  const db = getDb();
  const now = nowIso();
  return db.getAllAsync<DeckSummary>(
    `SELECT d.*,
            (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count,
            (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.due <= ?) AS due_count
     FROM decks d
     ORDER BY d.updated_at DESC`,
    now,
  );
}

export async function getDeck(id: string): Promise<Deck | null> {
  return getDb().getFirstAsync<Deck>('SELECT * FROM decks WHERE id = ?', id);
}

export async function createDeck(name: string, description = ''): Promise<Deck> {
  const db = getDb();
  const createdAt = nowIso();
  const deck: Deck = {
    id: createId(),
    name: name.trim(),
    description: description.trim(),
    created_at: createdAt,
    updated_at: createdAt,
  };
  await db.runAsync(
    `INSERT INTO decks (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    deck.id,
    deck.name,
    deck.description,
    deck.created_at,
    deck.updated_at,
  );
  return deck;
}

export async function listDueCards(deckId?: string): Promise<DueCard[]> {
  const db = getDb();
  const now = nowIso();
  if (deckId) {
    return db.getAllAsync<DueCard>(
      `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
       FROM cards c
       JOIN entries e ON e.id = c.entry_id
       JOIN decks d ON d.id = c.deck_id
       WHERE c.deck_id = ? AND c.due <= ?
       ORDER BY c.due ASC`,
      deckId,
      now,
    );
  }
  return db.getAllAsync<DueCard>(
    `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
     FROM cards c
     JOIN entries e ON e.id = c.entry_id
     JOIN decks d ON d.id = c.deck_id
     WHERE c.due <= ?
     ORDER BY c.due ASC`,
    now,
  );
}

export async function countDueCards(): Promise<number> {
  const row = await getDb().getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cards WHERE due <= ?',
    nowIso(),
  );
  return row?.count ?? 0;
}

export async function listCardsForDeck(deckId: string): Promise<DueCard[]> {
  return getDb().getAllAsync<DueCard>(
    `SELECT c.*, e.lemma, e.gloss, d.name AS deck_name
     FROM cards c
     JOIN entries e ON e.id = c.entry_id
     JOIN decks d ON d.id = c.deck_id
     WHERE c.deck_id = ?
     ORDER BY e.lemma COLLATE NOCASE`,
    deckId,
  );
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
    last_review: null,
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
        reps, lapses, state, last_review, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
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
      card.created_at,
    );

    await db.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', createdAt, input.deckId);
  });

  return { entry, card };
}

export async function reviewCard(card: CardRow, rating: Grade): Promise<CardRow> {
  const db = getDb();
  const now = new Date();
  const result = scheduleReview(card, rating, now);
  const updated: CardRow = {
    ...card,
    due: result.card.due.toISOString(),
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    elapsed_days: result.card.elapsed_days,
    scheduled_days: result.card.scheduled_days,
    learning_steps: result.card.learning_steps,
    reps: result.card.reps,
    lapses: result.card.lapses,
    state: result.card.state,
    last_review: toIso(result.card.last_review) ?? now.toISOString(),
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cards SET
        due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
        learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ?
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
      updated.last_review,
      updated.id,
    );

    await db.runAsync(
      `INSERT INTO reviews (
        id, card_id, rating, state, due, stability, difficulty,
        elapsed_days, scheduled_days, learning_steps, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      createId(),
      card.id,
      result.log.rating,
      result.log.state,
      result.log.due.toISOString(),
      result.log.stability,
      result.log.difficulty,
      result.log.elapsed_days,
      result.log.scheduled_days,
      result.log.learning_steps,
      result.log.review.toISOString(),
    );
  });

  return updated;
}

export async function addExample(input: {
  entryId: string;
  text: string;
  translation: string;
  source: Example['source'];
}): Promise<Example> {
  const example: Example = {
    id: createId(),
    entry_id: input.entryId,
    text: input.text.trim(),
    translation: input.translation.trim(),
    source: input.source,
    created_at: nowIso(),
  };
  await getDb().runAsync(
    `INSERT INTO examples (id, entry_id, text, translation, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    example.id,
    example.entry_id,
    example.text,
    example.translation,
    example.source,
    example.created_at,
  );
  return example;
}

export async function listKnownLemmas(limit = 80): Promise<string[]> {
  const rows = await getDb().getAllAsync<{ lemma: string }>(
    'SELECT lemma FROM entries ORDER BY created_at DESC LIMIT ?',
    limit,
  );
  return rows.map((row) => row.lemma);
}

export async function dumpBackup(): Promise<BackupPayload> {
  const db = getDb();
  const [decks, entries, inflections, cards, reviews, examples] = await Promise.all([
    db.getAllAsync<Deck>('SELECT * FROM decks'),
    db.getAllAsync<Entry>('SELECT * FROM entries'),
    db.getAllAsync<Inflection>('SELECT * FROM inflections'),
    db.getAllAsync<CardRow>('SELECT * FROM cards'),
    db.getAllAsync<ReviewRow>('SELECT * FROM reviews'),
    db.getAllAsync<Example>('SELECT * FROM examples'),
  ]);

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

export async function restoreBackup(payload: BackupPayload): Promise<void> {
  if (payload.version !== 1) {
    throw new Error(`Unsupported backup version: ${String(payload.version)}`);
  }

  const db = getDb();
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
        `INSERT INTO decks (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        deck.id,
        deck.name,
        deck.description,
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
      await db.runAsync(
        `INSERT INTO inflections (id, entry_id, form, tags) VALUES (?, ?, ?, ?)`,
        inflection.id,
        inflection.entry_id,
        inflection.form,
        inflection.tags,
      );
    }
    for (const card of payload.cards) {
      await db.runAsync(
        `INSERT INTO cards (
          id, deck_id, entry_id, card_type, front, back,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, last_review, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        card.last_review,
        card.created_at,
      );
    }
    for (const review of payload.reviews) {
      await db.runAsync(
        `INSERT INTO reviews (
          id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    }
    for (const example of payload.examples) {
      await db.runAsync(
        `INSERT INTO examples (id, entry_id, text, translation, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        example.id,
        example.entry_id,
        example.text,
        example.translation,
        example.source,
        example.created_at,
      );
    }
  });
}
