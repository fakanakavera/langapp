import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure how notifications behave while the app is running (foreground).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const WEEKDAYS = [2, 3, 4, 5, 6]; // Monday - Friday

const TIMES = [
  { hour: 7, minute: 40 },
  { hour: 10, minute: 2 },
  { hour: 12, minute: 25 },
  { hour: 15, minute: 2 },
  { hour: 17, minute: 1 },
];

let notificationPermissionPromise: Promise<boolean> | null = null;

async function cancelNotifications(
  predicate: (notification: Notifications.NotificationRequest) => boolean,
): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter(predicate)
      .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)),
  );
}

export function ensureNotificationPermissionsAsync(): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(false);
  if (notificationPermissionPromise) return notificationPermissionPromise;

  notificationPermissionPromise = (async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: 6, // AndroidImportance.HIGH
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#208AEF',
        });
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      if (existingStatus === 'granted') return true;
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    } finally {
      notificationPermissionPromise = null;
    }
  })();
  return notificationPermissionPromise;
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!(await ensureNotificationPermissionsAsync())) {
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({});
    return token.data;
  } catch {
    return null;
  }
}

export async function scheduleWeekdayRemindersAsync(): Promise<void> {
  if (Platform.OS === 'web') return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await cancelNotifications(
    (notification) =>
      notification.content.data?.kind === 'weekday-reminder' ||
      notification.content.title === 'LangApp reminder',
  );

  for (const weekday of WEEKDAYS) {
    for (const { hour, minute } of TIMES) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'LangApp reminder',
          body: `Time to practice: ${hour}:${String(minute).padStart(2, '0')}`,
          data: { kind: 'weekday-reminder' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          weekday,
          hour,
          minute,
          second: 0,
          repeats: true,
        } as Notifications.SchedulableNotificationTriggerInput,
      });
    }
  }
}

export async function scheduleMoneyEstimateReminderAsync(estimateCount: number): Promise<void> {
  if (Platform.OS === 'web') return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await cancelNotifications(
    (notification) => notification.content.data?.kind === 'money-estimate-reminder',
  );
  if (estimateCount <= 0) return;

  const reminderDate = new Date();
  reminderDate.setHours(22, 0, 0, 0);
  if (reminderDate <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Money estimates to review',
      body: `You still have ${estimateCount} estimate${estimateCount === 1 ? '' : 's'} to update or confirm today.`,
      data: { kind: 'money-estimate-reminder' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
    },
  });
}

export async function cancelWeekdayRemindersAsync(): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelNotifications(
    (notification) =>
      notification.content.data?.kind === 'weekday-reminder' ||
      notification.content.title === 'LangApp reminder',
  );
}

// ---------------------------------------------------------------------------
// Calendar event & todo notifications.
// These fire even when the phone is locked (system-delivered).
// ---------------------------------------------------------------------------

export async function scheduleCalendarEventNotification(event: {
  id: string;
  title: string;
  start_date: string;
  reminder_offset: number;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  await cancelNotifications(
    (n) => n.content.data?.kind === 'calendar-event' && n.content.data?.eventId === event.id,
  );

  const start = new Date(event.start_date);
  start.setMinutes(start.getMinutes() - event.reminder_offset);
  if (start <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Calendar: ${event.title}`,
      body: `Starting in ${event.reminder_offset} minute${event.reminder_offset !== 1 ? 's' : ''}.`,
      sound: true,
      data: { kind: 'calendar-event', eventId: event.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: start },
    identifier: `calendar-event-${event.id}`,
  });
}

export async function cancelCalendarEventNotification(eventId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelNotifications(
    (n) => n.content.data?.kind === 'calendar-event' && n.content.data?.eventId === eventId,
  );
}

export async function scheduleCalendarTodoNotification(todo: {
  id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  reminder_offset: number;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  await cancelNotifications(
    (n) => n.content.data?.kind === 'calendar-todo' && n.content.data?.todoId === todo.id,
  );

  let triggerDate: Date | null = null;

  if (todo.due_time) {
    const [hours, minutes] = todo.due_time.split(':').map(Number);
    const d = new Date(todo.due_date);
    d.setHours(hours, minutes, 0, 0);
    triggerDate = d;
  } else {
    // No time: remind at 9:00 on the due date.
    const d = new Date(todo.due_date);
    d.setHours(9, 0, 0, 0);
    triggerDate = d;
  }

  if (triggerDate) {
    triggerDate.setMinutes(triggerDate.getMinutes() - todo.reminder_offset);
  }

  if (!triggerDate || triggerDate <= new Date()) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `ToDo: ${todo.title}`,
      body: `Due in ${todo.reminder_offset} minute${todo.reminder_offset !== 1 ? 's' : ''}.`,
      sound: true,
      data: { kind: 'calendar-todo', todoId: todo.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    identifier: `calendar-todo-${todo.id}`,
  });
}

export async function cancelCalendarTodoNotification(todoId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelNotifications(
    (n) => n.content.data?.kind === 'calendar-todo' && n.content.data?.todoId === todoId,
  );
}
