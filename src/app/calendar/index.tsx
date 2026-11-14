import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { CardBlock } from '@/components/card-block';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteCalendarEvent,
  deleteCalendarTodo,
  listCalendarEvents,
  listCalendarTodos,
  saveCalendarEvent,
  saveCalendarTodo,
  toggleCalendarTodo,
  type CalendarEvent,
  type CalendarTodo,
} from '@/db/queries';
import { useDatabase } from '@/providers/database-provider';
import {
  cancelCalendarEventNotification,
  cancelCalendarTodoNotification,
  scheduleCalendarEventNotification,
  scheduleCalendarTodoNotification,
} from '@/lib/notifications';
import { parseLocalDate } from '@/money/dates';

type CalendarScreenView = 'home' | 'addEvent' | 'addTodo' | 'editEvent' | 'editTodo';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RECURRENCE_OPTIONS: { label: string; value: CalendarEvent['recurrence_type'] }[] = [
  { label: 'None', value: 'none' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function generateOccurrences(
  start: Date,
  recurrence: CalendarEvent['recurrence_type'],
  endDate: string | null,
  targetDay: string,
): boolean {
  if (recurrence === 'none') {
    return start.toISOString().slice(0, 10) === targetDay;
  }

  const end = endDate ? new Date(endDate) : null;
  let cursor = new Date(start);
  const maxIterations = 730; // safety cap ~2 years of daily
  let count = 0;

  while (count++ < maxIterations) {
    if (end && cursor > end) break;
    if (dayKey(cursor) === targetDay) return true;

    switch (recurrence) {
      case 'daily':
        cursor = addDays(cursor, 1);
        break;
      case 'weekly':
        cursor = addDays(cursor, 7);
        break;
      case 'monthly':
        cursor.setMonth(cursor.getMonth() + 1);
        break;
      case 'yearly':
        cursor.setFullYear(cursor.getFullYear() + 1);
        break;
      default:
        return false;
    }
  }
  return false;
}

function filterEventsForDay(
  events: CalendarEvent[],
  targetDay: string,
): CalendarEvent[] {
  return events.filter((event) => {
    const start = new Date(event.start_date);
    return generateOccurrences(
      start,
      event.recurrence_type,
      event.recurrence_end_date,
      targetDay,
    );
  });
}

function filterTodosForDay(
  todos: CalendarTodo[],
  targetDay: string,
): CalendarTodo[] {
  return todos.filter((todo) => {
    if (todo.recurrence_type === 'none') {
      return todo.due_date === targetDay;
    }
    const end = todo.recurrence_end_date ? new Date(todo.recurrence_end_date) : null;
    let cursor = new Date(todo.due_date);
    cursor.setHours(0, 0, 0, 0);
    const maxIterations = 730;
    let count = 0;
    while (count++ < maxIterations) {
      if (end && cursor > end) break;
      if (dayKey(cursor) === targetDay) return true;
      switch (todo.recurrence_type) {
        case 'daily':
          cursor = addDays(cursor, 1);
          break;
        case 'weekly':
          cursor = addDays(cursor, 7);
          break;
        case 'monthly':
          cursor.setMonth(cursor.getMonth() + 1);
          break;
        case 'yearly':
          cursor.setFullYear(cursor.getFullYear() + 1);
          break;
        default:
          return false;
      }
    }
    return false;
  });
}

export default function CalendarHomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { refresh } = useDatabase();
  const [view, setView] = useState<CalendarScreenView>('home');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todos, setTodos] = useState<CalendarTodo[]>([]);
  const [selectedDay, setSelectedDay] = useState(dayKey(new Date()));
  const [displayMonth, setDisplayMonth] = useState({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  });
  const [loading, setLoading] = useState(true);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingTodo, setEditingTodo] = useState<CalendarTodo | null>(null);

  const firstDayOfMonth = new Date(displayMonth.year, displayMonth.month, 1);
  const daysCount = daysInMonth(displayMonth.year, displayMonth.month);
  const startOffset = firstDayOfMonth.getDay(); // Sunday = 0

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCalendarEvents(), listCalendarTodos()]).then(
      ([evs, tds]) => {
        if (!cancelled) {
          setEvents(evs);
          setTodos(tds);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const dayEvents = useMemo(
    () => filterEventsForDay(events, selectedDay).sort(
      (a, b) => a.start_date.localeCompare(b.start_date),
    ),
    [events, selectedDay],
  );

  const dayTodos = useMemo(
    () => filterTodosForDay(todos, selectedDay).sort(
      (a, b) => (a.due_time ?? '').localeCompare(b.due_time ?? ''),
    ),
    [todos, selectedDay],
  );

  const monthLabel = `${MONTHS[displayMonth.month]} ${displayMonth.year}`;

  const goToday = useCallback(() => {
    const now = new Date();
    setSelectedDay(dayKey(now));
    setDisplayMonth({ year: now.getFullYear(), month: now.getMonth() });
  }, []);

  const prevMonth = useCallback(() => {
    setDisplayMonth((current) => {
      const d = new Date(current.year, current.month - 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  const nextMonth = useCallback(() => {
    setDisplayMonth((current) => {
      const d = new Date(current.year, current.month + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  const selectDay = useCallback((date: Date) => {
    setSelectedDay(dayKey(date));
  }, []);

  const isSelected = useCallback(
    (date: Date) => isSameDay(date, new Date(selectedDay)),
    [selectedDay],
  );

  const isToday = useCallback(
    (date: Date) => isSameDay(date, new Date()),
    [],
  );

  // ------------------------------------------------------------------
  // Save event
  // ------------------------------------------------------------------
  const handleSaveEvent = useCallback(
    async (input: {
      title: string;
      description: string;
      start_date: string;
      end_date: string;
      is_all_day: number;
      reminder_offset: number;
      recurrence_type: CalendarEvent['recurrence_type'];
      recurrence_end_date: string | null;
    }) => {
      if (!input.title.trim()) {
        Alert.alert('Title required', 'Enter a title for the event.');
        return;
      }
      if (input.end_date < input.start_date) {
        Alert.alert('Check dates', 'End time must be after start time.');
        return;
      }

      try {
        const saved = await saveCalendarEvent({
          id: editingEvent?.id,
          title: input.title,
          description: input.description,
          start_date: input.start_date,
          end_date: input.end_date,
          is_all_day: input.is_all_day,
          reminder_offset: input.reminder_offset,
          recurrence_type: input.recurrence_type,
          recurrence_end_date: input.recurrence_end_date,
        });

        if (editingEvent) {
          await cancelCalendarEventNotification(editingEvent.id);
        }
        await scheduleCalendarEventNotification(saved);

        // Insert directly so the UI updates immediately, then reload from DB.
        setEvents((prev) => {
          const next = [...prev.filter((e) => e.id !== saved.id), saved].sort(
            (a, b) => a.start_date.localeCompare(b.start_date),
          );
          return next;
        });

        setEditingEvent(null);
        setView('home');
        refresh();

        Alert.alert('Event saved', 'Your event has been added to the calendar.');
      } catch (caught) {
        Alert.alert(
          'Could not save event',
          caught instanceof Error ? caught.message : String(caught),
        );
      }
    },
    [editingEvent, refresh, setEvents],
  );

  const handleDeleteEvent = useCallback(
    async (event: CalendarEvent) => {
      await Alert.alert('Delete event?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await cancelCalendarEventNotification(event.id);
            await deleteCalendarEvent(event.id);
            setEvents((prev) => prev.filter((e) => e.id !== event.id));
            setView('home');
            refresh();
          },
        },
      ]);
    },
    [refresh, setEvents],
  );

  // ------------------------------------------------------------------
  // Save todo
  // ------------------------------------------------------------------
  const handleSaveTodo = useCallback(
    async (input: {
      title: string;
      description: string;
      due_date: string;
      due_time: string | null;
      reminder_offset: number;
      recurrence_type: CalendarTodo['recurrence_type'];
      recurrence_end_date: string | null;
    }) => {
      if (!input.title.trim()) {
        Alert.alert('Title required', 'Enter a title for the to-do.');
        return;
      }

      try {
        const saved = await saveCalendarTodo({
          id: editingTodo?.id,
          title: input.title,
          description: input.description,
          due_date: input.due_date,
          due_time: input.due_time,
          reminder_offset: input.reminder_offset,
          recurrence_type: input.recurrence_type,
          recurrence_end_date: input.recurrence_end_date,
        });

        if (editingTodo) {
          await cancelCalendarTodoNotification(editingTodo.id);
        }
        await scheduleCalendarTodoNotification(saved);

        // Insert directly so the UI updates immediately, then reload from DB.
        setTodos((prev) => {
          const next = [...prev.filter((t) => t.id !== saved.id), saved].sort(
            (a, b) => a.due_date.localeCompare(b.due_date),
          );
          return next;
        });

        setEditingTodo(null);
        setView('home');
        refresh();

        Alert.alert('To-do saved', 'Your to-do has been added to the calendar.');
      } catch (caught) {
        Alert.alert(
          'Could not save to-do',
          caught instanceof Error ? caught.message : String(caught),
        );
      }
    },
    [editingTodo, refresh, setTodos],
  );

  const handleDeleteTodo = useCallback(
    async (todo: CalendarTodo) => {
      await Alert.alert('Delete to-do?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await cancelCalendarTodoNotification(todo.id);
            await deleteCalendarTodo(todo.id);
            setTodos((prev) => prev.filter((t) => t.id !== todo.id));
            setView('home');
            refresh();
          },
        },
      ]);
    },
    [refresh, setTodos],
  );

  const handleToggleTodo = useCallback(
    async (todo: CalendarTodo) => {
      try {
        const next = todo.is_completed === 0 ? 1 : 0;
        // Update local state immediately so the UI reflects the change right away.
        setTodos((prev) =>
          prev.map((t) => (t.id === todo.id ? { ...t, is_completed: next } : t)),
        );
        await toggleCalendarTodo(todo.id);
        refresh();
      } catch (caught) {
        Alert.alert(
          'Could not update to-do',
          caught instanceof Error ? caught.message : String(caught),
        );
      }
    },
    [refresh, setTodos],
  );

  // ------------------------------------------------------------------
  // Editors
  // ------------------------------------------------------------------
  const openAddEvent = useCallback(() => setView('addEvent'), []);
  const openAddTodo = useCallback(() => setView('addTodo'), []);
  const openEditEvent = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
    setView('editEvent');
  }, []);
  const openEditTodo = useCallback((todo: CalendarTodo) => {
    setEditingTodo(todo);
    setView('editTodo');
  }, []);
  const backHome = useCallback(() => {
    setEditingEvent(null);
    setEditingTodo(null);
    setView('home');
  }, []);

  if (loading) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">Opening your calendar…</ThemedText>
      </Screen>
    );
  }

  return (
    <Screen tabInset>
      {view === 'home' ? (
        <CalendarHomeView
          monthLabel={monthLabel}
          prevMonth={prevMonth}
          nextMonth={nextMonth}
          goToday={goToday}
          selectedDay={selectedDay}
          dayEvents={dayEvents}
          dayTodos={dayTodos}
          startOffset={startOffset}
          daysCount={daysCount}
          displayMonth={displayMonth}
          selectDay={selectDay}
          isSelected={isSelected}
          isToday={isToday}
          theme={theme}
          openAddEvent={openAddEvent}
          openAddTodo={openAddTodo}
          handleToggleTodo={handleToggleTodo}
          handleDeleteEvent={handleDeleteEvent}
          handleDeleteTodo={handleDeleteTodo}
          openEditEvent={openEditEvent}
          openEditTodo={openEditTodo}
          router={router}
        />
      ) : (
        <CalendarEditorView
          view={view}
          editingEvent={editingEvent}
          editingTodo={editingTodo}
          backHome={backHome}
          handleSaveEvent={handleSaveEvent}
          handleSaveTodo={handleSaveTodo}
          theme={theme}
          selectedDay={selectedDay}
          HOURS={HOURS}
          MINUTES={MINUTES}
        />
      )}
    </Screen>
  );
}

type TodoRowProps = {
  todo: CalendarTodo;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  theme: ReturnType<typeof useTheme>;
};

function TodoRow({ todo, onToggle, onEdit, onDelete, theme }: TodoRowProps) {
  const styles = makeStyles(theme);
  const swipeableRef = useRef<SwipeableMethods | null>(null);

  return (
    <Swipeable
      ref={swipeableRef}
      overshootRight={false}
      containerStyle={styles.todoSwipeContainer}
      childrenContainerStyle={[
        styles.todoSwipeContent,
        { backgroundColor: theme.backgroundElement },
      ]}
      renderRightActions={() => (
        <View style={styles.todoRowActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit to-do"
            onPress={() => {
              swipeableRef.current?.close();
              onEdit();
            }}
            style={[styles.todoEditAction, { backgroundColor: theme.tint }]}>
            <ThemedText type="smallBold" style={styles.todoActionLabel}>
              Edit
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete to-do"
            onPress={() => {
              swipeableRef.current?.close();
              onDelete();
            }}
            style={[styles.todoDeleteAction, { backgroundColor: theme.error }]}>
            <ThemedText type="smallBold" style={styles.todoActionLabel}>
              Delete
            </ThemedText>
          </Pressable>
        </View>
      )}>
      <View style={styles.todoSwipeRow}>
        {/* Checkbox — toggle done */}
        <Pressable
          onPress={() => {
            swipeableRef.current?.close();
            void onToggle();
          }}
          style={styles.checkButton}>
          <ThemedText type="default">
            {todo.is_completed ? '☑' : '☐'}
          </ThemedText>
        </Pressable>

        {/* Title area — tap to edit */}
        <Pressable
          onPress={() => {
            swipeableRef.current?.close();
            void onEdit();
          }}
          style={styles.itemEditArea}>
          <View style={styles.itemTextWrapper}>
            <ThemedText
              type="default"
              style={[
                styles.itemTitle,
                ...(todo.is_completed ? [styles.itemTitleCompleted] : []),
              ]}>
              {todo.title}
            </ThemedText>
            {todo.due_time && (
              <ThemedText type="small" themeColor="textSecondary">
                {new Date(`${todo.due_date}T${todo.due_time}`).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </ThemedText>
            )}
            {todo.recurrence_type !== 'none' && (
              <ThemedText type="small" themeColor="textSecondary">
                · {todo.recurrence_type}
              </ThemedText>
            )}
          </View>
        </Pressable>
      </View>
    </Swipeable>
  );
}

type CalendarHomeViewProps = {
  monthLabel: string;
  prevMonth: () => void;
  nextMonth: () => void;
  goToday: () => void;
  selectedDay: string;
  dayEvents: CalendarEvent[];
  dayTodos: CalendarTodo[];
  startOffset: number;
  daysCount: number;
  displayMonth: { year: number; month: number };
  selectDay: (date: Date) => void;
  isSelected: (date: Date) => boolean;
  isToday: (date: Date) => boolean;
  theme: ReturnType<typeof useTheme>;
  openAddEvent: () => void;
  openAddTodo: () => void;
  handleToggleTodo: (todo: CalendarTodo) => void;
  handleDeleteEvent: (event: CalendarEvent) => void;
  handleDeleteTodo: (todo: CalendarTodo) => void;
  openEditEvent: (event: CalendarEvent) => void;
  openEditTodo: (todo: CalendarTodo) => void;
  router: ReturnType<typeof useRouter>;
};

function CalendarHomeView({
  monthLabel,
  prevMonth,
  nextMonth,
  goToday,
  selectedDay,
  dayEvents,
  dayTodos,
  startOffset,
  daysCount,
  displayMonth,
  selectDay,
  isSelected,
  isToday,
  theme,
  openAddEvent,
  openAddTodo,
  handleToggleTodo,
  handleDeleteEvent,
  handleDeleteTodo,
  openEditEvent,
  openEditTodo,
  router,
}: CalendarHomeViewProps) {
  const styles = makeStyles(theme);
  const [renderKey] = useState(0);

  const days: Date[] = useMemo(() => {
    const out: Date[] = [];
    const start = new Date(displayMonth.year, displayMonth.month, 1 - startOffset);
    for (let i = 0; i < 42; i++) {
      out.push(addDays(start, i));
    }
    return out;
  }, [displayMonth.year, displayMonth.month, startOffset]);

  return (
    <Screen tabInset>
      <ThemedView type="backgroundElement" style={styles.headerBar}>
        <Pressable onPress={prevMonth} style={styles.navButton}>
          <ThemedText type="title" style={styles.navText}>
            ‹
          </ThemedText>
        </Pressable>
        <View style={styles.monthCenter}>
          <ThemedText type="subtitle" style={styles.monthText}>
            {monthLabel}
          </ThemedText>
          <Pressable onPress={goToday} style={styles.todayButton}>
            <ThemedText type="small" themeColor="textSecondary">
              Today
            </ThemedText>
          </Pressable>
        </View>
        <Pressable onPress={nextMonth} style={styles.navButton}>
          <ThemedText type="title" style={styles.navText}>
            ›
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView type="backgroundElement" style={styles.weekdayRow}>
        {WEEKDAYS.map((weekday) => (
          <ThemedText
            key={weekday}
            type="smallBold"
            themeColor="textSecondary"
            style={styles.weekdayText}>
            {weekday}
          </ThemedText>
        ))}
      </ThemedView>
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.backgroundSelected }} />

      <ThemedView type="backgroundElement" style={styles.daysGrid}>
        {days.map((date) => {
          const inMonth = date.getMonth() === displayMonth.month;
          const pressed = isSelected(date);
          const today = isToday(date);
          return (
            <Pressable
              key={dayKey(date)}
              onPress={() => {
                if (inMonth) selectDay(date);
              }}
              style={[
                styles.dayCell,
                !inMonth && styles.dayOut,
                pressed && { ...styles.daySelected, backgroundColor: theme.tint },
                today && { ...styles.dayToday, borderColor: theme.tint },
              ]}>
              <ThemedText
                type="default"
                style={[
                  styles.dayNumber,
                  !inMonth && { ...styles.dayOutText, color: theme.textSecondary },
                  pressed && styles.daySelectedText,
                  today && { ...styles.dayTodayText, color: theme.tint },
                ]}>
                {date.getDate()}
              </ThemedText>
            </Pressable>
          );
        })}
      </ThemedView>

      <ThemedText type="smallBold" style={styles.sectionTitle}>
        {parseLocalDate(selectedDay).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </ThemedText>

      <ScrollView
        contentContainerStyle={styles.listContainer}
        keyboardShouldPersistTaps="handled">
        <CardBlock>
          <ThemedText type="smallBold">Events</ThemedText>
          {dayEvents.length === 0 ? (
            <ThemedText themeColor="textSecondary">No events today.</ThemedText>
          ) : (
            dayEvents.map((event) => (
              <Pressable
                key={event.id}
                onPress={() => openEditEvent(event)}
                style={[styles.itemRow, { borderBottomColor: theme.backgroundSelected }]}>
                <ThemedText type="default">{event.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {new Date(event.start_date).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })} –{' '}
                  {new Date(event.end_date).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {event.recurrence_type !== 'none' ? ` · ${event.recurrence_type}` : ''}
                </ThemedText>
                <UiButton
                  label="Delete"
                  variant="secondary"
                  onPress={() => handleDeleteEvent(event)}
                  style={styles.deleteButton}
                />
              </Pressable>
            ))
          )}
        </CardBlock>

        <CardBlock>
          <ThemedText type="smallBold">ToDos</ThemedText>
          {dayTodos.length === 0 ? (
            <ThemedText themeColor="textSecondary">No to-dos today.</ThemedText>
          ) : (
            dayTodos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                onToggle={() => void handleToggleTodo(todo)}
                onEdit={() => openEditTodo(todo)}
                onDelete={() => handleDeleteTodo(todo)}
                theme={theme}
              />
            ))
          )}
        </CardBlock>
      </ScrollView>

      <View style={styles.fabRow}>
        <UiButton label="Add Event" onPress={openAddEvent} style={styles.fab} />
        <UiButton label="Add ToDo" onPress={openAddTodo} variant="secondary" style={styles.fab} />
      </View>

      <Pressable onPress={() => router.replace('/')} style={styles.backButton}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          ← Back to hub
        </ThemedText>
      </Pressable>

      {/* Force remount when data changes so lists refresh */ }
      <View style={{ height: 0 }} key={renderKey} />
    </Screen>
  );
}

type CalendarEditorViewProps = {
  view: CalendarScreenView;
  editingEvent: CalendarEvent | null;
  editingTodo: CalendarTodo | null;
  backHome: () => void;
  handleSaveEvent: (input: {
    title: string;
    description: string;
    start_date: string;
    end_date: string;
    is_all_day: number;
    reminder_offset: number;
    recurrence_type: CalendarEvent['recurrence_type'];
    recurrence_end_date: string | null;
  }) => void;
  handleSaveTodo: (input: {
    title: string;
    description: string;
    due_date: string;
    due_time: string | null;
    reminder_offset: number;
    recurrence_type: CalendarTodo['recurrence_type'];
    recurrence_end_date: string | null;
  }) => void;
  theme: ReturnType<typeof useTheme>;
  selectedDay: string;

  HOURS: number[];
  MINUTES: number[];
};

const REMINDER_OFFSET_OPTIONS: { label: string; value: number }[] = [
  { label: 'At the time', value: 0 },
  { label: '5 minutes before', value: 5 },
  { label: '10 minutes before', value: 10 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '2 hours before', value: 120 },
];

function CalendarEditorView({
  view,
  editingEvent,
  editingTodo,
  backHome,
  handleSaveEvent,
  handleSaveTodo,
  theme,
  selectedDay,
}: CalendarEditorViewProps) {
  const styles = makeStyles(theme);
  const isEvent = view === 'addEvent' || view === 'editEvent';
  const title = isEvent
    ? editingEvent ? 'Edit Event' : 'Add Event'
    : editingTodo ? 'Edit ToDo' : 'Add ToDo';

  const isAdding = view === 'addEvent' || view === 'addTodo';

  // Default dates to the selected calendar day when adding
  const defaultDate = isAdding ? selectedDay : '';
  const defaultTime = isAdding ? '09:00' : '';

  const [eventTitle, setEventTitle] = useState(editingEvent?.title ?? '');
  const [eventDesc, setEventDesc] = useState(editingEvent?.description ?? '');
  const [startDate, setStartDate] = useState(
    editingEvent?.start_date ?? defaultDate,
  );
  const [startTime, setStartTime] = useState(
    editingEvent ? new Date(editingEvent.start_date).toTimeString().slice(0, 5) : defaultTime,
  );
  const [endDate, setEndDate] = useState(
    editingEvent?.end_date ?? defaultDate,
  );
  const [endTime, setEndTime] = useState(
    editingEvent ? new Date(editingEvent.end_date).toTimeString().slice(0, 5) : defaultTime,
  );
  const [isAllDay, setIsAllDay] = useState(Boolean(editingEvent?.is_all_day));
  const [recurrenceType, setRecurrenceType] = useState<CalendarEvent['recurrence_type']>(
    editingEvent?.recurrence_type ?? 'none',
  );
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(
    editingEvent?.recurrence_end_date ?? '',
  );
  const [eventReminderOffset, setEventReminderOffset] = useState(
    editingEvent?.reminder_offset ?? 0,
  );

  const [todoTitle, setTodoTitle] = useState(editingTodo?.title ?? '');
  const [todoDesc, setTodoDesc] = useState(editingTodo?.description ?? '');
  const [todoDueDate, setTodoDueDate] = useState(
    editingTodo?.due_date ?? defaultDate,
  );
  const [todoDueTime, setTodoDueTime] = useState(
    editingTodo?.due_time ?? defaultTime,
  );
  const [todoHasTime, setTodoHasTime] = useState(Boolean(editingTodo?.due_time));
  const [todoRecurrenceType, setTodoRecurrenceType] = useState<CalendarTodo['recurrence_type']>(
    editingTodo?.recurrence_type ?? 'none',
  );
  const [todoRecurrenceEndDate, setTodoRecurrenceEndDate] = useState(
    editingTodo?.recurrence_end_date ?? '',
  );
  const [todoReminderOffset, setTodoReminderOffset] = useState(
    editingTodo?.reminder_offset ?? 0,
  );

  const [pickerHour, setPickerHour] = useState(9);
  const [pickerMinute, setPickerMinute] = useState(0);

  // Time picker state
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<'start' | 'end' | 'todo'>('start');

  const combineDateTime = (date: string, time: string): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      // Fall back to today if the date string is invalid
      d.setHours(0, 0, 0, 0);
    }
    if (time) {
      const [h, m] = time.split(':').map(Number);
      d.setHours(h, m, 0, 0);
    }
    return d.toISOString();
  };

  const parseTime = (time: string): { hour: number; minute: number } => {
    const [h, m] = time.split(':').map(Number);
    return { hour: h ?? 9, minute: m ?? 0 };
  };

  const openTimePicker = (target: 'start' | 'end' | 'todo') => {
    const current = target === 'start' ? parseTime(startTime)
      : target === 'end' ? parseTime(endTime)
      : parseTime(todoDueTime ?? '09:00');
    setPickerHour(current.hour);
    setPickerMinute(current.minute);
    setTimePickerTarget(target);
    setTimePickerOpen(true);
  };

  const handleTimeSelect = () => {
    const time = `${String(pickerHour).padStart(2, '0')}:${String(pickerMinute).padStart(2, '0')}`;
    if (timePickerTarget === 'start') setStartTime(time);
    else if (timePickerTarget === 'end') setEndTime(time);
    else setTodoDueTime(time);
    setTimePickerOpen(false);
  };

  return (
    <Screen tabInset>
      <ThemedView type="backgroundElement" style={styles.headerBar}>
        <Pressable onPress={backHome} style={styles.navButton}>
          <ThemedText type="title" style={styles.navText}>‹</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={styles.monthText}>{title}</ThemedText>
        <View style={{ width: 44 }} />
      </ThemedView>

      <ScrollView
        contentContainerStyle={styles.listContainer}
        keyboardShouldPersistTaps="handled">
        <CardBlock>
          <ThemedText type="smallBold">Title</ThemedText>
          <TextInput
            value={isEvent ? eventTitle : todoTitle}
            onChangeText={(t) => {
              if (isEvent) setEventTitle(t);
              else setTodoTitle(t);
            }}
            placeholder="What is it?"
            style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
          />
          <ThemedText type="smallBold">Description</ThemedText>
          <TextInput
            value={isEvent ? eventDesc : todoDesc}
            onChangeText={(t) => {
              if (isEvent) setEventDesc(t);
              else setTodoDesc(t);
            }}
            placeholder="Add details…"
            style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
            multiline
            numberOfLines={3}
          />

          {isEvent ? (
            <>
              <ThemedText type="smallBold">Starts</ThemedText>
              <TextInput
                value={startDate}
                onChangeText={setStartDate}
                placeholder="Date"
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
              />
              <Pressable
                onPress={() => void openTimePicker('start')}
                style={styles.timePickerRow}>
                <ThemedText type="default">{startTime}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.timePickerSuffix}>
                  ↑↓
                </ThemedText>
              </Pressable>
              <ThemedText type="smallBold">Ends</ThemedText>
              <TextInput
                value={endDate}
                onChangeText={setEndDate}
                placeholder="Date"
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
              />
              <Pressable
                onPress={() => void openTimePicker('end')}
                style={styles.timePickerRow}>
                <ThemedText type="default">{endTime}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.timePickerSuffix}>
                  ↑↓
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setIsAllDay((v) => !v)}
                style={styles.toggleRow}>
                <ThemedText type="default">{isAllDay ? '☑' : '☐'}</ThemedText>
                <ThemedText type="default">All-day event</ThemedText>
              </Pressable>

              <ThemedText type="smallBold">Remind me</ThemedText>
              {REMINDER_OFFSET_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setEventReminderOffset(option.value)}
                  style={[
                    styles.recurrenceOption,
                    eventReminderOffset === option.value
                      ? { ...styles.recurrenceSelected, backgroundColor: theme.tint }
                      : null,
                  ]}>
                  <ThemedText type="default">{option.label}</ThemedText>
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <ThemedText type="smallBold">Due date</ThemedText>
              <TextInput
                value={todoDueDate}
                onChangeText={setTodoDueDate}
                placeholder="Date"
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
              />
              <Pressable
                onPress={() => setTodoHasTime((v) => !v)}
                style={styles.toggleRow}>
                <ThemedText type="default">{todoHasTime ? '☑' : '☐'}</ThemedText>
                <ThemedText type="default">Set a time</ThemedText>
              </Pressable>
              {todoHasTime && (
                <Pressable
                  onPress={() => void openTimePicker('todo')}
                  style={styles.timePickerRow}>
                  <ThemedText type="default">{todoDueTime}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.timePickerSuffix}>
                    ↑↓
                  </ThemedText>
                </Pressable>
              )}

              <ThemedText type="smallBold">Remind me</ThemedText>
              {REMINDER_OFFSET_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setTodoReminderOffset(option.value)}
                  style={[
                    styles.recurrenceOption,
                    todoReminderOffset === option.value
                      ? { ...styles.recurrenceSelected, backgroundColor: theme.tint }
                      : null,
                  ]}>
                  <ThemedText type="default">{option.label}</ThemedText>
                </Pressable>
              ))}
            </>
          )}

          <ThemedText type="smallBold">Repeats</ThemedText>
          {RECURRENCE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => {
                if (isEvent) setRecurrenceType(option.value);
                else setTodoRecurrenceType(option.value);
              }}
              style={[
                styles.recurrenceOption,
                (isEvent ? recurrenceType : todoRecurrenceType) === option.value
                  ? { ...styles.recurrenceSelected, backgroundColor: theme.tint }
                  : null,
              ]}>
              <ThemedText type="default">{option.label}</ThemedText>
            </Pressable>
          ))}

          {((isEvent ? recurrenceType : todoRecurrenceType) !== 'none' ? (
            <CardBlock style={styles.recurrenceEndCard}>
              <ThemedText type="smallBold">Repeats until (optional)</ThemedText>
              <TextInput
                value={isEvent ? recurrenceEndDate : todoRecurrenceEndDate}
                onChangeText={(t) => {
                  if (isEvent) setRecurrenceEndDate(t);
                  else setTodoRecurrenceEndDate(t);
                }}
                placeholder="YYYY-MM-DD"
                style={[styles.input, { borderColor: theme.backgroundSelected, color: theme.text }]}
              />
            </CardBlock>
          ) : null)}
        </CardBlock>

        <View style={styles.buttonRow}>
          <UiButton
            label="Cancel"
            variant="secondary"
            onPress={backHome}
            style={styles.cancelButton}
          />
          <UiButton
            label={isEvent ? 'Save Event' : 'Save ToDo'}
            onPress={() => {
              if (isEvent) {
                const start = combineDateTime(startDate, startTime);
                const end = combineDateTime(endDate, endTime);
                void handleSaveEvent({
                  title: eventTitle,
                  description: eventDesc,
                  start_date: start,
                  end_date: end,
                  is_all_day: isAllDay ? 1 : 0,
                  reminder_offset: eventReminderOffset,
                  recurrence_type: recurrenceType,
                  recurrence_end_date: recurrenceEndDate || null,
                });
              } else {
                void handleSaveTodo({
                  title: todoTitle,
                  description: todoDesc,
                  due_date: todoDueDate,
                  due_time: todoHasTime ? todoDueTime : null,
                  reminder_offset: todoReminderOffset,
                  recurrence_type: todoRecurrenceType,
                  recurrence_end_date: todoRecurrenceEndDate || null,
                });
              }
            }}
            style={styles.saveButton}
          />
        </View>
      </ScrollView>

      {/* Time picker modal */}
      <Modal
        visible={timePickerOpen}
        transparent
        onRequestClose={() => setTimePickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTimePickerOpen(false)}>
          <View style={styles.modalContainer}>
            <ThemedText type="smallBold" style={styles.modalTitle}>
              Select time
            </ThemedText>

            {/* Selected time preview */}
            <View style={styles.timePreview}>
              <ThemedText type="title" style={styles.timePreviewText}>
                {`${String(pickerHour).padStart(2, '0')}:${String(pickerMinute).padStart(2, '0')}`}
              </ThemedText>
            </View>

            {/* Two scrollable columns: hours | minutes */}
            <View style={styles.pickerColumns}>
              <ScrollView
                style={styles.pickerColumn}
                contentContainerStyle={styles.pickerColumnContent}
                scrollEnabled
                showsVerticalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={52}
                snapToAlignment="center"
                onMomentumScrollEnd={event => {
                  const index = Math.round(event.nativeEvent.contentOffset.y / 52);
                  const hour = Math.max(0, Math.min(23, index));
                  setPickerHour(hour);
                }}>
                {HOURS.map((h) => (
                  <Pressable
                    key={h}
                    onPress={() => setPickerHour(h)}
                    style={[
                      styles.pickerItem,
                      pickerHour === h && styles.pickerItemSelected,
                    ]}>
                    <ThemedText type="title" style={styles.pickerItemText}>
                      {String(h).padStart(2, '0')}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>

              <ThemedText type="title" style={[styles.pickerDivider, { color: theme.text }]}>
                :
              </ThemedText>

              <ScrollView
                style={styles.pickerColumn}
                contentContainerStyle={styles.pickerColumnContent}
                scrollEnabled
                showsVerticalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={52}
                snapToAlignment="center"
                onMomentumScrollEnd={event => {
                  const index = Math.round(event.nativeEvent.contentOffset.y / 52);
                  const minute = MINUTES[Math.max(0, Math.min(MINUTES.length - 1, index))];
                  setPickerMinute(minute);
                }}>
                {MINUTES.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setPickerMinute(m)}
                    style={[
                      styles.pickerItem,
                      pickerMinute === m && styles.pickerItemSelected,
                    ]}>
                    <ThemedText type="title" style={styles.pickerItemText}>
                      {String(m).padStart(2, '0')}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <Pressable
              onPress={handleTimeSelect}
              style={styles.modalClose}>
              <ThemedText type="title" style={styles.modalCloseText}>
                Done
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.three,
      paddingVertical: Spacing.two,
    },
    navButton: {
      padding: Spacing.one,
    },
    navText: {
      fontSize: 32,
      lineHeight: 40,
    },
    monthCenter: {
      alignItems: 'center',
      gap: Spacing.one,
    },
    monthText: {
      fontSize: 20,
      fontWeight: 600,
    },
    todayButton: {
      paddingHorizontal: Spacing.one,
    },
    weekdayRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingVertical: Spacing.one,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    weekdayText: {
      textAlign: 'center',
      fontSize: 14,
      fontWeight: 700,
    },
    daysGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-around',
      paddingVertical: Spacing.two,
    },
    dayCell: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
      margin: 2,
    },
    dayOut: {
      opacity: 0.4,
    },
    daySelected: {
      borderRadius: 18,
    },
    dayToday: {
      borderWidth: 1,
      borderRadius: 18,
    },
    dayNumber: {
      textAlign: 'center',
      fontSize: 16,
    },
    dayOutText: {
      color: theme.textSecondary,
    },
    daySelectedText: {
      color: '#fff',
      fontWeight: 700,
    },
    dayTodayText: {
      fontWeight: 700,
    },
    sectionTitle: {
      alignSelf: 'flex-start',
      marginHorizontal: Spacing.three,
      marginTop: Spacing.two,
      marginBottom: Spacing.one,
    },
    listContainer: {
      paddingHorizontal: Spacing.three,
      paddingBottom: Spacing.six,
    },
    itemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.one,
      paddingHorizontal: Spacing.two,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    itemCompleted: {
      opacity: 0.6,
    },
    checkButton: {
      padding: Spacing.one,
    },
    itemTextWrapper: {
      flex: 1,
      marginHorizontal: Spacing.two,
    },
    itemEditArea: {
      flex: 1,
    },
    itemTitle: {
      fontSize: 18,
      fontWeight: 600,
    },
    itemTitleCompleted: {
      textDecorationLine: 'line-through',
    },
    deleteButton: {
      marginLeft: Spacing.two,
    },
    fabRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: Spacing.two,
      padding: Spacing.three,
    },
    fab: {
      flex: 1,
      maxWidth: 200,
    },
    backButton: {
      alignSelf: 'flex-start',
      marginHorizontal: Spacing.three,
      marginTop: Spacing.one,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.two,
      paddingVertical: Spacing.one,
    },
    recurrenceOption: {
      paddingVertical: Spacing.one,
      paddingHorizontal: Spacing.two,
      borderRadius: Spacing.two,
      marginRight: Spacing.one,
      marginBottom: Spacing.one,
      alignItems: 'center',
    },
    recurrenceSelected: {},
    recurrenceEndCard: {
      marginTop: Spacing.one,
    },
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      padding: Spacing.three,
      gap: Spacing.two,
    },
    cancelButton: {
      flex: 1,
    },
    saveButton: {
      flex: 1,
    },
    input: {
      borderWidth: 1,
      borderRadius: Spacing.two,
      padding: Spacing.two,
      fontSize: 16,
      marginBottom: Spacing.two,
    },
    timePickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: Spacing.two,
      paddingHorizontal: Spacing.two,
      paddingVertical: Spacing.one,
      borderColor: theme.backgroundSelected,
    },
    timePickerSuffix: {
      fontSize: 14,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContainer: {
      backgroundColor: theme.background,
      width: '90%',
      maxWidth: 300,
      borderRadius: Spacing.three,
      padding: Spacing.three,
      maxHeight: '70%',
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: 600,
      marginBottom: Spacing.two,
      color: theme.text,
    },
    timePreview: {
      alignItems: 'center',
      marginVertical: Spacing.two,
    },
    timePreviewText: {
      fontSize: 56,
      fontWeight: 600,
      color: theme.text,
      letterSpacing: -2,
    },
    pickerColumns: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      height: 220,
      marginBottom: Spacing.two,
    },
    pickerColumn: {
      width: '45%',
      height: '100%',
      overflow: 'hidden',
    },
    pickerColumnContent: {
      paddingVertical: 80,
      alignItems: 'center',
    },
    pickerDivider: {
      fontSize: 40,
      fontWeight: 600,
      color: theme.text,
      marginHorizontal: Spacing.one,
    },
    pickerItem: {
      height: 52,
      justifyContent: 'center',
      alignItems: 'center',
      opacity: 0.5,
    },
    pickerItemSelected: {
      opacity: 1,
      fontWeight: 600,
    },
    pickerItemText: {
      fontSize: 32,
      color: theme.text,
    },
    modalClose: {
      alignItems: 'center',
      marginTop: Spacing.two,
      paddingVertical: Spacing.one,
    },
    modalCloseText: {
      fontSize: 16,
      fontWeight: 600,
      color: theme.tint,
    },
    todoSwipeContainer: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.backgroundSelected,
    },
    todoSwipeContent: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.one,
      paddingHorizontal: Spacing.two,
    },
    todoSwipeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flex: 1,
    },
    todoRowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      height: '100%',
      width: 120,
      paddingHorizontal: Spacing.two,
    },
    todoEditAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.one,
      paddingHorizontal: Spacing.three,
      borderRadius: Spacing.two,
    },
    todoDeleteAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.one,
      paddingHorizontal: Spacing.three,
      borderRadius: Spacing.two,
    },
    todoActionLabel: {
      color: '#fff',
    },
  });
}
