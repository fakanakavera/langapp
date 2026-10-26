import { RU_STARTER_DICTIONARY } from '@/morphology/dictionary';
import type { CaseInflection } from '@/db/queries';

export type CaseKey = 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'prep';
export type CaseNumber = 'sg' | 'pl';

export const CASES: { key: CaseKey; ru: string; en: string; hint: string; preps: string }[] = [
  { key: 'nom', ru: 'именительный', en: 'nominative', hint: 'who? what? (subject)', preps: '—' },
  { key: 'gen', ru: 'родительный', en: 'genitive', hint: 'of / from', preps: 'без · у · из · до · для' },
  { key: 'dat', ru: 'дательный', en: 'dative', hint: 'to / for', preps: 'к · по' },
  { key: 'acc', ru: 'винительный', en: 'accusative', hint: 'direct object / into', preps: 'в · на · за · про' },
  { key: 'ins', ru: 'творительный', en: 'instrumental', hint: 'with / by', preps: 'с · за · под · над' },
  { key: 'prep', ru: 'предложный', en: 'prepositional', hint: 'about / in (location)', preps: 'в · на · о' },
];

export function caseMeta(key: CaseKey) {
  return CASES.find((c) => c.key === key) ?? CASES[0];
}

const CASE_TOKENS: Record<string, CaseKey> = {
  nom: 'nom',
  gen: 'gen',
  dat: 'dat',
  acc: 'acc',
  ins: 'ins',
  prep: 'prep',
  pre: 'prep',
  loc: 'prep',
};

/** Split a tags string like "gen;sg / nom;pl" or "dat/prep;sg" into cases + number. */
export function parseTags(tags: string): { cases: CaseKey[]; number: CaseNumber } {
  const lower = tags.toLowerCase();
  const number: CaseNumber = lower.includes('pl') ? 'pl' : 'sg';
  const cases: CaseKey[] = [];
  for (const part of lower.split(/[^a-z]+/)) {
    const key = CASE_TOKENS[part];
    if (key && !cases.includes(key)) cases.push(key);
  }
  return { cases, number };
}

export type CaseSlot = {
  case: CaseKey;
  number: CaseNumber;
  forms: string[];
};

const TRAINABLE_POS = new Set(['noun', 'pronoun', 'adjective', 'adj', '']);

export function isCasePos(pos: string): boolean {
  return TRAINABLE_POS.has(pos.trim().toLowerCase());
}

/** Group one lemma's inflections into per-case slots (deduped forms). */
export function groupFormsByCase(rows: CaseInflection[]): CaseSlot[] {
  const slots = new Map<string, CaseSlot>();
  for (const row of rows) {
    const form = row.form.trim();
    if (!form) continue;
    const { cases, number } = parseTags(row.tags);
    for (const c of cases) {
      const key = `${c}:${number}`;
      const slot = slots.get(key) ?? { case: c, number, forms: [] as string[] };
      if (!slot.forms.includes(form)) slot.forms.push(form);
      slots.set(key, slot);
    }
  }
  return [...slots.values()];
}

export type CaseQuestion = {
  entryId: string;
  lemma: string;
  gloss: string;
  targetCase: CaseKey;
  number: CaseNumber;
  correctForm: string;
  options: string[];
};

/**
 * Build one multiple-choice question for a lemma: the correct form for the
 * target case plus other cases of the SAME word as distractors. This forces
 * case distinctions instead of vocabulary recall.
 */
export function buildCaseQuestion(
  entryId: string,
  lemma: string,
  gloss: string,
  slots: CaseSlot[],
  rand: () => number = Math.random,
): CaseQuestion | null {
  const usable = slots.filter((s) => s.forms.length > 0);
  if (usable.length < 2) return null;
  // Prefer slots whose first form differs from the lemma spelling so the
  // question is not trivially "pick the dictionary form".
  const ordered = [...usable].sort(() => rand() - 0.5);
  for (const target of ordered) {
    const correctForm = target.forms[Math.floor(rand() * target.forms.length)];
    const distractors: string[] = [];
    for (const other of usable) {
      if (other.case === target.case && other.number === target.number) continue;
      for (const form of other.forms) {
        if (form !== correctForm && !distractors.includes(form)) distractors.push(form);
      }
    }
    if (distractors.length < 2) continue;
    const picked = distractors.sort(() => rand() - 0.5).slice(0, 3);
    const options = [...picked, correctForm].sort(() => rand() - 0.5);
    return {
      entryId,
      lemma,
      gloss,
      targetCase: target.case,
      number: target.number,
      correctForm,
      options,
    };
  }
  return null;
}

/** Starter-dictionary fallback so the trainer works with empty decks. */
export function starterCasePool(): CaseInflection[] {
  const out: CaseInflection[] = [];
  for (const lemma of RU_STARTER_DICTIONARY) {
    if (!isCasePos(lemma.pos)) continue;
    for (const form of lemma.forms) {
      const { cases } = parseTags(form.tags);
      if (cases.length === 0) continue;
      out.push({
        entry_id: `starter:${lemma.lemma}`,
        lemma: lemma.lemma,
        gloss: lemma.gloss,
        pos: lemma.pos,
        form: form.form,
        tags: form.tags,
      });
    }
  }
  return out;
}
