// Text helpers: search folding (EN / FA / TR), tag normalisation, word count.

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Fold text so that visually-equivalent spellings match in search.
 * - NFD + strip combining marks (Latin accents, Arabic harakat)
 * - Arabic yeh/kaf -> Persian yeh/kaf, strip ZWNJ / tatweel
 * - Persian / Arabic-Indic digits -> ASCII digits
 * - Turkish İ/I/ı -> i, then lowercase
 * Search is intentionally lenient ("seker" finds "şeker").
 */
export function foldText(value) {
  let s = String(value ?? '');
  s = s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٰٟۖ-ۭ]/g, '')
    .replace(/[ك]/g, 'ک') // ك -> ک
    .replace(/[ىي]/g, 'ی') // ى ي -> ی
    .replace(/[‌‍ـ]/g, '')
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  return s.toLowerCase().normalize('NFC');
}

export function matchesQuery(haystack, query) {
  const q = foldText(query).trim();
  if (!q) return true;
  return foldText(haystack).includes(q);
}

/** Canonical key used to keep tag names unique ("Work" == "work" == " WORK "). */
export function tagKey(name) {
  return foldText(name).replace(/\s+/g, ' ').trim();
}

export function cleanTagName(name) {
  return String(name ?? '')
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

let WORD_RE;
try {
  WORD_RE = new RegExp("[\\p{L}\\p{N}]+(?:['’\\-][\\p{L}\\p{N}]+)*", 'gu');
} catch {
  WORD_RE = null;
}

/** Word count that works for Persian / Turkish / English (ZWNJ-safe). */
export function countWords(text) {
  const s = String(text ?? '').replace(/‌/g, '');
  if (!s.trim()) return 0;
  if (WORD_RE) return (s.match(WORD_RE) || []).length;
  return s.trim().split(/\s+/).length;
}

export function readingMinutes(words) {
  return words === 0 ? 0 : Math.max(1, Math.round(words / 200));
}
