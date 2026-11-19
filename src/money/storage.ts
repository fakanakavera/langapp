import { getDb } from '@/db/client';
import { createId } from '@/lib/id';
import { getRecurringDates, localDateString, parseLocalDate } from '@/money/dates';
import type {
  MoneyBudget,
  MoneyCategory,
  MoneyPreferences,
  MoneySubcategory,
  MoneyTag,
  MoneyTransaction,
  RecurringFrequency,
  RecurringRule,
  TransactionType,
} from '@/money/types';

const ESTIMATE_TODO_PREFIX = 'money-estimate:';
const ESTIMATE_TODO_BACKFILL_KEY = 'estimate_calendar_todos_backfilled';

type EstimateTodoData = {
  id: string;
  type: TransactionType;
  category_name: string | null;
  subcategory_name: string | null;
  description: string;
  occurred_at: string;
};

async function saveEstimateCalendarTodo(
  estimate: EstimateTodoData,
): Promise<void> {
  const db = getDb();
  const label =
    estimate.description.trim() ||
    estimate.subcategory_name ||
    estimate.category_name ||
    (estimate.type === 'expense' ? 'Expense' : 'Income');
  const title = `${estimate.type === 'expense' ? 'Expense' : 'Income'} estimate: ${label}`;
  const description = `${estimate.type === 'expense' ? 'Expense' : 'Income'}${
    estimate.category_name ? ` · ${estimate.category_name}` : ''
  }`;
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO calendar_todos (
      id, title, description, due_date, due_time, is_completed,
      reminder_offset, recurrence_type, recurrence_end_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, 0, 0, 'none', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      due_date = excluded.due_date,
      updated_at = excluded.updated_at`,
    `${ESTIMATE_TODO_PREFIX}${estimate.id}`,
    title,
    description,
    estimate.occurred_at.slice(0, 10),
    now,
    now,
  );
}

async function syncEstimateCalendarTodo(
  id: string,
  createIfMissing: boolean,
): Promise<void> {
  const db = getDb();
  const estimate = await db.getFirstAsync<EstimateTodoData>(
    `SELECT t.id, t.type, c.name AS category_name,
            CASE WHEN i.id IS NULL THEN s.name ELSE i.name END AS subcategory_name,
            t.description, t.occurred_at
     FROM money_transactions t
     LEFT JOIN money_categories c ON c.id = t.category_id
     LEFT JOIN money_subcategories s ON s.id = t.subcategory_id
     LEFT JOIN money_items i ON i.id = s.item_id
     WHERE t.id = ? AND t.status = 'estimate' AND t.is_deleted = 0`,
    id,
  );
  if (!estimate) return;
  const todoId = `${ESTIMATE_TODO_PREFIX}${id}`;
  if (!createIfMissing) {
    const todo = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM calendar_todos WHERE id = ?',
      todoId,
    );
    if (!todo) return;
  }
  await saveEstimateCalendarTodo(estimate);
}

export async function ensureEstimateCalendarTodos(): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    const backfilled = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM money_settings WHERE key = ?',
      ESTIMATE_TODO_BACKFILL_KEY,
    );
    if (backfilled) return;
    const estimates = await db.getAllAsync<EstimateTodoData>(
      `SELECT t.id, t.type, c.name AS category_name,
              CASE WHEN i.id IS NULL THEN s.name ELSE i.name END AS subcategory_name,
              t.description, t.occurred_at
       FROM money_transactions t
       LEFT JOIN money_categories c ON c.id = t.category_id
       LEFT JOIN money_subcategories s ON s.id = t.subcategory_id
       LEFT JOIN money_items i ON i.id = s.item_id
       WHERE t.status = 'estimate' AND t.is_deleted = 0`,
    );
    for (const estimate of estimates) {
      await saveEstimateCalendarTodo(estimate);
    }
    await db.runAsync(
      'INSERT OR REPLACE INTO money_settings (key, value) VALUES (?, ?)',
      ESTIMATE_TODO_BACKFILL_KEY,
      'true',
    );
  });
}

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
  todayEstimateCount: number;
  tags: MoneyTag[];
  itemTags: Record<string, string[]>;
}> {
  const db = getDb();
  await materializeRecurringEstimates(from, to);
  await ensureEstimateCalendarTodos();
  const today = localDateString(new Date());
  if (today < from || today > to) {
    await materializeRecurringEstimates(today, today);
  }
  const [categories, subcategories, transactions, recurring, budgets, settings, tags, tagMappings] =
    await Promise.all([
    db.getAllAsync<MoneyCategory>(
      'SELECT id, type, name FROM money_categories ORDER BY type, name COLLATE NOCASE',
    ),
    db.getAllAsync<MoneySubcategory>(
      `SELECT s.id, s.category_id, s.item_id,
              CASE WHEN i.id IS NULL THEN s.name ELSE i.name END AS name,
              s.amount_minor, CASE WHEN i.id IS NULL THEN s.barcode ELSE i.barcode END AS barcode
       FROM money_subcategories s
       LEFT JOIN money_items i ON i.id = s.item_id
       ORDER BY s.category_id, name COLLATE NOCASE`,
    ),
    db.getAllAsync<MoneyTransaction>(
      `SELECT t.id, t.type, t.category_id, t.subcategory_id, c.name AS category_name,
              CASE WHEN i.id IS NULL THEN s.name ELSE i.name END AS subcategory_name,
              t.amount_minor, t.quantity,
              t.description, t.occurred_at, t.status, t.recurring_rule_id
       FROM money_transactions t
       LEFT JOIN money_categories c ON c.id = t.category_id
       LEFT JOIN money_subcategories s ON s.id = t.subcategory_id
       LEFT JOIN money_items i ON i.id = s.item_id
       WHERE t.is_deleted = 0 AND t.occurred_at >= ? AND t.occurred_at <= ?
       ORDER BY t.occurred_at DESC, t.created_at DESC`,
      from,
      `${to}T23:59:59.999`,
    ),
    db.getAllAsync<RecurringRule>(
      `SELECT r.id, r.type, r.category_id, r.subcategory_id, c.name AS category_name, r.amount_minor,
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
    db.getAllAsync<MoneyTag>('SELECT id, name FROM money_tags ORDER BY name COLLATE NOCASE'),
    db.getAllAsync<{ item_id: string; tag_id: string }>(
      'SELECT item_id, tag_id FROM money_item_tags',
    ),
  ]);
  const itemTags: Record<string, string[]> = {};
  for (const { item_id, tag_id } of tagMappings) {
    (itemTags[item_id] ??= []).push(tag_id);
  }
  const values = new Map(settings.map(({ key, value }) => [key, value]));
  return {
    categories,
    subcategories,
    transactions,
    recurring,
    budgets,
    tags,
    itemTags,
    preferences: {
      currency: values.get('currency') ?? 'JPY',
      periodStartDay: Math.min(31, Math.max(1, Number(values.get('period_start_day') ?? 1))),
    },
    todayEstimateCount: await countEstimatesForDate(today),
  };
}

