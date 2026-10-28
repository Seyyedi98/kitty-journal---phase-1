// Tests for lock, reminders, themes and insights.  Run: npx tsx tests/logic.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { load, harness } from './helpers.mjs';

const lock = await load('../src/services/lock.js');
const rem = await load('../src/services/reminders.js');
const theme = await load('../src/theme.js');
const ins = await load('../src/utils/insights.js');
const emo = await load('../src/utils/emotions.js');

const h = harness('logic');
const { test, section } = h;

section('lock: crypto primitives vs node:crypto');
await test('sha256 matches node for many lengths (block-boundary cases included)', () => {
  for (const len of [0, 1, 3, 31, 32, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
    const data = crypto.randomBytes(len);
    assert.equal(Buffer.from(lock.sha256(data)).toString('hex'), crypto.createHash('sha256').update(data).digest('hex'), `len ${len}`);
  }
  assert.equal(Buffer.from(lock.sha256(Buffer.from('abc'))).toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
await test('pbkdf2-hmac-sha256 matches node for PINs, salts and iteration counts', () => {
  for (const [pin, iters] of [['1234', 1], ['1234', 2], ['0000', 10000], ['12345678', 777], ['9', 5]]) {
    const salt = crypto.randomBytes(16);
    const mine = Buffer.from(lock.pbkdf2Sha256(Buffer.from(pin), salt, iters)).toString('hex');
    assert.equal(mine, crypto.pbkdf2Sync(pin, salt, iters, 32, 'sha256').toString('hex'), `${pin}/${iters}`);
  }
});
await test('10k-iteration hash is fast enough for a phone (informational timing)', () => {
  const t = process.hrtime.bigint();
  lock.pbkdf2Sha256(Buffer.from('1234'), crypto.randomBytes(16), 10000);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log(`        (10k iterations took ${ms.toFixed(0)} ms on this machine)`);
  assert.ok(ms < 3000);
});

section('lock: PIN records');
const rnd = (n) => Uint8Array.from(crypto.randomBytes(n));
await test('PIN validation: 4–8 digits only', () => {
  for (const ok of ['1234', '00000000', '987654']) assert.ok(lock.isValidPin(ok), ok);
  for (const bad of ['123', '123456789', '12a4', '', ' 1234', '١٢٣٤', null, undefined]) assert.ok(!lock.isValidPin(bad), String(bad));
});
await test('record never contains the PIN; right PIN verifies, wrong ones do not', () => {
  const rec = lock.createPinRecord('4821', rnd);
  assert.ok(!JSON.stringify(rec).includes('4821'));
  assert.equal(rec.salt.length, 32); assert.equal(rec.hash.length, 64);
  assert.ok(lock.verifyPin('4821', rec));
  for (const wrong of ['4822', '0000', '482', '48210', 'abcd']) assert.ok(!lock.verifyPin(wrong, rec), wrong);
});
await test('two records for the same PIN differ (random salt)', () => {
  const a = lock.createPinRecord('1111', rnd); const b = lock.createPinRecord('1111', rnd);
  assert.notEqual(a.hash, b.hash);
});
await test('tampered / malformed records never verify', () => {
  const rec = lock.createPinRecord('1357', rnd);
  for (const bad of [null, {}, { ...rec, v: 2 }, { ...rec, kdf: 'md5' }, { ...rec, hash: 'zz' }, { ...rec, salt: rec.salt.slice(2) }, { ...rec, hash: '0'.repeat(64) }]) {
    assert.equal(lock.verifyPin('1357', bad), false);
  }
  assert.throws(() => lock.createPinRecord('12', rnd));
  assert.throws(() => lock.createPinRecord('1234', () => new Uint8Array(3)));
});

section('lock: lockout + relock policy');
await test('lockout schedule: free attempts, then 30s doubling, capped at 15 min', () => {
  assert.deepEqual([1, 2, 3, 4].map(lock.lockoutMs), [0, 0, 0, 0]);
  assert.deepEqual([5, 6, 7, 8].map(lock.lockoutMs), [30000, 60000, 120000, 240000]);
  assert.equal(lock.lockoutMs(30), 900000);
});
await test('failed attempts accumulate; success resets; state survives as plain JSON', () => {
  let s = { ...lock.EMPTY_LOCK_STATE };
  const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) s = lock.onFailedAttempt(s, t0 + i);
  assert.equal(lock.remainingLockMs(s, t0 + 10), 0);
  s = lock.onFailedAttempt(s, t0 + 10);
  assert.equal(s.fails, 5);
  assert.equal(lock.remainingLockMs(s, t0 + 10), 30000);
  assert.equal(lock.remainingLockMs(s, t0 + 10 + 29999), 1);
  assert.equal(lock.remainingLockMs(s, t0 + 10 + 30000), 0);
  s = JSON.parse(JSON.stringify(s)); // persisted + reloaded after an app restart
  assert.equal(lock.remainingLockMs(s, t0 + 11), 29999);
  assert.deepEqual(lock.onSuccessfulAttempt(), lock.EMPTY_LOCK_STATE);
});
await test('moving the clock backwards does not shorten a lockout', () => {
  let s = { ...lock.EMPTY_LOCK_STATE };
  for (let i = 0; i < 5; i++) s = lock.onFailedAttempt(s, 5_000_000);
  assert.equal(lock.remainingLockMs(s, 4_000_000), lock.lockoutMs(5)); // full penalty, not "hours left"
});
await test('relock policy', () => {
  const base = { enabled: true, backgroundedAt: 1000, now: 1500 };
  assert.equal(lock.shouldRelock({ ...base, delay: 'immediately' }), true);
  assert.equal(lock.shouldRelock({ ...base, delay: '1m' }), false);
  assert.equal(lock.shouldRelock({ ...base, delay: '1m', now: 1000 + 60000 }), true);
  assert.equal(lock.shouldRelock({ ...base, delay: '5m', now: 1000 + 299999 }), false);
  assert.equal(lock.shouldRelock({ ...base, enabled: false, delay: 'immediately' }), false);
  assert.equal(lock.shouldRelock({ ...base, backgroundedAt: null, delay: 'immediately' }), false);
  assert.equal(lock.shouldRelock({ ...base, now: 10, delay: '5m' }), true, 'clock went backwards: fail closed');
  assert.equal(lock.shouldRelock({ ...base, delay: 'bogus' }), true, 'unknown delay -> strictest');
});

section('reminders');
await test('defaults are off; normalisation repairs bad stored data', () => {
  assert.equal(rem.normalizeReminder(undefined).enabled, false);
  assert.deepEqual(rem.normalizeReminder({ enabled: 'yes', hour: 99, minute: -5, days: [1, 1, 9, 'x', 3] }), { enabled: false, hour: 20, minute: 0, days: [1, 3] });
  assert.deepEqual(rem.normalizeReminder({ enabled: true, hour: 7, minute: 30, days: 'oops' }).days, [0, 1, 2, 3, 4, 5, 6]);
});
await test('plan: one weekly notification per chosen day, expo weekdays, rotating messages', () => {
  const msgs = ['m0', 'm1', 'm2'];
  const plan = rem.planReminders({ enabled: true, hour: 21, minute: 15, days: [0, 2, 6] }, msgs);
  assert.deepEqual(plan.map((p) => p.weekday), [1, 3, 7]);
  assert.ok(plan.every((p) => p.hour === 21 && p.minute === 15));
  assert.deepEqual(plan.map((p) => p.body), ['m0', 'm2', 'm0']);
  assert.deepEqual(rem.planReminders({ enabled: false, days: [1] }, msgs), []);
  assert.deepEqual(rem.planReminders({ enabled: true, days: [] }, msgs), []);
  assert.deepEqual(rem.planReminders({ enabled: true, days: [1] }, []), []);
});
await test('re-planning is deterministic (no duplicates when settings are edited)', () => {
  const r = { enabled: true, hour: 8, minute: 0, days: [1, 2, 3] };
  assert.deepEqual(rem.planReminders(r, ['a', 'b']), rem.planReminders({ ...r }, ['a', 'b']));
  assert.equal(rem.planReminders(r, ['a']).length, 3);
});
await test('time stepping wraps around midnight and the hour', () => {
  assert.deepEqual(rem.stepTime({ hour: 23, minute: 55 }, 5), { hour: 0, minute: 0 });
  assert.deepEqual(rem.stepTime({ hour: 0, minute: 0 }, -5), { hour: 23, minute: 55 });
  assert.deepEqual(rem.stepTime({ hour: 9, minute: 30 }, 60), { hour: 10, minute: 30 });
});

section('themes / contrast');
await test('every theme resolves for light and dark; unknown theme falls back', () => {
  for (const key of theme.THEME_KEYS) for (const dark of [false, true]) {
    const p = theme.buildPalette(key, dark);
    for (const k of ['ink', 'paper', 'card', 'accent', 'sage', 'sageDark', 'onAccent', 'line']) assert.match(p[k], /^#[0-9A-Fa-f]{6}$/, `${key}.${k}`);
  }
  assert.deepEqual(theme.buildPalette('nope', false), theme.BASE);
  assert.deepEqual(theme.buildPalette('sage', true), theme.DARK);
});
await test('new themes meet WCAG AA (4.5:1) for text, selected states and accent buttons', () => {
  for (const key of theme.THEME_KEYS.filter((k) => k !== 'sage')) for (const dark of [false, true]) {
    const p = theme.buildPalette(key, dark);
    const name = `${key}/${dark ? 'dark' : 'light'}`;
    assert.ok(theme.contrastRatio(p.ink, p.paper) >= 4.5, `${name} ink/paper`);
    assert.ok(theme.contrastRatio(p.muted, p.paper) >= 4.5, `${name} muted/paper`);
    assert.ok(theme.contrastRatio(p.sageDark, p.card) >= 4.5, `${name} sageDark/card`);
    assert.ok(theme.contrastRatio(p.sageDark, p.sage) >= 4.5, `${name} sageDark/sage`);
    assert.ok(theme.contrastRatio(p.onAccent, p.accent) >= 4.5, `${name} onAccent/accent`);
  }
});
await test('default theme: button text is readable in both modes (was 1.8:1 in dark)', () => {
  assert.ok(theme.contrastRatio(theme.DARK.onAccent, theme.DARK.accent) >= 4.5);
  assert.ok(theme.contrastRatio(theme.BASE.onAccent, theme.BASE.accent) >= 3.0);
  const r = (a, b) => theme.contrastRatio(a, b).toFixed(2);
  console.log(`        (default light, informational: muted/paper ${r(theme.BASE.muted, theme.BASE.paper)}, sageDark/card ${r(theme.BASE.sageDark, theme.BASE.card)}, sageDark/sage ${r(theme.BASE.sageDark, theme.BASE.sage)}, white/accent ${r(theme.BASE.onAccent, theme.BASE.accent)} — below 4.5)`);
});

section('emotions');
await test('catalog keys are unique machine keys; cleanEmotions is strict', () => {
  assert.equal(new Set(emo.EMOTION_KEYS).size, emo.EMOTIONS.length);
  assert.ok(emo.EMOTION_KEYS.every((k) => /^[a-z]+$/.test(k)));
  assert.deepEqual(emo.cleanEmotions('x'), []);
  assert.deepEqual(emo.cleanEmotions([{ key: 'calm', intensity: 0 }, { key: 'calm' }, null, { key: 'sad', intensity: 5 }]), [{ key: 'calm', intensity: null }, { key: 'sad', intensity: 5 }]);
});

section('insights');
const mk = (date, extra = {}) => ({ journal_date: date, title: '', body: 'one two three', mood: null, favorite: 0, tags: [], emotions: [], ...extra });
const today = '2026-10-23'; // a Friday
await test('range presets', () => {
  assert.deepEqual(ins.rangeFor('7d', today), { from: '2026-10-17', to: today });
  assert.deepEqual(ins.rangeFor('30d', today), { from: '2026-09-24', to: today });
  assert.deepEqual(ins.rangeFor('all', today), { from: null, to: today });
  assert.equal(ins.daysBetween('2026-10-01', '2026-10-23'), 22);
  assert.equal(ins.addDays('2026-12-31', 1), '2027-01-01');
});
await test('totals respect the range; words counted for fa/en/tr', () => {
  const entries = [
    mk('2026-10-22', { body: 'سلام دنیا hello', favorite: 1 }),
    mk('2026-10-22', { body: 'İstanbul çok güzel' }),
    mk('2026-10-01'),
    mk('2026-01-01'),
  ];
  const r = ins.computeInsights({ entries, dailyMoods: {}, range: ins.rangeFor('30d', today), today, calendar: 'gregorian' });
  assert.equal(r.totals.entries, 3);
  assert.equal(r.totals.writingDays, 2);
  assert.equal(r.totals.words, 3 + 3 + 3);
  assert.equal(r.totals.favorites, 1);
  assert.equal(r.totals.rangeDays, 30);
  const all = ins.computeInsights({ entries, dailyMoods: {}, range: ins.rangeFor('all', today), today, calendar: 'gregorian' });
  assert.equal(all.totals.entries, 4);
  assert.equal(all.totals.rangeDays, ins.daysBetween('2026-01-01', today) + 1);
});
await test('missing mood is missing: never counted as neutral', () => {
  const moods = { '2026-10-20': 'good', '2026-10-21': 'good', '2026-10-22': 'low' };
  const r = ins.computeInsights({ entries: [mk('2026-10-20'), mk('2026-10-23')], dailyMoods: moods, range: ins.rangeFor('7d', today), today, calendar: 'gregorian' });
  assert.equal(r.mood.recordedDays, 3);
  assert.equal(r.mood.rangeDays, 7);
  assert.equal(r.mood.counts.find((m) => m.key === 'okay').count, 0);
  assert.equal(r.mood.counts.find((m) => m.key === 'good').count, 2);
  const noData = ins.computeInsights({ entries: [], dailyMoods: {}, range: ins.rangeFor('7d', today), today, calendar: 'gregorian' });
  assert.equal(noData.mood.recordedDays, 0);
  assert.ok(noData.weeklyMood.every((w) => w.avg === null && w.n === 0));
});
await test('daily and entry-level moods are reported separately', () => {
  const r = ins.computeInsights({ entries: [mk('2026-10-22', { mood: 'great' })], dailyMoods: { '2026-10-22': 'low' }, range: ins.rangeFor('7d', today), today, calendar: 'gregorian' });
  assert.equal(r.mood.counts.find((m) => m.key === 'low').count, 1);
  assert.equal(r.mood.counts.find((m) => m.key === 'great').count, 0);
  assert.equal(r.entryMood.counts.find((m) => m.key === 'great').count, 1);
  assert.equal(r.entryMood.total, 1);
});
await test('weekly mood averages only recorded days; buckets end today', () => {
  const moods = { '2026-10-23': 'great', '2026-10-22': 'low', '2026-10-10': 'okay' };
  const r = ins.computeInsights({ entries: [], dailyMoods: moods, range: ins.rangeFor('30d', today), today, calendar: 'gregorian' });
  const last = r.weeklyMood[r.weeklyMood.length - 1];
  assert.equal(last.end, today); assert.equal(last.avg, 3.5); assert.equal(last.n, 2);
  assert.equal(r.weeklyMood.length, 5);
});
await test('weekday order follows the locale week start', () => {
  const entries = [mk('2026-10-23'), mk('2026-10-23'), mk('2026-10-24')]; // Fri x2, Sat x1
  const sun = ins.computeInsights({ entries, dailyMoods: {}, range: ins.rangeFor('7d', today), today, calendar: 'gregorian', weekStart: 0 });
  assert.deepEqual(sun.weekdays.map((w) => w.day), [0, 1, 2, 3, 4, 5, 6]);
  const sat = ins.computeInsights({ entries, dailyMoods: {}, range: { from: '2026-10-17', to: '2026-10-24' }, today, calendar: 'gregorian', weekStart: 6 });
  assert.deepEqual(sat.weekdays.map((w) => w.day), [6, 0, 1, 2, 3, 4, 5]);
  assert.equal(sat.weekdays[0].count, 1);
  assert.equal(sat.weekdays[6].count, 2);
});
await test('monthly activity: last 6 months in the chosen calendar (Gregorian and Solar Hijri)', () => {
  const entries = [mk('2026-10-05'), mk('2026-10-20'), mk('2026-09-30'), mk('2026-04-01'), mk('2026-05-02')];
  const g = ins.computeInsights({ entries, dailyMoods: {}, range: ins.rangeFor('all', today), today, calendar: 'gregorian' });
  assert.deepEqual(g.monthly.map((m) => `${m.year}-${m.month}`), ['2026-5', '2026-6', '2026-7', '2026-8', '2026-9', '2026-10']);
  assert.deepEqual(g.monthly.map((m) => m.count), [1, 0, 0, 0, 1, 2]);
  const j = ins.computeInsights({ entries, dailyMoods: {}, range: ins.rangeFor('all', today), today, calendar: 'solarHijri' });
  assert.equal(j.monthly.length, 6);
  assert.ok(j.monthly.every((m) => m.year === 1405 || m.year === 1404));
  assert.equal(j.monthly.reduce((s, m) => s + m.count, 0) <= entries.length, true);
});
await test('top tags and emotions (intensity averaged over rated entries only)', () => {
  const entries = [
    mk('2026-10-22', { tags: [{ name: 'work' }, { name: 'family' }], emotions: [{ key: 'calm', intensity: 4 }, { key: 'sad', intensity: null }] }),
    mk('2026-10-21', { tags: [{ name: 'work' }], emotions: [{ key: 'calm', intensity: 2 }] }),
    mk('2026-10-20', { emotions: [{ key: 'calm', intensity: null }] }),
  ];
  const r = ins.computeInsights({ entries, dailyMoods: {}, range: ins.rangeFor('30d', today), today, calendar: 'gregorian' });
  assert.deepEqual(r.topTags, [{ name: 'work', count: 2 }, { name: 'family', count: 1 }]);
  assert.deepEqual(r.topEmotions[0], { key: 'calm', count: 3, avgIntensity: 3 });
  assert.equal(r.topEmotions.find((e) => e.key === 'sad').avgIntensity, null);
});
await test('empty journal does not crash or invent numbers', () => {
  const r = ins.computeInsights({ entries: [], dailyMoods: {}, range: ins.rangeFor('all', today), today, calendar: 'gregorian' });
  assert.equal(r.totals.entries, 0); assert.equal(r.totals.avgWords, 0); assert.equal(r.totals.rangeDays, 1);
  assert.deepEqual(r.topTags, []);
});

h.done();
