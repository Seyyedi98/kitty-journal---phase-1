// Local, on-device reminders. No server, no push token, no account.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { planReminders, normalizeReminder } from '../services/reminders';

const CHANNEL_ID = 'writing-reminders';
const TAG = 'kitty-journal-reminder';

let handlerSet = false;
export function initNotifications() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannel(name) {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name,
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 120],
    showBadge: false,
  });
}

/** @returns {Promise<'granted'|'denied'|'undetermined'>} */
export async function permissionStatus() {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain === false ? 'denied' : 'undetermined';
}

export async function requestPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  const asked = await Notifications.requestPermissionsAsync();
  if (asked.granted) return 'granted';
  return asked.canAskAgain === false ? 'denied' : 'undetermined';
}

/** Cancels only this app's reminders (identified by data.tag). */
async function cancelOurs() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of all) {
    if (n.content && n.content.data && n.content.data.tag === TAG) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

/**
 * Re-plans from scratch every time (cancel ours, schedule the plan), so editing
 * the reminder can never leave duplicates behind.
 * @param {object} reminder   { enabled, hour, minute, days }
 * @param {{title:string, messages:string[], channelName:string}} text
 * @returns {Promise<number>} how many notifications are scheduled
 */
export async function applyReminders(reminder, text) {
  await cancelOurs();
  const plan = planReminders(normalizeReminder(reminder), text.messages);
  if (!plan.length) return 0;
  await ensureChannel(text.channelName);
  for (const item of plan) {
    await Notifications.scheduleNotificationAsync({
      content: { title: text.title, body: item.body, data: { tag: TAG, action: 'new-entry' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: item.weekday,
        hour: item.hour,
        minute: item.minute,
        channelId: CHANNEL_ID,
      },
    });
  }
  return plan.length;
}

/** Calls back when the user taps one of our reminders. Returns an unsubscribe fn. */
export function onReminderTapped(callback) {
  const handle = (response) => {
    const data = response && response.notification && response.notification.request.content.data;
    if (data && data.tag === TAG) callback();
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  // App launched cold from a tap.
  Promise.resolve(Notifications.getLastNotificationResponseAsync?.())
    .then((r) => {
      if (r) handle(r);
    })
    .catch(() => {});
  return () => sub.remove();
}
