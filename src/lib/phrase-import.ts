export type PhraseRow = { lemma: string; text: string; translation: string };

const HEADER_WORDS = new Set(['word', 'lemma', 'front', 'phrase', 'text', 'sentence',
  'translation', 'meaning', 'back', 'english', 'ru', 'en']);

/**
 * Split one CSV line into fields, respecting double-quoted fields (which may
 * contain commas and line-wrapped quotes). Returns null when there are fewer
 * than 2 fields.
 */
function splitCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    } else {
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        fields.push(field);
        field = '';
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
  }
  fields.push(field);
  return fields.length >= 2 ? fields : null;
}

/**
 * Tolerant parser for phrase-import files.
 *
 * Accepted shapes (comma-separated, optional header):
 *   word, Russian sentence, English translation
 *   "дом","Я вижу дом.","I see the house."
 *
 * A line may also have just two columns (word, Russian sentence) — the
 * translation is then left blank. Lines that don't parse are skipped.
 */
export function parsePhraseText(text: string): { rows: PhraseRow[]; skipped: number } {
  const rows: PhraseRow[] = [];
  let skipped = 0;
  const seen = new Set<string>(); // normalized lemma + text
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

  let headerSkipped = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;
    if (/^\s*```/.test(line)) continue;

    const fields = splitCsvLine(line);
    if (!fields) {
      skipped += 1;
      continue;
    }

    // Trim and strip surrounding quotes leftovers.
    const clean = fields.map((f) => f.trim().replace(/^"|"$/g, ''));

    // Detect and skip a header row.
    if (!headerSkipped) {
      headerSkipped = true;
      const first = clean[0]?.toLowerCase() ?? '';
      if (HEADER_WORDS.has(first) || clean.some((f) => HEADER_WORDS.has(f.toLowerCase()))) {
        continue;
      }
    }

    const lemma = clean[0];
    const textPhrase = clean[1];
    const translation = clean[2] ?? '';

    if (!lemma || !textPhrase) {
      skipped += 1;
      continue;
    }
    if (!/[А-Яа-яЁёA-Za-z]/.test(lemma)) {
      skipped += 1;
      continue;
    }

    const key = `${lemma.toLocaleLowerCase('ru-RU')}||${textPhrase.toLocaleLowerCase('ru-RU')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ lemma, text: textPhrase, translation: translation.trim() });
  }

  return { rows, skipped };
}
