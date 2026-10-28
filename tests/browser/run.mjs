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
    console.log('  FAIL', name, '\n      ', String(e.message).split('\n').slice(0, 40).join(' | '));
    if (process.env.KJ_DEBUG) {
      console.log('      page errors:', JSON.stringify((await errors().catch(() => [])).slice(0, 3)).slice(0, 600));
      console.log('      page text  :', JSON.stringify((await bodyText().catch(() => '')).slice(0, 400)));
    }
  }
}
page.on('console', (m) => { if (process.env.KJ_DEBUG && m.text().includes('backup failed')) console.log('      CONSOLE', m.text().slice(0, 500)); });

const editorFrame = async () => {
  await page.waitForSelector('[data-testid="editor-frame"]');
  const handle = await page.$('[data-testid="editor-frame"]');
  const fr = await handle.contentFrame();
  await fr.waitForSelector('#ed');
  return fr;
};
async function typeBody(txt) {
  const fr = await editorFrame();
  await fr.click('#ed');
  await page.keyboard.type(txt);
}
const bodyHtmlInEditor = async () => (await editorFrame()).evaluate(() => document.getElementById('ed').innerHTML);
const wait = (ms) => page.waitForTimeout(ms);
const text = (t, opts = {}) => page.getByText(t, { exact: true, ...opts });
const NO_MOOD = 'No mood check-ins yet';
const label = (l) => (l === 'tab-settings' ? page.locator('[aria-label="Settings"]').first() : l.startsWith('tab-') ? page.locator(`[data-testid="${l}"]`) : page.locator(`[aria-label="${l}"]`));
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


// Fake Leaflet (no internet in the sandbox): enough of the API for our page script.
const FAKE_LEAFLET = `(function(){
  function Map_(id){ this.el=document.getElementById(id); window.__mapCalls=[]; this.h={}; }
  Map_.prototype.setView=function(c,z){window.__mapCalls.push(['setView',c,z]);return this;};
  Map_.prototype.fitBounds=function(b,o){window.__mapCalls.push(['fitBounds',b.length]);return this;};
  Map_.prototype.on=function(){return this;};
  window.L={ map:function(id){return new Map_(id);}, tileLayer:function(u){window.__tile=u;return {addTo:function(){}};},
    divIcon:function(o){return o;},
    marker:function(ll,o){var m={addTo:function(map){var d=document.createElement('div');d.className='leaflet-marker-icon';d.innerHTML=o.icon.html;d.addEventListener('click',function(e){e.stopPropagation();m.cb&&m.cb();});map.el.appendChild(d);return m;},on:function(t,cb){m.cb=cb;return m;}};return m;} };
})();`;

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
  await typeBody('Walked by the water and took photos.');
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

