// Rich text storage layer.  Run: npx tsx tests/richtext.mjs
import assert from 'node:assert/strict';
import { load, harness, makeDb } from './helpers.mjs';

const rt = await load('../src/utils/richText.js');
const mig = await load('../src/db/migrations.js');
const repo = await load('../src/db/repository.js');
const h = harness('richtext');
const { test, section } = h;

section('sanitizer');
await test('keeps supported formatting', () => {
  const html = '<p dir="rtl">سلام <strong>دنیا</strong> <em>x</em><u>u</u><s>s</s></p><h1>T</h1><ul><li>a</li><li>b</li></ul><ol><li>1</li></ol><blockquote>q</blockquote><hr>';
  assert.equal(rt.sanitizeHtml(html), html);
});
await test('is idempotent', () => {
  const dirty = '<div><b>x</b><span style="color:red">y</span></div>text<script>alert(1)</script><img src=x onerror=alert(1)>';
  const once = rt.sanitizeHtml(dirty);
  assert.equal(rt.sanitizeHtml(once), once);
});
await test('removes scripts, handlers, unknown tags and styles but keeps text', () => {
  const out = rt.sanitizeHtml('<p onclick="x()" style="color:red">hi <a href="javascript:x">link</a><script>bad()</script><style>p{}</style></p><img src=x onerror=y>');
  assert.equal(out, '<p>hi link</p>');
  assert.ok(!/script|onclick|onerror|href|style|img/.test(out));
});
await test('aliases: b/i/strike/div', () => {
  assert.equal(rt.sanitizeHtml('<div><b>a</b><i>b</i><strike>c</strike></div>'), '<p><strong>a</strong><em>b</em><s>c</s></p>');
});
await test('loose text and line breaks get wrapped in a paragraph', () => {
  assert.equal(rt.sanitizeHtml('one<br>two'), '<p>one<br>two</p>');
  assert.equal(rt.sanitizeHtml('a<p>b</p>c'), '<p>a</p><p>b</p><p>c</p>');
});
await test('text-align and dir are the only attributes kept, and only valid values', () => {
  assert.equal(rt.sanitizeHtml('<p style="text-align:center;color:red" dir="rtl">x</p>'), '<p dir="rtl" style="text-align:center">x</p>');
  assert.equal(rt.sanitizeHtml('<p dir="evil" style="text-align:url(x)">x</p>'), '<p>x</p>');
});
await test('escapes text so markup cannot be smuggled through entities', () => {
  assert.equal(rt.sanitizeHtml('<p>&lt;script&gt;x&lt;/script&gt; 1 &lt; 2 &amp; 3</p>'), '<p>&lt;script&gt;x&lt;/script&gt; 1 &lt; 2 &amp; 3</p>');
  assert.equal(rt.sanitizeHtml('<p>a < b</p>'), '<p>a &lt; b</p>');
});
await test('mis-nested and unclosed tags are repaired', () => {
  const out = rt.sanitizeHtml('<p><strong>a<em>b</strong>c</em></p><ul><li>x');
  assert.equal(out.match(/<p>/g).length, out.match(/<\/p>/g).length);
  assert.equal(out.match(/<li>/g).length, out.match(/<\/li>/g).length);
  assert.ok(out.endsWith('</li></ul>'));
});
await test('multilingual text survives untouched (fa, tr, ar, emoji)', () => {
  const t = '<p>سلام دنیا 😸 — Günaydın İstanbul ığüşöç — مرحبا</p>';
  assert.equal(rt.sanitizeHtml(t), t);
});

section('plain text derivation');
await test('paragraphs, breaks, lists and entities', () => {
  const p = rt.htmlToPlainText('<h1>Title</h1><p>one<br>two &amp; three</p><ul><li>a</li><li>b</li></ul><ol><li>x</li><li>y</li></ol>');
  assert.equal(p, 'Title\none\ntwo & three\n• a\n• b\n1. x\n2. y');
});
await test('plain -> html -> plain round-trips (incl. blank lines and < > &)', () => {
  for (const text of ['hello', 'a\n\nb', 'x < y & z > w', 'سلام\nدنیا\n\n\nend']) {
    const back = rt.htmlToPlainText(rt.plainTextToHtml(text));
    assert.equal(back, text.replace(/\n{3,}/g, '\n\n').trim());
  }
});
await test('empty content detection', () => {
  assert.equal(rt.isHtmlEmpty(''), true);
  assert.equal(rt.isHtmlEmpty('<p><br></p><p><br></p>'), true);
  assert.equal(rt.isHtmlEmpty('<p>x</p>'), false);
  assert.deepEqual(rt.htmlToRow('<p><br></p>'), { body: '', body_html: null, content_format_version: 1 });
  const row = rt.htmlToRow('<p><strong>hi</strong></p>');
  assert.equal(row.body, 'hi'); assert.equal(row.content_format_version, 2);
});
await test('legacy entries open as paragraphs; rich entries as stored', () => {
  assert.equal(rt.entryToEditorHtml({ body: 'a\nb', content_format_version: 1 }), '<p>a</p><p>b</p>');
  assert.equal(rt.entryToEditorHtml({ body: 'x', body_html: '<p><em>x</em></p>', content_format_version: 2 }), '<p><em>x</em></p>');
});

