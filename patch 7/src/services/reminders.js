// Writing reminders (spec section 12). Pure planning logic; scheduling lives in
// src/platform/notifications.js. Reminders are opt-in, gentle, and a missed day
// is never mentioned.

export const DEFAULT_REMINDER = { enabled: false, hour: 20, minute: 0, days: [0, 1, 2, 3, 4, 5, 6] };

const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};

/** Sanitise a stored/imported reminder config. */
export function normalizeReminder(r) {
  const src = r && typeof r === 'object' ? r : {};
  const days = Array.isArray(src.days)
    ? [...new Set(src.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : DEFAULT_REMINDER.days;
  return {
    enabled: src.enabled === true,
    hour: clampInt(src.hour, 0, 23, DEFAULT_REMINDER.hour),
    minute: clampInt(src.minute, 0, 59, DEFAULT_REMINDER.minute),
    days,
  };
}

/**
 * One weekly notification per selected weekday. Weekdays use expo's convention
 * (1 = Sunday … 7 = Saturday); `days` uses JS getDay() (0 = Sunday).
 * Each weekday gets a different gentle message (rotating through `messages`).
 */
export function planReminders(reminder, messages) {
  const r = normalizeReminder(reminder);
  if (!r.enabled || r.days.length === 0 || !messages || messages.length === 0) return [];
  return r.days.map((day) => ({
    weekday: day + 1,
    hour: r.hour,
    minute: r.minute,
    body: messages[day % messages.length],
  }));
}

export function formatTime(hour, minute, locale = 'en-US') {
  const d = new Date(2000, 0, 1, hour, minute);
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
}

/** Step minutes by 5 with wrap-around into the hour. */
export function stepTime({ hour, minute }, deltaMinutes) {
  const total = (((hour * 60 + minute + deltaMinutes) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}
