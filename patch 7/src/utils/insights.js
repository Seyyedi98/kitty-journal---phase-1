// Descriptive, non-diagnostic statistics computed locally (spec section 18).
// Rules enforced here:
//   * a day without a recorded mood is MISSING data, never "neutral";
//   * no streaks, no "bad day" inference, no judgement of gaps;
//   * every figure is a plain count or average of what the user recorded.

import { getCalendarParts, parseDateKey, dateKey, shiftCalendarMonth } from '../calendar';
import { MOODS } from '../theme';
import { countWords } from './text';

export const RANGE_PRESETS = ['7d', '30d', '90d', '365d', 'all'];
export const MOOD_SCORE = { veryLow: 1, low: 2, okay: 3, good: 4, great: 5 };

export function addDays(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function daysBetween(fromKey, toKey) {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  return Math.round((b - a) / 86400000);
}

/** Inclusive range ending today. `all` = no lower bound (from: null). */
export function rangeFor(preset, today) {
  const n = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[preset];
  if (!n) return { from: null, to: today };
  return { from: addDays(today, -(n - 1)), to: today };
}

const inRange = (key, range) => (!range.from || key >= range.from) && key <= range.to;

const top = (map, limit) =>
  [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit);

/**
 * @param {object} p
 * @param {Array}  p.entries      live entries (with tags, emotions)
 * @param {object} p.dailyMoods   { 'YYYY-MM-DD': moodKey }
 * @param {{from:string|null,to:string}} p.range
 * @param {string} p.today
 * @param {'gregorian'|'solarHijri'} p.calendar
 * @param {number} p.weekStart    0 = Sunday … 6 = Saturday
 */
export function computeInsights({ entries, dailyMoods, range, today, calendar, weekStart = 0 }) {
  const live = entries.filter((e) => inRange(e.journal_date, range));
  const dates = new Set(live.map((e) => e.journal_date));

  // Days covered by the selected period ("all" starts at the first entry).
  let from = range.from;
  if (!from) {
    const first = entries.reduce((m, e) => (m === null || e.journal_date < m ? e.journal_date : m), null);
    from = first || range.to;
  }
  const rangeDays = Math.max(1, daysBetween(from, range.to) + 1);

  let words = 0;
  for (const e of live) words += countWords(`${e.title || ''} ${e.body || ''}`);

  // Weekday distribution, ordered from the locale's first weekday.
  const byWeekday = Array(7).fill(0);
  for (const e of live) byWeekday[parseDateKey(e.journal_date).getDay()] += 1;
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const day = (weekStart + i) % 7;
    return { day, count: byWeekday[day] };
  });

  // Entries per calendar month for the last 6 months (selected calendar system).
  const nowParts = getCalendarParts(today, calendar);
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftCalendarMonth(nowParts.year, nowParts.month, -i);
    monthly.push({ year: m.year, month: m.month, count: 0 });
  }
  for (const e of entries) {
    const p = getCalendarParts(e.journal_date, calendar);
    const slot = monthly.find((m) => m.year === p.year && m.month === p.month);
    if (slot) slot.count += 1;
  }

  // Daily mood distribution (recorded days only).
  const moodCounts = MOODS.map((m) => ({ key: m.key, count: 0 }));
  let moodDays = 0;
  for (const [date, mood] of Object.entries(dailyMoods)) {
    if (!inRange(date, range)) continue;
    const slot = moodCounts.find((m) => m.key === mood);
    if (slot) {
      slot.count += 1;
      moodDays += 1;
    }
  }
  // Entry-level moods are reported separately — never merged with daily moods.
  const entryMoodCounts = MOODS.map((m) => ({ key: m.key, count: live.filter((e) => e.mood === m.key).length }));
  const entryMoodTotal = entryMoodCounts.reduce((s, m) => s + m.count, 0);

  // Weekly average of RECORDED daily moods (null = nothing recorded that week).
  const weekBuckets = [];
  const buckets = Math.min(12, Math.max(1, Math.ceil(rangeDays / 7)));
  for (let i = buckets - 1; i >= 0; i--) {
    const end = addDays(range.to, -7 * i);
    const start = addDays(end, -6);
    let sum = 0;
    let n = 0;
    for (const [date, mood] of Object.entries(dailyMoods)) {
      if (date >= start && date <= end && MOOD_SCORE[mood]) {
        sum += MOOD_SCORE[mood];
        n += 1;
      }
    }
    weekBuckets.push({ start, end, avg: n ? Math.round((sum / n) * 100) / 100 : null, n });
  }

  const tagMap = new Map();
  const emoMap = new Map();
  for (const e of live) {
    for (const t of e.tags || []) {
      const cur = tagMap.get(t.name) || { count: 0 };
      cur.count += 1;
      tagMap.set(t.name, cur);
    }
    for (const em of e.emotions || []) {
      const cur = emoMap.get(em.key) || { count: 0, sum: 0, n: 0 };
      cur.count += 1;
      if (em.intensity) {
        cur.sum += em.intensity;
        cur.n += 1;
      }
      emoMap.set(em.key, cur);
    }
  }

  return {
    totals: {
      entries: live.length,
      writingDays: dates.size,
      rangeDays,
      words,
      avgWords: live.length ? Math.round(words / live.length) : 0,
      favorites: live.filter((e) => e.favorite).length,
    },
    weekdays,
    monthly,
    mood: { counts: moodCounts, recordedDays: moodDays, rangeDays },
    entryMood: { counts: entryMoodCounts, total: entryMoodTotal },
    weeklyMood: weekBuckets,
    topTags: top(tagMap, 5).map(([name, v]) => ({ name, count: v.count })),
    topEmotions: top(emoMap, 5).map(([key, v]) => ({
      key,
      count: v.count,
      avgIntensity: v.n ? Math.round((v.sum / v.n) * 10) / 10 : null,
    })),
  };
}
