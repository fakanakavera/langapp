import { normalizeRussian, stripAccents } from '@/morphology/dictionary';
import type {
  BackupPayload,
  CardRow,
  Deck,
  Entry,
  Example,
  Inflection,
} from '@/db/types';

export type CsvRow = { front: string; back: string };

/** Card meaning when no translation exists yet — here or typed in the app. */
export const PLACEHOLDER_GLOSS = '(no translation yet)';

function isHeaderRow(front: string, back: string): boolean {
  return front.trim().toLowerCase() === 'front' && back.trim().toLowerCase() === 'back';
}

/**
 * Split a single CSV record line into its two fields. Handles quoted
 * fields with "" escapes; falls back to a first-comma split for
 * unquoted AI output. Returns null when the line holds no two fields.
 */
function splitRecord(line: string): { front: string; back: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"')) {
    // Quoted front: closing quote is the one followed by a comma (or EOL).
    let i = 1;
    let front = '';
    let closed = false;
    while (i < trimmed.length) {
      const ch = trimmed[i];
      if (ch === '"') {
        if (trimmed[i + 1] === '"') {
          front += '"';
          i += 2;
          continue;
        }
        closed = true;
        i += 1;
        break;
      }
      front += ch;
      i += 1;
    }
    if (!closed) return null;
    const rest = trimmed.slice(i).trim();
    if (!rest) return { front, back: '' };
    if (!rest.startsWith(',')) return null;
    let back = rest.slice(1).trim();
    if (back.startsWith('"')) {
      // Quoted back: must run to a closing quote (multiline records are
      // pre-joined by the caller, so EOL without close means malformed).
      let j = 1;
      let out = '';
      let backClosed = false;
      while (j < back.length) {
        const ch = back[j];
        if (ch === '"') {
          if (back[j + 1] === '"') {
            out += '"';
            j += 2;
            continue;
          }
          backClosed = true;
          j += 1;
          break;
        }
        out += ch;
        j += 1;
      }
      if (!backClosed) return null;
      return { front, back: out };
    }
    return { front, back };
  }
  const comma = trimmed.indexOf(',');
  if (comma < 0) return null;
  return {
    front: trimmed.slice(0, comma).trim(),
    back: trimmed.slice(comma + 1).trim(),
  };
}

/**
 * Join wrapped lines back into records: a record starting with a quote is
 * incomplete while splitRecord() still rejects it (its quotes don't
 * balance yet). Capped so one malformed line can't glue the whole file.
 * AI chat output wraps long backs across lines; without this every
 * wrapped row is silently lost.
 */
function joinWrappedLines(lines: string[]): string[] {
  const records: string[] = [];
  let current = '';
  let open = false;
  let joined = 0;
  const flush = () => {
    if (current.trim()) records.push(current);
    current = '';
    open = false;
    joined = 0;
  };
  for (const line of lines) {
    if (!open) {
      current = line;
      joined = 1;
    } else {
      current += `\n${line}`;
      joined += 1;
    }
    open =
      current.trim().startsWith('"') && splitRecord(current) === null && joined < 8;
    if (!open) flush();
  }
  if (current.trim()) records.push(current);
  return records;
}

/**
 * Bare word line: no comma at all (a pasted word list, one per line).
 * Strips numbering/bullets and wrapping quotes; accepts at most 2 tokens
 * so prose sentences never sneak in as words.
 */
