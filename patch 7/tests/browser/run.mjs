// End-to-end smoke test of the REAL App.js in headless Chromium.
//   * native modules are replaced by stand-ins (tests/browser/stubs)
//   * the database is a real SQLite (node:sqlite) reached through a bridge
// Run:  node tests/browser/run.mjs      (needs Node 22+, playwright + esbuild)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { bundle } from './build.mjs';

const require = createRequire('/opt/npm-tools/package.json');
const { chromium } = require('playwright');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-browser-'));
const bundlePath = path.join(out, 'bundle.js');
await bundle(bundlePath);

const raw = new DatabaseSync(':memory:');
const q = (sql, ...p) => raw.prepare(sql).all(...p).map((r) => ({ ...r }));
const one = (sql, ...p) => q(sql, ...p)[0] || null;

const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 412, height: 860 } });
page.setDefaultTimeout(5000);
await page.exposeFunction('__db', (op, sql, params) => {
  if (op === 'exec') { raw.exec(sql); return null; }
  if (op === 'run') {
    const r = raw.prepare(sql).run(...params);
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
  }
  if (op === 'all') return raw.prepare(sql).all(...params).map((r) => ({ ...r }));
  if (op === 'first') { const r = raw.prepare(sql).get(...params); return r ? { ...r } : null; }
  throw new Error('bad op ' + op);
});
await page.setContent('<!doctype html><html><body style="margin:0"><div id="root"></div></body></html>');
await page.addScriptTag({ path: bundlePath });

let passed = 0;
const failures = [];
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) {
    failures.push(name);
    console.log('  FAIL', name, '\n      ', String(e.message).split('\n').slice(0, 14).join(' | '));
    if (process.env.KJ_DEBUG) {
      console.log('      page errors:', JSON.stringify((await errors().catch(() => [])).slice(0, 3)).slice(0, 600));
      console.log('      page text  :', JSON.stringify((await bodyText().catch(() => '')).slice(0, 400)));
    }
  }
}
const wait = (ms) => page.waitForTimeout(ms);
const text = (t, opts = {}) => page.getByText(t, { exact: true, ...opts });
const label = (l) => page.locator(`[aria-label="${l}"]`);
const bodyText = () => page.evaluate(() => document.body.innerText);
const errors = () => page.evaluate(() => window.__errors);
async function waitForText(t, timeout = 4000) {
  await page.waitForFunction((s) => document.body.innerText.includes(s), t, { timeout });
}
async function waitFor(fn, timeout = 4000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await wait(80);
  }
}
const putFile = (uri, bytes = 3000) =>
  page.evaluate(([u, n]) => window.__files.set(u, 'A'.repeat(n)), [uri, bytes]);
const files = () => page.evaluate(() => [...window.__files.keys()]);

console.log('boot');
await step('app boots, migrations run, home renders without errors', async () => {
  await waitForText('Kitty Journal');
  await waitForText('Recent entries');
  const v = one('PRAGMA user_version').user_version;
  assert.ok(v >= 4, 'user_version ' + v);
  assert.deepEqual(await errors(), []);
});

