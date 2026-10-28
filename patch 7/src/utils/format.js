const LOCALES = { fa: 'fa-IR', tr: 'tr-TR', en: 'en-US' };
export const localeTag = (language) => LOCALES[language] || LOCALES.en;

/** Number formatter that uses the language's digits (Persian digits for fa). */
export function numberFormatter(language) {
  const f = new Intl.NumberFormat(localeTag(language), { maximumFractionDigits: 1 });
  return (n) => f.format(n);
}

/** 1536 -> "1.5 KB". Units stay Latin-script on purpose (KB / MB / GB are universal). */
export function formatBytes(bytes, language = 'en') {
  const n = Math.max(0, Number(bytes) || 0);
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const f = new Intl.NumberFormat(localeTag(language), { maximumFractionDigits: i === 0 ? 0 : 1 });
  return `${f.format(value)} ${units[i]}`;
}

/** Google-Maps-compatible geo: URL (opens any installed maps app). */
export function geoUrl(latitude, longitude, label) {
  const q = label ? `(${encodeURIComponent(label)})` : '';
  return `geo:${latitude},${longitude}?q=${latitude},${longitude}${q}`;
}

/** Fallback for devices where no app handles geo: URLs. */
export function webMapUrl(latitude, longitude) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

/** Format an ISO timestamp as a short date in the user's language/calendar. */
export function isoToDateKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