function cleanBareWord(line: string): string | null {
  let text = line
    .trim()
    .replace(/^\s*(?:\d{1,3}[.)]\s*|[-*•–—]\s*)+/, '')
    .trim()
    .replace(/^["'`«»„“”*_\s]+|["'`«»„“”*_\s.,!?;:]+$/g, '')
    .trim();
  if (!text || /[,;!?."'`()[\]{}]/.test(text)) return null;
  if (text.split(/\s+/).length > 2) return null;
  if (!/[А-Яа-яЁёA-Za-z]/.test(text)) return null;
  return text;
}

/**
 * Tolerant 2-column ("Front","Back") parser built for AI-pasted CSV:
 * strips markdown fences and prose, accepts header anywhere, "" escapes,
 * line-wrapped backs, and unquoted `front,back` lines. A bare word per
 * line (no comma) also imports — its meaning becomes a placeholder.
 * Fronts are plain words; backs may contain raw unescaped quotes.
 */
export function parseCsvRecords(text: string): { rows: CsvRow[]; skipped: number } {
  const rows: CsvRow[] = [];
  let skipped = 0;
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // Markdown fences AI chats love to add.
    .filter((line) => !/^\s*```/.test(line));
  for (const record of joinWrappedLines(lines)) {
    if (!record.trim()) continue;
    const fields = splitRecord(record);
    if (!fields) {
      const bare = cleanBareWord(record);
      if (!bare) {
        skipped += 1;
        continue;
      }
      rows.push({ front: bare, back: '' });
      continue;
    }
    const front = fields.front.trim();
    const back = fields.back.replace(/"$/g, '').trim();
    if (!front || isHeaderRow(front, back)) continue;
    // A front with quotes, dashes, or parens is a prompt echo or prose
    // ("1. «x» — ..."), never a word. Count it skipped, not imported.
    if (/["—–(]/.test(front)) {
      skipped += 1;
      continue;
    }
    rows.push({ front, back });
  }
  return { rows, skipped };
}

function labeledPart(source: string, label: string): string | null {
  const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:Meaning|Example|Translation):|$)`, 'i');
  const match = source.match(pattern);
  return match ? match[1].trim() : null;
}

function splitBack(back: string): { meaning: string; example: string; translation: string } {
  const normalized = back.replace(/<br\s*\/?>/gi, '\n');
  const meaning = labeledPart(normalized, 'Meaning');
  const example = labeledPart(normalized, 'Example');
  const translation = labeledPart(normalized, 'Translation');
  if (meaning === null && example === null && translation === null) {
    return { meaning: normalized.trim(), example: '', translation: '' };
  }
  return {
    meaning: meaning ?? '',
    example: example ?? '',
    translation: translation ?? '',
  };
}

/**
 * Split the Example part into the mixed-language hint and the full Russian
 * sentence: "mixed words (Русское предложение)" -> both. Without parens the
 * whole text is treated as the hint.
 */
function splitExample(example: string): { hint: string; text: string } {
  const match = example.match(/^([\s\S]*?)\s*\(([^()]*)\)\s*$/);
  if (match) return { hint: match[1].trim(), text: match[2].trim() };
  return { hint: example.trim(), text: '' };
}

/**
 * Convert parsed CSV rows into a backup payload. Ids are temporary —
 * importDeckPayload regenerates them. Duplicate words merge into one entry
 * (extra examples are kept). Missing part of speech is the only real gap
 * versus JSON imports (pos stays empty).
 *
 * The gloss falls back through translation → example → raw back text →
 * a visible placeholder, so a bare word list still becomes usable cards
 * instead of silently vanishing. Truly empty rows count as dropped.
 */
export function csvToBackupPayload(
  rows: CsvRow[],
  nowIso: string,
): { payload: BackupPayload; dropped: number } {
  const decks: Deck[] = [
    {
      id: 'csv-deck-1',
      name: 'CSV import',
      description: '',
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];
  const entries: Entry[] = [];
  const inflections: Inflection[] = [];
  const cards: CardRow[] = [];
  const examples: Example[] = [];
  const seen = new Map<string, string>();
  let counter = 0;
  let dropped = 0;

  for (const row of rows) {
    const lemma = stripAccents(row.front).trim();
    if (!lemma) {
      dropped += 1;
      continue;
    }
    const { meaning, example, translation } = splitBack(row.back);
    // Bare words arrive with an empty back: keep them with a visible
    // placeholder instead of dropping the row.
    const gloss =
      (meaning || translation || example || row.back).trim() || PLACEHOLDER_GLOSS;
    const { hint, text } = splitExample(example);

    const seenKey = lemma.toLocaleLowerCase('ru-RU');
    let entryId = seen.get(seenKey);
    if (!entryId) {
      counter += 1;
      entryId = `csv-entry-${counter}`;
      seen.set(seenKey, entryId);
      entries.push({
        id: entryId,
        lemma,
        language: 'ru',
        pos: '',
        gloss,
        notes: '',
        created_at: nowIso,
      });
      inflections.push({
        id: `csv-infl-${counter}`,
        entry_id: entryId,
        form: normalizeRussian(stripAccents(lemma)),
        tags: 'lemma',
      });
      cards.push({
        id: `csv-card-${counter}`,
        deck_id: 'csv-deck-1',
        entry_id: entryId,
        card_type: 'recognition',
        front: lemma,
        back: gloss,
        due: nowIso,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: 0,
        lapses: 0,
        state: 0,
        last_review: null,
        review_face: 1,
        review_history: [],
        created_at: nowIso,
      });
    }

    if (hint || text || translation.trim()) {
      examples.push({
        id: `csv-ex-${examples.length + 1}`,
        entry_id: entryId,
        text,
        translation: translation.trim(),
        hint,
        source: 'user',
        created_at: nowIso,
      });
    }
  }

  return {
    payload: {
      version: 1,
      exportedAt: nowIso,
      decks,
      entries,
      inflections,
      cards,
      reviews: [],
      examples,
    },
    dropped,
  };
}
