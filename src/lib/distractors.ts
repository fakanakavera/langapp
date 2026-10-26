import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { FoundationModels as FoundationModelsType, JSONSchema } from 'expo-foundation-models';

export type DistractorCandidate = {
  lemma: string;
  gloss: string;
  pos: string;
};

/**
 * The Apple-AI package is loaded lazily (dynamic import) so Expo Go never
 * evaluates its native module — importing it statically logs a missing
 * native module error there. On iOS dev builds the real module loads.
 */
let foundationModelsPromise: Promise<typeof FoundationModelsType | null> | null = null;

function getFoundationModels(): Promise<typeof FoundationModelsType | null> {
  if (Platform.OS !== 'ios') return Promise.resolve(null);
  // Expo Go has no native module: don't even load the package (loading it
  // logs a missing-native-module error). Dev builds attempt the real load.
  if (Constants.appOwnership === 'expo') return Promise.resolve(null);
  if (!foundationModelsPromise) {
    foundationModelsPromise = import('expo-foundation-models').then(
      (mod) => mod.FoundationModels ?? null,
      () => null,
    );
  }
  return foundationModelsPromise;
}

/** Open one shared AI session for a quiz, or null when AI is unavailable. */
export async function createAiSession(
  instructions = 'You build multiple-choice vocabulary quizzes. Follow instructions exactly.',
): Promise<string | null> {
  try {
    const fm = await withTimeout(getFoundationModels(), 5000, 'ai load');
    if (!fm || !fm.isAvailable()) return null;
    return await withTimeout(fm.createSession(instructions), 10000, 'ai session');
  } catch {
    // Expo Go, missing module, or model not ready: offline pool instead.
    return null;
  }
}

export async function closeAiSession(sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  try {
    const fm = await getFoundationModels();
    await fm?.closeSession(sessionId);
  } catch {
    // Session cleanup is best-effort.
  }
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sameWord(a: DistractorCandidate, b: DistractorCandidate): boolean {
  return a.lemma === b.lemma || a.gloss.toLowerCase() === b.gloss.toLowerCase();
}

/**
 * Instant offline fallback: prefer the same part of speech (pronouns with
 * pronouns, prepositions with prepositions — the confusable kind), then
 * anything else from the deck.
 */
export function deterministicDistractors(
  target: DistractorCandidate,
  candidates: DistractorCandidate[],
  count: number,
): DistractorCandidate[] {
  // Drop same-word entries AND duplicate option texts ("ты"/"вы" are both
  // "you" — rendering both would duplicate buttons and React keys).
  const seen = new Set<string>();
  const pool = candidates.filter((c) => {
    if (sameWord(c, target)) return false;
    const key = c.gloss.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const samePos = target.pos ? pool.filter((c) => c.pos && c.pos === target.pos) : [];
  const rest = pool.filter((c) => !samePos.includes(c));
  return [...shuffle(samePos), ...shuffle(rest)].slice(0, Math.max(0, count));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const PICKS_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    picks: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
  },
  required: ['picks'],
};

/**
 * Pick 3 confusable wrong answers for a multiple-choice question.
 *
 * Tries the iPhone's on-device Apple Intelligence model (picks from a
 * shortlist of same-category deck words); falls back to the instant
 * offline same-POS picker when AI is unavailable, slow, or rejects.
 * Never throws — always returns usable glosses (possibly fewer than 3
 * when the deck is tiny).
 */
export async function pickDistractorGlosses(
  target: DistractorCandidate,
  candidates: DistractorCandidate[],
  sessionId: string | null,
): Promise<{ glosses: string[]; aiUsed: boolean }> {
  const fallback = (): { glosses: string[]; aiUsed: boolean } => ({
    glosses: deterministicDistractors(target, candidates, 3).map((c) => c.gloss),
    aiUsed: false,
  });

  const pool = shuffle(candidates.filter((c) => !sameWord(c, target))).slice(0, 12);
  // Nothing for AI to choose between: use the whole pool as-is.
  if (pool.length < 4 || !sessionId) return fallback();

  try {
    const fm = await getFoundationModels();
    if (!fm || !fm.isAvailable()) return fallback();
    const prompt =
      `Russian word "${target.lemma}" means "${target.gloss}" in English.\n` +
      `From this list, pick the 3 most easily confused alternatives (same kind of word):\n` +
      pool.map((c) => `- ${c.gloss}`).join('\n');
    const result = await withTimeout(
      fm.respondWithSchema<{ picks: unknown }>(sessionId, prompt, PICKS_SCHEMA),
      20000,
      'distractor pick',
    );
    const raw = (result as { picks?: unknown } | null)?.picks;
    const matched: string[] = [];
    if (Array.isArray(raw)) {
      for (const pick of raw) {
        if (typeof pick !== 'string') continue;
        const hit = pool.find((c) => c.gloss.toLowerCase() === pick.trim().toLowerCase());
        if (
          hit &&
          hit.gloss.toLowerCase() !== target.gloss.toLowerCase() &&
          !matched.includes(hit.gloss)
        ) {
          matched.push(hit.gloss);
        }
        if (matched.length >= 3) break;
      }
    }
    // Fill any shortfall deterministically so we always return 3 when able.
    for (const c of deterministicDistractors(target, candidates, 10)) {
      if (matched.length >= 3) break;
      if (!matched.includes(c.gloss)) matched.push(c.gloss);
    }
    if (matched.length === 0) return fallback();
    return { glosses: matched, aiUsed: true };
  } catch {
    // AI unavailable, timed out, or rejected: offline fallback.
    return fallback();
  }
}
