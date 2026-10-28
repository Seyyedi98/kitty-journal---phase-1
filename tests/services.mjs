// Tests for DB v4, photo pipeline and backup/restore.  Run: npx tsx tests/services.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'node:buffer';
import { load, loadJSZip, makeDb, failingDb, makeFs, makeManipulate, fakeJpeg, harness } from './helpers.mjs';

const { runMigrations, LATEST_VERSION } = await load('../src/db/migrations.js');
const repo = await load('../src/db/repository.js');
const photos = await load('../src/services/photos.js');
const backup = await load('../src/services/backup.js');
const JSZip = loadJSZip();

const h = harness('services');
const { test, section } = h;

const fresh = async () => { const db = makeDb(); await runMigrations(db); return db; };
const deps = (fs, extra = {}) => ({ fs, JSZip, manipulate: makeManipulate(fs), ...extra });
const asset = (fs, name, { w = 1200, h: ht = 900, bytes = 4000, seed = 1, mime = 'image/jpeg', size } = {}) => {
  const uri = `mem://picker/${name}`;
  const buf = fakeJpeg(seed, bytes);
  fs.put(uri, buf);
  return { uri, width: w, height: ht, mimeType: mime, fileSize: size ?? buf.length, fileName: name };
};
const entry = (db, over = {}) => repo.saveEntry(db, { title: 't', body: 'b', journal_date: '2026-10-23', mood: null, tags: [], ...over });

