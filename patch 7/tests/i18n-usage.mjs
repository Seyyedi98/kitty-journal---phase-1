// Every translation key the UI reads (t.something) must exist in en, fa and tr.
// Static scan: the app itself cannot be run in this environment, so this is
// what catches a typo like t.savedd before it shows up as "undefined" on screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (p) => {
  const m = await import(p);
  return { ...(typeof m.default === 'object' && m.default ? m.default : {}), ...m };
};
const { translations } = await load('../src/i18n/index.js');
const { EMOTION_KEYS } = await load('../src/utils/emotions.js');
const { MOODS } = await load('../src/theme.js');

const files = [path.join(root, 'App.js')];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (
      /\.js$/.test(f.name) &&
      // UI files only: SQL aliases such as `t.id` in db/ must not look like translations.
      ['components', 'screens', 'hooks'].some((d) => p.includes(`${path.sep}${d}${path.sep}`))
    ) files.push(p);
  }
})(path.join(root, 'src'));

const used = new Map(); // key -> first file
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?<![\w.$])t\.([A-Za-z_]\w*)/g)) {
    if (!used.has(m[1])) used.set(m[1], path.relative(root, file));
  }
}
// Dynamic lookups: t[`emotion_${key}`], t[mood.key], t[item.key]
const dynamic = [...EMOTION_KEYS.map((k) => `emotion_${k}`), ...MOODS.map((m) => m.key)];
for (const k of dynamic) if (!used.has(k)) used.set(k, '(dynamic)');

let bad = 0;
for (const [key, file] of used) {
  for (const lang of Object.keys(translations)) {
    if (typeof translations[lang][key] !== 'string' || !translations[lang][key].trim()) {
      console.log(`  MISSING  t.${key}  [${lang}]  used in ${file}`);
      bad++;
    }
  }
}
// Placeholders must match across languages ({n}, {name}, …).
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
for (const key of Object.keys(translations.en)) {
  for (const lang of ['fa', 'tr']) {
    if (ph(translations.en[key]) !== ph(translations[lang][key])) {
      console.log(`  PLACEHOLDER MISMATCH  ${key} [${lang}]: ${ph(translations.en[key])} vs ${ph(translations[lang][key])}`);
      bad++;
    }
  }
}
console.log(`[i18n-usage] ${used.size} keys used, ${bad} problems`);
process.exit(bad ? 1 : 0);
