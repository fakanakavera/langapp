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
}): Promise<ExampleGeneration[]> {
  const extras = input.knownLemmas.filter((lemma) => lemma !== input.lemma).slice(0, 3);
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
