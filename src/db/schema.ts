export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY NOT NULL,
  lemma TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ru',
  pos TEXT NOT NULL DEFAULT '',
  gloss TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_lemma ON entries(lemma);

CREATE TABLE IF NOT EXISTS inflections (
  id TEXT PRIMARY KEY NOT NULL,
  entry_id TEXT NOT NULL,
  form TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inflections_form ON inflections(form);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY NOT NULL,
  deck_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  card_type TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  due TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  state INTEGER NOT NULL,
  mastery_tier INTEGER NOT NULL DEFAULT 0,
  quiz_due TEXT NOT NULL DEFAULT '',
  last_review TEXT,
  review_face INTEGER NOT NULL DEFAULT 1,
  review_history TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY NOT NULL,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  state INTEGER NOT NULL,
  due TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  faces TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS examples (
  id TEXT PRIMARY KEY NOT NULL,
  entry_id TEXT NOT NULL,
  text TEXT NOT NULL,
  translation TEXT NOT NULL DEFAULT '',
  hint TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS user_dictionary (
  id TEXT PRIMARY KEY NOT NULL,
  lemma TEXT NOT NULL,
  gloss TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_dictionary_lemma ON user_dictionary(lemma);
`;
