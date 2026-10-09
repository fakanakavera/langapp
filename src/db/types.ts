export type Deck = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type Entry = {
  id: string;
  lemma: string;
  language: string;
  pos: string;
  gloss: string;
  notes: string;
  created_at: string;
};

export type Inflection = {
  id: string;
  entry_id: string;
  form: string;
  tags: string;
};

export type CardType = 'recognition' | 'production';

export type CardRow = {
  id: string;
  deck_id: string;
  entry_id: string;
  card_type: CardType;
  front: string;
  back: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  created_at: string;
};

export type ReviewRow = {
  id: string;
  card_id: string;
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reviewed_at: string;
};

export type Example = {
  id: string;
  entry_id: string;
  text: string;
  translation: string;
  source: 'user' | 'ai' | 'seed';
  created_at: string;
};

export type DueCard = CardRow & {
  lemma: string;
  gloss: string;
  deck_name: string;
};

export type DeckSummary = Deck & {
  card_count: number;
  due_count: number;
};

export type BackupPayload = {
  version: 1;
  exportedAt: string;
  decks: Deck[];
  entries: Entry[];
  inflections: Inflection[];
  cards: CardRow[];
  reviews: ReviewRow[];
  examples: Example[];
};
