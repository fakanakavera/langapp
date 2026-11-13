import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  addMonthsClamped,
  currencyDecimals,
  dateInMonth,
  formatMoney,
  getPeriodEnd,
  getPeriodStart,
  isValidLocalDate,
  localDateString,
  parseAmount,
  parseAmountExpression,
  parseLocalDate,
} from '@/money/dates';
import {
  deleteCategory,
  deleteMoneyTransaction,
  deleteRecurringRule,
  deleteSubcategory,
  initializeMoneyTracker,
  loadMoneyData,
  loadMoneyStats,
  promoteEstimate,
  updateAndPromoteEstimate,
  saveBudget,
  saveCategory,
  saveMoneyPreference,
  saveRecurringRule,
  saveSubcategory,
  saveTransaction,
  setSubcategoryBarcode as saveSubcategoryBarcode,
  updateMoneyTransaction,
  updateEstimate,
} from '@/money/storage';
import type {
  CalendarEntry,
  MoneyCategory,
  MoneyPreferences,
  MoneySubcategory,
  MoneyTransaction,
  RecurringFrequency,
  RecurringRule,
  TransactionType,
} from '@/money/types';
import { useDatabase } from '@/providers/database-provider';
import {
  ensureNotificationPermissionsAsync,
  scheduleMoneyEstimateReminderAsync,
} from '@/lib/notifications';

type MoneyView = 'Overview' | 'Stats' | 'Calendar' | 'Add' | 'Settings';
type StatsDirection = 'past' | 'future';
type PastStatsMonths = 1 | 3 | 6 | 9 | 12;
type FutureStatsMonths = 1 | 2 | 3 | 4 | 5 | 6 | 9 | 12;
type MoneyData = Awaited<ReturnType<typeof loadMoneyData>>;