export async function loadMoneyManagementData(): Promise<{
  categories: MoneyCategory[];
  subcategories: MoneySubcategory[];
  tags: MoneyTag[];
  itemTags: Record<string, string[]>;
  currency: string;
}> {
  const db = getDb();
  const [categories, subcategories, tags, mappings, currencySetting] = await Promise.all([
    db.getAllAsync<MoneyCategory>(
      'SELECT id, type, name FROM money_categories ORDER BY type, name COLLATE NOCASE',
    ),
    db.getAllAsync<MoneySubcategory>(
      `SELECT s.id, s.category_id, s.item_id,
              CASE WHEN i.id IS NULL THEN s.name ELSE i.name END AS name,
              s.amount_minor, CASE WHEN i.id IS NULL THEN s.barcode ELSE i.barcode END AS barcode
       FROM money_subcategories s
       LEFT JOIN money_items i ON i.id = s.item_id
       ORDER BY s.category_id, name COLLATE NOCASE`,
    ),
    db.getAllAsync<MoneyTag>('SELECT id, name FROM money_tags ORDER BY name COLLATE NOCASE'),
    db.getAllAsync<{ item_id: string; tag_id: string }>(
      'SELECT item_id, tag_id FROM money_item_tags',
    ),
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM money_settings WHERE key = 'currency'",
    ),
  ]);
  const itemTags: Record<string, string[]> = {};
  for (const { item_id, tag_id } of mappings) {
    (itemTags[item_id] ??= []).push(tag_id);
  }
  return { categories, subcategories, tags, itemTags, currency: currencySetting?.value ?? 'JPY' };
}

