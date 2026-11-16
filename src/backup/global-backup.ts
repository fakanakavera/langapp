import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDb } from '@/db/client';
import type {
  Book,
  CardRow,
  CalendarEvent,
  CalendarTodo,
  Deck,
  Entry,
  Example,
  GlobalBackupPayload,
  Inflection,
  MoneyBudget,
  MoneyCategory,
  MoneyRecurring,
  MoneySetting,
  MoneySubcategory,
  MoneyTransaction,
  ReviewRow,
  UnknownWord,
  UserDictionaryEntry,
} from '@/db/types';
import { nowIso } from '@/lib/dates';

function isGlobalBackupPayload(value: unknown): value is GlobalBackupPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as GlobalBackupPayload;
  return (
    p.version === 2 &&
    Array.isArray(p.decks) &&
    Array.isArray(p.entries) &&
    Array.isArray(p.meta)
  );
}

/**
 * Export every table in the app as a single v2 JSON backup:
 * language learning (decks, cards, reviews, entries, inflections, examples),
 * reader (books, unknown words), user dictionary, money (all tables),
 * calendar (events, todos), and app settings (meta).
 */
export async function dumpGlobalBackup(): Promise<GlobalBackupPayload> {
  const db = getDb();
  const [
    decks,
    entries,
    inflections,
    cards,
    reviewRows,
    examples,
    books,
    unknownWords,
    userDictionary,
    moneyCategories,
    moneySubcategories,
    moneyTransactions,
    moneyRecurring,
    moneyBudgets,
    moneySettings,
    calendarEvents,
    calendarTodos,
    meta,
  ] = await Promise.all([
    db.getAllAsync<Deck>('SELECT * FROM decks'),
    db.getAllAsync<Entry>('SELECT * FROM entries'),
    db.getAllAsync<Inflection>('SELECT * FROM inflections'),
    db.getAllAsync<CardRow>('SELECT * FROM cards'),
    db.getAllAsync<any>('SELECT * FROM reviews'),
    db.getAllAsync<Example>('SELECT * FROM examples'),
    db.getAllAsync<Book>('SELECT * FROM books'),
    db.getAllAsync<UnknownWord>('SELECT * FROM unknown_words'),
    db.getAllAsync<UserDictionaryEntry>('SELECT * FROM user_dictionary'),
    db.getAllAsync<MoneyCategory>('SELECT * FROM money_categories'),
    db.getAllAsync<MoneySubcategory>('SELECT * FROM money_subcategories'),
    db.getAllAsync<MoneyTransaction>('SELECT * FROM money_transactions'),
    db.getAllAsync<MoneyRecurring>('SELECT * FROM money_recurring'),
    db.getAllAsync<MoneyBudget>('SELECT * FROM money_budgets'),
    db.getAllAsync<MoneySetting>('SELECT * FROM money_settings'),
    db.getAllAsync<CalendarEvent>('SELECT * FROM calendar_events'),
    db.getAllAsync<CalendarTodo>('SELECT * FROM calendar_todos'),
    db.getAllAsync<{ key: string; value: string }>('SELECT * FROM meta'),
  ]);

  const reviews: ReviewRow[] = reviewRows.map((row) => ({
    ...row,
    faces: typeof row.faces === 'string' ? JSON.parse(row.faces) : (row.faces ?? []),
  }));

  const normalizedCards = cards.map((card) => ({
    ...card,
    review_history:
      typeof card.review_history === 'string' ? JSON.parse(card.review_history) : (card.review_history ?? []),
  }));

  return {
    version: 2,
    exportedAt: nowIso(),
    decks,
    entries,
    inflections,
    cards: normalizedCards,
    reviews,
    examples,
    books,
    unknownWords,
    userDictionary,
    moneyCategories,
    moneySubcategories,
    moneyTransactions,
    moneyRecurring,
    moneyBudgets,
    moneySettings,
    calendarEvents,
    calendarTodos,
    meta,
  };
}

/**
 * Destructive restore: wipes every data table and replaces it with the
 * backup contents. Runs inside a single transaction so it either fully
 * succeeds or fully fails.
 */
