export type Deck = {
  id: string;
  name: string;
  description: string;
  pos_category: string | null;
  studying_limit: number;
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

export type ReviewFace = 1 | 2 | 3;

/** Which graded feature produced a review. Distractor lapses reuse the
 *  base mode with a -distractor suffix so stats can tell them apart. */
export type ReviewSource =
  | 'review'
  | 'quiz'
  | 'judge'
  | 'cases'
  | 'quiz-distractor'
  | 'judge-distractor';

export type FaceResponse =
  | { face: 1; response: 'know' | 'dont_know'; duration_ms?: number; source?: ReviewSource }
  | { face: 2; response: 'know' | 'dont_know'; duration_ms?: number; source?: ReviewSource }
  | { face: 3; response: 'no_idea' | 'vague_idea' | 'knew_confirm'; duration_ms?: number; source?: ReviewSource };

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
  mastery_tier: number;
  quiz_due: string;
  last_review: string | null;
  review_face: ReviewFace;
  review_history: FaceResponse[];
  locked: number;
  unlock_order: number;
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
  /** Per-face trail of this review, in order (includes time-to-answer). */
  faces: FaceResponse[];
};

export type Example = {
  id: string;
  entry_id: string;
  text: string;
  translation: string;
  /** Pre-authored face-2 hint (mostly English, target word in Russian). */
  hint: string;
  source: 'user' | 'ai' | 'seed';
  created_at: string;
};

export type DueCard = CardRow & {
  lemma: string;
  gloss: string;
  deck_name: string;
};

export type Book = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

export type UnknownWord = {
  id: string;
  book_id: string;
  surface: string;
  normalized: string;
  lemma_guess: string;
  context: string;
  created_at: string;
};

export type UserDictionaryEntry = {
  id: string;
  lemma: string;
  gloss: string;
  created_at: string;
};

export type DeckSummary = Deck & {
  card_count: number;
  due_count: number;
  studying_count: number;
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