export async function loadMoneyStats(
  from: string,
  to: string,
  includeEstimates: boolean,
): Promise<MoneyTransaction[]> {
  const today = localDateString(new Date());
  if (includeEstimates && to >= today) {
    await materializeRecurringEstimates(from > today ? from : today, to);
  }
  const until = parseLocalDate(to);
  until.setDate(until.getDate() + 1);
  return getDb().getAllAsync<MoneyTransaction>(
    `SELECT t.id, t.type, t.category_id, t.subcategory_id, c.name AS category_name,
            CASE WHEN i.id IS NULL THEN s.name ELSE i.name END AS subcategory_name,
            t.amount_minor, t.quantity,
            t.description, t.occurred_at, t.status, t.recurring_rule_id
     FROM money_transactions t
     LEFT JOIN money_categories c ON c.id = t.category_id
     LEFT JOIN money_subcategories s ON s.id = t.subcategory_id
     LEFT JOIN money_items i ON i.id = s.item_id
     WHERE t.is_deleted = 0
       AND (
         t.status = 'valid'
         ${includeEstimates ? "OR (t.status = 'estimate' AND t.occurred_at >= ? AND t.occurred_at < ?)" : ''}
       )
     ORDER BY t.occurred_at DESC, t.created_at DESC`,
    ...(includeEstimates ? [from, localDateString(until)] : []),
  );
}

async function materializeRecurringEstimates(from: string, to: string): Promise<void> {
  const db = getDb();
  const rules = await db.getAllAsync<RecurringRule>(
    `SELECT id, type, category_id, subcategory_id, NULL AS category_name, amount_minor, description,
            frequency, day_of_month, interval_days, weekday, start_date, end_date
     FROM money_recurring`,
  );
  const createdAt = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const rule of rules) {
      for (const date of getRecurringDates(rule, parseLocalDate(from), parseLocalDate(to))) {
        const transactionId = createId();
        const inserted = await db.runAsync(
          `INSERT OR IGNORE INTO money_transactions
            (id, type, category_id, subcategory_id, amount_minor, quantity, description, occurred_at,
             status, recurring_rule_id, recurring_date, created_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'estimate', ?, ?, ?)`,
          transactionId,
          rule.type,
          rule.category_id,
          rule.subcategory_id,
          rule.amount_minor,
          rule.description,
          date,
          rule.id,
          date,
          createdAt,
        );
        if (inserted.changes === 1) {
          await syncEstimateCalendarTodo(transactionId, true);
        }
      }
    }
  });
}

export async function countEstimatesForDate(date: string): Promise<number> {
  const nextDate = parseLocalDate(date);
  nextDate.setDate(nextDate.getDate() + 1);
  const row = await getDb().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM money_transactions
     WHERE status = 'estimate' AND is_deleted = 0 AND occurred_at >= ? AND occurred_at < ?`,
    date,
    localDateString(nextDate),
  );
  return row?.count ?? 0;
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
      (id, type, category_id, subcategory_id, amount_minor, quantity, description, occurred_at,
       status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?)`,
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
  subcategoryId: string | null;
  amountMinor: number;
  description: string;
  frequency: RecurringFrequency;
  dayOfMonth: number | null;
  intervalDays: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
  quantity: number;
}): Promise<void> {
  const db = getDb();
  const id = createId();
  const createdAt = new Date().toISOString();
  const status = input.startDate > localDateString(new Date()) ? 'estimate' : 'valid';
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO money_recurring
        (id, type, category_id, subcategory_id, amount_minor, description, frequency, day_of_month,
         interval_days, weekday, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.type,
      input.categoryId,
      input.subcategoryId,
      input.amountMinor,
      input.description.trim(),
      input.frequency,
      input.dayOfMonth,
      input.intervalDays,
      input.weekday,
      input.startDate,
      input.endDate,
    );
    const estimateId = createId();
    await db.runAsync(
      `INSERT INTO money_transactions
        (id, type, category_id, subcategory_id, amount_minor, quantity, description,
         occurred_at, status, recurring_rule_id, recurring_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      estimateId,
      input.type,
      input.categoryId,
      input.subcategoryId,
      input.amountMinor,
      input.quantity,
      input.description.trim(),
      input.startDate,
      status,
      id,
      input.startDate,
      createdAt,
    );
    await syncEstimateCalendarTodo(estimateId, true);
  });
}

export async function deleteRecurringRule(id: string): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM calendar_todos
       WHERE id IN (
         SELECT ? || id FROM money_transactions WHERE recurring_rule_id = ? AND status = 'estimate'
       )`,
      ESTIMATE_TODO_PREFIX,
      id,
    );
    await db.runAsync(
      "DELETE FROM money_transactions WHERE recurring_rule_id = ? AND status = 'estimate'",
      id,
    );
    await db.runAsync('DELETE FROM money_recurring WHERE id = ?', id);
  });
}