section('database');
const db = makeDb();
await mig.runMigrations(db);
await test('migration adds body_html; legacy rows are untouched', async () => {
  const cols = (await db.getAllAsync('PRAGMA table_info(entries)')).map((c) => c.name);
  assert.ok(cols.includes('body_html'));
});
await test('saveEntry stores html + derived plain text + format version', async () => {
  const id = await repo.saveEntry(db, { id: null, title: 't', bodyHtml: '<p><strong>Hello</strong> <script>x</script>world</p>', journal_date: '2026-10-01' });
  const e = await repo.getEntry(db, id);
  assert.equal(e.body_html, '<p><strong>Hello</strong> world</p>');
  assert.equal(e.body, 'Hello world');
  assert.equal(e.content_format_version, 2);
});
await test('clearing the text resets to plain/empty', async () => {
  const id = await repo.saveEntry(db, { id: null, title: 't', bodyHtml: '<p>x</p>', journal_date: '2026-10-01' });
  await repo.saveEntry(db, { id, title: 't', bodyHtml: '<p><br></p>', journal_date: '2026-10-01' });
  const e = await repo.getEntry(db, id);
  assert.equal(e.body, ''); assert.equal(e.body_html, null); assert.equal(e.content_format_version, 1);
});
await test('search finds text inside formatted entries by plain text, not markup', async () => {
  await repo.saveEntry(db, { id: null, title: 'r', bodyHtml: '<p>find <strong>needle</strong></p>', journal_date: '2026-10-02' });
  const hit = await db.getAllAsync("SELECT id FROM entries WHERE body LIKE '%find needle%'");
  assert.equal(hit.length, 1);
  assert.equal((await db.getAllAsync("SELECT id FROM entries WHERE body LIKE '%<strong>%'")).length, 0);
});

section('colour and direction');
await test('colour spans are kept as #hex; rgb() and font tags are normalised', () => {
  assert.equal(rt.sanitizeHtml('<p><span style="color: rgb(214, 69, 61);">a</span></p>'), '<p><span style="color:#d6453d">a</span></p>');
  assert.equal(rt.sanitizeHtml('<p><font color="#abc">a</font></p>'), '<p><span style="color:#aabbcc">a</span></p>');
  assert.equal(rt.sanitizeHtml('<p><span style="color:#3F3A33">a</span></p>', { dropColor: '#3f3a33' }), '<p>a</p>');
});
await test('invalid colours, backgrounds and other styles are dropped', () => {
  assert.equal(rt.sanitizeHtml('<p><span style="color:url(x)">a</span><span style="background-color:red;font-size:99px">b</span></p>'), '<p>ab</p>');
  assert.equal(rt.sanitizeHtml('<p><span style="color:red">a</span></p>'), '<p>a</p>'); // named colours are not accepted
  assert.ok(!/expression|javascript/.test(rt.sanitizeHtml('<span style="color:red;x:expression(1)">a</span>')));
});
await test('overlapping colour and bold stay balanced', () => {
  const out = rt.sanitizeHtml('<p><span style="color:#112233"><strong>a</span>b</strong></p>');
  assert.equal(out.match(/<strong>/g).length, out.match(/<\/strong>/g).length);
  assert.equal(out.match(/<span/g).length, out.match(/<\/span>/g).length);
  assert.equal(rt.htmlToPlainText(out), 'ab');
});
await test('forced direction survives on paragraphs, headings and lists', () => {
  assert.equal(rt.sanitizeHtml('<p dir="rtl">a</p><h1 dir="ltr">b</h1><ul dir="rtl"><li>c</li></ul>'), '<p dir="rtl">a</p><h1 dir="ltr">b</h1><ul dir="rtl"><li>c</li></ul>');
});
await test('a list nested inside a paragraph is lifted out', () => {
  const out = rt.sanitizeHtml('<p>x<ul><li>one</li></ul></p>');
  assert.ok(!/<p>[^<]*<ul>/.test(out), out);
  assert.equal(rt.htmlToPlainText(out), 'x\n• one');
});

section('fonts and highlight');
await test('font families are reduced to the offered stacks; unknown fonts are dropped', () => {
  assert.equal(rt.sanitizeHtml('<p><span style="font-family: serif;">a</span></p>'), "<p><span style=\"font-family:serif\">a</span></p>");
  assert.equal(rt.sanitizeHtml('<p><span style="font-family: &quot;Noto Naskh Arabic&quot;;">a</span></p>'), "<p><span style=\"font-family:'Noto Naskh Arabic',serif\">a</span></p>");
  assert.equal(rt.sanitizeHtml('<p><span style="font-family: monospace">a</span><span style="font-family: Comic Sans">b</span><span style="font-family: sans-serif">c</span></p>'), '<p><span style="font-family:monospace">a</span>bc</p>');
  const once = rt.sanitizeHtml('<p><span style="font-family: &quot;Noto Naskh Arabic&quot;; color: rgb(1, 2, 3); background-color: rgba(255, 213, 79, 0.45)">a</span></p>');
  assert.equal(rt.sanitizeHtml(once), once);
  assert.ok(once.includes("font-family:'Noto Naskh Arabic',serif;color:#010203;background-color:rgba(255,213,79,0.45)"), once);
});
await test('highlights keep their alpha; transparent and junk are dropped', () => {
  assert.equal(rt.sanitizeHtml('<p><span style="background-color: rgba(255, 213, 79, 0.45)">a</span></p>'), '<p><span style="background-color:rgba(255,213,79,0.45)">a</span></p>');
  assert.equal(rt.sanitizeHtml('<p><span style="background-color: transparent">a</span><span style="background-color: rgba(0, 0, 0, 0)">b</span><span style="background:url(x)">c</span></p>'), '<p>abc</p>');
});

h.done();