section('migrations v4');
await test('v3 database upgrades: every old entry gets a unique uuid, data kept', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = makeDb(raw);
  // Simulate an install that stopped at v3.
  const m = await load('../src/db/migrations.js');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  for (let i = 0; i < 3; i++) { await db.execAsync(m.MIGRATIONS[i]); }
  await db.execAsync('PRAGMA user_version = 3');
  for (let i = 0; i < 5; i++) {
    await db.runAsync(`INSERT INTO entries (title, body, journal_date, mood, favorite, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, `e${i}`, 'x', '2026-10-01', null, 0, 't', 't');
  }
  await runMigrations(db);
  const rows = await db.getAllAsync('SELECT uuid, title FROM entries');
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((r) => r.uuid)).size, 5);
  assert.ok(rows.every((r) => /^[a-f0-9]{32}$/.test(r.uuid)));
  assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, LATEST_VERSION);
});
await test('new entries get a uuid automatically', async () => {
  const db = await fresh();
  const id = await entry(db);
  assert.match((await repo.getEntry(db, id)).uuid, /^[a-f0-9]{32}$/);
});

section('emotions / locations / tags');
await test('emotions: unknown keys dropped, intensity validated, cleared with []', async () => {
  const db = await fresh();
  const id = await entry(db, { emotions: [{ key: 'calm', intensity: 3 }, { key: 'nope', intensity: 2 }, { key: 'calm', intensity: 1 }, { key: 'sad', intensity: 9 }] });
  let e = await repo.getEntry(db, id);
  assert.deepEqual(e.emotions.sort((a, b) => a.key.localeCompare(b.key)), [{ key: 'calm', intensity: 3 }, { key: 'sad', intensity: null }]);
  await repo.saveEntry(db, { id, title: 't', body: 'b', journal_date: '2026-10-23', mood: null, emotions: [] });
  assert.equal((await repo.getEntry(db, id)).emotions.length, 0);
});
await test('omitting emotions/location on save leaves them untouched', async () => {
  const db = await fresh();
  const id = await entry(db, { emotions: [{ key: 'calm', intensity: 2 }], location: { latitude: 41, longitude: 29, name: 'Home' } });
  await repo.saveEntry(db, { id, title: 'changed', body: 'b', journal_date: '2026-10-23', mood: null });
  const e = await repo.getEntry(db, id);
  assert.equal(e.emotions.length, 1);
  assert.equal(e.location.name, 'Home');
});
await test('locations: validation, name-only allowed, clear, trashed hidden from list', async () => {
  const db = await fresh();
  assert.equal(repo.cleanLocation({ latitude: 999, longitude: 0, name: '' }), null);
  assert.deepEqual(repo.cleanLocation({ latitude: 999, longitude: 0, name: 'Cafe' }), { latitude: null, longitude: null, name: 'Cafe', address: '' });
  const a = await entry(db, { location: { latitude: 35.7, longitude: 51.4, name: 'Tehran' } });
  const b = await entry(db, { location: { name: 'Somewhere' } });
  assert.equal((await repo.listLocations(db)).length, 2);
  await repo.softDeleteEntry(db, a);
  assert.equal((await repo.listLocations(db)).length, 1);
  await repo.saveEntry(db, { id: b, title: 't', body: 'b', journal_date: '2026-10-23', mood: null, location: null });
  assert.equal((await repo.listLocations(db)).length, 0);
});
await test('renameTag: plain rename and merge into an existing tag', async () => {
  const db = await fresh();
  const a = await entry(db, { tags: ['work', 'family'] });
  const b = await entry(db, { tags: ['Job'] });
  const tags = await repo.listTags(db);
  const work = tags.find((t) => t.name === 'work');
  const job = tags.find((t) => t.name === 'Job');
  assert.deepEqual(await repo.renameTag(db, work.id, 'office'), { merged: false, id: work.id });
  const merged = await repo.renameTag(db, job.id, ' OFFICE ');
  assert.equal(merged.merged, true);
  const after = await repo.listTags(db);
  assert.equal(after.filter((t) => t.name.toLowerCase() === 'office').length, 1);
  assert.equal(after.find((t) => t.name.toLowerCase() === 'office').count, 2);
  assert.ok((await repo.getEntry(db, a)).tags.some((t) => t.name.toLowerCase() === 'office'));
  assert.equal((await repo.getEntry(db, b)).tags.length, 1);
  await assert.rejects(() => repo.renameTag(db, after[0].id, '   '));
});

section('photos');
await test('exif date parsing', () => {
  assert.equal(photos.parseExifDate('2026:10:23 14:05:09'), '2026-10-23T14:05:09');
  assert.equal(photos.parseExifDate('garbage'), null);
  assert.equal(photos.parseExifDate('2026:13:40 00:00:00'), null);
  assert.equal(photos.parseExifDate(undefined), null);
});
await test('processing plan: small jpeg is copied as-is; big/png are re-encoded', () => {
  const p = photos.planImageProcessing;
  assert.deepEqual(p({ width: 1600, height: 1200, mimeType: 'image/jpeg', fileSize: 500000 }), { recompress: false, resize: null });
  assert.deepEqual(p({ width: 4000, height: 3000, mimeType: 'image/jpeg', fileSize: 500000 }), { recompress: true, resize: { width: 2048 } });
  assert.deepEqual(p({ width: 3000, height: 4000, mimeType: 'image/jpeg', fileSize: 500000 }), { recompress: true, resize: { height: 2048 } });
  assert.deepEqual(p({ width: 800, height: 600, mimeType: 'image/png', fileSize: 1000 }), { recompress: true, resize: null });
  assert.deepEqual(p({ width: 1600, height: 1200, mimeType: 'image/jpeg', fileSize: 9 * 1024 * 1024 }), { recompress: true, resize: null });
  assert.equal(p({ mimeType: 'image/jpeg' }).recompress, true); // unknown size -> safe path
});
await test('import: files + row exist, original untouched, thumbnail from stored copy', async () => {
  const db = await fresh(); const fs = makeFs();
  const id = await entry(db);
  const a = asset(fs, 'a.jpg', { w: 1200, h: 900 });
  const d = deps(fs);
  const row = await photos.importPhoto(db, d, id, a);
  assert.ok(await fs.exists(fs.attachmentsDir + row.file_name));
  assert.ok(await fs.exists(fs.attachmentsDir + row.thumb_name));
  assert.deepEqual(fs.files.get(fs.attachmentsDir + row.file_name), fs.files.get(a.uri), 'no re-compression of a modest jpeg');
  assert.equal(d.manipulate.calls.length, 1, 'only the thumbnail was generated');
  assert.equal(d.manipulate.calls[0].uri, fs.attachmentsDir + row.file_name);
  assert.equal((await repo.listEntryAttachments(db, id)).length, 1);
  assert.equal(row.original_name, 'a.jpg');
  assert.ok(fs.names('mem://cache/').length === 0, 'temp files cleaned');
});
await test('import: large image is resized once, small image gets no thumbnail', async () => {
  const db = await fresh(); const fs = makeFs();
  const id = await entry(db);
  const d = deps(fs);
  const big = await photos.importPhoto(db, d, id, asset(fs, 'big.jpg', { w: 4000, h: 3000, bytes: 9000 }));
  assert.equal(d.manipulate.calls[0].opts.resize.width, 2048);
  assert.ok(big.width <= 2048);
  const tiny = await photos.importPhoto(db, d, id, asset(fs, 'tiny.jpg', { w: 300, h: 200 }));
  assert.equal(tiny.thumb_name, null);
});
await test('failure at copy / thumbnail / db insert leaves no files and no row', async () => {
  for (const scenario of ['copy', 'thumb', 'db']) {
    const db = await fresh(); const fs = makeFs();
    const id = await entry(db);
    const a = asset(fs, 'x.jpg');
    let d = deps(fs);
    let useId = id;
    if (scenario === 'copy') fs.failCopy = () => true;
    if (scenario === 'thumb') d = deps(fs, { manipulate: makeManipulate(fs, { failOn: () => true }) });
    if (scenario === 'db') useId = 9999; // foreign key violation on insert
    await assert.rejects(() => photos.importPhoto(db, d, useId, a), (e) => e.code === 'import-failed');
    assert.deepEqual(fs.names(fs.attachmentsDir), [], scenario);
    assert.equal((await db.getAllAsync('SELECT * FROM attachments')).length, 0, scenario);
  }
});
await test('no-space is reported and nothing is written', async () => {
  const db = await fresh(); const fs = makeFs({ free: 1024 });
  const id = await entry(db);
  await assert.rejects(() => photos.importPhoto(db, deps(fs), id, asset(fs, 'x.jpg')), (e) => e.code === 'no-space');
  assert.deepEqual(fs.names(fs.attachmentsDir), []);
});
await test('importPhotos: one failure does not abort the others', async () => {
  const db = await fresh(); const fs = makeFs();
  const id = await entry(db);
  const good1 = asset(fs, 'g1.jpg', { seed: 1 });
  const bad = { ...asset(fs, 'bad.jpg', { seed: 2 }), uri: 'mem://picker/does-not-exist.jpg' };
  const good2 = asset(fs, 'g2.jpg', { seed: 3 });
  const r = await photos.importPhotos(db, deps(fs), id, [good1, bad, good2]);
  assert.equal(r.added.length, 2);
  assert.equal(r.failed.length, 1);
  assert.equal((await repo.listEntryAttachments(db, id)).length, 2);
});
await test('orphan cleanup: removes only unreferenced own-pattern files; never while an import runs', async () => {
  const db = await fresh(); const fs = makeFs();
  const id = await entry(db);
  const row = await photos.importPhoto(db, deps(fs), id, asset(fs, 'k.jpg'));
  const orphan = 'a'.repeat(32) + '.jpg';
  fs.put(fs.attachmentsDir + orphan, fakeJpeg(7));
  fs.put(fs.attachmentsDir + 'notes.txt', Buffer.from('mine'));
  const release = photos.beginFileOp();
  assert.deepEqual(await photos.cleanOrphanFiles(db, fs), { skipped: true, removed: 0 });
  assert.ok(await fs.exists(fs.attachmentsDir + orphan));
  release();
  assert.deepEqual(await photos.cleanOrphanFiles(db, fs), { skipped: false, removed: 1 });
  assert.ok(!(await fs.exists(fs.attachmentsDir + orphan)));
  assert.ok(await fs.exists(fs.attachmentsDir + row.file_name));
  assert.ok(await fs.exists(fs.attachmentsDir + 'notes.txt'), 'foreign files are never touched');
});
await test('trash keeps photos; purge deletes rows and files; emptyTrash too', async () => {
  const db = await fresh(); const fs = makeFs();
  const a = await entry(db); const b = await entry(db);
  const ra = await photos.importPhoto(db, deps(fs), a, asset(fs, 'a.jpg', { seed: 1 }));
  const rb = await photos.importPhoto(db, deps(fs), b, asset(fs, 'b.jpg', { seed: 2 }));
  await repo.softDeleteEntry(db, a);
  assert.ok(await fs.exists(fs.attachmentsDir + ra.file_name), 'soft delete keeps files');
  assert.equal((await repo.listAllAttachments(db)).length, 1, 'trashed photos hidden from Memories');
  await photos.purgeEntryAndFiles(db, fs, a);
  assert.ok(!(await fs.exists(fs.attachmentsDir + ra.file_name)));
  assert.ok(!(await fs.exists(fs.attachmentsDir + ra.thumb_name)));
  assert.ok(await fs.exists(fs.attachmentsDir + rb.file_name), 'other entries untouched');
  await repo.softDeleteEntry(db, b);
  await photos.emptyTrashAndFiles(db, fs);
  assert.deepEqual(fs.names(fs.attachmentsDir), []);
  assert.equal((await db.getAllAsync('SELECT * FROM attachments')).length, 0);
});
await test('missing-file detection and removal of broken references', async () => {
  const db = await fresh(); const fs = makeFs();
  const id = await entry(db);
  const r1 = await photos.importPhoto(db, deps(fs), id, asset(fs, 'a.jpg', { seed: 1 }));
  await photos.importPhoto(db, deps(fs), id, asset(fs, 'b.jpg', { seed: 2 }));
  await fs.remove(fs.attachmentsDir + r1.file_name);
  const check = await photos.checkAttachments(db, fs);
  assert.equal(check.total, 2);
  assert.equal(check.missing.length, 1);
  await photos.removeBrokenReferences(db, fs, check.missing);
  assert.equal((await repo.listEntryAttachments(db, id)).length, 1);
});

section('backup / restore');
async function seed(db, fs) {
  const a = await entry(db, { title: 'Salam سلام', body: 'متن فارسی and English', journal_date: '2026-10-01', mood: 'good', tags: ['Work', 'خانواده'], emotions: [{ key: 'calm', intensity: 4 }], location: { latitude: 35.69, longitude: 51.39, name: 'Tehran', address: 'Valiasr' } });
  const b = await entry(db, { title: 'İstanbul', body: 'şeker', journal_date: '2026-10-02', mood: null });
  await repo.setFavorite(db, a, true); await repo.setPinned(db, b, true);
  await photos.importPhoto(db, deps(fs), a, asset(fs, 'p1.jpg', { seed: 11, w: 4000, h: 3000, bytes: 6000 }));
  await photos.importPhoto(db, deps(fs), a, asset(fs, 'p2.jpg', { seed: 12 }));
  await repo.setDailyMood(db, '2026-10-01', 'great');
  await repo.setDailyMood(db, '2026-10-05', 'low');
  await repo.saveSetting(db, 'language', 'fa');
  await repo.saveSetting(db, 'lockEnabled', true); // must NOT be exported
  const t = await entry(db, { title: 'trashed', journal_date: '2026-10-03' });
  await repo.softDeleteEntry(db, t);
  return { a, b, t };
}
const snapshot = async (db) => {
  const d = await backup.collectData(db);
  return JSON.stringify({
    entries: d.entries.map((e) => ({ ...e, attachments: e.attachments.map(({ _file_name, _thumb_name, ...r }) => r) })).sort((x, y) => x.uuid.localeCompare(y.uuid)),
    dailyMoods: d.dailyMoods, settings: d.settings,
  });
};
const zipSource = async (fs, uri) => ({ name: 'b.zip', base64: await fs.readBase64(uri) });

await test('ZIP round trip into an empty device: everything identical, files byte-identical', async () => {
  const dbA = await fresh(); const fsA = makeFs();
  await seed(dbA, fsA);
  const made = await backup.createZipBackup(dbA, deps(fsA));
  assert.equal(made.missingFiles.length, 0);

  const dbB = await fresh(); const fsB = makeFs();
  const parsed = await backup.parseBackup(dbB, deps(fsB), await zipSource(fsA, made.uri));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.preview.counts.entries, 3);
  assert.equal(parsed.preview.counts.attachments, 2);
  assert.equal(parsed.preview.counts.tags, 2);
  assert.equal(parsed.preview.trashedEntries, 1);
  assert.equal(parsed.preview.newEntries, 3);
  assert.equal(parsed.preview.missingPhotos, 0);
  const s = await backup.applyRestore(dbB, deps(fsB), parsed, 'merge');
  assert.equal(s.entriesAdded, 3); assert.equal(s.photosAdded, 2); assert.equal(s.photosSkipped.length, 0);
  assert.equal(await snapshot(dbB), (await snapshot(dbA)).replace(/"settings":\{[^}]*\}/, '"settings":{}').replace(/"settings":\{\}$/, '"settings":{}'), 'data identical (settings only restored by replace)');
  const rowsA = await dbA.getAllAsync('SELECT uuid, file_name FROM attachments ORDER BY uuid');
  for (const r of rowsA) {
    assert.deepEqual(fsB.files.get(fsB.attachmentsDir + r.file_name), fsA.files.get(fsA.attachmentsDir + r.file_name));
  }
  const exported = JSON.parse(await backup.exportJson(dbA));
  assert.equal(exported.data.settings.lockEnabled, undefined, 'lock settings never exported');
});
await test('merge never overwrites and is idempotent', async () => {
  const db = await fresh(); const fs = makeFs();
  const ids = await seed(db, fs);
  const made = await backup.createZipBackup(db, deps(fs));
  await repo.saveEntry(db, { id: ids.a, title: 'edited later', body: 'new text', journal_date: '2026-10-01', mood: 'low' });
  await repo.setDailyMood(db, '2026-10-05', 'great');
  const before = await snapshot(db);
  const parsed = await backup.parseBackup(db, deps(fs), await zipSource(fs, made.uri));
  assert.equal(parsed.preview.duplicatesDifferent, 1);
  assert.equal(parsed.preview.duplicatesIdentical, 2);
  assert.equal(parsed.preview.moodConflicts, 1);
  const s = await backup.applyRestore(db, deps(fs), parsed, 'merge');
  assert.equal(s.entriesAdded, 0); assert.equal(s.duplicatesKept, 3); assert.equal(s.conflictsKeptLocal, 1); assert.equal(s.moodConflictsKeptLocal, 1);
  assert.equal(await snapshot(db), before, 'local data untouched');
});
await test('merge brings in only what is new', async () => {
  const dbA = await fresh(); const fsA = makeFs();
  await seed(dbA, fsA);
  const made = await backup.createZipBackup(dbA, deps(fsA));
  const dbB = await fresh(); const fsB = makeFs();
  const mine = await entry(dbB, { title: 'only on B', journal_date: '2026-09-09' });
  const parsed = await backup.parseBackup(dbB, deps(fsB), await zipSource(fsA, made.uri));
  await backup.applyRestore(dbB, deps(fsB), parsed, 'merge');
  const all = await repo.listEntries(dbB);
  assert.equal(all.length, 3, '2 live from A + 1 mine (trashed one is hidden)');
  assert.ok(all.some((e) => e.id === mine));
});
await test('replace: swaps data, writes a safety backup, removes stale files, applies settings', async () => {
  const dbA = await fresh(); const fsA = makeFs();
  await seed(dbA, fsA);
  const made = await backup.createZipBackup(dbA, deps(fsA));
  const dbB = await fresh(); const fsB = makeFs();
  const mine = await entry(dbB, { title: 'will be replaced', tags: ['old'] });
  const oldPhoto = await photos.importPhoto(dbB, deps(fsB), mine, asset(fsB, 'old.jpg', { seed: 99 }));
  const parsed = await backup.parseBackup(dbB, deps(fsB), await zipSource(fsA, made.uri));
  assert.equal(parsed.preview.local.entries, 1);
  const s = await backup.applyRestore(dbB, deps(fsB), parsed, 'replace');
  assert.ok(s.safetyBackup && await fsB.exists(s.safetyBackup.uri));
  assert.equal((await repo.listEntries(dbB)).some((e) => e.title === 'will be replaced'), false);
  assert.equal((await repo.listTags(dbB)).some((t) => t.name === 'old'), false);
  assert.ok(!(await fsB.exists(fsB.attachmentsDir + oldPhoto.file_name)), 'stale file removed after commit');
  assert.equal((await repo.loadSettings(dbB)).language, 'fa');
  // the safety backup can bring the old data back
  const back = await backup.parseBackup(dbB, deps(fsB), await zipSource(fsB, s.safetyBackup.uri));
  assert.equal(back.ok, true);
  assert.equal(back.data.entries.some((e) => e.title === 'will be replaced'), true);
});
await test('JSON export: structured only, says so, round-trips, photos reported as not included', async () => {
  const dbA = await fresh(); const fsA = makeFs();
  await seed(dbA, fsA);
  const text = await backup.exportJson(dbA);
  assert.equal(JSON.parse(text).includesAttachmentFiles, false);
  const dbB = await fresh(); const fsB = makeFs();
  const parsed = await backup.parseBackup(dbB, deps(fsB), { name: 'x.json', text });
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.ok(parsed.warnings.some((w) => w.code === 'json-no-photos'));
  const s = await backup.applyRestore(dbB, deps(fsB), parsed, 'merge');
  assert.equal(s.entriesAdded, 3); assert.equal(s.photosAdded, 0); assert.equal(s.photosSkipped.length, 2);
  assert.equal((await repo.listAllAttachments(dbB)).length, 0);
});
await test('rejects bad files with a precise error and changes nothing', async () => {
  const db = await fresh(); const fs = makeFs();
  await seed(db, fs);
  const before = await snapshot(db);
  const good = JSON.parse(await backup.exportJson(db));
  const mk = (mut) => { const c = JSON.parse(JSON.stringify(good)); mut(c); return JSON.stringify(c); };
  const cases = [
    ['corrupt json', { text: '{ not json' }, 'corrupt-json'],
    ['wrong format', { text: JSON.stringify({ hello: 1 }) }, 'not-a-backup'],
    ['future version', { text: mk((c) => { c.formatVersion = 99; }) }, 'unsupported-version'],
    ['missing version', { text: mk((c) => { delete c.formatVersion; }) }, 'bad-structure'],
    ['duplicate entry id', { text: mk((c) => { c.data.entries[1].uuid = c.data.entries[0].uuid; }) }, 'duplicate-id'],
    ['bad entry date', { text: mk((c) => { c.data.entries[0].journal_date = '2026-02-31'; }) }, 'bad-date'],
    ['bad id', { text: mk((c) => { c.data.entries[0].uuid = '../../etc'; }) }, 'bad-id'],
    ['bad timestamp', { text: mk((c) => { c.data.entries[0].updated_at = 'yesterday'; }) }, 'bad-timestamp'],
    ['entries not array', { text: mk((c) => { c.data.entries = 'x'; }) }, 'bad-structure'],
    ['bad daily mood', { text: mk((c) => { c.data.dailyMoods[0].mood = 'ecstatic'; }) }, 'bad-mood'],
    ['count mismatch (truncated)', { text: mk((c) => { c.data.entries.pop(); }) }, 'manifest-mismatch'],
    ['duplicate attachment id', { text: mk((c) => { const [x] = c.data.entries[0].attachments; c.data.entries[1].attachments = [{ ...x }]; }) }, 'duplicate-id'],
    ['not a zip (random base64)', { base64: Buffer.from('hello world').toString('base64') }, 'not-a-backup'],
    ['truncated zip', { base64: (await (async () => { const z = new JSZip(); z.file('a', 'x'.repeat(5000)); const b = await z.generateAsync({ type: 'base64' }); return b.slice(0, 40); })()) }, 'corrupt-zip'],
  ];
  for (const [name, src, code] of cases) {
    const r = await backup.parseBackup(db, deps(fs), src);
    assert.equal(r.ok, false, name);
    assert.ok(r.errors.some((e) => e.code === code), `${name}: expected ${code}, got ${JSON.stringify(r.errors)}`);
    await assert.rejects(() => backup.applyRestore(db, deps(fs), r, 'merge'), (e) => e.code === 'not-valid', name);
  }
  assert.equal(await snapshot(db), before);
});
await test('zip with unsafe path is rejected; unexpected files only warn', async () => {
  const db = await fresh(); const fs = makeFs();
  await seed(db, fs);
  const made = await backup.createZipBackup(db, deps(fs));
  const base = await JSZip.loadAsync(await fs.readBase64(made.uri), { base64: true });
  const evil = await JSZip.loadAsync(await base.generateAsync({ type: 'base64' }), { base64: true });
  evil.file('../evil.txt', 'x');
  const r1 = await backup.parseBackup(db, deps(fs), { base64: await evil.generateAsync({ type: 'base64' }) });
  // JSZip >= 3.8 already normalises '../' names on load; our own check is a second
  // line of defence. Either outcome is safe: rejected, or reduced to a warning.
  assert.ok(
    r1.errors.some((e) => e.code === 'unsafe-path') ||
      (r1.ok && r1.warnings.some((w) => w.code === 'unexpected-entry')),
    JSON.stringify([r1.errors, r1.warnings]),
  );
  if (r1.ok) {
    const fsX = makeFs();
    await backup.applyRestore(await fresh(), deps(fsX), r1, 'merge');
    assert.ok(fsX.names('mem://').every((n) => n.startsWith('docs/')), 'nothing written outside the app dirs');
  }
  const odd = await JSZip.loadAsync(await base.generateAsync({ type: 'base64' }), { base64: true });
  odd.file('notes/readme.txt', 'hi');
  const r2 = await backup.parseBackup(db, deps(fs), { base64: await odd.generateAsync({ type: 'base64' }) });
  assert.equal(r2.ok, true);
  assert.ok(r2.warnings.some((w) => w.code === 'unexpected-entry'));
});
await test('photos missing or damaged inside the zip are skipped and listed; entries still restored', async () => {
  const dbA = await fresh(); const fsA = makeFs();
  const ids = await seed(dbA, fsA);
  const made = await backup.createZipBackup(dbA, deps(fsA));
  const atts = await dbA.getAllAsync('SELECT uuid FROM attachments ORDER BY id');
  const z = await JSZip.loadAsync(await fsA.readBase64(made.uri), { base64: true });
  z.remove(`attachments/${atts[0].uuid}.jpg`);                                   // missing
  z.file(`attachments/${atts[1].uuid}.jpg`, Buffer.from('definitely not a jpeg')); // damaged
  const dbB = await fresh(); const fsB = makeFs();
  const parsed = await backup.parseBackup(dbB, deps(fsB), { base64: await z.generateAsync({ type: 'base64' }) });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.preview.missingPhotos, 1);
  assert.ok(parsed.warnings.some((w) => w.code === 'missing-photos'));
  const s = await backup.applyRestore(dbB, deps(fsB), parsed, 'merge');
  assert.equal(s.entriesAdded, 3);
  assert.equal(s.photosAdded, 0);
  assert.deepEqual(s.photosSkipped.map((p) => p.reason).sort(), ['corrupt', 'missing']);
  assert.deepEqual(fsB.names(fsB.attachmentsDir), [], 'no partial files left behind');
});
await test('a photo missing at backup time is reported at backup time, not hidden', async () => {
  const db = await fresh(); const fs = makeFs();
  await seed(db, fs);
  const row = await db.getFirstAsync('SELECT file_name FROM attachments ORDER BY id');
  await fs.remove(fs.attachmentsDir + row.file_name);
  const made = await backup.createZipBackup(db, deps(fs));
  assert.equal(made.missingFiles.length, 1);
});
await test('failure injection: file write fails mid-restore -> DB unchanged, staged files removed (merge)', async () => {
  const dbA = await fresh(); const fsA = makeFs();
  await seed(dbA, fsA);
  const made = await backup.createZipBackup(dbA, deps(fsA));
  const dbB = await fresh(); const fsB = makeFs();
  await entry(dbB, { title: 'mine' });
  const before = await snapshot(dbB);
  const parsed = await backup.parseBackup(dbB, deps(fsB), await zipSource(fsA, made.uri));
  fsB.writes = 0; fsB.failWrite = (uri, n) => n === 2;
  await assert.rejects(() => backup.applyRestore(dbB, deps(fsB), parsed, 'merge'), (e) => e.code === 'restore-failed');
  assert.equal(await snapshot(dbB), before);
  assert.deepEqual(fsB.names(fsB.attachmentsDir), []);
});
await test('failure injection: DB error inside the restore transaction rolls everything back (merge + replace)', async () => {
  for (const mode of ['merge', 'replace']) {
    const dbA = await fresh(); const fsA = makeFs();
    await seed(dbA, fsA);
    const made = await backup.createZipBackup(dbA, deps(fsA));
    const dbB = await fresh(); const fsB = makeFs();
    const mine = await entry(dbB, { title: 'mine', tags: ['keep'] });
    const keptPhoto = await photos.importPhoto(dbB, deps(fsB), mine, asset(fsB, 'keep.jpg', { seed: 5 }));
    const before = await snapshot(dbB);
    const filesBefore = fsB.names(fsB.attachmentsDir);
    const parsed = await backup.parseBackup(dbB, deps(fsB), await zipSource(fsA, made.uri));
    // Let the (replace-mode) safety backup succeed, then fail a later write.
    const bad = failingDb(dbB, mode === 'replace' ? 12 : 9);
    await assert.rejects(() => backup.applyRestore(bad, deps(fsB), parsed, mode), (e) => e.code === 'restore-failed', mode);
    assert.equal(await snapshot(dbB), before, mode + ': db unchanged');
    assert.ok(await fsB.exists(fsB.attachmentsDir + keptPhoto.file_name), mode + ': local photo intact');
    assert.deepEqual(fsB.names(fsB.attachmentsDir), filesBefore, mode + ': no staged files left');
  }
});
await test('replace aborts (nothing changed) if the safety backup cannot be written', async () => {
  const dbA = await fresh(); const fsA = makeFs();
  await seed(dbA, fsA);
  const made = await backup.createZipBackup(dbA, deps(fsA));
  const dbB = await fresh(); const fsB = makeFs();
  await entry(dbB, { title: 'mine' });
  const before = await snapshot(dbB);
  const parsed = await backup.parseBackup(dbB, deps(fsB), await zipSource(fsA, made.uri));
  fsB.writes = 0; fsB.failWrite = (uri) => uri.includes('/backups/');
  await assert.rejects(() => backup.applyRestore(dbB, deps(fsB), parsed, 'replace'), (e) => e.code === 'safety-backup-failed');
  assert.equal(await snapshot(dbB), before);
});
await test('insufficient storage is refused for backups', async () => {
  const db = await fresh(); const fs = makeFs();
  await seed(db, fs);
  fs.free = 100;
  await assert.rejects(() => backup.createZipBackup(db, deps(fs)), (e) => e.code === 'no-space');
});
await test('unknown mood/emotion values warn instead of corrupting data', async () => {
  const db = await fresh();
  const good = { format: backup.JSON_FORMAT, formatVersion: 1, data: { entries: [{ uuid: 'abcdef0123456789', journal_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', mood: 'weird', emotions: [{ key: 'unknown', intensity: 3 }], tags: [], attachments: [] }], dailyMoods: [] } };
  const r = await backup.parseBackup(db, deps(makeFs()), { text: JSON.stringify(good) });
  assert.equal(r.ok, true);
  assert.equal(r.data.entries[0].mood, null);
  assert.equal(r.data.entries[0].emotions.length, 0);
  assert.equal(r.warnings.length, 2);
});

h.done();