export async function updateEstimate(input: {
  id: string;
  categoryId: string | null;
  subcategoryId: string | null;
  amountMinor: number;
  description: string;
  occurredAt: string;
}): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `UPDATE money_transactions
       SET category_id = ?, subcategory_id = ?, amount_minor = ?, description = ?, occurred_at = ?
       WHERE id = ? AND status = 'estimate'`,
      input.categoryId,
      input.subcategoryId,
      input.amountMinor,
      input.description.trim(),
      input.occurredAt,
      input.id,
    );
    if (result.changes !== 1) {
      throw new Error('This estimate is no longer available to edit.');
    }
    await syncEstimateCalendarTodo(input.id, false);
  });
}

export async function updateMoneyTransaction(input: {
  id: string;
  categoryId: string | null;
  subcategoryId: string | null;
  amountMinor: number;
  description: string;
  occurredAt: string;
}): Promise<void> {
  const result = await getDb().runAsync(
    `UPDATE money_transactions
     SET category_id = ?, subcategory_id = ?, amount_minor = ?, description = ?, occurred_at = ?
     WHERE id = ? AND status = 'valid' AND is_deleted = 0`,
    input.categoryId,
    input.subcategoryId,
    input.amountMinor,
    input.description.trim(),
    input.occurredAt,
    input.id,
  );
  if (result.changes !== 1) {
    throw new Error('This transaction is no longer available to edit.');
  }
}

export async function updateAndPromoteEstimate(input: {
  id: string;
  categoryId: string | null;
  subcategoryId: string | null;
  amountMinor: number;
  description: string;
  occurredAt: string;
}): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    const updated = await db.runAsync(
      `UPDATE money_transactions
       SET category_id = ?, subcategory_id = ?, amount_minor = ?, description = ?, occurred_at = ?
       WHERE id = ? AND status = 'estimate'`,
      input.categoryId,
      input.subcategoryId,
      input.amountMinor,
      input.description.trim(),
      input.occurredAt,
      input.id,
    );
    if (updated.changes !== 1) {
      throw new Error('This estimate is no longer available to edit.');
    }

    const promoted = await db.runAsync(
      `UPDATE money_transactions SET status = 'valid'
       WHERE id = ? AND status = 'estimate'`,
      input.id,
    );
    if (promoted.changes !== 1) {
      throw new Error('This estimate is no longer available to confirm.');
    }
    await db.runAsync(
      'DELETE FROM calendar_todos WHERE id = ?',
      `${ESTIMATE_TODO_PREFIX}${input.id}`,
    );
  });
}

export async function promoteEstimate(id: string): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `UPDATE money_transactions SET status = 'valid'
       WHERE id = ? AND status = 'estimate'`,
      id,
    );
    if (result.changes !== 1) {
      throw new Error('This estimate is no longer available to confirm.');
    }
    await db.runAsync(
      'DELETE FROM calendar_todos WHERE id = ?',
      `${ESTIMATE_TODO_PREFIX}${id}`,
    );
  });
}

export async function deleteMoneyTransaction(id: string): Promise<void> {
  const result = await getDb().runAsync(
    `UPDATE money_transactions SET is_deleted = 1
     WHERE id = ? AND is_deleted = 0`,
    id,
  );
  if (result.changes !== 1) {
    throw new Error('This transaction is no longer available to delete.');
  }
}

/**
 * Delete one estimate transaction, with three scopes:
 * - 'one': soft-delete only this estimate.
 * - 'following': soft-delete every estimate of the same repeating schedule on
 *   dates after this one (this date is kept), and stop the schedule from
 *   generating later dates by capping its end date.
 * - 'all': soft-delete every estimate of the schedule and remove the schedule.
 * Valid (confirmed) transactions and the schedule itself are never removed by
 * 'one' or 'following'.
 */
