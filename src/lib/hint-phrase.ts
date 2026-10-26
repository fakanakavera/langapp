export type KnownWord = { lemma: string; gloss: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripParens(s: string): string {
  return s
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Use the first variant for multi-form lemmas like "в / во" -> "в". */
function primaryForm(lemma: string): string {
  return lemma.split('/')[0]?.trim() || lemma;
}

/**
 * Match candidates for a gloss, longest first:
 * - the full gloss ("was (neuter)")
 * - the gloss without parenthetical notes ("was")
 * - each slash alternative ("in / to / at" -> "in", "to", "at")
 *
 * Short slash alternatives (under 3 letters) are only used for the TARGET
 * word: its example sentence was written for it, so "to"/"in"/"at" really
 * mean it there. For already-known words in other cards' sentences they are
 * skipped, since e.g. infinitive "to" ("to know") is not the preposition "to".
 */
function glossCandidates(gloss: string, includeShortParts: boolean): string[] {
  const out: string[] = [];
  const full = gloss.trim();
  if (!full) return out;
  out.push(full);
  const deParen = stripParens(full);
  if (deParen && deParen !== full && !out.includes(deParen)) out.push(deParen);
  // Bare infinitive: gloss "to calm down" should also match "calm down"
  // (as in "You may calm down").
  const toMatch = full.match(/^to\s+(.+)$/i);
  if (toMatch) {
    const bare = stripParens(toMatch[1].trim());
    if (bare && !out.includes(bare)) out.push(bare);
  }
  if (full.includes('/')) {
    for (const part of full.split('/')) {
      const p = stripParens(part);
      if (p && !out.includes(p) && (includeShortParts || p.length >= 3)) out.push(p);
    }
  }
  return out.sort((a, b) => b.length - a.length);
}

function replaceWholeWord(text: string, search: string, replacement: string): string {
  const query = search.trim();
  if (!query) return text;
  const pattern = new RegExp(`\\b${escapeRegExp(query)}\\b`, 'gi');
  return text.replace(pattern, (match) => {
    const first = match[0] ?? '';
    // Keep sentence capitalization: "Book" -> "Книга".
    if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

/**
 * Build the face-2 hint. Priority order:
 *
 * 1. Authored hint (stored on the example): guaranteed sensible with the
 *    target word already in Russian. Known-word substitution still applies
 *    on top, so hints get progressively more Russian.
 * 2. Derived from the English translation: the target word — plus every
 *    already-known word — is swapped back into Russian.
 * 3. Fallback "lemma — translation": used when the target word appears
 *    nowhere in the translation, so the face always contains the Russian
 *    word instead of unexplained English.
 */
export function buildHintPhrase(
  lemma: string,
  gloss: string,
  translation: string,
  knownWords: KnownWord[],
  authoredHint = '',
): string {
  const russian = primaryForm(lemma);
  const known = [...knownWords].sort((a, b) => b.gloss.length - a.gloss.length);
  const applyKnownSubs = (text: string): string => {
    let out = text;
    for (const sub of known) {
      // Skip the target itself here: it is handled permissively below.
      if (sub.lemma === lemma && sub.gloss === gloss) continue;
      for (const candidate of glossCandidates(sub.gloss, false)) {
        out = replaceWholeWord(out, candidate, primaryForm(sub.lemma));
      }
    }
    return out;
  };

  if (authoredHint.trim()) return applyKnownSubs(authoredHint.trim());

  const base = translation.trim() || gloss;
  if (!base) return russian;
  let text = base;
  for (const candidate of glossCandidates(gloss, true)) {
    text = replaceWholeWord(text, candidate, russian);
  }
  if (text === base) {
    // Already Russian in there (e.g. a mixed translation): keep it.
    if (base.includes(russian)) return applyKnownSubs(text);
    return `${russian} — ${base}`;
  }
  return applyKnownSubs(text);
}
