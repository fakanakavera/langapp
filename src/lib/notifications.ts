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

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: 6, // AndroidImportance.HIGH
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#208AEF',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
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
  // Clear any previously scheduled reminders so we don't duplicate on relaunch.
  await Notifications.cancelAllScheduledNotificationsAsync();

  for (const weekday of WEEKDAYS) {
    for (const { hour, minute } of TIMES) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'LangApp reminder',
          body: `Time to practice: ${hour}:${String(minute).padStart(2, '0')}`,
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

export async function cancelWeekdayRemindersAsync(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
