// Shared test helpers: node:sqlite adapter shaped like expo-sqlite, an
// in-memory file system with fault injection, and a fake image manipulator.
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';

export const load = async (p) => {
  const m = await import(p);
  return { ...(typeof m.default === 'object' && m.default ? m.default : {}), ...m };
};

export function loadJSZip() {
  for (const base of [import.meta.url, 'file:///opt/node-tools/package.json']) {
    try { return createRequire(base)('jszip'); } catch { /* try next */ }
  }
  throw new Error('jszip not found (npm i jszip, or run where it is installed)');
}

export function makeDb(raw = new DatabaseSync(':memory:')) {
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

/** Wrap a db so the Nth runAsync call (1-based, counted from now) throws. */
export function failingDb(db, nth) {
  let n = 0;
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'runAsync') {
        return async (...a) => { n += 1; if (n === nth) throw new Error('injected db failure'); return target.runAsync(...a); };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export function fakeJpeg(seed = 1, bytes = 2000) {
  const body = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) body[i] = (i * 31 + seed * 17) & 0xff;
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), body]);
}

export function makeFs({ free = 10 * 1024 * 1024 * 1024 } = {}) {
  const files = new Map(); // uri -> Buffer
  const fs = {
    files,
    attachmentsDir: 'mem://docs/attachments/',
    backupsDir: 'mem://docs/backups/',
    cacheDir: 'mem://cache/',
    free,
    failWrite: null, // (uri, count) => boolean
    failCopy: null,
    writes: 0,
    async ensureDir() {},
    async copy(from, to) {
      if (fs.failCopy && fs.failCopy(to)) throw new Error('injected copy failure');
      if (!files.has(from)) throw new Error('copy: source missing ' + from);
      files.set(to, Buffer.from(files.get(from)));
    },
    async move(from, to) { files.set(to, files.get(from)); files.delete(from); },
    async exists(uri) { return files.has(uri); },
    async size(uri) { return files.has(uri) ? files.get(uri).length : null; },
    async remove(uri) { files.delete(uri); },
    async readBase64(uri) { if (!files.has(uri)) throw new Error('missing ' + uri); return files.get(uri).toString('base64'); },
    async writeBase64(uri, b64) {
      fs.writes += 1;
      if (fs.failWrite && fs.failWrite(uri, fs.writes)) throw new Error('injected write failure');
      files.set(uri, Buffer.from(b64, 'base64'));
    },
    async readText(uri) { return files.get(uri).toString('utf8'); },
    async writeText(uri, t) { files.set(uri, Buffer.from(t, 'utf8')); },
    async list(dir) {
      return [...files.keys()].filter((k) => k.startsWith(dir) && !k.slice(dir.length).includes('/')).map((k) => k.slice(dir.length));
    },
    async freeBytes() { return fs.free; },
    put(uri, buf) { files.set(uri, buf); },
    names(dir) { return [...files.keys()].filter((k) => k.startsWith(dir)).map((k) => k.slice(dir.length)).sort(); },
  };
  return fs;
}

/** Fake expo-image-manipulator: output is a smaller valid-looking JPEG. */
export function makeManipulate(fs, { failOn = null } = {}) {
  const calls = [];
  let n = 0;
  const fn = async (uri, opts) => {
    calls.push({ uri, opts });
    if (failOn && failOn(uri, opts, calls.length)) throw new Error('injected manipulate failure');
    const src = fs.files.get(uri);
    if (!src) throw new Error('manipulate: missing ' + uri);
    n += 1;
    const out = `mem://cache/m${n}.jpg`;
    const w = opts.resize?.width || (opts.resize?.height ? Math.round(opts.resize.height * 0.75) : 1000);
    const h = opts.resize?.height || (opts.resize?.width ? Math.round(opts.resize.width * 0.75) : 750);
    fs.files.set(out, fakeJpeg(n + 100, Math.max(500, Math.floor(src.length / 2))));
    return { uri: out, width: w, height: h };
  };
  fn.calls = calls;
  return fn;
}

export function harness(title) {
  let passed = 0;
  const failures = [];
  return {
    section(name) { console.log(name); },
    async test(name, fn) {
      try { await fn(); passed++; console.log('  ok  ', name); }
      catch (e) { failures.push(name); console.log('  FAIL', name, '\n      ', String(e.message).split('\n')[0]); }
    },
    done() {
      console.log(`\n[${title}] ${passed} passed, ${failures.length} failed`);
      if (failures.length) { console.log('Failed:', failures.join('; ')); process.exit(1); }
    },
  };
}
