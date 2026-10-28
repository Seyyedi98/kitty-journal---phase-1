const pad = value => String(value).padStart(2, '0');

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function gregorianToJalali(gy, gm, gd) {
  const cumulativeMonthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy > 1600 ? 979 : 0;
  gy -= gy > 1600 ? 1600 : 621;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + cumulativeMonthDays[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

export function jalaliToGregorian(jy, jm, jd) {
  const year = jy + 1595;
  let days = -355668 + (365 * year) + Math.floor(year / 33) * 8 + Math.floor(((year % 33) + 3) / 4) + jd;
  days += jm < 7 ? (jm - 1) * 31 : ((jm - 7) * 30) + 186;
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const lengths = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  while (gm <= 12 && gd > lengths[gm]) {
    gd -= lengths[gm];
    gm++;
  }
  return { gy, gm, gd };
}

export function jalaliMonthLength(year, month) {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  const lastDay = jalaliToGregorian(year, 12, 30);
  const back = gregorianToJalali(lastDay.gy, lastDay.gm, lastDay.gd);
  return back.jy === year && back.jm === 12 && back.jd === 30 ? 30 : 29;
}

export function getCalendarParts(key, calendar) {
  const date = parseDateKey(key);
  if (calendar === 'solarHijri') {
    const { jy, jm, jd } = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return { year: jy, month: jm, day: jd };
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function calendarDateKey(year, month, day, calendar) {
  if (calendar === 'solarHijri') {
    const { gy, gm, gd } = jalaliToGregorian(year, month, day);
    return `${gy}-${pad(gm)}-${pad(gd)}`;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function calendarMonthLength(year, month, calendar) {
  if (calendar === 'solarHijri') return jalaliMonthLength(year, month);
  return new Date(year, month, 0).getDate();
}

export function shiftCalendarMonth(year, month, amount) {
  const index = (year * 12) + month - 1 + amount;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 + 1 };
}

export function formatDateKey(key, locale = 'en', calendar = 'gregorian', options = {}) {
  const date = parseDateKey(key);
  const localeTag = locale === 'fa' ? 'fa-IR' : locale === 'tr' ? 'tr-TR' : 'en-US';
  return new Intl.DateTimeFormat(localeTag, { calendar: calendar === 'solarHijri' ? 'persian' : 'gregory', ...options }).format(date);
}

export function formatCalendarMonth(year, month, locale = 'en', calendar = 'gregorian') {
  const firstDate = parseDateKey(calendarDateKey(year, month, 1, calendar));
  const localeTag = locale === 'fa' ? 'fa-IR' : locale === 'tr' ? 'tr-TR' : 'en-US';
  return new Intl.DateTimeFormat(localeTag, { calendar: calendar === 'solarHijri' ? 'persian' : 'gregory', month: 'long', year: 'numeric' }).format(firstDate);
}

export function calendarWeekdayLabels(locale = 'en') {
  const localeTag = locale === 'fa' ? 'fa-IR' : locale === 'tr' ? 'tr-TR' : 'en-US';
  const formatter = new Intl.DateTimeFormat(localeTag, { weekday: 'short', timeZone: 'UTC' });
  // Start on Saturday for Persian, Monday for Turkish, Sunday for English.
  const start = locale === 'fa' ? 6 : locale === 'tr' ? 1 : 0;
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2023, 0, 1 + ((start + index) % 7)))));
}
