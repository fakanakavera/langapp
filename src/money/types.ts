export type TransactionType = 'income' | 'expense';
export type RecurringFrequency = 'monthly_day' | 'every_days' | 'weekly';

export type MoneyCategory = {
  id: string;
  type: TransactionType;
  name: string;
};

export type Transaction = {
  id: string;
  type: TransactionType;
  amountMinor: number;
  currencyCode: string;
  description: string;
  occurredAt: string;
};

export type MoneyTransaction = {
  id: string;
  type: TransactionType;
  category_id: string | null;
  subcategory_id: string | null;
  category_name: string | null;
  subcategory_name: string | null;
  amount_minor: number;
  quantity: number;
  description: string;
  occurred_at: string;
};

export type RecurringRule = {
  id: string;
  type: TransactionType;
  category_id: string | null;
  category_name: string | null;
  amount_minor: number;
  description: string;
  frequency: RecurringFrequency;
  day_of_month: number | null;
  interval_days: number | null;
  weekday: number | null;
  start_date: string;
  end_date: string | null;
};

export type MoneyBudget = {
  id: string;
  category_id: string;
  amount_minor: number;
};

export type MoneySubcategory = {
  id: string;
  category_id: string;
  name: string;
  amount_minor: number | null;
};

export type MoneyPreferences = {
  currency: string;
  periodStartDay: number;
};

export type CalendarEntry = {
  id: string;
  type: TransactionType;
  amount_minor: number;
  description: string;
  category_name: string | null;
  subcategory_name: string | null;
  occurred_at: string;
  scheduled: boolean;
};
