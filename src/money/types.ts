export type TransactionType = 'income' | 'expense';

export type Transaction = {
  id: string;
  type: TransactionType;
  amountMinor: number;
  currencyCode: string;
  description: string;
  occurredAt: string;
};
