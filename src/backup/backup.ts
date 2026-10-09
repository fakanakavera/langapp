import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { dumpBackup, restoreBackup } from '@/db/queries';
import type { BackupPayload } from '@/db/types';

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

export async function importBackup(): Promise<boolean> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets[0]) return false;

  const file = new File(result.assets[0].uri);
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  if (!isBackupPayload(parsed)) {
    throw new Error('This file is not a Langapp v1 backup.');
  }
  await restoreBackup(parsed);
  return true;
}
