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
