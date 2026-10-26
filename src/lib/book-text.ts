import type { UnknownWord } from '@/db/types';
import { normalizeRussian, stripAccents } from '@/morphology/dictionary';
import { ruEnLookup } from '@/lib/ru-en-dictionary';

export type TextToken = { text: string; isWord: boolean };

const WORD_RE = '[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*';
const TOKEN_RE = new RegExp(`(${WORD_RE})`, 'g');

/** Paragraphs: split on blank lines, fall back to single newlines. */
export function splitParagraphs(body: string): string[] {
  const normalized = body.replace(/\r\n?/g, '\n');
  const chunks = normalized.includes('\n\n')
    ? normalized.split(/\n{2,}/)
    : normalized.split(/\n/);
  return chunks.map((c) => c.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
}

export function isRussianWord(token: string): boolean {
  return new RegExp(`^${WORD_RE}$`).test(token);
}

/** Split a paragraph into word / non-word tokens, preserving everything. */
export function tokenizeParagraph(paragraph: string): TextToken[] {
  TOKEN_RE.lastIndex = 0;
  const out: TextToken[] = [];
  let last = 0;
  for (const match of paragraph.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ text: paragraph.slice(last, index), isWord: false });
    out.push({ text: match[0], isWord: true });
    last = index + match[0].length;
  }
  if (last < paragraph.length) out.push({ text: paragraph.slice(last), isWord: false });
  return out;
}

/** The sentence (by . ! ? … or newline) containing `offset` in a paragraph. */
export function sentenceAt(paragraph: string, offset: number): string {
  const bounds = /[.!?…]+["»)]?\s+|\n+/g;
  let start = 0;
  bounds.lastIndex = 0;
  for (const match of paragraph.matchAll(bounds)) {
    const end = (match.index ?? 0) + match[0].length;
    if (offset < end) {
      const sentence = paragraph.slice(start, end).trim();
      return sentence.length > 320 ? `${sentence.slice(0, 320)}…` : sentence;
    }
    start = end;
  }
  const tail = paragraph.slice(start).trim();
  return tail.length > 320 ? `${tail.slice(0, 320)}…` : tail;
}

export function countWords(body: string): number {
  const matches = body.match(new RegExp(WORD_RE, 'g'));
  return matches?.length ?? 0;
}

export type BookWordVisibility = 'known' | 'translated' | 'russian';

export type BookProgress = {
  totalWords: number;
  knownWords: number;
  translatedWords: number;
  russianWords: number;
};

export function normalizeBookWord(surface: string): string {
  return normalizeRussian(stripAccents(surface));
}

/** Keep book-list progress aligned with the reader's word rendering rules. */
export function classifyBookWord(
  surface: string,
  knownForms: ReadonlySet<string>,
  markedUnknown: ReadonlySet<string>,
): BookWordVisibility {
  const normalized = normalizeBookWord(surface);
  if (knownForms.has(normalized) && !markedUnknown.has(normalized)) return 'known';
  return ruEnLookup(normalized) ? 'translated' : 'russian';
}

export function calculateBookProgress(
  body: string,
  knownForms: ReadonlySet<string>,
  markedUnknown: ReadonlySet<string>,
): BookProgress {
  const progress: BookProgress = {
    totalWords: 0,
    knownWords: 0,
    translatedWords: 0,
    russianWords: 0,
  };
  for (const paragraph of splitParagraphs(body)) {
    for (const token of tokenizeParagraph(paragraph)) {
      if (!token.isWord) continue;
      progress.totalWords += 1;
      const visibility = classifyBookWord(token.text, knownForms, markedUnknown);
      if (visibility === 'known') progress.knownWords += 1;
      if (visibility === 'translated') progress.translatedWords += 1;
      else progress.russianWords += 1;
    }
  }
  return progress;
}

/**
 * AI-ready prompt: paste into any chat AI, get back a "Front","Back" CSV
 * that Settings → Import deck from JSON/CSV accepts (see csv-import.ts).
 */
export function buildAiDeckPrompt(bookTitle: string, words: UnknownWord[]): string {
  const lines = [
    'You are building a Russian vocabulary deck for the Langapp app.',
    '',
    'Reply with ONLY CSV lines, one per word, starting with exactly this header:',
    '"Front","Back"',
    'No explanations, no markdown fences, no extra text before or after — just the CSV,',
    'so it can be imported as-is.',
    '',
    'Rules for each line:',
    '- Front is the Russian dictionary lemma (no stress marks).',
    '- Back has three labeled parts separated by <br>:',
    '  Meaning: <short English gloss>',
    '  Example: <a few English context words> (<one full Russian sentence using the word>)',
    '  Translation: <English translation of that Russian sentence>',
    '- Example: "Front","Back" with Back =',
    '  Meaning: to want<br>Example: she wants to leave (Она хочет уехать.)<br>Translation: She wants to leave.',
    '- Keep sentences beginner-short. Escape inner quotes by doubling them.',
    '',
    `Words from "${bookTitle}" (surface form, guessed lemma, sentence seen in):`,
  ];
  words.forEach((word, index) => {
    const lemma = word.lemma_guess && word.lemma_guess !== word.surface
      ? ` (maybe lemma: ${word.lemma_guess})`
      : '';
    const context = word.context ? ` — "${word.context}"` : '';
    lines.push(`${index + 1}. "${word.surface}"${lemma}${context}`);
  });
  lines.push('', 'CSV below:');
  return lines.join('\n');
}
