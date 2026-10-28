// Logic tests (no device needed). Run:  npx tsx tests/run.mjs
// Uses Node's built-in node:sqlite behind a tiny adapter that mimics expo-sqlite.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
// tsx treats extensionless-package .js files as CommonJS, so named imports
// can be hidden behind `default`. load() merges both shapes.
const load = async (p) => {
  const m = await import(p);
  return { ...(typeof m.default === 'object' && m.default ? m.default : {}), ...m };
};
const { translations } = await load('../src/i18n/index.js');
const { foldText, matchesQuery, countWords, tagKey, cleanTagName } = await load('../src/utils/text.js');
const { runMigrations, LATEST_VERSION } = await load('../src/db/migrations.js');
const repo = await load('../src/db/repository.js');
const { gregorianToJalali, jalaliToGregorian, jalaliMonthLength, calendarDateKey, getCalendarParts } = await load('../src/calendar.js');
const { applyFilters, EMPTY_FILTERS } = await load('../src/utils/filters.js');

function makeDb(raw = new DatabaseSync(':memory:')) {
  return {
    raw,
    async execAsync(sql) { raw.exec(sql); },
    async runAsync(sql, ...p) {
      const r = raw.prepare(sql).run(...p.flat());
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    async getAllAsync(sql, ...p) { return raw.prepare(sql).all(...p.flat()).map((x) => ({ ...x })); },
    async getFirstAsync(sql, ...p) { const r = raw.prepare(sql).get(...p.flat()); return r ? { ...r } : null; },
    async withTransactionAsync(fn) {
      raw.exec('BEGIN');
      try { await fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failures.push(name); console.log('  FAIL', name, '\n      ', e.message.split('\n')[0]); }
}

console.log('i18n');
await test('en / fa / tr have identical key sets', () => {
  const keys = (l) => Object.keys(translations[l]).sort();
  assert.deepEqual(keys('fa'), keys('en'));
  assert.deepEqual(keys('tr'), keys('en'));
});
await test('no empty translation strings', () => {
  for (const l of Object.keys(translations)) for (const [k, v] of Object.entries(translations[l])) assert.ok(String(v).trim(), `${l}.${k}`);
});

console.log('text utils');
await test('Turkish dotted/dotless I folds', () => {
  assert.ok(matchesQuery('İstanbul çok güzel', 'istanbul'));
  assert.ok(matchesQuery('ISPARTA', 'ısparta'));
  assert.ok(matchesQuery('şeker', 'SEKER'));
});
await test('Persian: Arabic yeh/kaf, ZWNJ, digits', () => {
  assert.ok(matchesQuery('علي رفت', 'علی'));
  assert.ok(matchesQuery('کتاب', 'كتاب'));
  assert.ok(matchesQuery('می‌روم', 'میروم'));
  assert.ok(matchesQuery('امروز ۱۲ مهر است', '12 مهر'));
});
await test('empty query matches everything; non-match is false', () => {
  assert.ok(matchesQuery('abc', '   '));
  assert.ok(!matchesQuery('abc', 'xyz'));
});
await test('word count: mixed script, ZWNJ, punctuation', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('سلام دنیا hello'), 3);
  assert.equal(countWords('می‌روم خانه، بعد؟ ok!'), 4);
  assert.equal(countWords("don't stop"), 2);
});
await test('tag keys are case/space-insensitive', () => {
  assert.equal(tagKey(' Work '), tagKey('work'));
  assert.equal(cleanTagName('##  my   tag '), 'my tag');
});

console.log('migrations');
await test('fresh install reaches latest version with all tables', async () => {
  const db = makeDb();
  await runMigrations(db);
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, LATEST_VERSION);
  const names = (await db.getAllAsync("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name);
  for (const n of ['entries', 'daily_moods', 'tags', 'entry_tags', 'drafts', 'app_settings']) assert.ok(names.includes(n), n);
});
await test('running twice is a no-op', async () => {
  const db = makeDb();
  await runMigrations(db);
  await runMigrations(db);
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, LATEST_VERSION);
});
await test('existing v0 install (old initDb schema) upgrades without losing data', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
    journal_date TEXT NOT NULL, mood TEXT, favorite INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_entries_date ON entries(journal_date);
    CREATE TABLE daily_moods (journal_date TEXT PRIMARY KEY NOT NULL, mood TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO entries (title, body, journal_date, mood, favorite, created_at, updated_at) VALUES ('سلام','متن قدیمی','2026-10-01','good',1,'t','t');
    INSERT INTO daily_moods VALUES ('2026-10-01','great','t');`);
  const db = makeDb(raw);
  await runMigrations(db);
  const e = await db.getAllAsync('SELECT * FROM entries');
  assert.equal(e.length, 1);
  assert.equal(e[0].title, 'سلام');
  assert.equal(e[0].favorite, 1);
  assert.equal(e[0].pinned, 0);
  assert.equal(e[0].deleted_at, null);
  assert.equal((await db.getAllAsync('SELECT * FROM daily_moods')).length, 1);
});
await test('database from a newer app build is refused, not modified', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`PRAGMA user_version = ${LATEST_VERSION + 5}`);
  await assert.rejects(() => runMigrations(makeDb(raw)), /newer/);
});

console.log('repository');
const fresh = async () => { const db = makeDb(); await runMigrations(db); return db; };

await test('create, update, multiple entries on one date', async () => {
  const db = await fresh();
  const a = await repo.saveEntry(db, { title: 'A', body: 'one', journal_date: '2026-10-23', mood: 'good', tags: [] });
  const b = await repo.saveEntry(db, { title: 'B', body: 'two', journal_date: '2026-10-23', mood: null, tags: [] });
  assert.notEqual(a, b);
  await repo.saveEntry(db, { id: a, title: 'A2', body: 'one!', journal_date: '2026-10-23', mood: 'great', tags: [] });
  const list = await repo.listEntries(db);
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.id === a).title, 'A2');
  assert.equal(list.find((x) => x.id === a).mood, 'great');
});
await test('tags: dedupe case-insensitively, reuse across entries, replace on update', async () => {
  const db = await fresh();
  const a = await repo.saveEntry(db, { title: '', body: 'x', journal_date: '2026-10-23', mood: null, tags: ['Work', 'work', ' WORK ', 'Family'] });
  const b = await repo.saveEntry(db, { title: '', body: 'y', journal_date: '2026-10-24', mood: null, tags: ['work'] });
  let list = await repo.listEntries(db);
  assert.deepEqual(list.find((x) => x.id === a).tags.map((t) => t.name).sort(), ['Family', 'Work']);
  const tags = await repo.listTags(db);
  assert.equal(tags.length, 2);
  assert.equal(tags.find((t) => t.name === 'Work').count, 2);
  await repo.saveEntry(db, { id: a, title: '', body: 'x', journal_date: '2026-10-23', mood: null, tags: ['Family'] });
  list = await repo.listEntries(db);
  assert.deepEqual(list.find((x) => x.id === a).tags.map((t) => t.name), ['Family']);
  assert.equal(list.find((x) => x.id === b).tags.length, 1);
});
await test('deleting a tag never deletes entries', async () => {
  const db = await fresh();
  const a = await repo.saveEntry(db, { title: 't', body: 'b', journal_date: '2026-10-23', mood: null, tags: ['x'] });
  const [tag] = await repo.listTags(db);
  await repo.deleteTag(db, tag.id);
  const list = await repo.listEntries(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a);
  assert.equal(list[0].tags.length, 0);
});
await test('soft delete hides, restore brings back, tag counts ignore deleted', async () => {
  const db = await fresh();
  const a = await repo.saveEntry(db, { title: 'gone', body: 'b', journal_date: '2026-10-23', mood: null, tags: ['t'] });
  await repo.softDeleteEntry(db, a);
  assert.equal((await repo.listEntries(db)).length, 0);
  assert.equal((await repo.listTags(db))[0].count, 0);
  assert.equal((await repo.listDeletedEntries(db)).length, 1);
  await repo.restoreEntry(db, a);
  const list = await repo.listEntries(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].tags[0].name, 't');
});
await test('pinned entries sort first; favorite toggles', async () => {
  const db = await fresh();
  const old = await repo.saveEntry(db, { title: 'old', body: '', journal_date: '2026-01-01', mood: null, tags: [] });
  await repo.saveEntry(db, { title: 'new', body: '', journal_date: '2026-10-01', mood: null, tags: [] });
  await repo.setPinned(db, old, true);
  await repo.setFavorite(db, old, true);
  const list = await repo.listEntries(db);
  assert.equal(list[0].id, old);
  assert.equal(list[0].favorite, 1);
});
await test('failed save rolls back completely (no half-written entry)', async () => {
  const db = await fresh();
  await assert.rejects(() => repo.saveEntry(db, { title: 't', body: 'b', journal_date: null, mood: null, tags: ['x'] }));
  assert.equal((await repo.listEntries(db)).length, 0);
  assert.equal((await repo.listTags(db)).length, 0);
});
await test('daily mood is independent of entry mood and can be cleared', async () => {
  const db = await fresh();
  await repo.saveEntry(db, { title: '', body: 'x', journal_date: '2026-10-23', mood: 'low', tags: [] });
  await repo.setDailyMood(db, '2026-10-23', 'great');
  let moods = await repo.listDailyMoods(db);
  assert.equal(moods['2026-10-23'], 'great');
  assert.equal((await repo.listEntries(db))[0].mood, 'low');
  await repo.setDailyMood(db, '2026-10-23', 'good'); // upsert, no duplicate row
  await repo.setDailyMood(db, '2026-10-23', null);
  moods = await repo.listDailyMoods(db);
  assert.deepEqual(moods, {});
  assert.equal((await repo.listEntries(db))[0].mood, 'low');
});
await test('settings round-trip (JSON values, upsert)', async () => {
  const db = await fresh();
  await repo.saveSetting(db, 'language', 'fa');
  await repo.saveSetting(db, 'language', 'tr');
  await repo.saveSetting(db, 'appearance', 'dark');
  assert.deepEqual(await repo.loadSettings(db), { language: 'tr', appearance: 'dark' });
});
await test('filters: favorites + mood + tag combine with AND', async () => {
  const db = await fresh();
  await repo.saveEntry(db, { title: 'a', body: '', journal_date: '2026-10-01', mood: 'good', tags: ['x'] });
  const b = await repo.saveEntry(db, { title: 'b', body: '', journal_date: '2026-10-02', mood: 'good', tags: ['x', 'y'] });
  await repo.setFavorite(db, b, true);
  const entries = await repo.listEntries(db);
  const tagY = (await repo.listTags(db)).find((t) => t.name === 'y');
  assert.equal(applyFilters(entries, EMPTY_FILTERS).length, 2);
  assert.equal(applyFilters(entries, { favorites: true, mood: null, tagId: null }).length, 1);
  assert.equal(applyFilters(entries, { favorites: false, mood: 'good', tagId: tagY.id })[0].title, 'b');
  assert.equal(applyFilters(entries, { favorites: false, mood: 'low', tagId: null }).length, 0);
});

console.log('calendar (existing code, boundary checks)');
await test('Solar Hijri new year dates', () => {
  const j = (y, m, d) => { const p = gregorianToJalali(y, m, d); return `${p.jy}-${p.jm}-${p.jd}`; };
  assert.equal(j(2024, 3, 20), '1403-1-1');
  assert.equal(j(2025, 3, 21), '1404-1-1');
  assert.equal(j(2026, 3, 21), '1405-1-1');
});
await test('Solar Hijri round-trips for every day 2020–2035', () => {
  for (let t = Date.UTC(2020, 0, 1); t < Date.UTC(2036, 0, 1); t += 86400000) {
    const d = new Date(t);
    const g = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    const p = gregorianToJalali(...g);
    const back = jalaliToGregorian(p.jy, p.jm, p.jd);
    assert.deepEqual([back.gy, back.gm, back.gd], g, `${g}`);
  }
});
await test('Esfand length: 30 in leap years (1403), 29 otherwise (1404)', () => {
  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
});
await test('getCalendarParts / calendarDateKey are inverse', () => {
  const parts = getCalendarParts('2026-10-23', 'solarHijri');
  assert.equal(calendarDateKey(parts.year, parts.month, parts.day, 'solarHijri'), '2026-10-23');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failed:', failures.join('; ')); process.exit(1); }