export async function deleteEstimate(input: {
  id: string;
  mode: 'one' | 'following' | 'all';
}): Promise<void> {
  const db = getDb();
  const row = await db.getFirstAsync<{
    recurring_rule_id: string | null;
    occurred_at: string;
  }>(
    `SELECT recurring_rule_id, occurred_at FROM money_transactions
     WHERE id = ? AND status = 'estimate'`,
    input.id,
  );
  if (!row) {
    throw new Error('This estimate is no longer available to delete.');
  }
  await db.withTransactionAsync(async () => {
    if (input.mode === 'one' || !row.recurring_rule_id) {
      const result = await db.runAsync(
        `UPDATE money_transactions SET is_deleted = 1
         WHERE id = ? AND status = 'estimate' AND is_deleted = 0`,
        input.id,
      );
      if (result.changes !== 1) {
        throw new Error('This estimate is no longer available to delete.');
      }
      await db.runAsync(
        'DELETE FROM calendar_todos WHERE id = ?',
        `${ESTIMATE_TODO_PREFIX}${input.id}`,
      );
      return;
    }
    const { recurring_rule_id, occurred_at } = row;
    if (input.mode === 'following') {
      // Keep this date and everything before it; remove later dates and cap the
      // schedule so they are not materialized again.
      await db.runAsync(
        `UPDATE money_transactions SET is_deleted = 1
         WHERE recurring_rule_id = ? AND status = 'estimate'
           AND occurred_at > ? AND is_deleted = 0`,
        recurring_rule_id,
        occurred_at,
      );
      await db.runAsync(
        `UPDATE money_recurring SET end_date = ? WHERE id = ?`,
        occurred_at,
        recurring_rule_id,
      );
      await db.runAsync(
        `DELETE FROM calendar_todos
         WHERE id IN (
           SELECT ? || id FROM money_transactions
           WHERE recurring_rule_id = ? AND status = 'estimate' AND occurred_at > ?
         )`,
        ESTIMATE_TODO_PREFIX,
        recurring_rule_id,
        occurred_at,
      );
      return;
    }
    // mode === 'all': drop every future estimate of the schedule and the rule.
    await db.runAsync(
      `UPDATE money_transactions SET is_deleted = 1
       WHERE recurring_rule_id = ? AND status = 'estimate' AND is_deleted = 0`,
      recurring_rule_id,
    );
    await db.runAsync(
      `DELETE FROM calendar_todos
       WHERE id IN (
         SELECT ? || id FROM money_transactions
         WHERE recurring_rule_id = ? AND status = 'estimate'
       )`,
      ESTIMATE_TODO_PREFIX,
      recurring_rule_id,
    );
    await db.runAsync('DELETE FROM money_recurring WHERE id = ?', recurring_rule_id);
  });
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
    await db.runAsync(
      `DELETE FROM money_items
       WHERE NOT EXISTS (SELECT 1 FROM money_subcategories WHERE item_id = money_items.id)`,
    );
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
  barcode?: string | null;
  id?: string;
  itemId?: string | null;
  tagIds?: string[];
}): Promise<void> {
  const db = getDb();
  const cleanName = input.name.trim();
  const barcode = input.barcode?.trim() || null;
  const subcategoryId = input.id;
  if (subcategoryId) {
    await db.withTransactionAsync(async () => {
      const current = await db.getFirstAsync<{ item_id: string | null }>(
        'SELECT item_id FROM money_subcategories WHERE id = ?',
        subcategoryId,
      );
      let itemId = current?.item_id ?? input.itemId ?? null;
      if (!itemId) {
        itemId = createId();
        await db.runAsync(
          'INSERT INTO money_items (id, name, barcode) VALUES (?, ?, ?)',
          itemId,
          cleanName,
          barcode,
        );
        await db.runAsync(
          'UPDATE money_subcategories SET item_id = ? WHERE id = ?',
          itemId,
          subcategoryId,
        );
      }
      await db.runAsync(
        'UPDATE money_items SET name = ?, barcode = ? WHERE id = ?',
        cleanName,
        barcode,
        itemId,
      );
      await db.runAsync(
        'UPDATE money_subcategories SET name = ?, amount_minor = ?, barcode = ? WHERE id = ?',
        cleanName,
        input.amountMinor,
        barcode,
        subcategoryId,
      );
      if (input.tagIds) {
        await db.runAsync('DELETE FROM money_item_tags WHERE item_id = ?', itemId);
        for (const tagId of [...new Set(input.tagIds)]) {
          await db.runAsync(
            'INSERT INTO money_item_tags (item_id, tag_id) VALUES (?, ?)',
            itemId,
            tagId,
          );
        }
      }
    });
  } else {
    await saveSharedSubcategory({
      name: cleanName,
      barcode,
      categories: [{ categoryId: input.categoryId, amountMinor: input.amountMinor }],
    });
  }
}

