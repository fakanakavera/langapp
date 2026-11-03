import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  dumpBackup,
  deckNameExists,
  dumpDeckBackup,
  importDeckPayload,
  listStudyingCards,
} from '@/db/queries';
import type { BackupPayload } from '@/db/types';
import { csvToBackupPayload, parseCsvRecords } from '@/lib/csv-import';
import { nowIso } from '@/lib/dates';

function isBackupPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as BackupPayload;
  return (
    payload.version === 1 &&
    Array.isArray(payload.decks) &&
    Array.isArray(payload.entries) &&
    Array.isArray(payload.inflections) &&
    Array.isArray(payload.cards) &&
    Array.isArray(payload.reviews) &&
    Array.isArray(payload.examples)
  );
}

export async function exportBackup(): Promise<void> {
  const payload = await dumpBackup();
  const filename = `langapp-backup-${payload.exportedAt.slice(0, 10)}.json`;
  const file = new File(Paths.cache, filename);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(JSON.stringify(payload, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Export Langapp backup',
    });
    return;
  }

  throw new Error('Sharing is not available on this device.');
}

/** Export one deck (not everything) as a v1 JSON file via the share sheet. */
export async function exportDeckBackup(deckId: string): Promise<void> {
  const payload = await dumpDeckBackup(deckId);
  const safeName = (payload.decks[0]?.name ?? 'deck').replace(/[^\p{L}\p{N}._-]+/gu, '_');
  const filename = `langapp-deck-${safeName}-${payload.exportedAt.slice(0, 10)}.json`;
  const file = new File(Paths.cache, filename);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(JSON.stringify(payload, null, 2));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: `Export deck "${payload.decks[0]?.name ?? ''}"`,
    });
    return;
  }

  throw new Error('Sharing is not available on this device.');
}

/**
 * Merge-import a file into a NEW deck, keeping existing decks untouched.
 * Accepts Langapp JSON backups and two-column ("Front","Back") CSV files.
 * The name is validated (non-empty, unused) before the file picker opens.
 * Returns null when the user cancels file selection.
 */
export async function importDeckFile(
  deckName: string,
): Promise<
  { deckName: string; entries: number; cards: number; studying: number; skipped: number } | null
> {
  const name = deckName.trim();
  if (!name) {
    throw new Error('Name the new deck first.');
  }
  if (await deckNameExists(name)) {
    throw new Error(`A deck named "${name}" already exists.`);
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/csv', '.csv'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return null;

  const file = new File(result.assets[0].uri);
  const text = await file.text();
  const fileName = result.assets[0].name ?? '';
  const looksCsv =
    fileName.toLowerCase().endsWith('.csv') || /^\s*"Front"\s*,/i.test(text.slice(0, 100));

  let parsed: BackupPayload;
  let skipped = 0;
  if (looksCsv) {
    const { rows, skipped: unparsed } = parseCsvRecords(text);
    if (rows.length === 0) {
      throw new Error('No Front/Back rows found in this CSV.');
    }
    const converted = csvToBackupPayload(rows, nowIso());
    parsed = converted.payload;
    skipped = unparsed + converted.dropped;
    if (parsed.entries.length === 0) {
      throw new Error(
        `Could not read any words from this CSV${skipped ? ` (${skipped} rows skipped)` : ''}.`,
      );
    }
  } else {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        'This file is not valid JSON — it may be incomplete or cut off. ' +
          'Ask for the file again in smaller parts.',
      );
    }
    if (!isBackupPayload(json)) {
      throw new Error('This file is not a Langapp v1 backup.');
    }
    parsed = json;
  }
  const { deck, entries, cards } = await importDeckPayload(parsed, name);
  const studying = await listStudyingCards(deck.id);
  return { deckName: deck.name, entries, cards, studying: studying.length, skipped };
}
