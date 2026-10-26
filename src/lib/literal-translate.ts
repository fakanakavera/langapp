import { normalizeRussian, stripAccents } from '@/morphology/dictionary';

import { ruEnLookup } from './ru-en-dictionary';

/** Normalized Russian forms already in one of the user's decks. */
export type LiteralTranslateOptions = {
  known: Set<string>;
};

/**
 * "Bad" literal Russian -> English translation.
 *
 * Rules:
 * - Words in `known` (already in a deck) stay in Russian.
 * - Words found in the mini-dictionary become English.
 * - Everything else stays in Russian.
 * - Russian word order is preserved; punctuation / spacing is preserved.
 * - Runs fully on-device, offline, no API key, no $99 Apple fee.
 */
export function literalTranslate(text: string, opts: LiteralTranslateOptions): string {
  const { known } = opts;
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/[А-Яа-яЁё]/.test(ch)) {
      let j = i;
      while (j < text.length && /[А-Яа-яЁё-]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      const norm = normalizeRussian(stripAccents(word));
      if (known.has(norm)) {
        out.push(word);
      } else {
        const en = ruEnLookup(norm);
        out.push(en ? en : word);
      }
      i = j;
    } else {
      out.push(ch);
      i += 1;
    }
  }
  return out.join('');
}