await step('Memories map: photo marker, tap opens the entries of that place', async () => {
  await page.route('**/leaflet.js', (r) => r.fulfill({ contentType: 'application/javascript', body: FAKE_LEAFLET }));
  await page.route('**/leaflet.css', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  // the stand-in thumbnail is as big as the original; make it realistically small
  await page.evaluate(([n]) => { window.__files.set('file:///docs/attachments/' + n, 'AAAA'); }, [one('SELECT thumb_name FROM attachments').thumb_name]);
  await label('tab-memories').click();
  await text('Map').click();
  const frame = page.frameLocator('[data-testid="map-frame"]');
  await frame.locator('.leaflet-marker-icon').first().waitFor();
  assert.equal(await frame.locator('.leaflet-marker-icon').count(), 1);
  assert.equal(await frame.locator('.leaflet-marker-icon img').count(), 1, 'marker shows the entry photo');
  await waitForText('Tap a photo on the map');
  await frame.locator('.leaflet-marker-icon').first().click();
  await waitForText('1 entries here');
  assert.ok((await bodyText()).includes('Istanbul day'));
  await text('Istanbul day').last().click();
  await waitForText('Edit');
  assert.equal(await page.getByPlaceholder('A title for today (optional)').inputValue(), 'Istanbul day');
  await text('Done').click();
});

await step('naming places: Memories list, map panel and entry editor; no add button on Memories', async () => {
  raw.exec("INSERT INTO entries (uuid,title,body,journal_date,favorite,pinned,created_at,updated_at) VALUES ('cccccccccccccccccccccccccccccc01','unnamed trip','b','2026-10-20',0,0,'t','2026-10-20T00:00:00Z')");
  const eid = one("SELECT id FROM entries WHERE title='unnamed trip'").id;
  raw.exec(`INSERT INTO locations (uuid,entry_id,latitude,longitude,name,address,created_at) VALUES ('dddddddddddddddddddddddddddddd01',${eid},40.5,29.5,'','','t')`);
  await label('tab-home').click();
  await label('tab-memories').click();
  assert.equal(await label('New entry').count(), 0, 'no floating add button on Memories');
  await text('Places').click();
  await waitForText('Unnamed place');
  await page.locator('[aria-label="Name this place"]').first().click();
  await page.getByPlaceholder('Where were you? (optional)').fill('Bosphorus bridge');
  await text('Save name').click();
  await waitFor(() => one("SELECT name FROM locations WHERE entry_id=" + eid).name === 'Bosphorus bridge');
  await waitForText('Place name saved');
  assert.ok((await bodyText()).includes('Bosphorus bridge'));
  // map panel: rename the group again
  await text('Map').click();
  const frame = page.frameLocator('[data-testid="map-frame"]');
  await frame.locator('.leaflet-marker-icon').nth(1).waitFor();
  await frame.locator('.leaflet-marker-icon').nth(1).click();
  await waitForText('Bosphorus bridge');
  await page.locator('[aria-label="Edit name"]').first().click();
  await page.getByPlaceholder('Where were you? (optional)').fill('Bridge');
  await text('Save name').click();
  await waitFor(() => one("SELECT name FROM locations WHERE entry_id=" + eid).name === 'Bridge');
  // editor: a place saved without a name shows an obvious prompt
  await label('tab-home').click();
  await page.evaluate(() => { window.__location.place = {}; });
  await label('New entry').click();
  await page.getByPlaceholder('A title for today (optional)').fill('nameless spot');
  await text('Use current location').click();
  await waitForText('This place has no name yet');
  await page.getByPlaceholder('Where were you? (optional)').fill('Corner cafe');
  await waitFor(async () => !(await bodyText()).includes('This place has no name yet'));
  await waitFor(() => one("SELECT name FROM locations WHERE name='Corner cafe'"));
  await text('Done').click();
  await page.evaluate(() => { window.__location.place = { name: 'Galata Tower', street: 'Galata', city: 'Istanbul', region: 'Istanbul', country: 'Türkiye' }; });
  raw.exec("DELETE FROM entries WHERE title IN ('unnamed trip','nameless spot')");
});

await step('Backup (B1): ZIP + JSON export, share sheet, last-backup status', async () => {
  // some data to back up
  raw.exec("INSERT INTO entries (uuid,title,body,journal_date,favorite,pinned,created_at,updated_at) VALUES ('eeeeeeeeeeeeeeeeeeeeeeeeeeeeee01','backup me','text','2026-10-21',0,0,'t','t')");
  // the fake fs holds placeholder photo bytes; make them valid base64 like real files
  await page.evaluate(() => { for (const [k, v] of window.__files) { if (/\.(jpg|jpeg|png|webp)$/i.test(k)) window.__files.set(k, 'QUJDRA'.repeat(Math.ceil(v.length / 6)).slice(0, Math.floor(v.length / 4) * 4 || 4)); } });
  await label('tab-home').click();
  await label('tab-settings').click();
  await text('Backup & restore').click();
  await waitForText('No backup yet');
  await text('Full backup (.zip)', { exact: true }).last().click();
  await waitForText('Backup ready');
  const f = await files();
  const zipUri = f.find((u) => u.includes('/backups/') && u.endsWith('.zip'));
  assert.ok(zipUri, 'zip stored in the private backups folder');
  const head = await page.evaluate((u) => window.__files.get(u).slice(0, 4), zipUri);
  assert.equal(head, 'UEsD', 'file is a real ZIP');
  assert.ok((await bodyText()).match(/\d+ entries · \d+ photos/), 'counts shown');
  // nothing counts as backed up until the share sheet was opened
  assert.equal(await page.evaluate(() => window.__shared.length), 0);
  assert.equal((one("SELECT value FROM app_settings WHERE key='lastBackupAt'") || {}).value, undefined);
  // save to a user-picked folder (Downloads) via the system picker
  await page.evaluate(() => { window.__safDeny = true; });
  await text('Save to this phone').click();
  await wait(300);
  assert.equal((one("SELECT value FROM app_settings WHERE key='lastBackupAt'") || {}).value, undefined, 'cancelled picker is not a backup');
  await page.evaluate(() => { window.__safDeny = false; });
  await text('Save to this phone').click();
  await waitForText('Saved to the folder you chose');
  const saved = (await files()).find((u) => u.startsWith('content://downloads/'));
  assert.ok(saved && saved.endsWith('.zip'), 'zip written into the chosen folder');
  assert.equal((await page.evaluate((u) => window.__files.get(u), saved)).slice(0, 4), 'UEsD');
  await waitFor(() => one("SELECT value FROM app_settings WHERE key='lastBackupAt'"));
  await page.evaluate(() => { for (const k of [...window.__files.keys()]) if (k.startsWith('content://')) window.__files.delete(k); });
  raw.exec("DELETE FROM app_settings WHERE key='lastBackupAt'");
  await text('Share / save a copy').click();
  await waitFor(async () => (await page.evaluate(() => window.__shared.length)) === 1);
  await waitFor(() => one("SELECT value FROM app_settings WHERE key='lastBackupAt'"));
  await waitForText('Last backup saved');
  // JSON export: text only, valid, no photo files
  await text('Text export (.json)', { exact: true }).last().click();
  await waitForText('text only');
  const jsonUri = (await files()).find((u) => u.includes('/backups/') && u.endsWith('.json'));
  const parsed = JSON.parse(await page.evaluate((u) => window.__files.get(u), jsonUri));
  assert.equal(parsed.includesAttachmentFiles, false);
  assert.ok(parsed.data.entries.some((e) => e.title === 'backup me'));
  // sharing unavailable: a clear message, and no false "backed up"
  await page.evaluate(() => { window.__shareAvailable = false; });
  const before = one("SELECT value FROM app_settings WHERE key='lastBackupAt'").value;
  await page.waitForTimeout(1100);
  await text('Share / save a copy').click();
  await waitForText('Sharing is not available');
  assert.equal(one("SELECT value FROM app_settings WHERE key='lastBackupAt'").value, before);
  await page.evaluate(() => { window.__shareAvailable = true; });
  raw.exec("DELETE FROM entries WHERE title='backup me'");
  assert.deepEqual(await errors(), []);
  await page.evaluate(() => window.__pressBack()); await wait(250); // backup -> settings
  await page.evaluate(() => window.__pressBack()); await wait(250); // settings closed
  await waitForText('Recent entries');
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

console.log('rich editor');
await step('rich editor: bold/italic/heading/list, mixed RTL+LTR paragraphs, saved as sanitised HTML, reopen restores', async () => {
  raw.exec("INSERT INTO entries (uuid,title,body,journal_date,favorite,pinned,created_at,updated_at) VALUES ('eeeeeeeeeeeeeeeeeeeeeeeeeeeeee77','legacy','line one\nline <two> & three','2026-10-20',0,0,'t','t')");
  await label('tab-home').click();
  await waitForText('Recent entries');
  await label('New entry').click();
  await page.getByPlaceholder('A title for today (optional)').fill('rich test');
  const fr = await editorFrame();
  await fr.click('#ed');
  await page.keyboard.type('Plain then bold');
  // select the last word "bold" and make it bold through the toolbar
  await page.keyboard.down('Shift');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.locator('[data-testid="fmt-bold"]').click();
  await wait(250);
  assert.match(await bodyHtmlInEditor(), /<(strong|b)>bold<\/(strong|b)>/);
  assert.equal(await page.locator('[data-testid="fmt-bold"]').getAttribute('aria-selected') ?? 'x', 'true');
  // next paragraph: Persian, then a heading and a list
  await fr.click('#ed');
  await page.keyboard.press('Control+End');
  await page.locator('[data-testid="fmt-bold"]').click(); // typing continues in the format; toggle it off
  await page.keyboard.press('Enter');
  await page.keyboard.type('سلام دنیا');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Heading text');
  await page.locator('[data-testid="fmt-h1"]').click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('item one');
  await page.locator('[data-testid="fmt-ul"]').click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('item two');
  await wait(1500);
  const row = one("SELECT * FROM entries WHERE title='rich test'");
  assert.ok(row, 'entry saved');
  assert.equal(row.content_format_version, 2);
  assert.match(row.body_html, /<strong>bold<\/strong>/);
  assert.match(row.body_html, /<h1[^>]*>Heading text<\/h1>/);
  assert.match(row.body_html, /<ul><li>item one<\/li><li>item two<\/li><\/ul>/);
  assert.ok(row.body_html.includes('سلام دنیا'));
  assert.equal(row.body, 'Plain then bold\nسلام دنیا\nHeading text\n• item one\n• item two');
  assert.ok(!/<script|onerror|style=/.test(row.body_html));
  // every paragraph lays out in its own direction: Persian hugs the right edge, English the left (LTR app)
  const geo = await fr.evaluate(() => {
    const ed = document.getElementById('ed'); const box = ed.getBoundingClientRect();
    const rectOf = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
    const [en, fa] = [ed.children[0], ed.children[1]];
    return { boxL: box.left, boxR: box.right, enL: rectOf(en).left, faR: rectOf(fa).right };
  });
  assert.ok(Math.abs(geo.enL - geo.boxL) < 3, 'English starts at the left: ' + JSON.stringify(geo));
  assert.ok(Math.abs(geo.faR - geo.boxR) < 3, 'Persian starts at the right: ' + JSON.stringify(geo));
  // undo works through the toolbar
  await page.locator('[data-testid="fmt-undo"]').click();
  await wait(300);
  await text('Done').click();
  await wait(400);
  // reopen: formatting is restored
  await waitForText('rich test');
  await text('rich test').first().click();
  const html2 = await bodyHtmlInEditor();
  assert.ok(html2.includes('<strong>bold</strong>') && html2.includes('<h1'), html2);
  await text('Done').click();
  await wait(300);
  raw.exec("DELETE FROM entries WHERE title='rich test'");
  assert.deepEqual(await errors(), []);
});
await step('rich editor: lists toggle off, switch type without nesting, Backspace/Enter leave the list; direction; colour; undo is grouped', async () => {
  await label('tab-home').click();
  await label('New entry').click();
  const fr = await editorFrame();
  const html = () => fr.evaluate(() => document.getElementById('ed').innerHTML);
  await fr.click('#ed');
  await page.keyboard.type('alpha');
  await page.locator('[data-testid="fmt-ul"]').click();
  assert.equal(await html(), '<ul><li>alpha</li></ul>');
  await page.locator('[data-testid="fmt-ul"]').click(); // second tap removes it
  assert.equal(await html(), '<p>alpha</p>');
  await page.locator('[data-testid="fmt-ul"]').click();
  await page.locator('[data-testid="fmt-ol"]').click(); // switches type, never nests
  assert.equal(await html(), '<ol><li>alpha</li></ol>');
  await page.locator('[data-testid="fmt-ol"]').click();
  await page.locator('[data-testid="fmt-ul"]').click();
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('beta');
  await page.keyboard.press('Home'); await page.keyboard.press('Backspace'); // leaves the list
  assert.equal(await html(), '<ul><li>alpha</li></ul><p>beta</p>');
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
  await page.keyboard.type('x'); await page.keyboard.press('Backspace');
  await page.locator('[data-testid="fmt-ul"]').click(); await page.keyboard.press('Enter'); // Enter on an empty item leaves
  assert.ok(!(await html()).includes('<li><br>'), await html());

  // direction: forced RTL, then back to automatic
  await fr.evaluate(() => { document.getElementById('ed').innerHTML = '<p>hello</p>'; });
  await fr.click('#ed p');
  await page.locator('[data-testid="fmt-rtl"]').click();
  assert.equal(await html(), '<p dir="rtl">hello</p>');
  const right = await fr.evaluate(() => { const ed = document.getElementById('ed'); const r = document.createRange(); r.selectNodeContents(ed.firstChild); return Math.abs(r.getBoundingClientRect().right - ed.getBoundingClientRect().right) < 3; });
  assert.ok(right, 'forced RTL hugs the right edge even for Latin text');
  await page.locator('[data-testid="fmt-rtl"]').click();
  assert.equal(await html(), '<p>hello</p>');

  // colour
  await fr.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('#ed p')); getSelection().removeAllRanges(); getSelection().addRange(r); });
  await page.locator('[data-testid="fmt-color"]').click();
  await page.locator('[data-testid="color-d6453d"]').click();
  await wait(300);
  assert.match(await html(), /color: rgb\(214, 69, 61\)/);
  await wait(1200);
  assert.match(one("SELECT body_html FROM entries WHERE body LIKE '%hello%' ORDER BY id DESC LIMIT 1").body_html, /<span style="color:#d6453d">hello<\/span>/);

  // undo removes a whole burst of typing, not one letter
  await fr.evaluate(() => { document.getElementById('ed').innerHTML = '<p><br></p>'; });
  await fr.click('#ed');
  await page.keyboard.type('one two three');
  await wait(900);
  await page.keyboard.type(' four five six');
  await wait(900);
  await page.locator('[data-testid="fmt-undo"]').click();
  assert.equal(await fr.evaluate(() => document.getElementById('ed').innerText.trim()), 'one two three');
  await page.locator('[data-testid="fmt-redo"]').click();
  assert.equal(await fr.evaluate(() => document.getElementById('ed').innerText.trim()), 'one two three four five six');
  await text('Done').click();
  await wait(400);
  raw.exec("DELETE FROM entries WHERE body LIKE '%one two three%' OR body LIKE '%hello%' OR body LIKE '%alpha%'");
  assert.deepEqual(await errors(), []);
});
await step('rich editor: font and highlight from the toolbar are saved and survive reopening', async () => {
  await label('tab-home').click();
  await label('New entry').click();
  await page.getByPlaceholder('A title for today (optional)').fill('fonts test');
  const fr = await editorFrame();
  await fr.click('#ed');
  await page.keyboard.type('styled words');
  await page.keyboard.press('Control+A');
  await page.locator('[data-testid="fmt-font"]').click();
  await page.locator('[data-testid="font-naskh"]').click();
  await page.locator('[data-testid="fmt-highlight"]').click();
  await page.locator('[data-testid="highlight-0"]').click();
  await wait(1500);
  const row = one("SELECT * FROM entries WHERE title='fonts test'");
  assert.match(row.body_html, /font-family:'Noto Naskh Arabic',serif/);
  assert.match(row.body_html, /background-color:rgba\(255,213,79,0\.45\)/);
  assert.equal(row.body, 'styled words');
  // the toolbar reflects the formatting at the caret
  await fr.click('#ed');
  await wait(300);
  assert.equal(await page.locator('[data-testid="fmt-font"]').getAttribute('aria-selected'), 'true');
  // reset both
  await page.keyboard.press('Control+A');
  await page.locator('[data-testid="fmt-font"]').click();
  await page.locator('[data-testid="font-default"]').click();
  await page.locator('[data-testid="fmt-highlight"]').click();
  await page.locator('[data-testid="highlight-none"]').click();
  await wait(1500);
  const clean = one("SELECT body_html FROM entries WHERE title='fonts test'").body_html;
  assert.ok(!/font-family|background/.test(clean), clean);
  await text('Done').click();
  await wait(300);
  raw.exec("DELETE FROM entries WHERE title='fonts test'");
  assert.deepEqual(await errors(), []);
});
await step('rich editor: legacy plain-text entry opens as paragraphs and stays plain until edited', async () => {
  await label('tab-home').click();
  await waitForText('legacy');
  await text('legacy').first().click();
  const html = await bodyHtmlInEditor();
  assert.ok(html.includes('line one') && html.includes('&lt;two&gt; &amp; three'), html);
  await text('Done').click();
  await wait(500);
  const row = one("SELECT * FROM entries WHERE title='legacy'");
  assert.equal(row.content_format_version, 1, 'opening without editing does not convert');
  assert.equal(row.body_html, null);
  raw.exec("DELETE FROM entries WHERE title='legacy'");
});
console.log('tablet');
await step('tablet landscape: dock does not overlap content; one Settings button', async () => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await wait(600);
  await label('tab-home').click();
  await waitForText('Recent entries');
  const r = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="tab-home"]').closest('[style*="position: absolute"]').getBoundingClientRect();
    const h = [...document.querySelectorAll('span')].find((e) => e.textContent === 'Recent entries' || e.textContent === 'Kitty Journal' && false) ; if (!h) return { missing: document.body.innerText.slice(0, 200) }; const hr = h.getBoundingClientRect();
    const settings = document.querySelectorAll('[aria-label="Settings"]').length;
    return { dockRight: dock.right, textLeft: hr.left, settings, dockTop: dock.top };
  });
  await page.screenshot({ path: '/tmp/tablet.png' });
  await page.setViewportSize({ width: 412, height: 860 });
  await wait(400);
  assert.ok(r.textLeft >= r.dockRight, 'content starts right of the dock: ' + JSON.stringify(r));
  assert.equal(r.settings, 1, 'only one Settings control: ' + JSON.stringify(r));
});
console.log('tags manager, back button, settings persistence');
await step('tag manager: rename and merge, delete keeps entries', async () => {
  // two entries with tags
  raw.exec(`INSERT INTO entries (uuid,title,body,journal_date,favorite,pinned,created_at,updated_at) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1','one','x','2026-10-01',0,0,'t','t'),('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2','two','y','2026-10-02',0,0,'t','t');
    INSERT INTO tags (name,name_key,created_at,updated_at) VALUES ('Work','work','t','t'),('Jobs','jobs','t','t');
    INSERT INTO entry_tags SELECT e.id, t.id FROM entries e, tags t WHERE (e.title='one' AND t.name='Work') OR (e.title='two' AND t.name='Jobs');`);
  await page.evaluate(() => window.__pressBack()); // sub-screen -> settings
  await wait(250); // let React re-register the Back listener, as a human tap would
  await page.evaluate(() => window.__pressBack()); // settings closed
  await wait(250);
  await label('tab-settings').click();
  await waitForText('Manage tags');
  // the floating dock overlaps the last row in this un-scrolled harness; click the row directly
  await text('Manage tags').dispatchEvent('click');
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
  await wait(250);
  assert.equal(await page.evaluate(() => window.__pressBack()), true); // settings -> home tab shown
  await wait(250);
  await label('tab-calendar').click();
  await waitForText('Selected date');
  await wait(250);
  assert.equal(await page.evaluate(() => window.__pressBack()), true); // calendar -> home
  await waitForText('Recent entries');
  await wait(250);
  assert.equal(await page.evaluate(() => window.__pressBack()), false); // lets the OS exit
});
await step('Insights mood distribution counts a mood picked in the editor; calendar has no inline + button', async () => {
  await label('tab-home').click();
  await label('tab-insights').click();
  await waitForText('Mood distribution');
  assert.ok((await bodyText()).includes(NO_MOOD), 'precondition: no mood data yet');
  await label('tab-home').click();
  await label('New entry').click();
  await page.getByPlaceholder('A title for today (optional)').fill('mood test');
  await waitFor(() => one("SELECT * FROM entries WHERE title='mood test'"));
  await label('Good').last().click();
  await waitFor(() => one("SELECT mood FROM entries WHERE title='mood test'").mood === 'good');
  await text('Done').click();
  await label('tab-insights').click();
  await waitFor(async () => !(await bodyText()).includes(NO_MOOD));
  await label('tab-calendar').click();
  assert.equal(await page.locator('[aria-label="New entry"]').count(), 1, 'only the floating add button remains');
});
await step('settings persist to the database and Persian switches layout/labels', async () => {
  await label('tab-settings').click();
  await text('فارسی').click();
  await waitFor(() => (one("SELECT value FROM app_settings WHERE key='language'") || {}).value === '"fa"');
  await waitForText('تنظیمات');
  await text('Dark').click().catch(() => {});
  assert.deepEqual(await errors(), []);
});
await step('Persian RTL: dock order/pill and text alignment', async () => {
  await label('tab-home').click();
  await waitForText('Kitty Journal');
  const x = async (id) => (await page.locator(`[data-testid="${id}"]`).boundingBox()).x;
  assert.ok((await x('tab-home')) > (await x('tab-insights')), 'Home is the right-most tab in RTL');
  // filter chips start at the right edge in Persian
  const all = await page.locator('[aria-label="همه"]').first().boundingBox();
  const fav = await page.locator('[aria-label="علاقه‌مندی‌ها"]').first().boundingBox();
  assert.ok(all.x > fav.x, 'first chip is on the right');
  // ...and line up with the search box above them (its right edge is the content edge)
  const box = await page.locator('input').first().evaluate((el) => el.parentElement.getBoundingClientRect().right);
  assert.ok(Math.abs(all.x + all.width - box) < 6, 'first chip aligns with content edge: chip ' + (all.x + all.width) + ' vs ' + box);
  // active tab pill: icon is to the RIGHT of its label
  const pill = page.locator('[data-testid="tab-home"] > div').first();
  const iconBox = await pill.locator('i').boundingBox();
  const labelBox = await pill.locator('span').first().boundingBox();
  assert.ok(iconBox.x > labelBox.x, 'icon right of label');
  // body text defaults to right alignment in Persian
  const aligns = await page.evaluate(() => [...document.querySelectorAll('span')].filter((e) => /[\u0600-\u06FF]/.test(e.textContent)).map((e) => getComputedStyle(e).textAlign));
  assert.ok(aligns.length > 3 && aligns.every((a) => a === 'right' || a === 'center'), 'persian text aligned right: ' + [...new Set(aligns)]);
});

await browser.close();
console.log(`\n[browser] ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failed:', failures.join('; ')); process.exit(1); }