console.log('entry: text, tag, feelings, place, photo');
await step('new entry autosaves text and shows "Saved" only after commit', async () => {
  await label('New entry').click();
  await page.getByPlaceholder('A title for today (optional)').fill('Istanbul day');
  await page.getByPlaceholder('What is on your mind?').fill('Walked by the water and took photos.');
  await waitFor(() => one("SELECT * FROM entries WHERE title='Istanbul day'"));
  await waitForText('Saved');
  const e = one("SELECT * FROM entries WHERE title='Istanbul day'");
  assert.equal(e.body, 'Walked by the water and took photos.');
  assert.ok(e.uuid && e.uuid.length === 32);
});
await step('tag is added with Enter and stored once', async () => {
  const tagInput = page.getByPlaceholder('Add a tag…');
  await tagInput.fill('travel');
  await tagInput.press('Enter');
  await tagInput.fill('Travel');
  await tagInput.press('Enter'); // duplicate (case-insensitive) is ignored
  await waitFor(() => one('SELECT COUNT(*) AS n FROM entry_tags').n === 1);
  assert.equal(q('SELECT * FROM tags').length, 1);
});
await step('secondary feeling with strength is stored by machine key', async () => {
  await text('Calm', { exact: true }).first().click();
  await label('Strength 4 of 5').click();
  await waitFor(() => one("SELECT * FROM entry_emotions WHERE emotion_key='calm'"));
  await waitFor(() => one("SELECT intensity FROM entry_emotions WHERE emotion_key='calm'").intensity === 4);
});
await step('"use current location" saves coordinates + name', async () => {
  await text('Use current location').click();
  await waitFor(() => one('SELECT * FROM locations'));
  const l = one('SELECT * FROM locations');
  assert.equal(Math.round(l.latitude * 1000), 41008);
  assert.equal(l.name, 'Galata Tower');
});
await step('denied location permission shows a message, typed name still works', async () => {
  await label('Remove place').click();
  await waitFor(() => !one('SELECT * FROM locations'));
  await page.evaluate(() => { window.__location.granted = false; });
  await text('Use current location').click();
  await waitForText('Location permission was not granted');
  await page.getByPlaceholder('Where were you? (optional)').fill('Kadıköy pier');
  await waitFor(() => one("SELECT * FROM locations WHERE name='Kadıköy pier'"));
  assert.equal(one('SELECT latitude FROM locations').latitude, null);
  // restore a real fix for the rest of the run
  await page.evaluate(() => { window.__location.granted = true; });
  await text('Use current location').click();
  await waitFor(() => one('SELECT latitude FROM locations').latitude != null);
});
await step('photo: picked, copied, thumbnailed, row inserted (big image is re-encoded)', async () => {
  await putFile('file:///cache/pick1.jpg', 3 * 1024 * 1024 + 50);
  await page.evaluate(() => { window.__nextPick = [{ uri: 'file:///cache/pick1.jpg', width: 4000, height: 3000, mimeType: 'image/jpeg' }]; });
  await text('Add photos').click();
  await waitFor(() => one('SELECT * FROM attachments'));
  const a = one('SELECT * FROM attachments');
  const f = await files();
  assert.ok(f.includes('file:///docs/attachments/' + a.file_name), 'main file stored');
  assert.ok(a.thumb_name && f.includes('file:///docs/attachments/' + a.thumb_name), 'thumbnail stored');
  assert.ok(a.width <= 2048 && a.height <= 2048, 'resized to max edge');
  await waitForText('1 added');
});
await step('photo picker cancelled: nothing changes', async () => {
  const before = q('SELECT * FROM attachments').length;
  await page.evaluate(() => { window.__nextPick = []; });
  await text('Add photos').click();
  await wait(300);
  assert.equal(q('SELECT * FROM attachments').length, before);
});
await step('photo: import failure leaves no row and no stray files', async () => {
  const before = (await files()).length;
  await page.evaluate(() => { window.__nextPick = [{ uri: 'file:///cache/does-not-exist.jpg', width: 800, height: 600 }]; });
  await text('Add photos').click();
  await waitForText('could not be added');
  assert.equal(q('SELECT * FROM attachments').length, 1);
  assert.equal((await files()).length, before);
});

console.log('home list and memories');
await step('closing the editor shows the entry with photo count, place and feeling', async () => {
  await text('Done').click();
  await waitFor(async () => (await bodyText()).includes('Istanbul day'));
  const t = await bodyText();
  assert.ok(t.includes('#travel'));
  assert.ok(t.includes('Kadıköy pier'));
  assert.equal(await page.locator('[data-icon="Image"]').count() >= 1, true);
});
await step('Memories: photo grid + places list + open in maps', async () => {
  await label('tab-memories').click();
  await waitFor(async () => (await page.locator('img').count()) >= 1);
  assert.ok((await bodyText()).includes('1 photos'));
  await text('Places').click();
  await waitForText('Kadıköy pier');
  await text('Open in maps').click();
  await waitFor(async () => (await page.evaluate(() => window.__opened || [])).length === 1);
  const url = (await page.evaluate(() => window.__opened))[0];
  assert.ok(url.startsWith('geo:41.0082,28.9784'), url);
});
await step('opening an entry from Memories opens the editor with its data', async () => {
  await text('View entry').click();
  await waitForText('Edit');
  assert.equal(await page.getByPlaceholder('A title for today (optional)').inputValue(), 'Istanbul day');
  await text('Done').click();
});

