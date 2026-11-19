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
  pos_category TEXT CHECK (pos_category IN ('noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection', 'number')),
  studying_limit INTEGER NOT NULL DEFAULT 60,
  position INTEGER NOT NULL DEFAULT 0,
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
  locked INTEGER NOT NULL DEFAULT 1,
  unlock_order INTEGER NOT NULL DEFAULT 0,
  cefr_level TEXT CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
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

CREATE TABLE IF NOT EXISTS money_categories (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (type, name)
);

CREATE TABLE IF NOT EXISTS money_subcategories (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL,
  item_id TEXT,
  name TEXT NOT NULL,
  amount_minor INTEGER,
  barcode TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES money_categories(id) ON DELETE CASCADE,
  UNIQUE (category_id, name)
);

CREATE INDEX IF NOT EXISTS idx_money_subcategories_category ON money_subcategories(category_id);

CREATE TABLE IF NOT EXISTS money_items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT
);

CREATE TABLE IF NOT EXISTS money_tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS money_item_tags (
  item_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (item_id, tag_id),
  FOREIGN KEY (item_id) REFERENCES money_items(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES money_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS money_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id TEXT,
  subcategory_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  description TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'estimate')),
  recurring_rule_id TEXT,
  recurring_date TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES money_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (subcategory_id) REFERENCES money_subcategories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_money_transactions_date
  ON money_transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_money_transactions_category
  ON money_transactions(category_id);

CREATE TABLE IF NOT EXISTS money_recurring (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id TEXT,
  subcategory_id TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  description TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly_day', 'every_days', 'weekly')),
  day_of_month INTEGER,
  interval_days INTEGER,
  weekday INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT,
  FOREIGN KEY (category_id) REFERENCES money_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (subcategory_id) REFERENCES money_subcategories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS money_budgets (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  UNIQUE (category_id)
);

CREATE TABLE IF NOT EXISTS money_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
  reminder_offset INTEGER NOT NULL DEFAULT 0,
  recurrence_type TEXT NOT NULL DEFAULT 'none' CHECK (recurrence_type IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_start_date ON calendar_events(start_date);

CREATE TABLE IF NOT EXISTS calendar_todos (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,
  due_time TEXT,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
  reminder_offset INTEGER NOT NULL DEFAULT 0,
  recurrence_type TEXT NOT NULL DEFAULT 'none' CHECK (recurrence_type IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recurrence_end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_todos_due_date ON calendar_todos(due_date);
CREATE INDEX IF NOT EXISTS idx_calendar_todos_completed ON calendar_todos(is_completed);
`;