export async function saveSharedSubcategory(input: {
  name: string;
  barcode: string | null;
  categories: { categoryId: string; amountMinor: number | null }[];
  tagIds?: string[];
  itemId?: string;
}): Promise<void> {
  const db = getDb();
  const name = input.name.trim();
  const categories = [...new Map(input.categories.map((row) => [row.categoryId, row])).values()];
  if (!name) throw new Error('Item name is required.');
  if (categories.length === 0) throw new Error('Select at least one category.');
  await db.withTransactionAsync(async () => {
    const itemId = input.itemId ?? createId();
    if (input.itemId) {
      await db.runAsync(
        'UPDATE money_items SET name = ?, barcode = ? WHERE id = ?',
        name,
        input.barcode?.trim() || null,
        itemId,
      );
      const currentLinks = await db.getAllAsync<{ id: string; category_id: string }>(
        'SELECT id, category_id FROM money_subcategories WHERE item_id = ?',
        itemId,
      );
      const selectedCategoryIds = new Set(categories.map((row) => row.categoryId));
      for (const link of currentLinks) {
        if (selectedCategoryIds.has(link.category_id)) continue;
        await db.runAsync(
          'UPDATE money_transactions SET subcategory_id = NULL WHERE subcategory_id = ?',
          link.id,
        );
        await db.runAsync(
          'UPDATE money_recurring SET subcategory_id = NULL WHERE subcategory_id = ?',
          link.id,
        );
        await db.runAsync('DELETE FROM money_subcategories WHERE id = ?', link.id);
      }
    } else {
      await db.runAsync(
        'INSERT INTO money_items (id, name, barcode) VALUES (?, ?, ?)',
        itemId,
        name,
        input.barcode?.trim() || null,
      );
    }
    for (const row of categories) {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM money_subcategories WHERE item_id = ? AND category_id = ?',
        itemId,
        row.categoryId,
      );
      if (existing) {
        await db.runAsync(
          'UPDATE money_subcategories SET name = ?, amount_minor = ?, barcode = ? WHERE id = ?',
          name,
          row.amountMinor,
          input.barcode?.trim() || null,
          existing.id,
        );
      } else {
        await db.runAsync(
          `INSERT INTO money_subcategories
            (id, category_id, item_id, name, amount_minor, barcode, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          createId(),
          row.categoryId,
          itemId,
          name,
          row.amountMinor,
          input.barcode?.trim() || null,
          new Date().toISOString(),
        );
      }
    }
    for (const tagId of input.tagIds ?? []) {
      await db.runAsync(
        'INSERT OR IGNORE INTO money_item_tags (item_id, tag_id) VALUES (?, ?)',
        itemId,
        tagId,
      );
    }
  });
}

export async function saveMoneyTag(name: string, id?: string): Promise<void> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Tag name is required.');
  if (id) {
    await getDb().runAsync('UPDATE money_tags SET name = ? WHERE id = ?', cleanName, id);
  } else {
    await getDb().runAsync(
      'INSERT INTO money_tags (id, name) VALUES (?, ?)',
      createId(),
      cleanName,
    );
  }
}

export async function deleteMoneyTag(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM money_tags WHERE id = ?', id);
}

export async function setSubcategoryBarcode(id: string, barcode: string): Promise<void> {
  const db = getDb();
  const subcategory = await db.getFirstAsync<{ item_id: string | null }>(
    'SELECT item_id FROM money_subcategories WHERE id = ?',
    id,
  );
  const cleanBarcode = barcode.trim() || null;
  await db.runAsync('UPDATE money_subcategories SET barcode = ? WHERE id = ?', cleanBarcode, id);
  if (subcategory?.item_id) {
    await db.runAsync('UPDATE money_items SET barcode = ? WHERE id = ?', cleanBarcode, subcategory.item_id);
  }
}

export async function deleteSubcategory(id: string): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    const subcategory = await db.getFirstAsync<{ item_id: string | null }>(
      'SELECT item_id FROM money_subcategories WHERE id = ?',
      id,
    );
    await db.runAsync('UPDATE money_recurring SET subcategory_id = NULL WHERE subcategory_id = ?', id);
    await db.runAsync('UPDATE money_transactions SET subcategory_id = NULL WHERE subcategory_id = ?', id);
    await db.runAsync('DELETE FROM money_subcategories WHERE id = ?', id);
    if (subcategory?.item_id) {
      await db.runAsync(
        `DELETE FROM money_items WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM money_subcategories WHERE item_id = ?)`,
        subcategory.item_id,
        subcategory.item_id,
      );
    }
  });
}
