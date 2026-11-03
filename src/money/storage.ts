import { getDb } from '@/db/client';
import { createId } from '@/lib/id';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyPreferences,
  MoneySubcategory,
  MoneyTransaction,
  RecurringFrequency,
  RecurringRule,
  TransactionType,
} from '@/money/types';

const DEFAULT_CATEGORIES: Record<TransactionType, string[]> = {
  expense: ['Housing', 'Groceries', 'Transport', 'Dining', 'Bills', 'Health', 'Shopping', 'Other'],
  income: ['Salary', 'Freelance', 'Gift', 'Other'],
};

export async function initializeMoneyTracker(): Promise<void> {
  const db = getDb();
  const defaultsSeeded = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM money_settings WHERE key = 'defaults_seeded'",
  );
  if (!defaultsSeeded) {
    await db.withTransactionAsync(async () => {
      for (const type of ['expense', 'income'] as const) {
        for (const name of DEFAULT_CATEGORIES[type]) {
          await db.runAsync(
            'INSERT OR IGNORE INTO money_categories (id, type, name, created_at) VALUES (?, ?, ?, ?)',
            createId(),
            type,
            name,
            new Date().toISOString(),
          );
        }
      }
      await db.runAsync(
        "INSERT OR REPLACE INTO money_settings (key, value) VALUES ('defaults_seeded', 'true')",
      );
    });
  }
  await db.runAsync(
    "INSERT OR IGNORE INTO money_settings (key, value) VALUES ('currency', 'JPY')",
  );
  await db.runAsync(
    "INSERT OR IGNORE INTO money_settings (key, value) VALUES ('period_start_day', '1')",
  );
}

export async function loadMoneyData(
  from: string,
  to: string,
): Promise<{
  categories: MoneyCategory[];
  subcategories: MoneySubcategory[];
  transactions: MoneyTransaction[];
  recurring: RecurringRule[];
  budgets: MoneyBudget[];
  preferences: MoneyPreferences;
}> {
  const db = getDb();
  const [categories, subcategories, transactions, recurring, budgets, settings] = await Promise.all([
    db.getAllAsync<MoneyCategory>(
      'SELECT id, type, name FROM money_categories ORDER BY type, name COLLATE NOCASE',
    ),
    db.getAllAsync<MoneySubcategory>(
      'SELECT id, category_id, name, amount_minor FROM money_subcategories ORDER BY category_id, name COLLATE NOCASE',
    ),
    db.getAllAsync<MoneyTransaction>(
      `SELECT t.id, t.type, t.category_id, t.subcategory_id, c.name AS category_name,
              s.name AS subcategory_name, t.amount_minor, t.quantity,
              t.description, t.occurred_at
       FROM money_transactions t
       LEFT JOIN money_categories c ON c.id = t.category_id
       LEFT JOIN money_subcategories s ON s.id = t.subcategory_id
       WHERE t.occurred_at >= ? AND t.occurred_at <= ?
       ORDER BY t.occurred_at DESC, t.created_at DESC`,
      from,
      `${to}T23:59:59.999`,
    ),
    db.getAllAsync<RecurringRule>(
      `SELECT r.id, r.type, r.category_id, c.name AS category_name, r.amount_minor,
              r.description, r.frequency, r.day_of_month, r.interval_days, r.weekday,
              r.start_date, r.end_date
       FROM money_recurring r
       LEFT JOIN money_categories c ON c.id = r.category_id`,
    ),
    db.getAllAsync<MoneyBudget>(
      'SELECT id, category_id, amount_minor FROM money_budgets ORDER BY category_id',
    ),
    db.getAllAsync<{ key: string; value: string }>(
      "SELECT key, value FROM money_settings WHERE key IN ('currency', 'period_start_day')",
    ),
  ]);
  const values = new Map(settings.map(({ key, value }) => [key, value]));
  return {
    categories,
    subcategories,
    transactions,
    recurring,
    budgets,
    preferences: {
      currency: values.get('currency') ?? 'JPY',
      periodStartDay: Math.min(31, Math.max(1, Number(values.get('period_start_day') ?? 1))),
    },
  };
}

export async function saveTransaction(input: {
  type: TransactionType;
  categoryId: string | null;
  subcategoryId: string | null;
  amountMinor: number;
  quantity: number;
  description: string;
  occurredAt: string;
}): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO money_transactions
      (id, type, category_id, subcategory_id, amount_minor, quantity, description, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    createId(),
    input.type,
    input.categoryId,
    input.subcategoryId,
    input.amountMinor,
    input.quantity,
    input.description.trim(),
    input.occurredAt,
    new Date().toISOString(),
  );
}

export async function saveRecurringRule(input: {
  type: TransactionType;
  categoryId: string | null;
  amountMinor: number;
  description: string;
  frequency: RecurringFrequency;
  dayOfMonth: number | null;
  intervalDays: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
}): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO money_recurring
      (id, type, category_id, amount_minor, description, frequency, day_of_month,
       interval_days, weekday, start_date, end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    createId(),
    input.type,
    input.categoryId,
    input.amountMinor,
    input.description.trim(),
    input.frequency,
    input.dayOfMonth,
    input.intervalDays,
    input.weekday,
    input.startDate,
    input.endDate,
  );
}

export async function deleteRecurringRule(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM money_recurring WHERE id = ?', id);
}

export async function saveCategory(type: TransactionType, name: string, id?: string): Promise<void> {
  const db = getDb();
  const cleanName = name.trim();
  if (id) {
    await db.runAsync('UPDATE money_categories SET name = ? WHERE id = ?', cleanName, id);
  } else {
    await db.runAsync(
      'INSERT INTO money_categories (id, type, name, created_at) VALUES (?, ?, ?, ?)',
      createId(),
      type,
      cleanName,
      new Date().toISOString(),
    );
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM money_budgets WHERE category_id = ?', id);
    await db.runAsync('DELETE FROM money_categories WHERE id = ?', id);
  });
}

export async function saveBudget(categoryId: string, amountMinor: number): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO money_budgets (id, category_id, amount_minor) VALUES (?, ?, ?)
     ON CONFLICT(category_id) DO UPDATE SET amount_minor = excluded.amount_minor`,
    createId(),
    categoryId,
    amountMinor,
  );
}

export async function saveMoneyPreference(
  key: 'currency' | 'period_start_day',
  value: string,
): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO money_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

export async function saveSubcategory(input: {
  categoryId: string;
  name: string;
  amountMinor: number | null;
  id?: string;
}): Promise<void> {
  const db = getDb();
  const cleanName = input.name.trim();
  if (input.id) {
    await db.runAsync(
      'UPDATE money_subcategories SET name = ?, amount_minor = ? WHERE id = ?',
      cleanName,
      input.amountMinor,
      input.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO money_subcategories (id, category_id, name, amount_minor, created_at) VALUES (?, ?, ?, ?, ?)',
      createId(),
      input.categoryId,
      cleanName,
      input.amountMinor,
      new Date().toISOString(),
    );
  }
}

export async function deleteSubcategory(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM money_subcategories WHERE id = ?', id);
}
