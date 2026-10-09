import * as SQLite from 'expo-sqlite';

import { SCHEMA_SQL } from '@/db/schema';
import { seedIfNeeded } from '@/db/seed';

let database: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync('langapp.db');
    await db.execAsync(SCHEMA_SQL);
    await seedIfNeeded(db);
    database = db;
    return db;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!database) {
    throw new Error('Database is not ready yet.');
  }
  return database;
}
