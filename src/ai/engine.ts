import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { JSONSchema } from 'expo-foundation-models';

export type AiStatus = {
  available: boolean;
  backend: 'stub' | 'llama.cpp';
  model: string | null;
  reason: string;
};

export type ExampleGeneration = {
  text: string;
  translation: string;
};

/**
 * Local inference is intentionally stubbed for Expo Go.
 * llama.cpp (via a React Native binding such as llama.rn) and a small
 * quantized Qwen instruct GGUF will be wired in a custom development build.
 */
export function getAiStatus(): AiStatus {
  return {
    available: false,
    backend: 'stub',
    model: null,
    reason:
      'On-device Qwen via llama.cpp needs a custom development build. Expo Go cannot load that native module.',
  };
}

export async function generateExamplePhrases(input: {
  lemma: string;
  gloss: string;
  knownLemmas: string[];
}): Promise<ExampleGeneration[]> {  const extras = input.knownLemmas.filter((lemma) => lemma !== input.lemma).slice(0, 3);
  const withKnown = extras.length
    ? ` ${extras.join(', ')}`
    : '';

  return [
    {
      text: `Я вижу ${input.lemma}.`,
      translation: `I see ${input.gloss}.`,
    },
    {
      text: `Это ${input.lemma}.`,
      translation: `This is ${input.gloss}.`,
    },
    {
      text: extras.length
        ? `Сегодня я учу слово «${input.lemma}» вместе с:${withKnown}.`
        : `Сегодня я учу слово «${input.lemma}».`,
      translation: extras.length
        ? `Today I am learning the word “${input.lemma}” together with:${withKnown}.`
        : `Today I am learning the word “${input.lemma}”.`,
    },
  ];
}

const READING_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    phrases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Russian sentence using the word' },
          translation: { type: 'string', description: 'English translation' },
        },
        required: ['text', 'translation'],
      },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ['phrases'],
};

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('AI generation timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Ask the iPhone's on-device Apple Intelligence model for fresh beginner
 * sentences using a word. Returns null when AI is unavailable (Expo Go,
 * unsupported device, model not ready), fails, or times out — callers fall
 * back to stored examples. Never throws.
 */
export async function generateReadingPhrases(
  input: {
    lemma: string;
    gloss: string;
    knownLemmas: string[];
  },
  sessionId: string | null,
): Promise<ExampleGeneration[] | null> {
  if (Platform.OS !== 'ios' || !sessionId) return null;
  // Expo Go has no native module: don't even load the package.
  if (Constants.appOwnership === 'expo') return null;
  try {
    const { FoundationModels } = await import('expo-foundation-models');
    if (!FoundationModels.isAvailable()) return null;
    const known = input.knownLemmas.filter((l) => l !== input.lemma).slice(0, 20);
    const prompt =
      `Write 2 short beginner Russian sentences using the word "${input.lemma}" ` +
      `(it means "${input.gloss}" in English). Use only simple everyday words` +
      `${known.length ? ` the reader already knows: ${known.join(', ')}` : ''}. ` +
      `Reply with each sentence and its English translation.`;
    const result = await raceTimeout(
      FoundationModels.respondWithSchema<{ phrases: unknown }>(sessionId, prompt, READING_SCHEMA),
      30000,
    );
    const raw = (result as { phrases?: unknown } | null)?.phrases;
    if (!Array.isArray(raw)) return null;
    const out: ExampleGeneration[] = [];
    for (const item of raw) {
      const record = item as { text?: unknown; translation?: unknown } | null;
      if (record && typeof record.text === 'string' && record.text.trim()) {
        out.push({
          text: record.text.trim(),
          translation: typeof record.translation === 'string' ? record.translation.trim() : '',
        });
      }
      if (out.length >= 3) break;
    }
    return out.length > 0 ? out : null;
  } catch {
    // Model unavailable, refused, or timed out: caller uses stored examples.
    return null;
  }
}