const VIEWS: MoneyView[] = ['Overview', 'Stats', 'Calendar', 'Add', 'Settings'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'];
const PAST_STATS_RANGES: PastStatsMonths[] = [1, 3, 6, 9, 12];
const FUTURE_STATS_RANGES: FutureStatsMonths[] = [1, 2, 3, 4, 5, 6, 9, 12];

function parseQuantity(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

export default function MoneyHomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannerLocked = useRef(false);
  const [view, setView] = useState<MoneyView>('Overview');
  const [data, setData] = useState<MoneyData | null>(null);
  const [statsTransactions, setStatsTransactions] = useState<MoneyTransaction[] | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<MoneyPreferences>({
    currency: 'JPY',
    periodStartDay: 1,
  });
  const [periodStartDraft, setPeriodStartDraft] = useState('1');
  const [periodStart, setPeriodStart] = useState(() => getPeriodStart(new Date(), 1));
  const periodEnd = useMemo(
    () => getPeriodEnd(periodStart, preferences.periodStartDay),
    [periodStart, preferences.periodStartDay],
  );
  const [statsDirection, setStatsDirection] = useState<StatsDirection>('past');
  const [pastStatsMonths, setPastStatsMonths] = useState<PastStatsMonths>(1);
  const [futureStatsMonths, setFutureStatsMonths] = useState<FutureStatsMonths>(3);
  const [includeEstimates, setIncludeEstimates] = useState(false);
  const statsDateRange = useMemo(() => {
    const today = parseLocalDate(localDateString(new Date()));
    if (statsDirection === 'past') {
      const start =
        pastStatsMonths === 1
          ? dateInMonth(today.getFullYear(), today.getMonth(), 1)
          : dateInMonth(today.getFullYear(), today.getMonth() - pastStatsMonths, today.getDate());
      return { from: localDateString(start), to: localDateString(today) };
    }
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const end = dateInMonth(
      today.getFullYear(),
      today.getMonth() + futureStatsMonths,
      today.getDate(),
    );
    return { from: localDateString(tomorrow), to: localDateString(end) };
  }, [statsDirection, pastStatsMonths, futureStatsMonths]);
  const statsRangeDays = useMemo(() => {
    const from = parseLocalDate(statsDateRange.from);
    const to = parseLocalDate(statsDateRange.to);
    return Math.max(
      1,
      Math.round(
        (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
          Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
          86_400_000,
      ) + 1,
    );
  }, [statsDateRange]);
  const [selectedDate, setSelectedDate] = useState(localDateString(new Date()));
  const [transactionType, setTransactionType] = useState<TransactionType>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(localDateString(new Date()));
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly_day');
  const [dayOfMonth, setDayOfMonth] = useState(`${new Date().getDate()}`);
  const [intervalDays, setIntervalDays] = useState('2');
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [endDate, setEndDate] = useState('');
  const [categoryModal, setCategoryModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [selectedParentCategoryId, setSelectedParentCategoryId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [subcategoryEditorVisible, setSubcategoryEditorVisible] = useState(false);
  const [subcategoryCategoryId, setSubcategoryCategoryId] = useState<string | null>(null);
  const [subcategoryName, setSubcategoryName] = useState('');
  const [subcategoryAmount, setSubcategoryAmount] = useState('');
  const [subcategoryBarcode, setSubcategoryBarcode] = useState('');
  const [newSubcategoryBarcode, setNewSubcategoryBarcode] = useState('');
  const [editingSubcategory, setEditingSubcategory] = useState<MoneySubcategory | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [scannerPurpose, setScannerPurpose] = useState<
    'transaction' | 'subcategory' | 'new-subcategory'
  >('transaction');
  const [scanChoiceVisible, setScanChoiceVisible] = useState(false);
  const [scanCandidates, setScanCandidates] = useState<MoneySubcategory[]>([]);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [scanRequiresBarcodeMapping, setScanRequiresBarcodeMapping] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchDate, setBatchDate] = useState(localDateString(new Date()));
  const [batchCategoryId, setBatchCategoryId] = useState<string | null>(null);
  const [batchPendingSubcategory, setBatchPendingSubcategory] = useState<MoneySubcategory | null>(null);
  const [batchQuantity, setBatchQuantity] = useState('1');
  const [batchEditingQuantity, setBatchEditingQuantity] = useState(false);
  const [budgetCategoryId, setBudgetCategoryId] = useState('all');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<string[]>([]);
  const [expandedStatsCategoryIds, setExpandedStatsCategoryIds] = useState<string[]>([]);
  const [editingTransaction, setEditingTransaction] = useState<MoneyTransaction | null>(null);
  const [estimateAmount, setEstimateAmount] = useState('');
  const [estimateDate, setEstimateDate] = useState('');
  const [estimateDescription, setEstimateDescription] = useState('');
  const [estimateCategoryId, setEstimateCategoryId] = useState('');

  useEffect(() => {
    let cancelled = false;
    initializeMoneyTracker()
      .then(() => {
        if (!cancelled) setError(null);
        return loadMoneyData(localDateString(periodStart), localDateString(periodEnd));
      })
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setPreferences(loaded.preferences);
        setPeriodStartDraft(`${loaded.preferences.periodStartDay}`);
        setPeriodStart((current) => {
          const updated = getPeriodStart(current, loaded.preferences.periodStartDay);
          return localDateString(current) === localDateString(updated) ? current : updated;
        });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [periodStart, periodEnd, revision]);

  useEffect(() => {
    if (view !== 'Stats') return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setStatsLoading(true);
        setStatsError(null);
        return loadMoneyStats(
          statsDateRange.from,
          statsDateRange.to,
          includeEstimates,
        );
      })
      .then((transactions) => {
        if (!cancelled && transactions) setStatsTransactions(transactions);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setStatsError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, revision, statsDateRange, includeEstimates]);

  useEffect(() => {
    if (!data) return;
    ensureNotificationPermissionsAsync()
      .then((granted) =>
        granted ? scheduleMoneyEstimateReminderAsync(data.todayEstimateCount) : undefined,
      )
      .catch((caught: unknown) => {
        Alert.alert(
          'Could not schedule estimate reminder',
          caught instanceof Error ? caught.message : String(caught),
        );
      });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 50);
    const timeout = setTimeout(refresh, tomorrow.getTime() - Date.now());
    return () => clearTimeout(timeout);
  }, [data, refresh]);

  const periodLabel = `${periodStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} – ${periodEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  const periodTransactions = useMemo(() => data?.transactions ?? [], [data]);
  const validPeriodTransactions = useMemo(
    () => periodTransactions.filter((transaction) => transaction.status === 'valid'),
    [periodTransactions],
  );
  const recurringEvents = useMemo<CalendarEntry[]>(
    () =>
      periodTransactions
        .filter((transaction) => transaction.status === 'estimate')
        .map((transaction) => ({ ...transaction, scheduled: true })),
    [periodTransactions],
  );
  const expenseTotal = validPeriodTransactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((total, transaction) => total + transaction.amount_minor, 0);
  const incomeTotal = validPeriodTransactions
    .filter((transaction) => transaction.type === 'income')
    .reduce((total, transaction) => total + transaction.amount_minor, 0);

  // Combine category and subcategory selections without double-counting
  // transactions when a parent and one of its children are both selected.
  const categoryStats = useMemo(() => {
    if (!data || !statsTransactions) return null;
    const categories = new Set(selectedCategoryIds);
    const subcategories = new Set(selectedSubcategoryIds);
    const transactions = statsTransactions.filter(
      (transaction) =>
        (transaction.category_id != null && categories.has(transaction.category_id)) ||
        (transaction.subcategory_id != null && subcategories.has(transaction.subcategory_id)),
    );
    const rangeTransactions = transactions.filter((transaction) => {
      const date = transaction.occurred_at.slice(0, 10);
      return date >= statsDateRange.from && date <= statsDateRange.to;
    });
    const expenseTransactions = rangeTransactions.filter((transaction) => transaction.type === 'expense');
    const incomeTotal = rangeTransactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + transaction.amount_minor, 0);
    const expenseTotal = expenseTransactions.reduce(
      (sum, transaction) => sum + transaction.amount_minor,
      0,
    );
    const actualExpenseTotal = expenseTransactions
      .filter((transaction) => transaction.status === 'valid')
      .reduce((sum, transaction) => sum + transaction.amount_minor, 0);
    const estimateExpenseTotal = expenseTransactions
      .filter((transaction) => transaction.status === 'estimate')
      .reduce((sum, transaction) => sum + transaction.amount_minor, 0);
    const estimateCount = expenseTransactions.filter(
      (transaction) => transaction.status === 'estimate',
    ).length;
    const actualIncomeTotal = rangeTransactions
      .filter((transaction) => transaction.type === 'income' && transaction.status === 'valid')
      .reduce((sum, transaction) => sum + transaction.amount_minor, 0);
    const estimateIncomeTotal = rangeTransactions
      .filter((transaction) => transaction.type === 'income' && transaction.status === 'estimate')
      .reduce((sum, transaction) => sum + transaction.amount_minor, 0);
    const totalQuantity = expenseTransactions.reduce(
      (sum, transaction) => sum + (transaction.quantity || 1),
      0,
    );
    const today = localDateString(new Date());
    const rateEnd = statsDirection === 'past' ? today : statsDateRange.to;
    const lifetimeExpenses = transactions.filter(
      (transaction) =>
        transaction.type === 'expense' &&
        transaction.occurred_at.slice(0, 10) <= rateEnd &&
        (transaction.status === 'valid' || includeEstimates),
    );
    const daysTracked = daysSinceFirstActualExpense(transactions, rateEnd, statsRangeDays);
    const lifetimeExpenseTotal = lifetimeExpenses.reduce(
      (sum, transaction) => sum + transaction.amount_minor,
      0,
    );
    const lifetimeQuantity = lifetimeExpenses.reduce(
      (sum, transaction) => sum + (transaction.quantity || 1),
      0,
    );
    const itemRows = [
      ...data.categories
        .filter(
          (category) =>
            selectedCategoryIds.includes(category.id) && category.type === 'expense',
        )
        .map((category) => ({
          id: `category:${category.id}`,
          name: category.name,
          kind: 'Category' as const,
          transactions: rangeTransactions.filter(
            (transaction) =>
              transaction.category_id === category.id && transaction.type === 'expense',
          ),
          lifetimeTransactions: transactions.filter(
            (transaction) =>
              transaction.category_id === category.id &&
              transaction.type === 'expense' &&
              transaction.occurred_at.slice(0, 10) <= rateEnd &&
              (transaction.status === 'valid' || includeEstimates),
          ),
        })),
      ...data.subcategories
        .filter((subcategory) => selectedSubcategoryIds.includes(subcategory.id))
        .map((subcategory) => ({
          id: `subcategory:${subcategory.id}`,
          name: subcategory.name,
          kind: data.categories.find((category) => category.id === subcategory.category_id)?.name ??
            'Subcategory',
          transactions: rangeTransactions.filter(
            (transaction) =>
              transaction.subcategory_id === subcategory.id && transaction.type === 'expense',
          ),
          lifetimeTransactions: transactions.filter(
            (transaction) =>
              transaction.subcategory_id === subcategory.id &&
              transaction.type === 'expense' &&
              transaction.occurred_at.slice(0, 10) <= rateEnd &&
              (transaction.status === 'valid' || includeEstimates),
          ),
        })),
    ]
      .map((row) => ({
        ...row,
        stats: calculatePurchaseStats(
          row.transactions,
          row.lifetimeTransactions,
          rateEnd,
          statsRangeDays,
        ),
      }))
      .sort((a, b) => b.stats.totalAmount - a.stats.totalAmount);

    return {
      itemRows,
      incomeTotal,
      expenseTotal,
      actualExpenseTotal,
      estimateExpenseTotal,
      estimateCount,
      actualIncomeTotal,
      estimateIncomeTotal,
      net: incomeTotal - expenseTotal,
      count: expenseTransactions.length,
      totalQuantity,
      averagePerDay: daysTracked ? lifetimeExpenseTotal / daysTracked : 0,
      averageQuantityPerDay: daysTracked ? lifetimeQuantity / daysTracked : 0,
      daysTracked,
    };
  }, [
    data,
    statsTransactions,
    selectedCategoryIds,
    selectedSubcategoryIds,
    statsRangeDays,
    statsDateRange,
    statsDirection,
    includeEstimates,
  ]);

  const runWrite = async (operation: () => Promise<void>, successMessage: string): Promise<boolean> => {
    try {
      await operation();
      refresh();
      Alert.alert('Saved', successMessage);
      return true;
    } catch (caught) {
      Alert.alert('Could not save', caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  };

  const selectedSubcategory = data?.subcategories.find((subcategory) => subcategory.id === subcategoryId);
  const hasFixedUnitPrice = selectedSubcategory?.amount_minor != null;
  const parsedQuantity = parseQuantity(quantity);

  const openTransactionEditor = (transaction: MoneyTransaction) => {
    setEditingTransaction(transaction);
    setEstimateAmount(
      `${transaction.amount_minor / 10 ** currencyDecimals(preferences.currency)}`,
    );
    setEstimateDate(transaction.occurred_at.slice(0, 10));
    setEstimateDescription(transaction.description);
    setEstimateCategoryId(transaction.category_id ?? '');
  };

  const handleSaveTransaction = async (markAsActual = false) => {
    if (!editingTransaction) return;
    const amountMinor = parseAmountExpression(estimateAmount, preferences.currency);
    if (amountMinor === null) {
      Alert.alert('Check the amount', 'Enter a positive amount.');
      return;
    }
    if (!isValidLocalDate(estimateDate)) {
      Alert.alert('Check the date', 'Enter a date in YYYY-MM-DD format.');
      return;
    }
    const update = {
      id: editingTransaction.id,
      categoryId: estimateCategoryId || null,
      subcategoryId:
        estimateCategoryId === editingTransaction.category_id
          ? editingTransaction.subcategory_id
          : null,
      amountMinor,
      description: estimateDescription,
      occurredAt: estimateDate,
    };
    const saved = await runWrite(
      () => editingTransaction.status === 'estimate'
        ? markAsActual
          ? updateAndPromoteEstimate(update)
          : updateEstimate(update)
        : updateMoneyTransaction(update),
      editingTransaction.status === 'estimate'
        ? markAsActual
          ? `Estimate saved and marked as an actual ${editingTransaction.type}.`
          : 'Estimate updated.'
        : `${editingTransaction.type === 'expense' ? 'Expense' : 'Income'} updated.`,
    );
    if (saved) {
      setEditingTransaction(null);
      setSelectedDate(estimateDate);
      setPeriodStart(getPeriodStart(parseLocalDate(estimateDate), preferences.periodStartDay));
    }
  };

  const handleConfirmEstimate = async (estimate: MoneyTransaction) => {
    await runWrite(
      () => promoteEstimate(estimate.id),
      `Estimate marked as an actual ${estimate.type}.`,
    );
  };

  const handleDeleteTransaction = (entry: CalendarEntry) => {
    const kind = entry.scheduled
      ? 'estimate'
      : entry.type === 'expense'
        ? 'expense'
        : 'income';
    Alert.alert(`Delete ${kind}?`, 'This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void runWrite(
            () => deleteMoneyTransaction(entry.id),
            `${kind[0].toUpperCase()}${kind.slice(1)} deleted.`,
          ),
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!data) return;
    const amountMinor = parseAmountExpression(amount, preferences.currency);
    if (amountMinor === null) {
      Alert.alert(
        'Check the amount',
        `Enter a positive amount (you can use + and -, e.g. 3000-499)${currencyDecimals(preferences.currency) ? ` with up to ${currencyDecimals(preferences.currency)} decimal places` : ''}.`,
      );
      return;
    }
    let transactionAmountMinor = amountMinor;
    let transactionQuantity = 1;
    if (!isRecurring && hasFixedUnitPrice) {
      const parsed = parseQuantity(quantity);
      if (parsed === null) {
        Alert.alert('Check the quantity', 'Enter a quantity greater than zero with up to 2 decimal places.');
        return;
      }
      transactionQuantity = parsed;
      transactionAmountMinor = Math.round(amountMinor * transactionQuantity);
      if (!Number.isSafeInteger(transactionAmountMinor)) {
        Alert.alert('Check the total', 'The total amount is too large.');
        return;
      }
    }
    if (!isValidLocalDate(occurredAt)) {
      Alert.alert('Check the date', 'Enter a date in YYYY-MM-DD format.');
      return;
    }
    let saved: boolean;
    if (isRecurring) {
      const day = Number(dayOfMonth);
      const interval = Number(intervalDays);
      if (
        frequency === 'monthly_day' &&
        (!Number.isInteger(day) || day < 1 || day > 31)
      ) {
        Alert.alert('Check the day', 'Choose a day from 1 to 31.');
        return;
      }
      if (frequency === 'every_days' && (!Number.isInteger(interval) || interval < 1)) {
        Alert.alert('Check the interval', 'Enter a whole number of days greater than zero.');
        return;
      }
      if (endDate && (!isValidLocalDate(endDate) || endDate < occurredAt)) {
        Alert.alert('Check the end date', 'The end date must be on or after the start date.');
        return;
      }
      saved = await runWrite(
        () =>
          saveRecurringRule({
            type: transactionType,
            categoryId: effectiveCategoryId || null,
            subcategoryId: subcategoryId || null,
            amountMinor,
            description,
            frequency,
            dayOfMonth: frequency === 'monthly_day' ? day : null,
            intervalDays: frequency === 'every_days' ? interval : null,
            weekday: frequency === 'weekly' ? weekday : null,
            startDate: occurredAt,
            endDate: endDate || null,
            quantity: 1,
          }),
        'The first item and recurring estimates have been added.',
      );
    } else {
      saved = await runWrite(
        () =>
          saveTransaction({
            type: transactionType,
            categoryId: effectiveCategoryId || null,
            subcategoryId: subcategoryId || null,
            amountMinor: transactionAmountMinor,
            quantity: transactionQuantity,
            description,
            occurredAt,
          }),
        `${transactionType === 'income' ? 'Income' : 'Expense'} added.`,
      );
    }
    if (!saved) return;
    setAmount('');
    setQuantity('1');
    setDescription('');
    setIsRecurring(false);
    setEndDate('');
  };

  const handleSaveNewItem = async () => {
    const name = newItemName.trim();
    if (!name) {
      Alert.alert('Name required', 'Enter a name for the category or subcategory.');
      return;
    }
    if (editingCategoryId) {
      // Renaming an existing top-level category
      const saved = await runWrite(
        () => saveCategory(transactionType, name, editingCategoryId),
        'Category updated.',
      );
      if (!saved) return;
      setEditingCategoryId(null);
      setNewItemName('');
      setSelectedParentCategoryId(null);
      setSubcategoryAmount('');
      setNewSubcategoryBarcode('');
      setDropdownOpen(false);
      return;
    }
    if (selectedParentCategoryId === null) {
      // Create a new top-level category
      const saved = await runWrite(
        () => saveCategory(transactionType, name),
        'Category added.',
      );
      if (!saved) return;
    } else {
      // Create a subcategory under the selected parent
      let amountMinor: number | null = null;
      if (subcategoryAmount.trim() !== '') {
        amountMinor = parseAmount(subcategoryAmount, preferences.currency);
        if (amountMinor === null) {
          Alert.alert(
            'Check the amount',
            `Enter a positive amount${currencyDecimals(preferences.currency) ? ` with up to ${currencyDecimals(preferences.currency)} decimal places` : ''}.`,
          );
          return;
        }
      }
      const saved = await runWrite(
        () =>
          saveSubcategory({
            categoryId: selectedParentCategoryId,
            name,
            amountMinor,
            barcode: newSubcategoryBarcode,
          }),
        'Subcategory added.',
      );
      if (!saved) return;
    }
    setNewItemName('');
    setSelectedParentCategoryId(null);
    setSubcategoryAmount('');
    setNewSubcategoryBarcode('');
    setDropdownOpen(false);
  };

  const handleSaveSubcategory = async () => {
    const name = subcategoryName.trim();
    if (!name) {
      Alert.alert('Subcategory name required', 'Enter a name for this subcategory.');
      return;
    }
    if (!subcategoryCategoryId) {
      Alert.alert('No category selected', 'Please select a category first.');
      return;
    }
    let amountMinor: number | null = null;
    if (subcategoryAmount.trim() !== '') {
      amountMinor = parseAmount(subcategoryAmount, preferences.currency);
      if (amountMinor === null) {
        Alert.alert(
          'Check the amount',
          `Enter a positive amount${currencyDecimals(preferences.currency) ? ` with up to ${currencyDecimals(preferences.currency)} decimal places` : ''}.`,
        );
        return;
      }
    }
    const saved = await runWrite(
      () =>
        saveSubcategory({
          categoryId: subcategoryCategoryId,
          name,
          amountMinor,
          barcode: subcategoryBarcode,
          id: editingSubcategory?.id,
        }),
      editingSubcategory ? 'Subcategory updated.' : 'Subcategory added.',
    );
    if (!saved) return;
    closeSubcategoryEditor();
  };

  const closeSubcategoryEditor = () => {
    setSubcategoryEditorVisible(false);
    setSubcategoryCategoryId(null);
    setEditingSubcategory(null);
    setSubcategoryName('');
    setSubcategoryAmount('');
    setSubcategoryBarcode('');
  };

  const closeCategoryManager = () => {
    setCategoryModal(false);
    closeSubcategoryEditor();
  };

  const handleSaveBudget = async () => {
    const amountMinor = parseAmount(budgetAmount, preferences.currency);
    if (amountMinor === null) {
      Alert.alert('Check the budget', 'Enter a positive budget amount.');
      return;
    }
    if (await runWrite(() => saveBudget(budgetCategoryId, amountMinor), 'Budget target saved.')) {
      setBudgetAmount('');
    }
  };

  const handleSaveStartDay = async (value: string) => {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      Alert.alert('Check the start day', 'Choose a day from 1 to 31.');
      return;
    }
    if (await runWrite(() => saveMoneyPreference('period_start_day', `${day}`), 'Calendar cycle updated.')) {
      setPeriodStartDraft(`${day}`);
    }
  };

  const handleChangeCurrency = async (currency: string) => {
    await runWrite(() => saveMoneyPreference('currency', currency), `Currency changed to ${currency}.`);
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    );
  };

  const selectAllCategories = () => {
    setSelectedCategoryIds(data?.categories.map((category) => category.id) ?? []);
    setSelectedSubcategoryIds(data?.subcategories.map((subcategory) => subcategory.id) ?? []);
  };

  const clearCategories = () => {
    setSelectedCategoryIds([]);
    setSelectedSubcategoryIds([]);
  };

  const toggleSubcategory = (subcategoryId: string) => {
    setSelectedSubcategoryIds((current) =>
      current.includes(subcategoryId)
        ? current.filter((id) => id !== subcategoryId)
        : [...current, subcategoryId],
    );
  };

  const toggleStatsCategoryExpanded = (categoryId: string) => {
    setExpandedStatsCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  };

  const titleColor = theme.text;
  const categoriesForType = data?.categories.filter((category) => category.type === transactionType) ?? [];
  const effectiveCategoryId = categoriesForType.some((category) => category.id === categoryId)
    ? categoryId
    : categoriesForType[0]?.id ?? '';
  const expenseCategories = data?.categories.filter((category) => category.type === 'expense') ?? [];
  const incomeCategories = data?.categories.filter((category) => category.type === 'income') ?? [];

  const openBarcodeScanner = async (
    purpose: 'transaction' | 'subcategory' | 'new-subcategory' = 'transaction',
  ) => {
    try {
      if (!cameraPermission?.granted) {
        const permission = await requestCameraPermission();
        if (!permission.granted) {
          Alert.alert('Camera permission needed', 'Allow camera access to scan item barcodes.');
          return;
        }
      }
      scannerLocked.current = false;
      setCameraReady(false);
      setScannerPurpose(purpose);
      setScannerVisible(true);
    } catch (caught) {
      Alert.alert(
        'Could not open camera',
        caught instanceof Error ? caught.message : String(caught),
      );
    }
  };

  const closeBarcodeScanner = () => {
    scannerLocked.current = true;
    setCameraReady(false);
    setScannerVisible(false);
  };

  const closeBatchScanner = () => {
    scannerLocked.current = false;
    setCameraReady(false);
    setScannerVisible(false);
  };

  const handleCameraMountError = (message: string) => {
    closeBarcodeScanner();
    Alert.alert('Could not start camera', message);
  };

  const selectScannedSubcategory = async (
    subcategory: MoneySubcategory,
    saveBarcodeMapping = false,
  ) => {
    const category = data?.categories.find((item) => item.id === subcategory.category_id);
    if (!category) {
      Alert.alert('Item unavailable', 'This subcategory no longer has a category.');
      return;
    }
    if (batchMode) {
      setBatchPendingSubcategory(subcategory);
      setBatchQuantity('1');
      setBatchEditingQuantity(false);
      setScanChoiceVisible(false);
      setScanRequiresBarcodeMapping(false);
      return;
    }
    if (saveBarcodeMapping) {
      try {
        await saveSubcategoryBarcode(subcategory.id, scannedBarcode);
        refresh();
      } catch (caught) {
        Alert.alert(
          'Could not save barcode',
          caught instanceof Error ? caught.message : String(caught),
        );
        return;
      }
    }
    setTransactionType(category.type);
    setCategoryId(category.id);
    setSubcategoryId(subcategory.id);
    setExpandedCategoryId(category.id);
    setDescription(subcategory.name);
    setQuantity('1');
    setAmount(
      subcategory.amount_minor != null
        ? String(subcategory.amount_minor / 10 ** currencyDecimals(preferences.currency))
        : '',
    );
    setScanChoiceVisible(false);
    setScanRequiresBarcodeMapping(false);
  };

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (scannerLocked.current) return;
    scannerLocked.current = true;
    if (batchMode) {
      setScannerVisible(false);
      if (!data) {
        scannerLocked.current = false;
        return;
      }
      const barcode = result.data.trim();
      if (!barcode) {
        Alert.alert(
          'Barcode not recognized',
          'Try scanning the barcode again.',
          [{ text: 'OK', onPress: () => { setScannerVisible(true); scannerLocked.current = false; } }],
        );
        return;
      }
      const matches = data.subcategories.filter((subcategory) => subcategory.barcode === barcode);
      if (matches.length === 1) {
        setBatchPendingSubcategory(matches[0]);
        setBatchQuantity('1');
        setBatchEditingQuantity(false);
        scannerLocked.current = false;
        return;
      }
      if (matches.length > 1) {
        setScanCandidates(matches);
        setScanRequiresBarcodeMapping(false);
        setScanChoiceVisible(true);
        scannerLocked.current = false;
        return;
      }
      Alert.alert(
        'No matching item',
        'No saved item matches this barcode. Add it in the categories screen first.',
        [{ text: 'OK', onPress: () => { scannerLocked.current = false; } }],
      );
      return;
    }
    setScannerVisible(false);
    if (!data) {
      scannerLocked.current = false;
      return;
    }
    const barcode = result.data.trim();
    if (!barcode) {
      Alert.alert(
        'Barcode not recognized',
        'Try scanning the barcode again.',
        [{ text: 'OK', onPress: () => { scannerLocked.current = false; } }],
      );
      return;
    }
    if (scannerPurpose === 'subcategory') {
      setSubcategoryBarcode(barcode);
      scannerLocked.current = false;
      return;
    }
    if (scannerPurpose === 'new-subcategory') {
      setNewSubcategoryBarcode(barcode);
      scannerLocked.current = false;
      return;
    }
    setScannedBarcode(barcode);
    const matches = data.subcategories.filter((subcategory) => subcategory.barcode === barcode);
    if (matches.length === 1) {
      void selectScannedSubcategory(matches[0], false);
      scannerLocked.current = false;
      return;
    }
    if (matches.length > 1) {
      setScanCandidates(matches);
      setScanRequiresBarcodeMapping(false);
      setScanChoiceVisible(true);
      scannerLocked.current = false;
      return;
    }
    setScanCandidates(data.subcategories.filter((subcategory) => !subcategory.barcode));
    setScanRequiresBarcodeMapping(true);
    setScanChoiceVisible(true);
    scannerLocked.current = false;
  };

  const openBatchSetup = () => {
    setBatchDate(localDateString(new Date()));
    setBatchCategoryId(null);
    setBatchPendingSubcategory(null);
    setBatchQuantity('1');
    setBatchEditingQuantity(false);
    setBatchMode(true);
  };

  const closeBatchMode = () => {
    setBatchMode(false);
    setScannerVisible(false);
    setBatchPendingSubcategory(null);
    setBatchQuantity('1');
    setBatchEditingQuantity(false);
  };

  const handleBatchCategorySelect = (categoryId: string | null) => {
    setBatchCategoryId(categoryId);
  };

  const startBatchScanning = async () => {
    if (!data || !batchCategoryId) return;
    if (!isValidLocalDate(batchDate)) {
      Alert.alert('Check the date', 'Enter a valid date in YYYY-MM-DD format.');
      return;
    }
    const category = data.categories.find((c) => c.id === batchCategoryId);
    if (!category) return;
    scannerLocked.current = false;
    setCameraReady(false);
    setScannerVisible(true);
  };

  const toggleBatchQuantityEditing = () => {
    setBatchEditingQuantity(true);
  };

  const finishBatchQuantityEditing = (value: string) => {
    const parsed = parseQuantity(value);
    if (parsed === null || parsed <= 0) {
      setBatchQuantity('1');
    } else {
      setBatchQuantity(String(parsed));
    }
    setBatchEditingQuantity(false);
  };

  const confirmBatchItem = async () => {
    if (!data || !batchPendingSubcategory || !batchCategoryId) return;
    const parsed = parseQuantity(batchQuantity);
    if (parsed === null) {
      Alert.alert(
        'Check the quantity',
        'Enter a quantity greater than zero with up to 2 decimal places.',
      );
      return;
    }
    const category = data.categories.find((c) => c.id === batchCategoryId);
    const subcategory = batchPendingSubcategory;
    if (!category) return;
    let amountMinor = 0;
    if (subcategory.amount_minor != null) {
      amountMinor = Math.round(subcategory.amount_minor * parsed);
      if (!Number.isSafeInteger(amountMinor)) {
        Alert.alert('Check the total', 'The total amount is too large.');
        return;
      }
    }
    try {
      await saveTransaction({
        type: category.type,
        categoryId: batchCategoryId,
        subcategoryId: subcategory.id,
        amountMinor,
        quantity: parsed,
        description: subcategory.name,
        occurredAt: batchDate,
      });
      refresh();
    } catch (caught) {
      Alert.alert('Could not add item', caught instanceof Error ? caught.message : String(caught));
      return;
    }
    setBatchPendingSubcategory(null);
    setBatchQuantity('1');
    setBatchEditingQuantity(false);
    scannerLocked.current = false;
    setScannerVisible(true);
  };

  const cancelBatchItem = () => {
    setBatchPendingSubcategory(null);
    setBatchQuantity('1');
    setBatchEditingQuantity(false);
    closeBatchMode();
  };

  const selectedDayEntries = [
    ...periodTransactions
      .filter((transaction) => transaction.occurred_at.slice(0, 10) === selectedDate)
      .map((transaction) => ({
        ...transaction,
        scheduled: transaction.status === 'estimate',
      })),
  ];

  if (error) {
    return (
      <Screen>
        <ThemedText type="subtitle">Money Tracker</ThemedText>
        <CardBlock>
          <ThemedText type="smallBold">Could not load your money data</ThemedText>
          <ThemedText themeColor="textSecondary">{error}</ThemedText>
          <UiButton label="Try again" onPress={refresh} />
        </CardBlock>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <ActivityIndicator color={theme.tint} />
        <ThemedText themeColor="textSecondary">Opening your money tracker…</ThemedText>
      </Screen>
    );
  }

  return (
    <Screen
      scrollKey={view}
      footer={
        <View style={styles.bottomTabs}>
          {VIEWS.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === item }}
              onPress={() => setView(item)}
              style={[
                styles.bottomTab,
                { backgroundColor: view === item ? theme.tint : 'transparent' },
              ]}>
              <ThemedText
                type="small"
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  color: view === item ? '#fff' : theme.text,
                  fontWeight: view === item ? '700' : '500',
                }}>
                {item}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      }>
      <View style={styles.header}>
        <UiButton
          label="← Back to hub"
          variant="secondary"
          onPress={() => router.replace('/')}
          style={styles.backButton}
        />
        <ThemedText type="smallBold" themeColor="textSecondary">
          PERSONAL FINANCE
        </ThemedText>
        <ThemedText type="subtitle" style={[styles.pageTitle, { color: titleColor }]}>
          Money Tracker
        </ThemedText>
        <ThemedText themeColor="textSecondary">{periodLabel}</ThemedText>
      </View>

      {view === 'Overview' && (
        <>
          <View style={styles.summaryRow}>
            <SummaryCard title="Income" amount={formatMoney(incomeTotal, preferences.currency)} />
            <SummaryCard title="Expenses" amount={formatMoney(expenseTotal, preferences.currency)} />
          </View>
          <CardBlock>
            <ThemedText type="smallBold">Net this cycle</ThemedText>
            <ThemedText type="subtitle" style={styles.moneyTotal}>
              {formatMoney(incomeTotal - expenseTotal, preferences.currency)}
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              Only actual transactions count toward totals. Estimates stay out until you confirm
              them.
            </ThemedText>
          </CardBlock>
          <CardBlock>
            <ThemedText type="smallBold">Budget progress</ThemedText>
            <BudgetSummary
              budgets={data.budgets}
              categories={expenseCategories}
              transactions={validPeriodTransactions}
              currency={preferences.currency}
            />
          </CardBlock>
          <CardBlock>
            <ThemedText type="smallBold">Recent activity</ThemedText>
            {periodTransactions.length === 0 ? (
              <ThemedText themeColor="textSecondary">No transactions in this cycle yet.</ThemedText>
            ) : (
              periodTransactions.slice(0, 5).map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  currency={preferences.currency}
                />
              ))
            )}
          </CardBlock>
        </>
      )}

      {view === 'Calendar' && (
        <>
          <CardBlock>
            <View style={styles.calendarHeader}>
              <Pressable
                accessibilityLabel="Previous calendar cycle"
                onPress={() => setPeriodStart((start) => addMonthsClamped(start, -1, preferences.periodStartDay))}
                style={styles.arrowButton}>
                <ThemedText style={styles.arrowText}>‹</ThemedText>
              </Pressable>
              <ThemedText type="smallBold" style={styles.calendarLabel}>
                {periodLabel}
              </ThemedText>
              <Pressable
                accessibilityLabel="Next calendar cycle"
                onPress={() => setPeriodStart((start) => addMonthsClamped(start, 1, preferences.periodStartDay))}
                style={styles.arrowButton}>
                <ThemedText style={styles.arrowText}>›</ThemedText>
              </Pressable>
            </View>
            <CalendarGrid
              start={periodStart}
              startDay={preferences.periodStartDay}
              selectedDate={selectedDate}
              transactions={validPeriodTransactions}
              recurring={recurringEvents}
              currency={preferences.currency}
              onSelect={setSelectedDate}
            />
          </CardBlock>
          <CardBlock>
            <ThemedText type="smallBold">
              {parseLocalDate(selectedDate).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </ThemedText>
            {selectedDayEntries.length === 0 ? (
              <ThemedText themeColor="textSecondary">Nothing planned for this day.</ThemedText>
            ) : (
              selectedDayEntries.map((entry) => (
                <CalendarEntryRow
                  key={entry.id}
                  entry={entry}
                  currency={preferences.currency}
                  onDelete={() => handleDeleteTransaction(entry)}
                  onEdit={() => {
                    const transaction = periodTransactions.find(
                      (item) => item.id === entry.id,
                    );
                    if (transaction) openTransactionEditor(transaction);
                  }}
                  onConfirm={
                    entry.status === 'estimate'
                      ? () => {
                          const estimate = periodTransactions.find(
                            (transaction) => transaction.id === entry.id,
                          );
                          if (estimate) void handleConfirmEstimate(estimate);
                        }
                      : undefined
                  }
                />
              ))
            )}
          </CardBlock>
        </>
      )}

      {view === 'Add' && (
        <>
          <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
            {(['expense', 'income'] as const).map((type) => (
              <Pressable
                key={type}
                accessibilityRole="tab"
                accessibilityState={{ selected: transactionType === type }}
                onPress={() => {
                  setTransactionType(type);
                  setCategoryId('');
                  setSubcategoryId(null);
                  setExpandedCategoryId(null);
                  setAmount('');
                }}
                style={[
                  styles.segment,
                  {
                    backgroundColor: transactionType === type ? theme.tint : theme.backgroundElement,
                  },
                ]}>
                <ThemedText style={{ color: transactionType === type ? '#fff' : theme.text }}>
                  {type === 'expense' ? 'Expense' : 'Income'}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <UiButton
            label="Add multiple items"
            variant="secondary"
            style={styles.batchRow}
            onPress={openBatchSetup}
          />
          <CardBlock>
            <UiButton
              label="Scan item barcode"
              variant="secondary"
              onPress={() => void openBarcodeScanner()}
            />
            <ThemedText type="small" themeColor="textSecondary">
              Scan a saved item or link a new barcode to a subcategory.
            </ThemedText>
            <ThemedText type="smallBold">
              {hasFixedUnitPrice ? `Unit price (${preferences.currency})` : `Amount (${preferences.currency})`}
            </ThemedText>
            <TextInput
              accessibilityLabel="Amount"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              placeholder="0 (e.g. 3000-499)"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            {hasFixedUnitPrice ? (
              <ThemedText type="small" themeColor="textSecondary">
                Fixed price · total for {parsedQuantity != null ? quantity : '…'}:{' '}
                {parseAmountExpression(amount, preferences.currency) != null &&
                parsedQuantity != null
                  ? formatMoney(
                      Math.round(
                        (parseAmountExpression(amount, preferences.currency) ?? 0) * parsedQuantity,
                      ),
                      preferences.currency,
                    )
                  : 'enter a valid price and quantity (up to 2 decimal places)'}
              </ThemedText>
            ) : null}
            <View style={styles.amountOperators}>
              <Pressable
                accessibilityLabel="Add plus operator"
                onPress={() => setAmount((current) => current + '+')}
                style={[
                  styles.operatorButton,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.backgroundSelected,
                  },
                ]}>
                <ThemedText
                  style={[
                    styles.operatorText,
                    { color: theme.tint },
                  ]}>
                  +
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityLabel="Add minus operator"
                onPress={() => setAmount((current) => current + '-')}
                style={[
                  styles.operatorButton,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.backgroundSelected,
                  },
                ]}>
                <ThemedText
                  style={[
                    styles.operatorText,
                    { color: theme.tint },
                  ]}>
                  −
                </ThemedText>
              </Pressable>
            </View>
            {hasFixedUnitPrice ? (
              <>
                <ThemedText type="smallBold">How many bought?</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  You can enter up to 2 decimal places, e.g. 12.34.
                </ThemedText>
                <TextInput
                  accessibilityLabel="Quantity bought"
                  keyboardType="decimal-pad"
                  value={quantity}
                  onChangeText={setQuantity}
                  placeholder="1"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                />
              </>
            ) : null}
            <ThemedText type="smallBold">Category</ThemedText>
            <View style={styles.categoryList}>
              {categoriesForType.map((category) => {
                const isExpanded = expandedCategoryId === category.id;
                const subs = (data?.subcategories ?? []).filter(
                  (s) => s.category_id === category.id
                );
                return (
                  <View key={category.id} style={styles.categorySection}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setExpandedCategoryId(
                          expandedCategoryId === category.id ? null : category.id
                        )
                      }
                      style={[
                        styles.categoryRow,
                        {
                          backgroundColor: theme.backgroundElement,
                          borderColor: theme.backgroundSelected,
                        },
                      ]}>
                      <ThemedText type="smallBold">{category.name}</ThemedText>
                      <ThemedText style={{ color: theme.tint, fontSize: 20 }}>
                        {isExpanded ? '▾' : '▸'}
                      </ThemedText>
                    </Pressable>
                    {isExpanded && subs.length > 0 && (
                      <View style={styles.subcategoryList}>
                        {subs.map((sub) => {
                          const isSelected = subcategoryId === sub.id;
                          const fixedLabel = sub.amount_minor != null
                            ? ` · ${formatMoney(sub.amount_minor, preferences.currency)}`
                            : '';
                          return (
                            <Pressable
                              key={sub.id}
                              accessibilityRole="button"
                              onPress={() => {
                                setSubcategoryId(sub.id);
                                setCategoryId(category.id);
                                setQuantity('1');
                                if (sub.amount_minor != null) {
                                  setAmount(
                                    String(
                                      sub.amount_minor /
                                        10 ** currencyDecimals(preferences.currency)
                                    )
                                  );
                                } else {
                                  setAmount('');
                                }
                              }}
                              style={[
                                styles.subcategoryRow,
                                isSelected && {
                                  backgroundColor: theme.backgroundSelected,
                                },
                                {
                                  borderColor: theme.backgroundSelected,
                                },
                              ]}>
                              <ThemedText type="small">
                                {sub.name}{fixedLabel}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                    {!isExpanded && subs.length > 0 && (
                      <ThemedText type="small" themeColor="textSecondary">
                        {subs.length} subcategory{subs.length !== 1 ? 'ies' : ''}
                      </ThemedText>
                    )}
                  </View>
                );
              })}
            </View>
            <UiButton label="Manage categories" variant="secondary" onPress={() => setCategoryModal(true)} />
            <ThemedText type="smallBold">Description (optional)</ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What was this for?"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <ThemedText type="smallBold">{isRecurring ? 'First date' : 'Date'}</ThemedText>
            <TextInput
              value={occurredAt}
              onChangeText={setOccurredAt}
              placeholder="YYYY-MM-DD"
              accessibilityLabel={isRecurring ? 'First date' : 'Transaction date'}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isRecurring }}
              onPress={() => setIsRecurring((current) => !current)}
              style={styles.checkRow}>
              <ThemedText style={{ color: theme.tint, fontSize: 20 }}>
                {isRecurring ? '☑' : '☐'}
              </ThemedText>
              <ThemedText>Repeat this {transactionType}</ThemedText>
            </Pressable>
            {isRecurring && (
              <RecurringFields
                themeText={theme.text}
                borderColor={theme.backgroundSelected}
                frequency={frequency}
                setFrequency={setFrequency}
                dayOfMonth={dayOfMonth}
                setDayOfMonth={setDayOfMonth}
                intervalDays={intervalDays}
                setIntervalDays={setIntervalDays}
                weekday={weekday}
                setWeekday={setWeekday}
                endDate={endDate}
                setEndDate={setEndDate}
              />
            )}
            <UiButton
              label={isRecurring ? 'Save recurring schedule' : `Add ${transactionType}`}
              onPress={handleSubmit}
            />
          </CardBlock>
          {data.recurring.length > 0 && (
            <CardBlock>
              <ThemedText type="smallBold">Recurring schedules</ThemedText>
              {data.recurring.map((rule) => (
                <RecurringRuleRow
                  key={rule.id}
                  rule={rule}
                  currency={preferences.currency}
                  onDelete={() =>
                    Alert.alert('Delete schedule?', 'Future scheduled dates will be removed.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () =>
                          void runWrite(() => deleteRecurringRule(rule.id), 'Schedule deleted.'),
                      },
                    ])
                  }
                />
              ))}
            </CardBlock>
          )}
        </>
      )}

      {view === 'Settings' && (
        <>
          <CardBlock>
            <ThemedText type="smallBold">Currency</ThemedText>
            <ThemedText themeColor="textSecondary">
              Changing currency updates the display format; it does not convert existing amounts.
            </ThemedText>
            <View style={styles.chipWrap}>
              {CURRENCIES.map((currency) => (
                <ChoiceChip
                  key={currency}
                  label={currency}
                  selected={preferences.currency === currency}
                  onPress={() => void handleChangeCurrency(currency)}
                />
              ))}
            </View>
          </CardBlock>
          <CardBlock>
            <ThemedText type="smallBold">Calendar cycle start</ThemedText>
            <ThemedText themeColor="textSecondary">
              For example, day 20 makes each cycle run from the 20th to the 19th. In shorter
              months, the start falls on that month’s last day.
            </ThemedText>
            <TextInput
              accessibilityLabel="Calendar cycle start day"
              keyboardType="number-pad"
              value={periodStartDraft}
              onChangeText={setPeriodStartDraft}
              onSubmitEditing={(event) => void handleSaveStartDay(event.nativeEvent.text)}
              placeholder="1–31"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <UiButton
              label="Save start day"
              variant="secondary"
              onPress={() => void handleSaveStartDay(periodStartDraft)}
            />
            <ThemedText type="small" themeColor="textSecondary">
              To apply a different day, enter it above and press Done or Save start day.
            </ThemedText>
          </CardBlock>
          <CardBlock>
            <ThemedText type="smallBold">Set a cycle budget</ThemedText>
            <ThemedText themeColor="textSecondary">
              Targets reset with your calendar cycle ({periodLabel}).
            </ThemedText>
            <View style={styles.chipWrap}>
              <ChoiceChip
                label="All expenses"
                selected={budgetCategoryId === 'all'}
                onPress={() => setBudgetCategoryId('all')}
              />
              {expenseCategories.map((category) => (
                <ChoiceChip
                  key={category.id}
                  label={category.name}
                  selected={budgetCategoryId === category.id}
                  onPress={() => setBudgetCategoryId(category.id)}
                />
              ))}
            </View>
            <TextInput
              accessibilityLabel="Budget amount"
              keyboardType="decimal-pad"
              value={budgetAmount}
              onChangeText={setBudgetAmount}
              placeholder={`Amount in ${preferences.currency}`}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <UiButton label="Save budget" onPress={handleSaveBudget} />
          </CardBlock>
          <CardBlock>
            <ThemedText type="smallBold">Budget progress</ThemedText>
            <BudgetSummary
              budgets={data.budgets}
              categories={expenseCategories}
              transactions={validPeriodTransactions}
              currency={preferences.currency}
            />
            {data.budgets.length > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                To change a target, choose its category above and save a new amount.
              </ThemedText>
            )}
          </CardBlock>
        </>
      )}

      {view === 'Stats' && (
        <>
          <CardBlock>
            <ThemedText type="smallBold">Stats period</ThemedText>
            <View style={styles.chipWrap}>
              <ChoiceChip
                label="Past"
                selected={statsDirection === 'past'}
                onPress={() => setStatsDirection('past')}
              />
              <ChoiceChip
                label="Future"
                selected={statsDirection === 'future'}
                onPress={() => setStatsDirection('future')}
              />
            </View>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              {statsDirection === 'past' ? 'Past range' : 'Future range'}
            </ThemedText>
            <View style={styles.chipWrap}>
              {statsDirection === 'past'
                ? PAST_STATS_RANGES.map((months) => (
                    <ChoiceChip
                      key={months}
                      label={months === 1 ? 'This month' : `Last ${months} months`}
                      selected={pastStatsMonths === months}
                      onPress={() => setPastStatsMonths(months)}
                    />
                  ))
                : FUTURE_STATS_RANGES.map((months) => (
                    <ChoiceChip
                      key={months}
                      label={`Next ${months} ${months === 1 ? 'month' : 'months'}`}
                      selected={futureStatsMonths === months}
                      onPress={() => setFutureStatsMonths(months)}
                    />
                  ))}
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: includeEstimates }}
              onPress={() => setIncludeEstimates((value) => !value)}
              style={styles.checkRow}>
              <ThemedText style={{ color: theme.tint, fontSize: 20 }}>
                {includeEstimates ? '☑' : '☐'}
              </ThemedText>
              <View style={styles.flex}>
                <ThemedText>Include estimates</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Adds pending estimates in the selected range to totals and category stats.
                </ThemedText>
              </View>
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary">
              Showing {parseLocalDate(statsDateRange.from).toLocaleDateString()} to{' '}
              {parseLocalDate(statsDateRange.to).toLocaleDateString()}.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Period totals use this range. Daily averages use spending since the first actual
              expense in each selection.
            </ThemedText>
          </CardBlock>

          <CardBlock>
            <ThemedText type="smallBold">Choose categories and items</ThemedText>
            <ThemedText themeColor="textSecondary">
              Category totals include all their subcategories. Selecting both a category and an
              item won’t double-count the combined totals. Estimates are included only when the
              option above is enabled.
            </ThemedText>
            <View style={styles.selectionActions}>
              <Pressable
                accessibilityRole="button"
                onPress={selectAllCategories}
                disabled={
                  selectedCategoryIds.length === data.categories.length &&
                  selectedSubcategoryIds.length === data.subcategories.length
                }
                style={styles.selectionAction}>
                <ThemedText type="small" style={{ color: theme.tint, fontWeight: '600' }}>
                  Select all
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={clearCategories}
                disabled={selectedCategoryIds.length === 0 && selectedSubcategoryIds.length === 0}
                style={styles.selectionAction}>
                <ThemedText type="small" style={{ color: theme.error, fontWeight: '600' }}>
                  Clear
                </ThemedText>
              </Pressable>
            </View>
            {data?.categories.length === 0 ? (
              <ThemedText themeColor="textSecondary">
                No categories yet. Add some in the Add tab.
              </ThemedText>
            ) : (
              <>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Expenses
                </ThemedText>
                <View style={styles.statsCategoryList}>
                  {expenseCategories.map((category) => {
                    const expanded = expandedStatsCategoryIds.includes(category.id);
                    const subcategories = data.subcategories.filter(
                      (subcategory) => subcategory.category_id === category.id,
                    );
                    return (
                      <View key={category.id} style={styles.statsCategorySection}>
                        <View style={styles.statsCategoryHeader}>
                          <View style={styles.flex}>
                            <CategoryChip
                              category={category}
                              selected={selectedCategoryIds.includes(category.id)}
                              onPress={() => toggleCategory(category.id)}
                            />
                          </View>
                          {subcategories.length > 0 ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${category.name} items`}
                              onPress={() => toggleStatsCategoryExpanded(category.id)}
                              style={[styles.expandStatsButton, { backgroundColor: theme.backgroundElement }]}>
                              <ThemedText style={{ color: theme.tint, fontWeight: '700' }}>
                                {expanded ? 'Hide items' : `${subcategories.length} items`}
                              </ThemedText>
                            </Pressable>
                          ) : null}
                        </View>
                        {expanded ? (
                          <View style={styles.chipWrap}>
                            {subcategories.map((subcategory) => (
                              <Pressable
                                key={subcategory.id}
                                accessibilityRole="checkbox"
                                accessibilityState={{
                                  checked: selectedSubcategoryIds.includes(subcategory.id),
                                }}
                                onPress={() => toggleSubcategory(subcategory.id)}
                                style={[
                                  styles.chip,
                                  {
                                    backgroundColor: selectedSubcategoryIds.includes(subcategory.id)
                                      ? theme.tint
                                      : theme.background,
                                    borderColor: selectedSubcategoryIds.includes(subcategory.id)
                                      ? theme.tint
                                      : theme.backgroundSelected,
                                  },
                                ]}>
                                <ThemedText
                                  style={{
                                    color: selectedSubcategoryIds.includes(subcategory.id)
                                      ? '#fff'
                                      : theme.text,
                                  }}>
                                  {subcategory.name}
                                  {subcategory.amount_minor != null
                                    ? ` · ${formatMoney(subcategory.amount_minor, preferences.currency)}/ea`
                                    : ''}
                                </ThemedText>
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Income
                </ThemedText>
                <View style={styles.chipWrap}>
                  {incomeCategories.map((category) => (
                    <CategoryChip
                      key={category.id}
                      category={category}
                      selected={selectedCategoryIds.includes(category.id)}
                      onPress={() => toggleCategory(category.id)}
                    />
                  ))}
                </View>
              </>
            )}
          </CardBlock>

          {(selectedCategoryIds.length === 0 && selectedSubcategoryIds.length === 0) &&
          data.categories.length > 0 ? (
            <CardBlock style={styles.emptyCard}>
              <ThemedText themeColor="textSecondary">Select categories or items to see their stats.</ThemedText>
            </CardBlock>
          ) : null}

          {statsLoading ? (
            <CardBlock style={styles.loadingCard}>
              <ActivityIndicator color={theme.tint} />
              <ThemedText themeColor="textSecondary">Loading stats for this range…</ThemedText>
            </CardBlock>
          ) : statsError ? (
            <CardBlock>
              <ThemedText type="smallBold">Could not load stats</ThemedText>
              <ThemedText themeColor="textSecondary">{statsError}</ThemedText>
              <UiButton label="Try again" variant="secondary" onPress={refresh} />
            </CardBlock>
          ) : (selectedCategoryIds.length > 0 || selectedSubcategoryIds.length > 0) &&
            categoryStats ? (
            <>
              <View style={styles.statsRow}>
                <StatCard
                  label={
                    includeEstimates && categoryStats.estimateCount > 0
                      ? 'Expenses incl. estimates'
                      : 'Actual expenses'
                  }
                  amount={formatMoney(categoryStats.expenseTotal, preferences.currency)}
                  sign="−"
                  color={theme.error}
                />
                {includeEstimates && categoryStats.estimateCount > 0 ? (
                  <>
                    <StatCard
                      label="Actual expenses"
                      amount={formatMoney(categoryStats.actualExpenseTotal, preferences.currency)}
                      sign="−"
                      color={theme.error}
                    />
                    <StatCard
                      label="Estimated expenses"
                      amount={formatMoney(categoryStats.estimateExpenseTotal, preferences.currency)}
                      sign="−"
                      color={theme.textSecondary}
                    />
                  </>
                ) : null}
                <StatCard
                  label="Average / day since first expense"
                  amount={formatMoney(categoryStats.averagePerDay, preferences.currency)}
                />
                <StatCard
                  label={statsDirection === 'past' ? 'Monthly spend pace' : 'Monthly amount pace'}
                  amount={formatMoney(categoryStats.averagePerDay * 30.44, preferences.currency)}
                />
                <StatCard
                  label="Items"
                  amount={categoryStats.totalQuantity.toLocaleString()}
                />
                <StatCard
                  label="Items / day"
                  amount={categoryStats.averageQuantityPerDay.toFixed(2)}
                />
                <StatCard
                  label="Expense records"
                  amount={categoryStats.count.toLocaleString()}
                />
                <StatCard
                  label="Average amount / record"
                  amount={formatMoney(
                    categoryStats.count ? categoryStats.expenseTotal / categoryStats.count : 0,
                    preferences.currency,
                  )}
                />
                <StatCard
                  label="Average items / record"
                  amount={(categoryStats.count
                    ? categoryStats.totalQuantity / categoryStats.count
                    : 0
                  ).toFixed(1)}
                />
                <StatCard
                  label="Average price / item"
                  amount={formatMoney(
                    categoryStats.totalQuantity
                      ? categoryStats.expenseTotal / categoryStats.totalQuantity
                      : 0,
                    preferences.currency,
                  )}
                />
                <StatCard label="Days in range" amount={categoryStats.daysTracked.toLocaleString()} />
                {categoryStats.incomeTotal > 0 ? (
                  <>
                    <StatCard
                      label={
                        includeEstimates && categoryStats.estimateIncomeTotal > 0
                          ? 'Income incl. estimates'
                          : 'Actual income'
                      }
                      amount={formatMoney(
                        includeEstimates
                          ? categoryStats.incomeTotal
                          : categoryStats.actualIncomeTotal,
                        preferences.currency,
                      )}
                      sign="+"
                      color={theme.success}
                    />
                    {includeEstimates && categoryStats.estimateIncomeTotal > 0 ? (
                      <StatCard
                        label="Estimated income"
                        amount={formatMoney(categoryStats.estimateIncomeTotal, preferences.currency)}
                        sign="+"
                        color={theme.textSecondary}
                      />
                    ) : null}
                    <StatCard
                      label="Net"
                      amount={formatMoney(categoryStats.net, preferences.currency)}
                      sign={categoryStats.net >= 0 ? '+' : '−'}
                      color={categoryStats.net >= 0 ? theme.success : theme.error}
                    />
                  </>
                ) : null}
              </View>

              {statsDirection === 'past' ? (
                <CardBlock>
                <ThemedText type="smallBold">Restock outlook</ThemedText>
                <ThemedText themeColor="textSecondary">
                  Estimates use the average gap between purchase dates; they become more useful
                  after several purchases.
                </ThemedText>
                {categoryStats.itemRows.filter((row) => row.stats.nextPredictedDate).length === 0 ? (
                  <ThemedText themeColor="textSecondary">
                    No repeat purchase pattern yet. Record purchases on different dates to get a
                    restock estimate.
                  </ThemedText>
                ) : (
                  categoryStats.itemRows
                    .filter((row) => row.stats.nextPredictedDate)
                    .sort(
                      (a, b) =>
                        (a.stats.daysUntilNext ?? Infinity) - (b.stats.daysUntilNext ?? Infinity),
                    )
                    .map((row) => (
                      <View key={row.id} style={styles.categoryStatRow}>
                        <View style={styles.flex}>
                          <ThemedText type="smallBold">{row.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {row.kind} · next {formatDate(row.stats.nextPredictedDate)} ·{' '}
                            {row.stats.daysUntilNext != null && row.stats.daysUntilNext <= 0
                              ? 'due now'
                              : `in ${row.stats.daysUntilNext} days`}
                          </ThemedText>
                        </View>
                        <ThemedText type="smallBold" style={{ color: theme.error }}>
                          {formatMoney(row.stats.averageAmount, preferences.currency)} / buy
                        </ThemedText>
                      </View>
                    ))
                )}
                </CardBlock>
              ) : null}

              <CardBlock>
                <ThemedText type="smallBold">
                  {statsDirection === 'past' ? 'Selected targets' : 'Selected projections'}
                </ThemedText>
                {categoryStats.itemRows.length === 0 ? (
                  <ThemedText themeColor="textSecondary">
                    No expenses found for these selections in this range.
                  </ThemedText>
                ) : (
                  categoryStats.itemRows.map((row) => (
                    <View key={row.id} style={styles.targetStats}>
                      <View style={styles.categoryStatRow}>
                        <View style={styles.flex}>
                          <ThemedText type="smallBold">{row.name}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {row.kind} · {row.stats.count} record{row.stats.count === 1 ? '' : 's'}
                          </ThemedText>
                        </View>
                        <ThemedText type="smallBold" style={{ color: theme.error }}>
                          {formatMoney(row.stats.totalAmount, preferences.currency)}
                        </ThemedText>
                      </View>
                      <View style={styles.targetMetricGrid}>
                        <TargetMetric
                          label="Average / day since first expense"
                          value={formatMoney(row.stats.averagePerDay, preferences.currency)}
                        />
                        <TargetMetric
                          label={statsDirection === 'past' ? 'Monthly spend pace' : 'Monthly amount pace'}
                          value={formatMoney(
                            row.stats.averagePerDay * 30.44,
                            preferences.currency,
                          )}
                        />
                        <TargetMetric
                          label="Items / day"
                          value={row.stats.averageQuantityPerDay.toFixed(2)}
                        />
                        <TargetMetric
                          label="Items"
                          value={row.stats.totalQuantity.toLocaleString()}
                        />
                        <TargetMetric
                          label="Avg amount / record"
                          value={formatMoney(row.stats.averageAmount, preferences.currency)}
                        />
                        <TargetMetric
                          label="Avg items / record"
                          value={row.stats.averageQuantity.toFixed(2)}
                        />
                        <TargetMetric
                          label="Avg price / item"
                          value={formatMoney(row.stats.unitPrice, preferences.currency)}
                        />
                        <TargetMetric
                          label="Avg gap / median gap"
                          value={row.stats.averageIntervalDays == null
                            ? 'Not enough history'
                            : `${row.stats.averageIntervalDays.toFixed(1)} / ${row.stats.medianIntervalDays} days`}
                        />
                        {statsDirection === 'past' ? (
                          <>
                            <TargetMetric
                              label="Last bought"
                              value={row.stats.lastPurchase
                                ? `${formatDate(row.stats.lastPurchase)} · ${row.stats.daysSinceLast} days ago`
                                : 'No purchases'}
                            />
                            <TargetMetric
                              label="Estimated next buy"
                              value={row.stats.nextPredictedDate
                                ? `${formatDate(row.stats.nextPredictedDate)} · ${
                                    row.stats.daysUntilNext != null && row.stats.daysUntilNext <= 0
                                      ? 'due now'
                                      : `in ${row.stats.daysUntilNext} days`
                                  }`
                                : 'Need purchases on 2+ dates'}
                            />
                          </>
                        ) : (
                          <TargetMetric
                            label="Estimates in range"
                            value={row.transactions
                              .filter((transaction) => transaction.status === 'estimate')
                              .length.toLocaleString()}
                          />
                        )}
                      </View>
                    </View>
                  ))
                )}
              </CardBlock>
            </>
          ) : null}
        </>
      )}

      <Modal
        visible={editingTransaction !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditingTransaction(null)}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText type="subtitle" style={styles.modalTitle}>
              {editingTransaction?.status === 'estimate'
                ? 'Edit estimate'
                : `Edit ${editingTransaction?.type ?? 'transaction'}`}
            </ThemedText>
            <Pressable onPress={() => setEditingTransaction(null)}>
              <ThemedText style={{ color: theme.tint }}>Cancel</ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <CardBlock>
              <ThemedText type="smallBold">Amount ({preferences.currency})</ThemedText>
              <TextInput
                accessibilityLabel={`${editingTransaction?.type ?? 'Transaction'} amount`}
                keyboardType="decimal-pad"
                value={estimateAmount}
                onChangeText={setEstimateAmount}
                style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              />
              <ThemedText type="smallBold">Date (YYYY-MM-DD)</ThemedText>
              <TextInput
                accessibilityLabel={`${editingTransaction?.type ?? 'Transaction'} date`}
                value={estimateDate}
                onChangeText={setEstimateDate}
                style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              />
              <ThemedText type="smallBold">Category</ThemedText>
              <View style={styles.chipWrap}>
                <ChoiceChip
                  label="Uncategorized"
                  selected={!estimateCategoryId}
                  onPress={() => setEstimateCategoryId('')}
                />
                {data?.categories
                  .filter((category) => category.type === editingTransaction?.type)
                  .map((category) => (
                    <ChoiceChip
                      key={category.id}
                      label={category.name}
                      selected={estimateCategoryId === category.id}
                      onPress={() => setEstimateCategoryId(category.id)}
                    />
                  ))}
              </View>
              <ThemedText type="smallBold">Description (optional)</ThemedText>
              <TextInput
                value={estimateDescription}
                onChangeText={setEstimateDescription}
                placeholder="What was this for?"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
              />
              <UiButton
                label={editingTransaction?.status === 'estimate' ? 'Save estimate' : 'Save changes'}
                onPress={() => void handleSaveTransaction()}
              />
              {editingTransaction?.status === 'estimate' && (
                <UiButton
                  label={`Save and mark as actual ${editingTransaction.type}`}
                  variant="secondary"
                  onPress={() => void handleSaveTransaction(true)}
                />
              )}
            </CardBlock>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={categoryModal && !scannerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCategoryManager}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText type="subtitle" style={styles.modalTitle}>
              {transactionType === 'expense' ? 'Expense' : 'Income'} categories
            </ThemedText>
            <Pressable onPress={closeCategoryManager}>
              <ThemedText style={{ color: theme.tint }}>Done</ThemedText>
            </Pressable>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* --- Add new category / subcategory --- */}
            {!subcategoryEditorVisible && (
              <CardBlock
                style={[
                  styles.modalCard,
                  { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText type="smallBold">Add new</ThemedText>
                <TextInput
                  value={newItemName}
                  onChangeText={setNewItemName}
                  placeholder="Category or subcategory name"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                />
                <ThemedText type="smallBold">Parent category</ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDropdownOpen((open) => !open)}
                  style={[
                    styles.dropdown,
                    {
                      borderColor: theme.backgroundSelected,
                      backgroundColor: dropdownOpen
                        ? theme.backgroundElement
                        : theme.background,
                    },
                  ]}>
                  <ThemedText style={{ color: theme.text }}>
                    {selectedParentCategoryId === null
                      ? 'New category'
                      : data?.categories.find((c) => c.id === selectedParentCategoryId)?.name ??
                        'New category'}
                  </ThemedText>
                  <ThemedText style={{ color: theme.tint, fontSize: 20 }}>
                    {dropdownOpen ? '▲' : '▼'}
                  </ThemedText>
                </Pressable>
                {dropdownOpen && (
                  <ScrollView
                    style={[
                      styles.dropdownList,
                      { borderColor: theme.backgroundSelected },
                    ]}
                    showsVerticalScrollIndicator={false}
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setSelectedParentCategoryId(null);
                        setDropdownOpen(false);
                      }}
                      style={styles.dropdownItem}>
                      <ThemedText style={{ color: theme.text }}>
                        New category
                      </ThemedText>
                    </Pressable>
                    {categoriesForType.map((category) => (
                      <Pressable
                        key={category.id}
                        accessibilityRole="button"
                        onPress={() => {
                          setSelectedParentCategoryId(category.id);
                          setDropdownOpen(false);
                        }}
                        style={styles.dropdownItem}>
                        <ThemedText style={{ color: theme.text }}>
                          {category.name}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                {selectedParentCategoryId !== null && (
                  <View style={styles.amountRow}>
                    <ThemedText type="smallBold">Fixed amount (optional)</ThemedText>
                    <ThemedText themeColor="textSecondary">
                      Leave blank if the amount varies each time.
                    </ThemedText>
                    <TextInput
                      keyboardType="decimal-pad"
                      value={subcategoryAmount}
                      onChangeText={setSubcategoryAmount}
                      placeholder={`Amount in ${preferences.currency}`}
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                    />
                    <ThemedText type="smallBold">Barcode (optional)</ThemedText>
                    <TextInput
                      value={newSubcategoryBarcode}
                      onChangeText={setNewSubcategoryBarcode}
                      placeholder="Scan or enter a barcode"
                      placeholderTextColor={theme.textSecondary}
                      autoCapitalize="none"
                      style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                    />
                    <UiButton
                      label="Scan barcode"
                      variant="secondary"
                      onPress={() => void openBarcodeScanner('new-subcategory')}
                    />
                  </View>
                )}
                <UiButton
                  label={editingCategoryId ? 'Save changes' : selectedParentCategoryId === null ? 'Add category' : 'Add subcategory'}
                  onPress={handleSaveNewItem}
                />
              </CardBlock>
            )}

            {subcategoryEditorVisible && (
              <CardBlock
                style={[
                  styles.modalCard,
                  { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedText type="smallBold">Edit subcategory</ThemedText>
                <TextInput
                  value={subcategoryName}
                  onChangeText={setSubcategoryName}
                  placeholder="e.g. Coca Cola 1.5L"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                />
                <ThemedText type="smallBold">Fixed amount (optional)</ThemedText>
                <ThemedText themeColor="textSecondary">
                  Leave blank if the amount varies each time.
                </ThemedText>
                <TextInput
                  keyboardType="decimal-pad"
                  value={subcategoryAmount}
                  onChangeText={setSubcategoryAmount}
                  placeholder={`Amount in ${preferences.currency}`}
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                />
                <ThemedText type="smallBold">Barcode (optional)</ThemedText>
                <TextInput
                  value={subcategoryBarcode}
                  onChangeText={setSubcategoryBarcode}
                  placeholder="Scan or enter a barcode"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                />
                <UiButton
                  label="Scan barcode"
                  variant="secondary"
                  onPress={() => void openBarcodeScanner('subcategory')}
                />
                <UiButton
                  label="Save changes"
                  onPress={() => void handleSaveSubcategory()}
                />
                <UiButton
                  label="Cancel editing"
                  variant="secondary"
                  onPress={closeSubcategoryEditor}
                />
              </CardBlock>
            )}

            {/* --- Existing categories (manage) --- */}
            <ThemedText type="smallBold" style={styles.manageSectionTitle}>
              Existing {transactionType === 'expense' ? 'expense' : 'income'} categories
            </ThemedText>
            {categoriesForType.map((category) => {
              const isExpanded = expandedCategoryId === category.id;
              const subs = (data?.subcategories ?? []).filter(
                (s) => s.category_id === category.id
              );
              return (
                <View key={category.id} style={styles.modalCategorySection}>
                  <View style={styles.modalCategoryRow}>
                    <ThemedText style={styles.flex}>{category.name}</ThemedText>
                    <View style={styles.modalCategoryActions}>
                      <Pressable
                        onPress={() =>
                          setExpandedCategoryId(
                            expandedCategoryId === category.id ? null : category.id
                          )
                        }>
                        <ThemedText style={{ color: theme.tint }}>
                          {isExpanded ? '▾' : '▸'}
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setEditingCategoryId(category.id);
                          setNewItemName(category.name);
                          setSelectedParentCategoryId(null);
                          setDropdownOpen(false);
                        }}>
                        <ThemedText style={{ color: theme.tint }}>Edit</ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          Alert.alert(
                            'Delete category?',
                            'Existing transactions will stay but become uncategorized.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: () => {
                                  void runWrite(
                                    () => deleteCategory(category.id),
                                    'Category deleted.',
                                  );
                                  if (categoryId === category.id) setCategoryId('');
                                },
                              },
                            ],
                          )
                        }>
                        <ThemedText style={{ color: theme.error }}>Delete</ThemedText>
                      </Pressable>
                    </View>
                  </View>
                  {isExpanded && subs.length > 0 && (
                    <View style={styles.subcategoryList}>
                      {subs.map((sub) => (
                        <View key={sub.id} style={styles.subcategoryRowModal}>
                          <ThemedText style={styles.flex}>
                            {sub.name}
                            {sub.amount_minor != null && (
                              <ThemedText type="small" themeColor="textSecondary">
                                {' · '}
                                {formatMoney(sub.amount_minor, preferences.currency)}
                              </ThemedText>
                            )}
                          </ThemedText>
                          <View style={styles.subcategoryActions}>
                            <Pressable
                              onPress={() => {
                                setEditingSubcategory(sub);
                                setSubcategoryCategoryId(sub.category_id);
                                setSubcategoryName(sub.name);
                                setSubcategoryAmount(
                                  sub.amount_minor != null
                                    ? String(
                                        sub.amount_minor /
                                          10 ** currencyDecimals(preferences.currency)
                                      )
                                    : ''
                                );
                                setSubcategoryBarcode(sub.barcode ?? '');
                                setSubcategoryEditorVisible(true);
                              }}>
                              <ThemedText style={{ color: theme.tint }}>Edit</ThemedText>
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                Alert.alert(
                                  'Delete subcategory?',
                                  'Transactions using it will stay but become uncategorized.',
                                  [
                                    { text: 'Cancel', style: 'cancel' },
                                    {
                                      text: 'Delete',
                                      style: 'destructive',
                                      onPress: () => {
                                        void runWrite(
                                          () => deleteSubcategory(sub.id),
                                          'Subcategory deleted.',
                                        );
                                        if (subcategoryId === sub.id) setSubcategoryId(null);
                                      },
                                    },
                                  ],
                                )
                              }>
                              <ThemedText style={{ color: theme.error }}>Delete</ThemedText>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                  {!isExpanded && subs.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {subs.length} subcategory{subs.length !== 1 ? 'ies' : ''}
                    </ThemedText>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={scannerVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeBarcodeScanner}>
        <View style={[styles.cameraModal, { backgroundColor: '#000' }]}>
          {scannerVisible ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'],
              }}
              onCameraReady={() => setCameraReady(true)}
              onMountError={(event) => handleCameraMountError(event.message)}
              onBarcodeScanned={handleBarcodeScanned}
            />
          ) : null}
          <View style={styles.cameraHeader}>
            <ThemedText type="subtitle" style={{ color: '#fff' }}>
              Scan item barcode
            </ThemedText>
            {batchMode ? (
              <>
                {batchCategoryId && data ? (
                  <View style={styles.batchScannerInfo}>
                    <ThemedText style={{ color: '#fff', fontSize: 13, opacity: 0.9 }}>
                      {batchDate} ·{' '}
                      {data.categories.find((category) => category.id === batchCategoryId)?.name}
                    </ThemedText>
                  </View>
                ) : null}
                <Pressable accessibilityRole="button" onPress={closeBatchScanner}>
                  <ThemedText style={{ color: '#fff' }}>Back</ThemedText>
                </Pressable>
              </>
            ) : (
              <Pressable accessibilityRole="button" onPress={closeBarcodeScanner}>
                <ThemedText style={{ color: '#fff' }}>Close</ThemedText>
              </Pressable>
            )}
          </View>
          <View style={styles.cameraHint}>
            <ThemedText style={{ color: '#fff', textAlign: 'center' }}>
              {cameraReady
                ? 'Align the barcode inside the camera view.'
                : 'Opening camera…'}
            </ThemedText>
          </View>
        </View>
      </Modal>
      <Modal
        visible={scanChoiceVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setScanChoiceVisible(false);
          setScanRequiresBarcodeMapping(false);
        }}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText type="subtitle" style={styles.modalTitle}>
              {scanRequiresBarcodeMapping ? 'Link barcode to item' : 'Choose matching item'}
            </ThemedText>
            <Pressable
              onPress={() => {
                setScanChoiceVisible(false);
                setScanRequiresBarcodeMapping(false);
              }}>
              <ThemedText style={{ color: theme.tint }}>Cancel</ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <ThemedText themeColor="textSecondary">
              {scanRequiresBarcodeMapping
                ? `No item is saved for barcode ${scannedBarcode}. Choose a subcategory to save it for next time.`
                : 'This barcode is linked to more than one subcategory. Choose the correct category and item.'}
            </ThemedText>
            {scanCandidates.map((subcategory) => {
              const category = data.categories.find(
                (item) => item.id === subcategory.category_id,
              );
              return (
                <Pressable
                  key={subcategory.id}
                  accessibilityRole="button"
                  onPress={() =>
                    void selectScannedSubcategory(
                      subcategory,
                      scanRequiresBarcodeMapping,
                    )
                  }
                  style={[
                    styles.scanCandidate,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.backgroundSelected,
                    },
                  ]}>
                  <ThemedText type="smallBold">{subcategory.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {category?.name ?? 'Unknown category'}
                  </ThemedText>
                </Pressable>
              );
            })}
            {scanCandidates.length === 0 ? (
              <>
                <ThemedText themeColor="textSecondary">
                  Create a subcategory first, then add this barcode to it.
                </ThemedText>
                <UiButton
                  label="Manage categories"
                  onPress={() => {
                    setScanChoiceVisible(false);
                    setScanRequiresBarcodeMapping(false);
                    setNewSubcategoryBarcode(scannedBarcode);
                    setNewItemName('');
                    setSelectedParentCategoryId(null);
                    setCategoryModal(true);
                  }}
                />
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      {batchMode && !scannerVisible && !batchPendingSubcategory && (
        <Modal
          visible={true}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={closeBatchMode}>
          <View style={[styles.modal, { backgroundColor: theme.background }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                Add multiple items
              </ThemedText>
              <Pressable onPress={closeBatchMode}>
                <ThemedText style={{ color: theme.tint }}>Cancel</ThemedText>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled">
              <CardBlock
                style={[styles.modalCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold">Date</ThemedText>
                <TextInput
                  value={batchDate}
                  onChangeText={setBatchDate}
                  placeholder={localDateString(new Date())}
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  All scanned items will be saved with this date.
                </ThemedText>
                <ThemedText type="smallBold">Category</ThemedText>
                {categoriesForType.map((category) => (
                  <Pressable
                    key={category.id}
                    accessibilityRole="button"
                    onPress={() => handleBatchCategorySelect(category.id)}
                    style={[
                      styles.batchCategoryRow,
                      batchCategoryId === category.id
                        ? { backgroundColor: theme.tint, borderColor: theme.tint }
                        : {
                            backgroundColor: theme.backgroundElement,
                            borderColor: theme.backgroundSelected,
                          },
                    ]}>
                    <ThemedText
                      type="smallBold"
                      style={{ color: batchCategoryId === category.id ? '#fff' : theme.text }}>
                      {category.name}
                    </ThemedText>
                    {batchCategoryId === category.id && (
                      <ThemedText style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: 14 }}>
                        ✓
                      </ThemedText>
                    )}
                  </Pressable>
                ))}
                {categoriesForType.length === 0 && (
                  <ThemedText themeColor="textSecondary">
                    No categories for this type yet. Add some first.
                  </ThemedText>
                )}
                <ThemedText type="small" themeColor="textSecondary">
                  All scanned items will be saved with this category.
                </ThemedText>
              </CardBlock>
              <View style={styles.batchActions}>
                <UiButton
                  label="Cancel"
                  variant="secondary"
                  onPress={closeBatchMode}
                  style={styles.batchActionButton}
                />
                <UiButton
                  label="Start scanning"
                  disabled={!batchCategoryId}
                  onPress={startBatchScanning}
                  style={styles.batchActionButton}
                />
              </View>
            </ScrollView>
          </View>
        </Modal>
      )}

      {!!batchPendingSubcategory && !scannerVisible && (
        <Modal
          visible={true}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={cancelBatchItem}>
          <View style={[styles.modal, { backgroundColor: theme.background }]}>
            <View style={styles.modalHeader}>
              <ThemedText type="subtitle" style={styles.modalTitle}>
                {batchPendingSubcategory.name}
              </ThemedText>
              <Pressable onPress={cancelBatchItem}>
                <ThemedText style={{ color: theme.tint }}>Cancel</ThemedText>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <CardBlock
                style={[styles.modalCard, { backgroundColor: theme.backgroundElement }]}>
                {batchPendingSubcategory.amount_minor != null && (
                  <>
                    <ThemedText type="smallBold">Unit price</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatMoney(
                        batchPendingSubcategory.amount_minor,
                        preferences.currency,
                      )}
                    </ThemedText>
                  </>
                )}
                <ThemedText type="smallBold">Quantity</ThemedText>
                <View style={styles.batchQuantityRow}>
                  <Pressable
                    accessibilityLabel="Decrease quantity"
                    onPress={() => {
                      const parsed = parseQuantity(batchQuantity);
                      if (parsed != null && parsed > 1) {
                        setBatchQuantity(String(Math.max(1, parsed - 1)));
                      } else {
                        setBatchQuantity('1');
                      }
                    }}
                    style={[
                      styles.batchQuantityButton,
                      { backgroundColor: theme.backgroundElement },
                    ]}>
                    <ThemedText style={{ color: theme.tint, fontWeight: '700', fontSize: 20 }}>
                      −
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Quantity"
                    onPress={toggleBatchQuantityEditing}
                    style={[
                      styles.batchQuantityDisplay,
                      { backgroundColor: theme.backgroundElement },
                    ]}>
                    {batchEditingQuantity ? (
                      <TextInput
                        value={batchQuantity}
                        onChangeText={setBatchQuantity}
                        keyboardType="numeric"
                        onSubmitEditing={(event) =>
                          finishBatchQuantityEditing(event.nativeEvent.text)
                        }
                        onBlur={() => finishBatchQuantityEditing(batchQuantity)}
                        style={{
                          flex: 1,
                          color: theme.text,
                          fontSize: 22,
                          fontWeight: '700',
                          textAlign: 'center',
                        }}
                      />
                    ) : (
                      <ThemedText style={{ color: theme.text, fontSize: 24, fontWeight: '700' }}>
                        {batchQuantity}
                      </ThemedText>
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Increase quantity"
                    onPress={() => {
                      const parsed = parseQuantity(batchQuantity);
                      setBatchQuantity(parsed != null ? String(parsed + 1) : '1');
                    }}
                    style={[
                      styles.batchQuantityButton,
                      { backgroundColor: theme.backgroundElement },
                    ]}>
                    <ThemedText style={{ color: theme.tint, fontWeight: '700', fontSize: 20 }}>
                      +
                    </ThemedText>
                  </Pressable>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  Tap the number to type a quantity directly.
                </ThemedText>
              </CardBlock>
              <View style={styles.batchActions}>
                <UiButton
                  label="Cancel"
                  variant="secondary"
                  onPress={cancelBatchItem}
                  style={styles.batchActionButton}
                />
                <UiButton
                  label="Confirm"
                  onPress={confirmBatchItem}
                  style={styles.batchActionButton}
                />
              </View>
            </ScrollView>
          </View>
        </Modal>
      )}

    </Screen>
  );
}

function SummaryCard({ title, amount }: { title: string; amount: string }) {
  return (
    <CardBlock style={styles.summaryCard}>
      <ThemedText type="small" themeColor="textSecondary">{title}</ThemedText>
      <ThemedText type="smallBold" style={styles.summaryAmount}>{amount}</ThemedText>
    </CardBlock>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.tint : theme.background,
          borderColor: selected ? theme.tint : theme.backgroundSelected,
        },
      ]}>
      <ThemedText style={{ color: selected ? '#fff' : theme.text }}>{label}</ThemedText>
    </Pressable>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

type PurchaseStats = {
  totalAmount: number;
  totalQuantity: number;
  count: number;
  averageAmount: number;
  averageQuantity: number;
  unitPrice: number;
  averagePerDay: number;
  averageQuantityPerDay: number;
  averageIntervalDays: number | null;
  medianIntervalDays: number | null;
  lastPurchase: string | null;
  daysSinceLast: number;
  nextPredictedDate: string | null;
  daysUntilNext: number | null;
};

function daysSinceFirstActualExpense(
  transactions: MoneyTransaction[],
  throughDate: string,
  fallbackDays: number,
): number {
  const today = localDateString(new Date());
  const firstActualDate = transactions
    .filter(
      (transaction) =>
        transaction.type === 'expense' &&
        transaction.status === 'valid' &&
        transaction.occurred_at.slice(0, 10) <= today,
    )
    .map((transaction) => transaction.occurred_at.slice(0, 10))
    .sort()[0];
  if (!firstActualDate) return fallbackDays;
  return Math.max(
    1,
    Math.floor(
      (parseLocalDate(throughDate).getTime() - parseLocalDate(firstActualDate).getTime()) /
        86_400_000,
    ) + 1,
  );
}

function calculatePurchaseStats(
  transactions: MoneyTransaction[],
  lifetimeTransactions: MoneyTransaction[],
  throughDate: string,
  fallbackDays: number,
): PurchaseStats {
  const sorted = [...transactions].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const totalAmount = sorted.reduce((sum, transaction) => sum + transaction.amount_minor, 0);
  const totalQuantity = sorted.reduce(
    (sum, transaction) => sum + (transaction.quantity || 1),
    0,
  );
  const lifetimeAmount = lifetimeTransactions.reduce(
    (sum, transaction) => sum + transaction.amount_minor,
    0,
  );
  const lifetimeQuantity = lifetimeTransactions.reduce(
    (sum, transaction) => sum + (transaction.quantity || 1),
    0,
  );
  const daysTracked = daysSinceFirstActualExpense(
    lifetimeTransactions,
    throughDate,
    fallbackDays,
  );
  const purchaseDates = [...new Set(sorted.map((transaction) => transaction.occurred_at.slice(0, 10)))];
  const intervals = purchaseDates.slice(1).map((date, index) =>
    Math.round(
      (parseLocalDate(date).getTime() - parseLocalDate(purchaseDates[index]).getTime()) /
        86_400_000,
    ),
  );
  const averageIntervalDays = intervals.length
    ? intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
    : null;
  const orderedIntervals = [...intervals].sort((a, b) => a - b);
  const middle = Math.floor(orderedIntervals.length / 2);
  const medianIntervalDays = orderedIntervals.length
    ? orderedIntervals.length % 2
      ? orderedIntervals[middle]
      : (orderedIntervals[middle - 1] + orderedIntervals[middle]) / 2
    : null;
  const lastPurchase = purchaseDates[purchaseDates.length - 1] ?? null;
  const today = parseLocalDate(localDateString(new Date()));
  const daysSinceLast = lastPurchase
    ? Math.max(0, Math.floor((today.getTime() - parseLocalDate(lastPurchase).getTime()) / 86_400_000))
    : 0;
  let nextPredictedDate: string | null = null;
  let daysUntilNext: number | null = null;
  if (lastPurchase && averageIntervalDays != null) {
    const prediction = parseLocalDate(lastPurchase);
    prediction.setDate(prediction.getDate() + Math.max(1, Math.round(averageIntervalDays)));
    nextPredictedDate = localDateString(prediction);
    daysUntilNext = Math.ceil((prediction.getTime() - today.getTime()) / 86_400_000);
  }

  return {
    totalAmount,
    totalQuantity,
    count: sorted.length,
    averageAmount: sorted.length ? totalAmount / sorted.length : 0,
    averageQuantity: sorted.length ? totalQuantity / sorted.length : 0,
    unitPrice: totalQuantity ? totalAmount / totalQuantity : 0,
    averagePerDay: daysTracked ? lifetimeAmount / daysTracked : 0,
    averageQuantityPerDay: daysTracked ? lifetimeQuantity / daysTracked : 0,
    averageIntervalDays,
    medianIntervalDays,
    lastPurchase,
    daysSinceLast,
    nextPredictedDate,
    daysUntilNext,
  };
}

function StatCard({
  label,
  amount,
  sign,
  color,
}: {
  label: string;
  amount: string;
  sign?: string;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <CardBlock style={styles.statCard}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={[styles.statAmount, { color: color ?? theme.text }]}>
        {sign ? `${sign} ` : ''}{amount}
      </ThemedText>
    </CardBlock>
  );
}

function TargetMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.targetMetric}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

function CategoryChip({
  category,
  selected,
  onPress,
}: {
  category: MoneyCategory;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.tint : theme.background,
          borderColor: selected ? theme.tint : theme.backgroundSelected,
        },
      ]}>
      <ThemedText style={{ color: selected ? '#fff' : theme.text, fontWeight: '600' }}>
        {category.name}
      </ThemedText>
      {selected && (
        <ThemedText style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: 14 }}>
          ✓
        </ThemedText>
      )}
    </Pressable>
  );
}

function TransactionRow({
  transaction,
  currency,
}: {
  transaction: MoneyTransaction;
  currency: string;
}) {
  const theme = useTheme();
  const isIncome = transaction.type === 'income';
  return (
    <View style={styles.listRow}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">
          {transaction.description || transaction.category_name || 'Uncategorized'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {transaction.status === 'estimate' ? 'Estimate · ' : ''}
          {transaction.category_name ?? 'Uncategorized'} · {transaction.occurred_at.slice(0, 10)}
        </ThemedText>
      </View>
      <ThemedText style={{ color: isIncome ? theme.success : theme.error, fontWeight: '700' }}>
        {isIncome ? '+' : '−'}{formatMoney(transaction.amount_minor, currency)}
      </ThemedText>
    </View>
  );
}

function CalendarEntryRow({
  entry,
  currency,
  onDelete,
  onEdit,
  onConfirm,
}: {
  entry: CalendarEntry;
  currency: string;
  onDelete: () => void;
  onEdit?: () => void;
  onConfirm?: () => void;
}) {
  const theme = useTheme();
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  return (
    <Swipeable
      ref={swipeableRef}
      overshootRight={false}
      containerStyle={styles.calendarSwipeContainer}
      childrenContainerStyle={[
        styles.calendarSwipeContent,
        { backgroundColor: theme.backgroundElement },
      ]}
      renderRightActions={() => (
        <View style={styles.calendarRowActions}>
          {!entry.scheduled && onEdit && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${entry.type}`}
              onPress={() => {
                swipeableRef.current?.close();
                onEdit();
              }}
              style={[styles.calendarEditAction, { backgroundColor: theme.tint }]}>
              <ThemedText type="smallBold" style={styles.calendarDeleteLabel}>
                Edit
              </ThemedText>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${entry.scheduled ? 'estimate' : entry.type}`}
            onPress={() => {
              swipeableRef.current?.close();
              onDelete();
            }}
            style={[styles.calendarDeleteAction, { backgroundColor: theme.error }]}>
            <ThemedText type="smallBold" style={styles.calendarDeleteLabel}>
              Delete
            </ThemedText>
          </Pressable>
        </View>
      )}>
      <View style={styles.calendarEntry}>
        <View style={styles.listRow}>
          <View style={styles.flex}>
            <ThemedText type="smallBold">
              {entry.description || entry.category_name || 'Uncategorized'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {entry.category_name ?? 'Uncategorized'}{entry.subcategory_name ? ` · ${entry.subcategory_name}` : ''} · {entry.scheduled ? 'Estimate' : entry.type}
            </ThemedText>
          </View>
          <ThemedText
            style={{
              color:
                entry.type === 'income'
                  ? theme.success
                  : entry.type === 'expense'
                    ? theme.error
                    : theme.text,
              fontWeight: '700',
            }}>
            {entry.type === 'income' ? '+' : '−'}{formatMoney(entry.amount_minor, currency)}
          </ThemedText>
        </View>
        {entry.scheduled ? (
          <View style={styles.estimateActions}>
            <Pressable accessibilityRole="button" onPress={onEdit} style={styles.estimateAction}>
              <ThemedText style={{ color: theme.tint, fontWeight: '600' }}>Edit estimate</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onConfirm} style={styles.estimateAction}>
              <ThemedText style={{ color: theme.success, fontWeight: '600' }}>
                Mark as actual {entry.type}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Swipeable>
  );
}

function RecurringRuleRow({
  rule,
  currency,
  onDelete,
}: {
  rule: RecurringRule;
  currency: string;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const summary =
    rule.frequency === 'monthly_day'
      ? `Monthly on day ${rule.day_of_month}`
      : rule.frequency === 'weekly'
        ? `Every ${WEEKDAYS[rule.weekday ?? 0]}`
        : `Every ${rule.interval_days} days`;
  return (
    <View style={styles.listRow}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">
          {rule.description || rule.category_name || (rule.type === 'income' ? 'Income' : 'Expense')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {rule.category_name ?? 'Uncategorized'} · {summary} · starts {rule.start_date}
        </ThemedText>
      </View>
      <View style={styles.ruleActions}>
        <ThemedText style={{ color: rule.type === 'income' ? theme.success : theme.error }}>
          {formatMoney(rule.amount_minor, currency)}
        </ThemedText>
        <Pressable onPress={onDelete}>
          <ThemedText style={{ color: theme.error }}>Delete</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function BudgetSummary({
  budgets,
  categories,
  transactions,
  currency,
}: {
  budgets: MoneyData['budgets'];
  categories: MoneyCategory[];
  transactions: MoneyTransaction[];
  currency: string;
}) {
  const theme = useTheme();
  const globalBudget = budgets.find((budget) => budget.category_id === 'all');
  const categoryBudgets = budgets.filter((budget) => budget.category_id !== 'all');
  const totalBudget = globalBudget?.amount_minor ??
    categoryBudgets.reduce((sum, budget) => sum + budget.amount_minor, 0);
  const spentTotal = transactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + transaction.amount_minor, 0);
  const rows = [
    ...(globalBudget
      ? [{ id: 'all', name: 'All expenses', target: globalBudget.amount_minor, spent: spentTotal }]
      : []),
    ...categoryBudgets.map((budget) => ({
        id: budget.category_id,
        name: categories.find((category) => category.id === budget.category_id)?.name ?? 'Category removed',
        target: budget.amount_minor,
        spent: transactions
          .filter(
            (transaction) =>
              transaction.type === 'expense' && transaction.category_id === budget.category_id,
          )
          .reduce((sum, transaction) => sum + transaction.amount_minor, 0),
      })),
  ];

  if (budgets.length === 0) {
    return <ThemedText themeColor="textSecondary">Set a target to see your progress here.</ThemedText>;
  }

  const totalProgress = totalBudget > 0 ? Math.round((spentTotal / totalBudget) * 100) : 0;

  return (
    <View style={styles.budgetList}>
      {!globalBudget && (
        <View style={styles.budgetItem}>
          <View style={styles.budgetLabelRow}>
            <ThemedText type="smallBold">Combined target</ThemedText>
            <ThemedText type="small">{totalProgress}%</ThemedText>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, totalProgress)}%`,
                  backgroundColor: totalProgress >= 100 ? theme.error : theme.tint,
                },
              ]}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {formatMoney(spentTotal, currency)} of {formatMoney(totalBudget, currency)}
          </ThemedText>
        </View>
      )}
      {rows.map((row) => {
        const progress = Math.round((row.spent / row.target) * 100);
        return (
          <View key={row.id} style={styles.budgetItem}>
            <View style={styles.budgetLabelRow}>
              <ThemedText type="smallBold">{row.name}</ThemedText>
              <ThemedText type="small">{progress}%</ThemedText>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, progress)}%`,
                    backgroundColor: progress >= 100 ? theme.error : theme.tint,
                  },
                ]}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {formatMoney(row.spent, currency)} of {formatMoney(row.target, currency)}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

function CalendarGrid({
  start,
  startDay,
  selectedDate,
  transactions,
  recurring,
  currency,
  onSelect,
}: {
  start: Date;
  startDay: number;
  selectedDate: string;
  transactions: MoneyTransaction[];
  recurring: CalendarEntry[];
  currency: string;
  onSelect: (date: string) => void;
}) {
  const theme = useTheme();
  const firstGridDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay());
  const dates = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGridDate);
    date.setDate(date.getDate() + index);
    return date;
  });
  const end = getPeriodEnd(start, startDay);

  const dayIncome = new Map<string, number>();
  const dayExpense = new Map<string, number>();
  const estimateIncome = new Map<string, number>();
  const estimateExpense = new Map<string, number>();
  const addEntry = (entry: { type: TransactionType; amount_minor: number; occurred_at: string }) => {
    const dateString = entry.occurred_at.slice(0, 10);
    const target = entry.type === 'income' ? dayIncome : dayExpense;
    target.set(dateString, (target.get(dateString) ?? 0) + entry.amount_minor);
  };
  const addEstimate = (entry: { type: TransactionType; amount_minor: number; occurred_at: string }) => {
    const dateString = entry.occurred_at.slice(0, 10);
    const target = entry.type === 'income' ? estimateIncome : estimateExpense;
    target.set(dateString, (target.get(dateString) ?? 0) + entry.amount_minor);
  };
  for (const transaction of transactions) addEntry(transaction);
  for (const entry of recurring) addEstimate(entry);

  // Chunk the 42 grid dates into 6 weeks of 7 so each row renders exactly
  // 7 cells and Saturday never wraps to the next line.
  const weeks: Date[][] = [];
  for (let i = 0; i < dates.length; i += 7) {
    weeks.push(dates.slice(i, i + 7));
  }

  return (
    <View style={styles.calendarGrid}>
      <View style={styles.weekRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <ThemedText key={`${day}-${index}`} type="small" themeColor="textSecondary" style={styles.weekday}>
            {day}
          </ThemedText>
        ))}
      </View>
      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.weekRow}>
          {week.map((date) => {
            const dateString = localDateString(date);
            const inPeriod = date >= start && date <= end;
            const income = dayIncome.get(dateString) ?? 0;
            const expense = dayExpense.get(dateString) ?? 0;
            const estimatedIncome = estimateIncome.get(dateString) ?? 0;
            const estimatedExpense = estimateExpense.get(dateString) ?? 0;
            const isSelected = selectedDate === dateString;
            return (
              <Pressable
                key={dateString}
                accessibilityRole="button"
                accessibilityLabel={
                  `${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${
                    income > 0 ? `, ${formatMoney(income, currency)} income` : ''
                  }${expense > 0 ? `, ${formatMoney(expense, currency)} expenses` : ''}${
                    estimatedIncome > 0
                      ? `, ${formatMoney(estimatedIncome, currency)} estimated income`
                      : ''
                  }${
                    estimatedExpense > 0
                      ? `, ${formatMoney(estimatedExpense, currency)} estimated expenses`
                      : ''
                  }`
                }
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelect(dateString)}
                style={[styles.dateCell, isSelected && { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText
                  style={[
                    styles.dayNumber,
                    {
                      color: inPeriod ? theme.text : theme.textSecondary,
                      opacity: inPeriod ? 1 : 0.45,
                      fontWeight: isSelected ? '700' : '400',
                    },
                  ]}>
                  {date.getDate()}
                </ThemedText>
                {income > 0 && (
                  <ThemedText style={[styles.dayAmount, { color: theme.success }]} numberOfLines={1}>
                    +{formatMoney(income, currency)}
                  </ThemedText>
                )}
                {expense > 0 && (
                  <ThemedText style={[styles.dayAmount, { color: theme.error }]} numberOfLines={1}>
                    −{formatMoney(expense, currency)}
                  </ThemedText>
                )}
                {estimatedIncome > 0 && (
                  <ThemedText style={[styles.dayEstimate, { color: theme.textSecondary }]} numberOfLines={1}>
                    ~+{formatMoney(estimatedIncome, currency)}
                  </ThemedText>
                )}
                {estimatedExpense > 0 && (
                  <ThemedText style={[styles.dayEstimate, { color: theme.textSecondary }]} numberOfLines={1}>
                    ~−{formatMoney(estimatedExpense, currency)}
                  </ThemedText>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function RecurringFields({
  themeText,
  borderColor,
  frequency,
  setFrequency,
  dayOfMonth,
  setDayOfMonth,
  intervalDays,
  setIntervalDays,
  weekday,
  setWeekday,
  endDate,
  setEndDate,
}: {
  themeText: string;
  borderColor: string;
  frequency: RecurringFrequency;
  setFrequency: (value: RecurringFrequency) => void;
  dayOfMonth: string;
  setDayOfMonth: (value: string) => void;
  intervalDays: string;
  setIntervalDays: (value: string) => void;
  weekday: number;
  setWeekday: (value: number) => void;
  endDate: string;
  setEndDate: (value: string) => void;
}) {
  return (
    <View style={styles.recurringFields}>
      <ThemedText type="smallBold">Repeat</ThemedText>
      <View style={styles.chipWrap}>
        <ChoiceChip label="Monthly" selected={frequency === 'monthly_day'} onPress={() => setFrequency('monthly_day')} />
        <ChoiceChip label="Every N days" selected={frequency === 'every_days'} onPress={() => setFrequency('every_days')} />
        <ChoiceChip label="Weekly" selected={frequency === 'weekly'} onPress={() => setFrequency('weekly')} />
      </View>
      {frequency === 'monthly_day' && (
        <TextInput
          accessibilityLabel="Day of month"
          keyboardType="number-pad"
          value={dayOfMonth}
          onChangeText={setDayOfMonth}
          placeholder="Day of month (1–31)"
          placeholderTextColor="#777"
          style={[styles.input, { color: themeText, borderColor }]}
        />
      )}
      {frequency === 'every_days' && (
        <TextInput
          accessibilityLabel="Repeat every number of days"
          keyboardType="number-pad"
          value={intervalDays}
          onChangeText={setIntervalDays}
          placeholder="Number of days"
          placeholderTextColor="#777"
          style={[styles.input, { color: themeText, borderColor }]}
        />
      )}
      {frequency === 'weekly' && (
        <View style={styles.chipWrap}>
          {WEEKDAYS.map((day, index) => (
            <ChoiceChip
              key={day}
              label={day.slice(0, 3)}
              selected={weekday === index}
              onPress={() => setWeekday(index)}
            />
          ))}
        </View>
      )}
      <ThemedText type="small">End date (optional, YYYY-MM-DD)</ThemedText>
      <TextInput
        value={endDate}
        onChangeText={setEndDate}
        placeholder="No end date"
        placeholderTextColor="#777"
        style={[styles.input, { color: themeText, borderColor }]}
      />
      <ThemedText type="small" themeColor="textSecondary">
        The first item is recorded as actual (unless it’s in the future). Later dates appear as
        estimates and stay out of stats and budgets until you confirm them.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  pageTitle: {
    fontSize: 32,
    lineHeight: 38,
  },
  bottomTabs: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  bottomTab: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    minHeight: 44,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  summaryCard: {
    flex: 1,
    minWidth: 0,
  },
  summaryAmount: {
    fontSize: 17,
  },
  moneyTotal: {
    fontSize: 28,
    lineHeight: 36,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendarLabel: {
    flex: 1,
    textAlign: 'center',
  },
  arrowButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  arrowText: {
    fontSize: 28,
  },
  calendarGrid: {
    gap: Spacing.one,
  },
  weekRow: {
    flexDirection: 'row',
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
  },
  dateCell: {
    width: `${100 / 7}%`,
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  dayNumber: {
    fontSize: 15,
    lineHeight: 20,
  },
  dayAmount: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
  },
  dayEstimate: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: Spacing.one,
  },
  segmented: {
    flexDirection: 'row',
    padding: Spacing.one,
    borderRadius: 16,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: Spacing.two,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  amountOperators: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  operatorButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: Spacing.two,
  },
  operatorText: {
    fontSize: 16,
    fontWeight: '600',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  selectionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  selectionAction: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  sectionTitle: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
    alignItems: 'flex-start',
    paddingVertical: Spacing.two,
  },
  statAmount: {
    fontSize: 17,
    fontWeight: '700',
  },
  loadingCard: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  statsCategoryList: {
    gap: Spacing.two,
  },
  statsCategorySection: {
    gap: Spacing.one,
  },
  statsCategoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  expandStatsButton: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: 10,
  },
  targetStats: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#80808055',
    marginTop: Spacing.two,
    paddingTop: Spacing.one,
  },
  targetMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  targetMetric: {
    flexBasis: '46%',
    flexGrow: 1,
    gap: 2,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: Spacing.six,
  },
  categoryStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#80808055',
    paddingVertical: Spacing.two,
  },
  categoryStatValue: {
    minWidth: 70,
    textAlign: 'right',
  },
  categoryStatDetail: {
    marginTop: 1,
    paddingLeft: 1,
  },
  replenishCard: {
    marginTop: Spacing.two,
    alignItems: 'center',
  },
  replenishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: Spacing.one,
  },
  replenishName: {
    fontSize: 20,
    fontWeight: '700',
  },
  replenishAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  categoryList: {
    gap: Spacing.one,
  },
  categorySection: {
    gap: Spacing.one,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
  },
  subcategoryList: {
    gap: 1,
  },
  subcategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: 8,
  },
  addSubcategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: 8,
    borderStyle: 'dotted',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  recurringFields: {
    gap: Spacing.two,
    padding: Spacing.two,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#80808055',
    paddingVertical: Spacing.two,
  },
  calendarEntry: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#80808055',
  },
  calendarSwipeContainer: {
    overflow: 'hidden',
  },
  calendarSwipeContent: {
    flex: 1,
  },
  calendarDeleteAction: {
    width: 88,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.one,
    marginBottom: Spacing.one,
    borderRadius: Spacing.two,
  },
  calendarEditAction: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.one,
    marginBottom: Spacing.one,
    borderRadius: Spacing.two,
  },
  calendarRowActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.one,
  },
  calendarDeleteLabel: {
    color: '#ffffff',
  },
  estimateActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  estimateAction: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  flex: {
    flex: 1,
  },
  ruleActions: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
  budgetList: {
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  budgetItem: {
    gap: Spacing.one,
  },
  budgetLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  modal: {
    flex: 1,
    paddingTop: Spacing.four,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 28,
  },
  modalContent: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
  },
  cameraModal: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cameraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  cameraHint: {
    alignSelf: 'center',
    marginBottom: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    backgroundColor: '#0009',
  },
  scanCandidate: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: 12,
  },
  modalCategorySection: {
    gap: Spacing.one,
  },
  modalCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#80808055',
  },
  modalCategoryActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  subcategoryRowModal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#80808055',
  },
  subcategoryActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  modalCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 12,
  },
  manageSectionTitle: {
    marginTop: Spacing.two,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
  dropdownList: {
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#80808055',
  },
  amountRow: {
    gap: Spacing.one,
  },
  batchRow: {
    width: '100%',
    alignSelf: 'stretch',
    marginTop: Spacing.one,
  },
  batchCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: Spacing.one,
  },
  batchScannerInfo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
  },
  batchActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  batchActionButton: {
    flex: 1,
  },
  batchQuantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  batchQuantityButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    minWidth: 44,
  },
  batchQuantityDisplay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
});
