import * as Speech from 'expo-speech';

// Cached lookup of a Russian system voice so words are pronounced with
// Russian phonetics instead of the device default voice.
let russianVoicePromise: Promise<string | undefined> | null = null;

function getRussianVoice(): Promise<string | undefined> {
  if (!russianVoicePromise) {
    russianVoicePromise = Speech.getAvailableVoicesAsync().then(
      (voices) => voices.find((v) => v.language.toLowerCase().startsWith('ru'))?.identifier,
      () => undefined,
    );
  }
  return russianVoicePromise;
}

export async function speakRussian(
  text: string,
  onDone?: () => void,
  onStart?: () => void,
): Promise<void> {
  if (!text.trim()) return;
  await Speech.stop();
  const voice = await getRussianVoice();
  Speech.speak(text, {
    language: 'ru',
    ...(voice ? { voice } : {}),
    ...(onDone ? { onDone } : {}),
    ...(onStart ? { onStart } : {}),
  });
}

export function stopSpeech(): void {
  void Speech.stop();
}

let englishVoicePromise: Promise<string | undefined> | null = null;

function getEnglishVoice(): Promise<string | undefined> {
  if (!englishVoicePromise) {
    englishVoicePromise = Speech.getAvailableVoicesAsync().then(
      (voices) => voices.find((v) => v.language.toLowerCase().startsWith('en'))?.identifier,
      () => undefined,
    );
  }
  return englishVoicePromise;
}

export async function speakEnglish(
  text: string,
  onDone?: () => void,
  onStart?: () => void,
): Promise<void> {
  if (!text.trim()) return;
  await Speech.stop();
  const voice = await getEnglishVoice();
  Speech.speak(text.trim(), {
    language: 'en',
    ...(voice ? { voice } : {}),
    ...(onDone ? { onDone } : {}),
    ...(onStart ? { onStart } : {}),
  });
}

/**
 * What TTS should say for a gloss: first slash-variant, no parenthetical
 * notes. "in / to / at" -> "in", "was (neuter)" -> "was".
 */
export function toSpokenEnglish(gloss: string): string {
  const first = gloss.split('/')[0] ?? '';
  return first
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

type ScriptSegment = { text: string; lang: 'ru' | 'en' };

/**
 * Split mixed text into maximal same-script runs (Cyrillic vs Latin),
 * carrying the punctuation/spaces between words along. Non-letter
 * prefixes attach to the run that follows; anything else is dropped
 * when it holds no speakable text.
 */
export function splitByScript(text: string): ScriptSegment[] {
  const out: ScriptSegment[] = [];
  let cur: ScriptSegment | null = null;
  const push = (seg: ScriptSegment) => {
    if (cur && cur.lang === seg.lang) {
      cur.text += seg.text;
    } else {
      if (cur) out.push(cur);
      cur = seg;
    }
  };
  const wordRe = /[А-Яа-яЁё]+|[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(text)) !== null) {
    if (match.index > lastEnd) {
      const gap = text.slice(lastEnd, match.index);
      if (cur) cur.text += gap;
      else cur = { text: gap, lang: 'ru' };
    }
    const word = match[0];
    const lang = /[А-Яа-яЁё]/.test(word[0] ?? '') ? 'ru' : 'en';
    push({ text: word, lang });
    lastEnd = match.index + word.length;
  }
  if (lastEnd < text.length && cur) cur.text += text.slice(lastEnd);
  if (cur) out.push(cur);
  return out.filter((seg) => seg.text.trim());
}

export type MixedPlayback = { stop: () => void };

// Generation counter: starting a new playback (or stop) invalidates any
// chained onDone still in flight, so utterances never overlap.
let mixedGeneration = 0;

/**
 * Speak mixed Russian/English text, switching voices at script
 * boundaries: Cyrillic runs use the Russian voice, Latin runs English.
 * Chained via onDone (expo-speech has no queue); stop() halts the chain.
 */
export function speakMixed(text: string, opts?: { onDone?: () => void }): MixedPlayback {
  const generation = ++mixedGeneration;
  const segments = splitByScript(text);
  void Speech.stop();

  const step = async (index: number): Promise<void> => {
    if (generation !== mixedGeneration) return;
    if (index >= segments.length) {
      opts?.onDone?.();
      return;
    }
    const seg = segments[index];
    const voice = seg.lang === 'ru' ? await getRussianVoice() : await getEnglishVoice();
    if (generation !== mixedGeneration) return;
    Speech.speak(seg.text, {
      language: seg.lang,
      ...(voice ? { voice } : {}),
      onDone: () => void step(index + 1),
      onStopped: () => {},
      onError: () => void step(index + 1),
    });
  };
  void step(0);

  return {
    stop: () => {
      if (generation === mixedGeneration) {
        mixedGeneration += 1;
        void Speech.stop();
      }
    },
  };
}
