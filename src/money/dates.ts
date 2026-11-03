import type { RecurringRule } from '@/money/types';

export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isValidLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && localDateString(parseLocalDate(value)) === value;
}

export function dateInMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

export function getPeriodStart(date: Date, startDay: number): Date {
  const currentMonthStart = dateInMonth(date.getFullYear(), date.getMonth(), startDay);
  if (date >= currentMonthStart) return currentMonthStart;
  return dateInMonth(date.getFullYear(), date.getMonth() - 1, startDay);
}

export function getPeriodEnd(start: Date, startDay: number): Date {
  const nextStart = dateInMonth(start.getFullYear(), start.getMonth() + 1, startDay);
  return new Date(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate() - 1);
}

export function addMonthsClamped(date: Date, months: number, day: number): Date {
  return dateInMonth(date.getFullYear(), date.getMonth() + months, day);
}

export function getRecurringDates(rule: RecurringRule, from: Date, to: Date): string[] {
  const start = parseLocalDate(rule.start_date);
  const end = rule.end_date ? parseLocalDate(rule.end_date) : null;
  const lowerBound = from > start ? from : start;
  const upperBound = end && end < to ? end : to;
  if (lowerBound > upperBound) return [];

  const dates: string[] = [];
  if (rule.frequency === 'monthly_day') {
    let cursor = dateInMonth(lowerBound.getFullYear(), lowerBound.getMonth(), rule.day_of_month ?? 1);
    if (cursor < lowerBound) {
      cursor = dateInMonth(cursor.getFullYear(), cursor.getMonth() + 1, rule.day_of_month ?? 1);
    }
    while (cursor <= upperBound) {
      dates.push(localDateString(cursor));
      cursor = dateInMonth(cursor.getFullYear(), cursor.getMonth() + 1, rule.day_of_month ?? 1);
    }
    return dates;
  }

  if (rule.frequency === 'weekly') {
    const targetWeekday = rule.weekday ?? start.getDay();
    const cursor = new Date(lowerBound);
    cursor.setDate(cursor.getDate() + ((targetWeekday - cursor.getDay() + 7) % 7));
    while (cursor <= upperBound) {
      dates.push(localDateString(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    return dates;
  }

  const interval = Math.max(1, rule.interval_days ?? 1);
  const cursor = new Date(start);
  if (cursor < lowerBound) {
    const elapsed =
      (Date.UTC(lowerBound.getFullYear(), lowerBound.getMonth(), lowerBound.getDate()) -
        Date.UTC(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())) /
      86_400_000;
    cursor.setDate(cursor.getDate() + Math.ceil(elapsed / interval) * interval);
  }
  while (cursor <= upperBound) {
    dates.push(localDateString(cursor));
    cursor.setDate(cursor.getDate() + interval);
  }
  return dates;
}

export function currencyDecimals(currency: string): number {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

export function parseAmount(value: string, currency: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const decimals = currencyDecimals(currency);
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) return null;
  const amount = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0');
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: currencyDecimals(currency),
  }).format(amountMinor / 10 ** currencyDecimals(currency));
}
