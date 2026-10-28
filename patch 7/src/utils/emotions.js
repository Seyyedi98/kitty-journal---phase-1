// Bundled, versioned emotion catalog. Stored by `key`, never by label, so a
// translation change can never orphan saved data. Labels live in i18n as
// `emotion_<key>`. Extend by appending — never rename or remove a key.
export const EMOTION_CATALOG_VERSION = 1;

export const EMOTIONS = [
  { key: 'calm', face: '😌' },
  { key: 'grateful', face: '🙏' },
  { key: 'content', face: '☺️' },
  { key: 'hopeful', face: '🌱' },
  { key: 'excited', face: '🤩' },
  { key: 'tired', face: '😴' },
  { key: 'anxious', face: '😰' },
  { key: 'sad', face: '😢' },
  { key: 'frustrated', face: '😤' },
  { key: 'lonely', face: '🫥' },
];

export const EMOTION_KEYS = EMOTIONS.map((e) => e.key);

export function isEmotionKey(key) {
  return EMOTION_KEYS.includes(key);
}

/** Normalise user/imported emotions: known keys only, unique, intensity 1–5 or null. */
export function cleanEmotions(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const key = raw && raw.key;
    if (!isEmotionKey(key) || seen.has(key)) continue;
    seen.add(key);
    const n = Number(raw.intensity);
    out.push({ key, intensity: Number.isInteger(n) && n >= 1 && n <= 5 ? n : null });
  }
  return out;
}
