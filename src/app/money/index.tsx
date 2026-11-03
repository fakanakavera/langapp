import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
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
  formatMoney,
  getPeriodEnd,
  getPeriodStart,
  getRecurringDates,
  isValidLocalDate,
  localDateString,
  parseAmount,
  parseLocalDate,
} from '@/money/dates';
import {
  deleteCategory,
  deleteRecurringRule,
  initializeMoneyTracker,
  loadMoneyData,
  saveBudget,
  saveCategory,
  saveMoneyPreference,
  saveRecurringRule,
  saveTransaction,
} from '@/money/storage';
import type {
  CalendarEntry,
  MoneyCategory,
  MoneyPreferences,
  MoneyTransaction,
  RecurringFrequency,
  RecurringRule,
  TransactionType,
} from '@/money/types';
import { useDatabase } from '@/providers/database-provider';

type MoneyView = 'Overview' | 'Calendar' | 'Add' | 'Budgets' | 'Settings';
type MoneyData = Awaited<ReturnType<typeof loadMoneyData>>;

const VIEWS: MoneyView[] = ['Overview', 'Calendar', 'Add', 'Budgets', 'Settings'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'];

export default function MoneyHomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { revision, refresh } = useDatabase();
  const [view, setView] = useState<MoneyView>('Overview');
  const [data, setData] = useState<MoneyData | null>(null);
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
  const [selectedDate, setSelectedDate] = useState(localDateString(new Date()));
  const [transactionType, setTransactionType] = useState<TransactionType>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(localDateString(new Date()));
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly_day');
  const [dayOfMonth, setDayOfMonth] = useState(`${new Date().getDate()}`);
  const [intervalDays, setIntervalDays] = useState('2');
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [endDate, setEndDate] = useState('');
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<MoneyCategory | null>(null);
  const [budgetCategoryId, setBudgetCategoryId] = useState('all');
  const [budgetAmount, setBudgetAmount] = useState('');

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

  const periodLabel = `${periodStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })} – ${periodEnd.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  const recurringEvents = useMemo<CalendarEntry[]>(() => {
    if (!data) return [];
    return data.recurring.flatMap((rule) =>
      getRecurringDates(rule, periodStart, periodEnd).map((date) => ({
        id: `${rule.id}-${date}`,
        type: rule.type,
        amount_minor: rule.amount_minor,
        description: rule.description || rule.frequency.replace('_', ' '),
        category_name: rule.category_name,
        occurred_at: date,
        scheduled: true,
      })),
    );
  }, [data, periodStart, periodEnd]);

  const periodTransactions = data?.transactions ?? [];
  const expenseTotal = periodTransactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((total, transaction) => total + transaction.amount_minor, 0);
  const incomeTotal = periodTransactions
    .filter((transaction) => transaction.type === 'income')
    .reduce((total, transaction) => total + transaction.amount_minor, 0);

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

  const handleSubmit = async () => {
    if (!data) return;
    const amountMinor = parseAmount(amount, preferences.currency);
    if (amountMinor === null) {
      Alert.alert(
        'Check the amount',
        `Enter a positive amount${currencyDecimals(preferences.currency) ? ` with up to ${currencyDecimals(preferences.currency)} decimal places` : ''}.`,
      );
      return;
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
            amountMinor,
            description,
            frequency,
            dayOfMonth: frequency === 'monthly_day' ? day : null,
            intervalDays: frequency === 'every_days' ? interval : null,
            weekday: frequency === 'weekly' ? weekday : null,
            startDate: occurredAt,
            endDate: endDate || null,
          }),
        'Your recurring schedule has been added.',
      );
    } else {
      saved = await runWrite(
        () =>
          saveTransaction({
            type: transactionType,
            categoryId: effectiveCategoryId || null,
            amountMinor,
            description,
            occurredAt,
          }),
        `${transactionType === 'income' ? 'Income' : 'Expense'} added.`,
      );
    }
    if (!saved) return;
    setAmount('');
    setDescription('');
    setIsRecurring(false);
    setEndDate('');
  };

  const handleSaveCategory = async () => {
    const name = categoryName.trim();
    if (!name) {
      Alert.alert('Category name required', 'Enter a name for this category.');
      return;
    }
    const saved = await runWrite(
      () => saveCategory(transactionType, name, editingCategory?.id),
      editingCategory ? 'Category updated.' : 'Category added.',
    );
    if (!saved) return;
    setCategoryName('');
    setEditingCategory(null);
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

  const titleColor = theme.text;
  const categoriesForType = data?.categories.filter((category) => category.type === transactionType) ?? [];
  const effectiveCategoryId = categoriesForType.some((category) => category.id === categoryId)
    ? categoryId
    : categoriesForType[0]?.id ?? '';
  const expenseCategories = data?.categories.filter((category) => category.type === 'expense') ?? [];
  const selectedDayEntries = [
    ...periodTransactions
      .filter((transaction) => transaction.occurred_at.slice(0, 10) === selectedDate)
      .map((transaction) => ({ ...transaction, scheduled: false })),
    ...recurringEvents.filter((entry) => entry.occurred_at === selectedDate),
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
    <Screen>
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}>
        {VIEWS.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === item }}
            onPress={() => setView(item)}
            style={[
              styles.tab,
              { backgroundColor: view === item ? theme.tint : theme.backgroundElement },
            ]}>
            <ThemedText style={{ color: view === item ? '#fff' : theme.text, fontWeight: '600' }}>
              {item}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>

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
              Activity from {periodLabel}. Scheduled entries are shown on the calendar and aren’t
              included until recorded.
            </ThemedText>
          </CardBlock>
          <CardBlock>
            <ThemedText type="smallBold">Budget progress</ThemedText>
            <BudgetSummary
              budgets={data.budgets}
              categories={expenseCategories}
              transactions={periodTransactions}
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
              transactions={periodTransactions}
              recurring={recurringEvents}
              onSelect={setSelectedDate}
            />
            <View style={styles.legend}>
              <ThemedText themeColor="textSecondary">● Expense</ThemedText>
              <ThemedText style={{ color: '#26845B' }}>● Income</ThemedText>
              <ThemedText style={{ color: theme.tint }}>○ Scheduled</ThemedText>
            </View>
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
                onPress={() => setTransactionType(type)}
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
          <CardBlock>
            <ThemedText type="smallBold">Amount ({preferences.currency})</ThemedText>
            <TextInput
              accessibilityLabel="Amount"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <ThemedText type="smallBold">Category</ThemedText>
            <View style={styles.chipWrap}>
              {categoriesForType.map((category) => (
                <ChoiceChip
                  key={category.id}
                  label={category.name}
                  selected={category.id === effectiveCategoryId}
                  onPress={() => setCategoryId(category.id)}
                />
              ))}
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

      {view === 'Budgets' && (
        <>
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
              transactions={periodTransactions}
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
        </>
      )}

      <Modal
        visible={categoryModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCategoryModal(false)}>
        <View style={[styles.modal, { backgroundColor: theme.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText type="subtitle" style={styles.modalTitle}>
              {transactionType === 'expense' ? 'Expense' : 'Income'} categories
            </ThemedText>
            <Pressable onPress={() => setCategoryModal(false)}>
              <ThemedText style={{ color: theme.tint }}>Done</ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {categoriesForType.map((category) => (
              <View key={category.id} style={styles.categoryRow}>
                <ThemedText style={styles.flex}>{category.name}</ThemedText>
                <Pressable
                  onPress={() => {
                    setEditingCategory(category);
                    setCategoryName(category.name);
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
                            void runWrite(() => deleteCategory(category.id), 'Category deleted.');
                            if (categoryId === category.id) setCategoryId('');
                          },
                        },
                      ],
                    )
                  }>
                  <ThemedText style={{ color: theme.error }}>Delete</ThemedText>
                </Pressable>
              </View>
            ))}
            <ThemedText type="smallBold">
              {editingCategory ? 'Rename category' : 'New category'}
            </ThemedText>
            <TextInput
              value={categoryName}
              onChangeText={setCategoryName}
              placeholder="Category name"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            />
            <UiButton label={editingCategory ? 'Save changes' : 'Add category'} onPress={handleSaveCategory} />
            {editingCategory && (
              <UiButton
                label="Cancel editing"
                variant="secondary"
                onPress={() => {
                  setEditingCategory(null);
                  setCategoryName('');
                }}
              />
            )}
          </ScrollView>
        </View>
      </Modal>
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

function TransactionRow({
  transaction,
  currency,
}: {
  transaction: MoneyTransaction;
  currency: string;
}) {
  const isIncome = transaction.type === 'income';
  return (
    <View style={styles.listRow}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">
          {transaction.description || transaction.category_name || 'Uncategorized'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {transaction.category_name ?? 'Uncategorized'} · {transaction.occurred_at.slice(0, 10)}
        </ThemedText>
      </View>
      <ThemedText style={{ color: isIncome ? '#26845B' : undefined, fontWeight: '700' }}>
        {isIncome ? '+' : '−'}{formatMoney(transaction.amount_minor, currency)}
      </ThemedText>
    </View>
  );
}

function CalendarEntryRow({ entry, currency }: { entry: CalendarEntry; currency: string }) {
  return (
    <View style={styles.listRow}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">
          {entry.description || entry.category_name || 'Uncategorized'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {entry.category_name ?? 'Uncategorized'} · {entry.scheduled ? 'Scheduled' : entry.type}
        </ThemedText>
      </View>
      <ThemedText style={{ color: entry.type === 'income' ? '#26845B' : undefined, fontWeight: '700' }}>
        {entry.type === 'income' ? '+' : '−'}{formatMoney(entry.amount_minor, currency)}
      </ThemedText>
    </View>
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
        <ThemedText>{formatMoney(rule.amount_minor, currency)}</ThemedText>
        <Pressable onPress={onDelete}>
          <ThemedText style={{ color: '#D04444' }}>Delete</ThemedText>
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
                  backgroundColor: totalProgress >= 100 ? '#D04444' : theme.tint,
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
                    backgroundColor: progress >= 100 ? '#D04444' : theme.tint,
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
  onSelect,
}: {
  start: Date;
  startDay: number;
  selectedDate: string;
  transactions: MoneyTransaction[];
  recurring: CalendarEntry[];
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
  return (
    <View style={styles.calendarGrid}>
      <View style={styles.weekRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <ThemedText key={`${day}-${index}`} type="small" themeColor="textSecondary" style={styles.weekday}>
            {day}
          </ThemedText>
        ))}
      </View>
      <View style={styles.dateGrid}>
        {dates.map((date) => {
          const dateString = localDateString(date);
          const inPeriod = date >= start && date <= end;
          const dayTransactions = transactions.filter((transaction) => transaction.occurred_at.slice(0, 10) === dateString);
          const hasExpense = dayTransactions.some((transaction) => transaction.type === 'expense');
          const hasIncome = dayTransactions.some((transaction) => transaction.type === 'income');
          const hasSchedule = recurring.some((event) => event.occurred_at === dateString);
          return (
            <Pressable
              key={dateString}
              accessibilityRole="button"
              accessibilityLabel={`${date.toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
              })}${hasExpense ? ', expense' : ''}${hasIncome ? ', income' : ''}${hasSchedule ? ', scheduled entry' : ''}`}
              accessibilityState={{ selected: selectedDate === dateString }}
              onPress={() => onSelect(dateString)}
              style={[
                styles.dateCell,
                selectedDate === dateString && { backgroundColor: theme.backgroundSelected },
              ]}>
              <ThemedText
                style={{
                  color: inPeriod ? theme.text : theme.textSecondary,
                  opacity: inPeriod ? 1 : 0.45,
                  fontWeight: selectedDate === dateString ? '700' : '400',
                }}>
                {date.getDate()}
              </ThemedText>
              <View style={styles.dots}>
                {hasExpense && <View style={[styles.dot, { backgroundColor: theme.error }]} />}
                {hasIncome && <View style={[styles.dot, { backgroundColor: '#26845B' }]} />}
                {hasSchedule && <View style={[styles.dot, { backgroundColor: theme.tint }]} />}
              </View>
            </Pressable>
          );
        })}
      </View>
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
        Upcoming dates appear on the calendar as scheduled. They won’t count toward totals or
        budgets until you add the actual transaction.
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
  tabs: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  tab: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 24,
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
  dateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dateCell: {
    width: `${100 / 7}%`,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  dots: {
    height: 5,
    flexDirection: 'row',
    gap: 2,
    marginTop: 1,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
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
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
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
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#80808055',
    paddingVertical: Spacing.two,
  },
});
