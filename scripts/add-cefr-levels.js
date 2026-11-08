/**
 * add-cefr-levels.js
 *
 * Pre-processes the 10 beginner deck JSON backup files downloaded from
 * C:\Users\fakan\Downloads\*.json, adding `cefr_level: "A1"` to every card.
 *
 * All of these files come from the "Русский с нуля — ..." beginner core
 * vocabulary (split from a 1000-word deck by part of speech), so every word
 * in them is A1-level. When imported into the app through the existing
 * import flow (Import as new deck / Import into this deck), the CEFR level
 * will be stored on each card and the unlock scheduler will order cards by
 * CEFR level first (A1 before A2 before B1 ...), then by unlock_order.
 *
 * Usage:
 *   cd C:\Users\fakan\Downloads\langapp
 *   node scripts/add-cefr-levels.js
 *
 * The script reads each source file from C:\Users\fakan\Downloads\ and
 * writes an updated copy next to it with a "-with-cefr" suffix.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';

const SOURCE_DIR = 'C:\\Users\\fakan\\Downloads';
const FILES = [
  'adj-adjectives.json',
  'adv-adverbs.json',
  'conj-conjunctions.json',
  'interj-interjections.json',
  'noun-nouns.json',
  'num-numbers.json',
  'particle-particles.json',
  'prep-prepositions.json',
  'pron-pronouns.json',
  'verb-verbs.json',
];

const CEFR_LEVEL = 'A1';

function addCefrLevel(payload) {
  for (const card of payload.cards) {
    card.cefr_level = CEFR_LEVEL;
  }
  return payload;
}

async function main() {
  let totalCards = 0;
  let totalFiles = 0;

  for (const fileName of FILES) {
    const sourcePath = `${SOURCE_DIR}\\${fileName}`;
    let raw;
    try {
      raw = await readFile(sourcePath, 'utf8');
    } catch (err) {
      console.error(`❌  ${fileName}: not found or unreadable — ${err.message}`);
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      console.error(`❌  ${fileName}: invalid JSON — ${err.message}`);
      continue;
    }

    if (
      !payload.version ||
      !Array.isArray(payload.decks) ||
      !Array.isArray(payload.cards)
    ) {
      console.error(`❌  ${fileName}: not a Langapp v1 backup payload`);
      continue;
    }

    const deckName = payload.decks[0]?.name ?? '(unnamed deck)';
    const beforeCount = payload.cards.length;

    addCefrLevel(payload);
    totalCards += payload.cards.length;
    totalFiles += 1;

    // Also tag the deck description so it's clear these are A1 cards.
    for (const deck of payload.decks) {
      if (!deck.description.includes('CEFR')) {
        deck.description += ` | CEFR: ${CEFR_LEVEL}`;
      }
    }

    const outPath = `${SOURCE_DIR}\\${fileName.replace('.json', `-cefr${CEFR_LEVEL.toLowerCase()}.json`)}`;
    await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(
      `✅  ${fileName} → ${outPath.split('\\').pop()} | deck: "${deckName}" | cards: ${beforeCount} (all set to ${CEFR_LEVEL})`,
    );
  }

  console.log(`\nDone: ${totalFiles} file(s), ${totalCards} card(s) marked as ${CEFR_LEVEL}.`);
  console.log('\nNext step: open the app, go to Decks → Create deck (or open an existing deck),');
  console.log('then use "Import as new deck" / "Import into this deck" and pick each');
  console.log('`-cefra1.json` file. Cards will unlock in CEFR order (A1 first).');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