console.log('delete, undo, trash, purge');
await step('delete → Undo restores; Alert is shown for confirmation', async () => {
  await label('tab-home').click();
  await page.locator('[role="button"]').filter({ hasText: 'Istanbul day' }).first().click().catch(() => {});
  await text('Istanbul day').first().click();
  await waitForText('Edit');
  await text('Delete', { exact: true }).last().click();
  const alert = await page.evaluate(() => window.__alerts[window.__alerts.length - 1]);
  assert.equal(alert.title, 'Delete');
  await page.evaluate(() => window.__alerts[window.__alerts.length - 1].buttons.find((b) => b.style === 'destructive').onPress());
  await waitFor(() => one("SELECT deleted_at FROM entries WHERE title='Istanbul day'").deleted_at);
  await waitForText('Entry deleted');
  await text('Undo').click();
  await waitFor(() => one("SELECT deleted_at FROM entries WHERE title='Istanbul day'").deleted_at === null);
});
await step('Trash screen lists a deleted entry; restore works; purge removes files', async () => {
  // delete again via the editor
  await text('Istanbul day').first().click();
  await waitForText('Edit');
  await text('Delete', { exact: true }).last().click();
  await page.evaluate(() => window.__alerts[window.__alerts.length - 1].buttons.find((b) => b.style === 'destructive').onPress());
  await waitFor(() => one("SELECT deleted_at FROM entries WHERE title='Istanbul day'").deleted_at);
  await label('tab-settings').click();
  await waitForText('1 in trash');
  await text('Trash').click();
  await waitForText('Istanbul day');
  assert.ok((await bodyText()).includes('Walked by the water'));
  // photos are kept while in trash
  assert.equal(q('SELECT * FROM attachments').length, 1);
  const att = one('SELECT * FROM attachments');

  await text('Delete forever').click();
  await page.evaluate(() => window.__alerts[window.__alerts.length - 1].buttons.find((b) => b.style === 'destructive').onPress());
  await waitFor(() => !one('SELECT * FROM entries'));
  assert.equal(q('SELECT * FROM attachments').length, 0);
  assert.equal(q('SELECT * FROM locations').length, 0);
  assert.equal(q('SELECT * FROM entry_emotions').length, 0);
  const f = await files();
  assert.ok(!f.includes('file:///docs/attachments/' + att.file_name), 'photo file deleted');
  assert.ok(!f.includes('file:///docs/attachments/' + att.thumb_name), 'thumb file deleted');
  await waitForText('Trash is empty');
});

console.log('tags manager, back button, settings persistence');
await step('tag manager: rename and merge, delete keeps entries', async () => {
  // two entries with tags
  raw.exec(`INSERT INTO entries (uuid,title,body,journal_date,favorite,pinned,created_at,updated_at) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1','one','x','2026-10-01',0,0,'t','t'),('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2','two','y','2026-10-02',0,0,'t','t');
    INSERT INTO tags (name,name_key,created_at,updated_at) VALUES ('Work','work','t','t'),('Jobs','jobs','t','t');
    INSERT INTO entry_tags SELECT e.id, t.id FROM entries e, tags t WHERE (e.title='one' AND t.name='Work') OR (e.title='two' AND t.name='Jobs');`);
  await page.evaluate(() => window.__pressBack()); // sub-screen -> settings
  await page.evaluate(() => window.__pressBack()); // settings closed
  await label('tab-settings').click();
  await text('Manage tags').click();
  await waitForText('#Work');
  await label('Rename: Jobs').click();
  const input = page.getByLabel('Rename tag').last();
  await input.fill('work');
  await text('Rename', { exact: true }).last().click();
  await waitFor(() => q("SELECT * FROM tags WHERE name_key IN ('work','jobs')").length === 1);
  assert.equal(one('SELECT COUNT(*) AS n FROM entry_tags').n, 2);
  assert.equal(q('SELECT * FROM entries').length, 2);
  await label('Delete tag: work').click();
  await page.evaluate(() => window.__alerts[window.__alerts.length - 1].buttons.find((b) => b.style === 'destructive').onPress());
  await waitFor(() => q("SELECT * FROM tags WHERE name_key='work'").length === 0);
  assert.equal(q('SELECT * FROM entries').length, 2);
});
await step('Android Back: sub-screen → settings → previous tab → Home → exit', async () => {
  assert.equal(await page.evaluate(() => window.__pressBack()), true); // tags -> settings
  await waitForText('Language');
  assert.equal(await page.evaluate(() => window.__pressBack()), true); // settings -> home tab shown
  await label('tab-calendar').click();
  await waitForText('Selected date');
  assert.equal(await page.evaluate(() => window.__pressBack()), true); // calendar -> home
  await waitForText('Recent entries');
  assert.equal(await page.evaluate(() => window.__pressBack()), false); // lets the OS exit
});
await step('settings persist to the database and Persian switches layout/labels', async () => {
  await label('tab-settings').click();
  await text('فارسی').click();
  await waitFor(() => (one("SELECT value FROM app_settings WHERE key='language'") || {}).value === '"fa"');
  await waitForText('تنظیمات');
  await text('Dark').click().catch(() => {});
  assert.deepEqual(await errors(), []);
});

await browser.close();
console.log(`\n[browser] ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failed:', failures.join('; ')); process.exit(1); }