export async function restoreGlobalBackup(payload: GlobalBackupPayload): Promise<void> {
  if (payload.version !== 2) {
    throw new Error(`Unsupported backup version: ${String(payload.version)}`);
  }

  const db = getDb();
  // SQLite foreign keys are checked per-statement, so a bulk delete-then-insert
  // can briefly violate them even though the final state is valid. Disable FK
  // enforcement for the restore transaction, then re-enable it.
  await db.execAsync('PRAGMA foreign_keys = OFF');
  try {
    await db.withTransactionAsync(async () => {
      // --- Delete in FK-safe order (children before parents) ---
      await db.execAsync('DELETE FROM reviews');
      await db.execAsync('DELETE FROM examples');
      await db.execAsync('DELETE FROM cards');
      await db.execAsync('DELETE FROM inflections');
      await db.execAsync('DELETE FROM unknown_words');
      await db.execAsync('DELETE FROM entries');
      await db.execAsync('DELETE FROM decks');
      await db.execAsync('DELETE FROM books');
      await db.execAsync('DELETE FROM money_transactions');
      await db.execAsync('DELETE FROM money_recurring');
      await db.execAsync('DELETE FROM money_budgets');
      await db.execAsync('DELETE FROM money_subcategories');
      await db.execAsync('DELETE FROM money_categories');
      await db.execAsync('DELETE FROM money_settings');
      await db.execAsync('DELETE FROM calendar_events');
      await db.execAsync('DELETE FROM calendar_todos');
      await db.execAsync('DELETE FROM user_dictionary');
      await db.execAsync('DELETE FROM meta');

      // --- Insert in FK-safe order (parents before children) ---
      for (const deck of payload.decks) {
        await db.runAsync(
          `INSERT INTO decks (id, name, description, pos_category, studying_limit, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          deck.id,
          deck.name,
          deck.description,
          deck.pos_category ?? null,
          deck.studying_limit,
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
      for (const book of payload.books) {
        await db.runAsync(
          `INSERT INTO books (id, title, body, created_at) VALUES (?, ?, ?, ?)`,
          book.id,
          book.title,
          book.body,
          book.created_at,
        );
      }
      for (const cat of payload.moneyCategories) {
        await db.runAsync(
          `INSERT INTO money_categories (id, type, name, created_at) VALUES (?, ?, ?, ?)`,
          cat.id,
          cat.type,
          cat.name,
          cat.created_at,
        );
      }
      for (const ev of payload.calendarEvents) {
        await db.runAsync(
          `INSERT INTO calendar_events
           (id, title, description, start_date, end_date, is_all_day, reminder_offset,
            recurrence_type, recurrence_end_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ev.id,
          ev.title,
          ev.description,
          ev.start_date,
          ev.end_date,
          ev.is_all_day,
          ev.reminder_offset,
          ev.recurrence_type,
          ev.recurrence_end_date ?? null,
          ev.created_at,
          ev.updated_at,
        );
      }
      for (const td of payload.calendarTodos) {
        await db.runAsync(
          `INSERT INTO calendar_todos
           (id, title, description, due_date, due_time, is_completed, reminder_offset,
            recurrence_type, recurrence_end_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          td.id,
          td.title,
          td.description,
          td.due_date,
          td.due_time ?? null,
          td.is_completed,
          td.reminder_offset,
          td.recurrence_type,
          td.recurrence_end_date ?? null,
          td.created_at,
          td.updated_at,
        );
      }
      for (const u of payload.userDictionary) {
        await db.runAsync(
          `INSERT INTO user_dictionary (id, lemma, gloss, created_at) VALUES (?, ?, ?, ?)`,
          u.id,
          u.lemma,
          u.gloss,
          u.created_at,
        );
      }
      for (const m of payload.meta) {
        await db.runAsync(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, m.key, m.value);
      }
      for (const inf of payload.inflections) {
        const rawTags = (inf as any).tags;
        const tags = Array.isArray(rawTags) ? rawTags.join(' ') : (rawTags ?? '');
        await db.runAsync(
          `INSERT INTO inflections (id, entry_id, form, tags) VALUES (?, ?, ?, ?)`,
          inf.id,
          inf.entry_id,
          inf.form,
          tags,
        );
      }
      for (const ex of payload.examples) {
        await db.runAsync(
          `INSERT INTO examples (id, entry_id, text, translation, hint, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ex.id,
          ex.entry_id,
          ex.text,
          ex.translation,
          (ex as any).hint ?? '',
          ex.source,
          ex.created_at,
        );
      }
      for (const uw of payload.unknownWords) {
        await db.runAsync(
          `INSERT INTO unknown_words (id, book_id, surface, normalized, lemma_guess, context, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          uw.id,
          uw.book_id,
          uw.surface,
          uw.normalized,
          uw.lemma_guess,
          uw.context,
          uw.created_at,
        );
      }
      for (const sub of payload.moneySubcategories) {
        await db.runAsync(
          `INSERT INTO money_subcategories (id, category_id, name, amount_minor, barcode, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          sub.id,
          sub.category_id,
          sub.name,
          sub.amount_minor ?? null,
          sub.barcode ?? null,
          sub.created_at,
        );
      }
      for (const rec of payload.moneyRecurring) {
        await db.runAsync(
          `INSERT INTO money_recurring
           (id, type, category_id, subcategory_id, amount_minor, description, frequency,
            day_of_month, interval_days, weekday, start_date, end_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          rec.id,
          rec.type,
          rec.category_id ?? null,
          rec.subcategory_id ?? null,
          rec.amount_minor,
          rec.description,
          rec.frequency,
          rec.day_of_month ?? null,
          rec.interval_days ?? null,
          rec.weekday ?? null,
          rec.start_date,
          rec.end_date ?? null,
        );
      }
      for (const bud of payload.moneyBudgets) {
        await db.runAsync(
          `INSERT INTO money_budgets (id, category_id, amount_minor) VALUES (?, ?, ?)`,
          bud.id,
          bud.category_id,
          bud.amount_minor,
        );
      }
      for (const tx of payload.moneyTransactions) {
        await db.runAsync(
          `INSERT INTO money_transactions
           (id, type, category_id, subcategory_id, amount_minor, quantity, description,
            occurred_at, status, recurring_rule_id, recurring_date, is_deleted, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tx.id,
          tx.type,
          tx.category_id ?? null,
          tx.subcategory_id ?? null,
          tx.amount_minor,
          tx.quantity,
          tx.description,
          tx.occurred_at,
          tx.status,
          tx.recurring_rule_id ?? null,
          tx.recurring_date ?? null,
          tx.is_deleted ?? 0,
          tx.created_at,
        );
      }
      for (const card of payload.cards) {
        const reviewFace = (card as any).review_face ?? 1;
        const reviewHistory = Array.isArray(card.review_history) ? card.review_history : [];
        await db.runAsync(
          `INSERT INTO cards
           (id, deck_id, entry_id, card_type, front, back, due, stability, difficulty,
            elapsed_days, scheduled_days, learning_steps, reps, lapses, state, mastery_tier,
            quiz_due, last_review, review_face, review_history, locked, unlock_order, cefr_level, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          card.last_review ?? null,
          reviewFace,
          JSON.stringify(reviewHistory),
          (card as any).locked ?? 1,
          (card as any).unlock_order ?? 0,
          (card as any).cefr_level ?? null,
          card.created_at,
        );
      }
      for (const review of payload.reviews) {
        const faces = Array.isArray(review.faces) ? review.faces : [];
        await db.runAsync(
          `INSERT INTO reviews
           (id, card_id, rating, state, due, stability, difficulty, elapsed_days,
            scheduled_days, learning_steps, reviewed_at, faces)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          JSON.stringify(faces),
        );
      }
      for (const ms of payload.moneySettings) {
        await db.runAsync(`INSERT OR REPLACE INTO money_settings (key, value) VALUES (?, ?)`, ms.key, ms.value);
      }
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON');
  }
}

/** Write the full backup to the cache directory and open the iOS share sheet. */
export async function exportGlobalBackup(): Promise<void> {
  const payload = await dumpGlobalBackup();
  const filename = `langapp-global-backup-${payload.exportedAt.slice(0, 10)}.json`;
  const file = new File(Paths.cache, filename);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(JSON.stringify(payload, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Export Langapp global backup (all data)',
    });
    return;
  }
  throw new Error('Sharing is not available on this device.');
}

/**
 * Let the user pick a global backup JSON file, validate it, and restore it.
 * Returns null when the user cancels. Throws on invalid file.
 * Warning: this replaces ALL existing data on the device.
 */
export async function importGlobalBackupFile(): Promise<{ tables: number; rows: number } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', '.json'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;

  const file = new File(result.assets[0].uri);
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isGlobalBackupPayload(json)) {
    throw new Error('This file is not a Langapp global backup (v2).');
  }

  await restoreGlobalBackup(json);

  const totalRows =
    json.decks.length +
    json.entries.length +
    json.inflections.length +
    json.cards.length +
    json.reviews.length +
    json.examples.length +
    json.books.length +
    json.unknownWords.length +
    json.userDictionary.length +
    json.moneyCategories.length +
    json.moneySubcategories.length +
    json.moneyTransactions.length +
    json.moneyRecurring.length +
    json.moneyBudgets.length +
    json.moneySettings.length +
    json.calendarEvents.length +
    json.calendarTodos.length +
    json.meta.length;

  return { tables: 18, rows: totalRows };
}
