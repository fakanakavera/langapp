import { lookupForm } from '@/db/queries';
import { normalizeRussian } from '@/morphology/dictionary';

export type MorphologyMatch = {
  entryId: string;
  lemma: string;
  gloss: string;
  pos: string;
  tags: string;
  matchedForm: string;
};

export async function analyzeRussian(input: string): Promise<MorphologyMatch[]> {
  const normalized = normalizeRussian(input);
  if (!normalized) return [];

  const rows = await lookupForm(normalized);
  return rows.map((row) => ({
    entryId: row.id,
    lemma: row.lemma,
    gloss: row.gloss,
    pos: row.pos,
    tags: row.tags,
    matchedForm: row.matched_form,
  }));
}
