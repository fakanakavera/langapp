import * as SQLite from 'expo-sqlite';

import { SCHEMA_SQL } from '@/db/schema';
import { seedIfNeeded } from '@/db/seed';

let database: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const cards = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(cards)"
  );
  const cardColumns = new Set(cards.map((c) => c.name));

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

  const examples = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(examples)"
  );
  const exampleColumns = new Set(examples.map((c) => c.name));

  if (!exampleColumns.has('hint')) {
    await db.execAsync(`
      ALTER TABLE examples ADD COLUMN hint TEXT NOT NULL DEFAULT '';
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
