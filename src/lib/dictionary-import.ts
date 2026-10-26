export type DictionaryRow = { lemma: string; gloss: string };

const HEADER_WORDS = new Set(['word', 'lemma', 'front', 'gloss', 'translation', 'meaning', 'back']);

function isWordLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!/[A-Za-zА-Яа-яЁё]/.test(trimmed)) return false;
  return true;
}

/**
 * Tolerant parser for word -> translation files.
 * Accepts CSV (`word,translation`, optional header) and delimited lines
 * (`word = translation`, `word: translation`, `word — translation`,
 * `word → translation`). Skips comments, blank lines, and non-word lines.
 */
export function parseDictionaryText(text: string): { rows: DictionaryRow[]; skipped: number } {
  const rows: DictionaryRow[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;
    if (/^\s*```/.test(line)) continue;

    let lemma: string | null = null;
    let gloss: string | null = null;

    // CSV: word,translation (everything after the first comma is the gloss).
    const csv = line.match(/^([^,]+),(.+)$/);
    if (csv) {
      const left = csv[1].trim();
      const right = csv[2].trim();
      if (HEADER_WORDS.has(left.toLowerCase())) continue;
      if (isWordLike(left) && right) {
        lemma = left;
        gloss = right;
      }
    }

    // Delimited: word = translation / word: translation / word — translation / word → translation
    if (!lemma) {
      const delimiters = [' = ', ' : ', ' — ', ' – ', ' → ', '=', ':'];
      for (const d of delimiters) {
        const idx = line.indexOf(d);
        if (idx < 0) continue;
        const left = line.slice(0, idx).trim();
        const right = line.slice(idx + d.length).trim();
        if (!left || !right || HEADER_WORDS.has(left.toLowerCase())) continue;
        if (!isWordLike(left)) continue;
        lemma = left;
        gloss = right;
        break;
      }
    }

    if (!lemma || !gloss) {
      skipped += 1;
      continue;
    }

    const key = lemma.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ lemma, gloss });
  }

  return { rows, skipped };
}
