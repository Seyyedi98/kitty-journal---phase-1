// Backup / export / restore (spec section 17). Pure logic over injected deps:
//   deps = { fs, JSZip }
//
// Formats
//   JSON  "kitty-journal-json"   structured data only (NO photo files)
//   ZIP   "kitty-journal-backup" manifest.json + data.json + attachments/<uuid>.jpg
//                                + thumbs/<uuid>.jpg
// Archive paths are always derived from validated attachment uuids, never from
// stored file names, and nothing is ever written to a path taken from the
// archive — so path traversal is impossible by construction.
//
// Restore policy
//   * Structural problems (bad JSON/ZIP, wrong version, missing required
//     fields, duplicate ids, bad dates, manifest/data mismatch) REJECT the
//     whole file; nothing is changed.
//   * Missing or damaged PHOTO files are the only partially-recoverable case:
//     the entries are restored, those photos are skipped, and the result lists
//     exactly which ones.
//   * Merge never overwrites: an entry whose uuid already exists locally is
//     kept as is (counted as duplicate / kept-local conflict).
//   * Replace first writes an automatic safety backup; if that fails, nothing
//     is changed. DB changes are one transaction; files are staged first and
//     rolled back if the transaction fails.

import { cleanTagName, tagKey } from '../utils/text';
import { cleanEmotions } from '../utils/emotions';
import { htmlToRow } from '../utils/richText';
import { cleanLocation, listReferencedFiles } from '../db/repository';
import { LATEST_VERSION } from '../db/migrations';
import { MOODS } from '../theme';
import { attachmentUri, beginFileOp, OWN_FILE_RE, removeFiles } from './photos';

export const BACKUP_FORMAT = 'kitty-journal-backup';
export const JSON_FORMAT = 'kitty-journal-json';
export const FORMAT_VERSION = 1;
export const SETTINGS_IN_BACKUP = ['language', 'calendarType', 'appearance', 'theme'];

const MOOD_KEYS = MOODS.map((m) => m.key);
const UID_RE = /^[A-Za-z0-9-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ZIP_NAME_RE = /^(manifest\.json|data\.json|attachments\/[A-Za-z0-9-]{8,64}\.jpg|thumbs\/[A-Za-z0-9-]{8,64}\.jpg)$/;
const SETTING_VALUES = {
  language: ['en', 'fa', 'tr'],
  calendarType: ['default', 'solarHijri', 'gregorian'],
  appearance: ['light', 'dark', 'system'],
};
const MAX_ENTRIES = 200000;

export class BackupError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

const nowIso = () => new Date().toISOString();
const pad = (n) => String(n).padStart(2, '0');

export function backupFileName(prefix = 'kitty-journal-backup', d = new Date()) {
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.zip`;
}

export function base64Bytes(b64) {
  const s = String(b64 || '');
  if (!s) return 0;
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - padding;
}

export function isValidDateKey(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isIso = (v) => typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v));
const flag = (v) => (v === true || v === 1 || v === '1' ? 1 : 0);

/* ------------------------------ collect ------------------------------ */

/** Everything the journal consists of, as plain JSON-safe data (trash included). */
export async function collectData(db) {
  const entries = await db.getAllAsync('SELECT * FROM entries ORDER BY id');
  const tagRows = await db.getAllAsync(
    `SELECT et.entry_id AS entry_id, t.name AS name FROM entry_tags et
     JOIN tags t ON t.id = et.tag_id ORDER BY t.name COLLATE NOCASE`,
  );
  const emoRows = await db.getAllAsync('SELECT entry_id, emotion_key AS key, intensity FROM entry_emotions');
  const locRows = await db.getAllAsync('SELECT * FROM locations');
  const attRows = await db.getAllAsync('SELECT * FROM attachments ORDER BY entry_id, sort_order, id');
  const moods = await db.getAllAsync('SELECT journal_date, mood, updated_at FROM daily_moods ORDER BY journal_date');
  const settingRows = await db.getAllAsync('SELECT key, value FROM app_settings');

  const group = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.entry_id)) m.set(r.entry_id, []);
      m.get(r.entry_id).push(r);
    }
    return m;
  };
  const tags = group(tagRows);
  const emos = group(emoRows);
  const atts = group(attRows);
  const locs = new Map(locRows.map((r) => [r.entry_id, r]));

  const outEntries = entries.map((e) => {
    const loc = locs.get(e.id);
    return {
      uuid: e.uuid,
      title: e.title,
      body: e.body,
      body_html: e.body_html ?? null,
      journal_date: e.journal_date,
      mood: e.mood ?? null,
      favorite: e.favorite ? 1 : 0,
      pinned: e.pinned ? 1 : 0,
      created_at: e.created_at,
      updated_at: e.updated_at,
      deleted_at: e.deleted_at ?? null,
      content_format_version: e.content_format_version ?? 1,
      tags: (tags.get(e.id) || []).map((t) => t.name),
      emotions: (emos.get(e.id) || []).map((x) => ({ key: x.key, intensity: x.intensity })),
      location: loc
        ? { latitude: loc.latitude, longitude: loc.longitude, name: loc.name, address: loc.address }
        : null,
      attachments: (atts.get(e.id) || []).map((a, i) => ({
        uuid: a.uuid,
        original_name: a.original_name,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        width: a.width,
        height: a.height,
        captured_at: a.captured_at,
        created_at: a.created_at,
        sort_order: i,
        has_thumb: Boolean(a.thumb_name),
        // Local names, used only to find the files while building a backup.
        _file_name: a.file_name,
        _thumb_name: a.thumb_name,
      })),
    };
  });

  const settings = {};
  for (const r of settingRows) {
    if (!SETTINGS_IN_BACKUP.includes(r.key)) continue;
    try {
      settings[r.key] = JSON.parse(r.value);
    } catch {
      /* skip corrupt */
    }
  }
  return { entries: outEntries, dailyMoods: moods, settings };
}

function stripLocalNames(data) {
  return {
    ...data,
    entries: data.entries.map((e) => ({
      ...e,
      attachments: e.attachments.map(({ _file_name, _thumb_name, ...rest }) => rest),
    })),
  };
}

function countsOf(data) {
  const tagSet = new Set();
  let attachments = 0;
  let locations = 0;
  for (const e of data.entries) {
    for (const t of e.tags) tagSet.add(tagKey(t));
    attachments += e.attachments.length;
    if (e.location) locations += 1;
  }
  return {
    entries: data.entries.length,
    attachments,
    tags: tagSet.size,
    dailyMoods: data.dailyMoods.length,
    locations,
  };
}

/* ------------------------------- export ------------------------------ */

/** Structured-data export. Contains NO photo files (and says so in the file). */
export async function exportJson(db) {
  const data = stripLocalNames(await collectData(db));
  return JSON.stringify(
    {
      format: JSON_FORMAT,
      formatVersion: FORMAT_VERSION,
      schemaVersion: LATEST_VERSION,
      createdAt: nowIso(),
      includesAttachmentFiles: false,
      counts: countsOf(data),
      data,
    },
    null,
    2,
  );
}

export async function saveJsonExport(db, deps) {
  const { fs } = deps;
  const text = await exportJson(db);
  await fs.ensureDir(fs.backupsDir);
  const name = backupFileName('kitty-journal-data').replace(/\.zip$/, '.json');
  const uri = `${fs.backupsDir}${name}`;
  await fs.writeText(uri, text);
  if (!(await fs.size(uri))) throw new BackupError('write-failed');
  return { uri, name, mimeType: 'application/json' };
}

/**
 * Full backup: data + photo files in one ZIP. Missing photo files are listed in
 * the result and in the manifest — the backup never pretends they are included.
 */
export async function createZipBackup(db, deps, { prefix = 'kitty-journal-backup' } = {}) {
  const { fs, JSZip } = deps;
  const release = beginFileOp();
  try {
    const raw = await collectData(db);
    const data = stripLocalNames(raw);

    const declared = raw.entries.reduce(
      (sum, e) => sum + e.attachments.reduce((s, a) => s + (a.size_bytes || 0), 0),
      0,
    );
    const free = await fs.freeBytes?.();
    if (free != null && free < declared * 1.6 + 5 * 1024 * 1024) throw new BackupError('no-space');

    const zip = new JSZip();
    const files = [];
    const missingFiles = [];
    for (const e of raw.entries) {
      for (const a of e.attachments) {
        const main = await readIfExists(fs, attachmentUri(fs, a._file_name));
        if (main == null) {
          missingFiles.push({ entry: e.uuid, attachment: a.uuid });
          continue;
        }
        zip.file(`attachments/${a.uuid}.jpg`, main, { base64: true, compression: 'STORE' });
        files.push({ path: `attachments/${a.uuid}.jpg`, size: base64Bytes(main) });
        if (a._thumb_name) {
          const thumb = await readIfExists(fs, attachmentUri(fs, a._thumb_name));
          if (thumb != null) {
            zip.file(`thumbs/${a.uuid}.jpg`, thumb, { base64: true, compression: 'STORE' });
            files.push({ path: `thumbs/${a.uuid}.jpg`, size: base64Bytes(thumb) });
          }
        }
      }
    }
    // Attachment metadata for files that could not be read stays in data.json,
    // flagged by the manifest list so restore reports them as missing.
    const manifest = {
      format: BACKUP_FORMAT,
      formatVersion: FORMAT_VERSION,
      schemaVersion: LATEST_VERSION,
      createdAt: nowIso(),
      counts: countsOf(data),
      photoFilesIncluded: files.filter((f) => f.path.startsWith('attachments/')).length,
      missingAtBackupTime: missingFiles,
      files,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('data.json', JSON.stringify(data));

    const out = await zip.generateAsync({ type: 'base64', compression: 'STORE' });
    await fs.ensureDir(fs.backupsDir);
    const name = backupFileName(prefix);
    const uri = `${fs.backupsDir}${name}`;
    try {
      await fs.writeBase64(uri, out);
      const size = await fs.size(uri);
      if (!size || size < base64Bytes(out)) throw new BackupError('write-failed');
      return { uri, name, size, counts: manifest.counts, missingFiles, mimeType: 'application/zip' };
    } catch (error) {
      await fs.remove(uri).catch(() => {});
      throw error instanceof BackupError ? error : new BackupError('write-failed', String(error && error.message));
    }
  } finally {
    release();
  }
}

async function readIfExists(fs, uri) {
  try {
    if (!(await fs.exists(uri))) return null;
    const b64 = await fs.readBase64(uri);
    return b64 && b64.length ? b64 : null;
  } catch {
    return null;
  }
}

/* ----------------------------- validation ---------------------------- */

/**
 * Validate and normalise the `data` object of a backup.
 * @returns {{errors: object[], warnings: object[], data: object|null}}
 */
export function validateData(input) {
  const errors = [];
  const warnings = [];
  const fail = (code, detail) => errors.push({ code, detail });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('bad-structure', 'data');
    return { errors, warnings, data: null };
  }
  if (!Array.isArray(input.entries)) fail('bad-structure', 'entries');
  if (!Array.isArray(input.dailyMoods ?? [])) fail('bad-structure', 'dailyMoods');
  if (errors.length) return { errors, warnings, data: null };
  if (input.entries.length > MAX_ENTRIES) {
    fail('too-large', 'entries');
    return { errors, warnings, data: null };
  }

  const entryIds = new Set();
  const attIds = new Set();
  let droppedEmotions = 0;
  let unknownMoods = 0;
  const entries = [];

  input.entries.forEach((e, i) => {
    const where = `entries[${i}]`;
    if (!e || typeof e !== 'object') return fail('bad-entry', where);
    if (typeof e.uuid !== 'string' || !UID_RE.test(e.uuid)) return fail('bad-id', where);
    if (entryIds.has(e.uuid)) return fail('duplicate-id', e.uuid);
    entryIds.add(e.uuid);
    if (!isValidDateKey(e.journal_date)) return fail('bad-date', where);
    if (!isIso(e.created_at) || !isIso(e.updated_at)) return fail('bad-timestamp', where);
    if (e.deleted_at != null && !isIso(e.deleted_at)) return fail('bad-timestamp', where);
    if ((e.title != null && typeof e.title !== 'string') || (e.body != null && typeof e.body !== 'string') || (e.body_html != null && typeof e.body_html !== 'string')) {
      return fail('bad-type', where);
    }

    let mood = e.mood ?? null;
    if (mood != null && !MOOD_KEYS.includes(mood)) {
      unknownMoods += 1;
      mood = null;
    }
    const emotionsIn = Array.isArray(e.emotions) ? e.emotions : [];
    const emotions = cleanEmotions(emotionsIn);
    droppedEmotions += emotionsIn.length - emotions.length;

    const tags = [];
    const seen = new Set();
    for (const t of Array.isArray(e.tags) ? e.tags : []) {
      const name = cleanTagName(t);
      const key = tagKey(name);
      if (name && key && !seen.has(key)) {
        seen.add(key);
        tags.push(name);
      }
    }

    const attachments = [];
    for (const [j, a] of (Array.isArray(e.attachments) ? e.attachments : []).entries()) {
      if (!a || typeof a.uuid !== 'string' || !UID_RE.test(a.uuid)) {
        fail('bad-id', `${where}.attachments[${j}]`);
        continue;
      }
      if (attIds.has(a.uuid)) {
        fail('duplicate-id', a.uuid);
        continue;
      }
      attIds.add(a.uuid);
      attachments.push({
        uuid: a.uuid,
        original_name: typeof a.original_name === 'string' ? a.original_name.slice(0, 255) : null,
        mime_type: 'image/jpeg',
        size_bytes: Number.isFinite(Number(a.size_bytes)) ? Math.max(0, Number(a.size_bytes)) : 0,
        width: Number.isFinite(Number(a.width)) ? Number(a.width) : null,
        height: Number.isFinite(Number(a.height)) ? Number(a.height) : null,
        captured_at: typeof a.captured_at === 'string' ? a.captured_at : null,
        created_at: isIso(a.created_at) ? a.created_at : e.created_at,
        sort_order: j,
        has_thumb: Boolean(a.has_thumb),
      });
    }

    const richRow = typeof e.body_html === 'string' && e.body_html && e.content_format_version >= 2 ? htmlToRow(e.body_html) : null;
    const rich = richRow && richRow.content_format_version === 2 ? richRow : null;
    entries.push({
      uuid: e.uuid,
      title: e.title ?? '',
      body: rich ? rich.body : (e.body ?? ''),
      body_html: rich ? rich.body_html : null,
      journal_date: e.journal_date,
      mood,
      favorite: flag(e.favorite),
      pinned: flag(e.pinned),
      created_at: e.created_at,
      updated_at: e.updated_at,
      deleted_at: e.deleted_at ?? null,
      content_format_version: rich ? rich.content_format_version : (Number.isInteger(e.content_format_version) ? Math.min(e.content_format_version, 1) : 1),
      tags,
      emotions,
      location: cleanLocation(e.location),
      attachments,
    });
  });

  const dailyMoods = [];
  const dates = new Set();
  (input.dailyMoods || []).forEach((m, i) => {
    const where = `dailyMoods[${i}]`;
    if (!m || !isValidDateKey(m.journal_date)) return fail('bad-date', where);
    if (!MOOD_KEYS.includes(m.mood)) return fail('bad-mood', where);
    if (dates.has(m.journal_date)) return fail('duplicate-id', m.journal_date);
    dates.add(m.journal_date);
    dailyMoods.push({
      journal_date: m.journal_date,
      mood: m.mood,
      updated_at: isIso(m.updated_at) ? m.updated_at : nowIso(),
    });
  });

  const settings = {};
  for (const key of SETTINGS_IN_BACKUP) {
    const v = input.settings && input.settings[key];
    if (v == null) continue;
    if (key === 'theme') {
      if (typeof v === 'string' && /^[a-z]{2,20}$/.test(v)) settings.theme = v;
    } else if (SETTING_VALUES[key].includes(v)) {
      settings[key] = v;
    }
  }

  if (droppedEmotions) warnings.push({ code: 'unknown-emotions', detail: droppedEmotions });
  if (unknownMoods) warnings.push({ code: 'unknown-moods', detail: unknownMoods });
  if (errors.length) return { errors, warnings, data: null };
  return { errors, warnings, data: { entries, dailyMoods, settings } };
}

/* ------------------------------- parse ------------------------------- */

function checkEnvelope(env, expectedFormat, errors) {
  if (!env || typeof env !== 'object') return errors.push({ code: 'not-a-backup' });
  if (env.format !== expectedFormat) return errors.push({ code: 'not-a-backup' });
  if (!Number.isInteger(env.formatVersion) || env.formatVersion < 1) {
    return errors.push({ code: 'bad-structure', detail: 'formatVersion' });
  }
  if (env.formatVersion > FORMAT_VERSION) {
    return errors.push({ code: 'unsupported-version', detail: env.formatVersion });
  }
  if (Number.isInteger(env.schemaVersion) && env.schemaVersion > LATEST_VERSION) {
    errors.push({ code: 'newer-schema', detail: env.schemaVersion });
  }
  return undefined;
}

/**
 * Parse + validate a backup file and build the restore preview. Never throws
 * for bad input — problems are returned in `errors` (empty errors == usable).
 * @param {object} source  { name?, text? } for JSON or { name?, base64 } for ZIP
 */
export async function parseBackup(db, deps, source) {
  const { JSZip } = deps;
  const result = { ok: false, kind: null, errors: [], warnings: [], data: null, zip: null, manifest: null, preview: null };
  const errors = result.errors;
  let dataObj = null;
  let envelope = null;

  try {
    if (typeof source.base64 === 'string' && source.base64.startsWith('UEsD')) {
      result.kind = 'zip';
      let zip;
      try {
        zip = await JSZip.loadAsync(source.base64, { base64: true });
      } catch (error) {
        errors.push({ code: 'corrupt-zip', detail: String(error && error.message) });
        return result;
      }
      for (const name of Object.keys(zip.files)) {
        if (zip.files[name].dir) continue;
        if (name.includes('..') || name.includes('\\') || name.startsWith('/')) {
          errors.push({ code: 'unsafe-path', detail: name });
        } else if (!ZIP_NAME_RE.test(name)) {
          result.warnings.push({ code: 'unexpected-entry', detail: name });
        }
      }
      if (errors.length) return result;
      const manifestFile = zip.file('manifest.json');
      const dataFile = zip.file('data.json');
      if (!manifestFile || !dataFile) {
        errors.push({ code: 'not-a-backup', detail: 'missing manifest or data' });
        return result;
      }
      try {
        envelope = JSON.parse(await manifestFile.async('string'));
        dataObj = JSON.parse(await dataFile.async('string'));
      } catch {
        errors.push({ code: 'corrupt-json' });
        return result;
      }
      checkEnvelope(envelope, BACKUP_FORMAT, errors);
      result.zip = zip;
      result.manifest = envelope;
    } else {
      result.kind = 'json';
      let text = source.text;
      if (typeof text !== 'string' && typeof source.base64 === 'string') {
        errors.push({ code: 'not-a-backup' });
        return result;
      }
      try {
        envelope = JSON.parse(String(text ?? '').replace(/^﻿/, ''));
      } catch {
        errors.push({ code: 'corrupt-json' });
        return result;
      }
      checkEnvelope(envelope, JSON_FORMAT, errors);
      dataObj = envelope && envelope.data;
    }
    if (errors.length) return result;

    const checked = validateData(dataObj);
    result.warnings.push(...checked.warnings);
    if (checked.errors.length) {
      errors.push(...checked.errors);
      return result;
    }
    result.data = checked.data;

    const counts = countsOf(result.data);
    if (envelope.counts) {
      for (const k of ['entries', 'attachments', 'dailyMoods']) {
        if (Number.isInteger(envelope.counts[k]) && envelope.counts[k] !== counts[k]) {
          errors.push({ code: 'manifest-mismatch', detail: k });
        }
      }
      if (errors.length) return result;
    }

    // Which photo files can actually be restored?
    const present = new Set();
    const missing = [];
    for (const e of result.data.entries) {
      for (const a of e.attachments) {
        if (result.zip && result.zip.file(`attachments/${a.uuid}.jpg`)) present.add(a.uuid);
        else missing.push({ entry: e.uuid, attachment: a.uuid });
      }
    }
    result.presentAttachments = present;
    if (result.kind === 'json' && counts.attachments > 0) {
      result.warnings.push({ code: 'json-no-photos', detail: counts.attachments });
    } else if (missing.length) {
      result.warnings.push({ code: 'missing-photos', detail: missing.length });
    }

    // Compare with what is on this device.
    const localEntries = await db.getAllAsync('SELECT uuid, updated_at, deleted_at FROM entries');
    const localByUuid = new Map(localEntries.map((r) => [r.uuid, r.updated_at]));
    const localTrashed = new Set(localEntries.filter((r) => r.deleted_at).map((r) => r.uuid));
    let identical = 0;
    let differing = 0;
    let fromTrash = 0;
    for (const e of result.data.entries) {
      if (!localByUuid.has(e.uuid)) continue;
      // In the trash here, active in the file: merge brings it back, so it is not a duplicate.
      if (localTrashed.has(e.uuid) && !e.deleted_at) { fromTrash += 1; continue; }
      if (localByUuid.get(e.uuid) === e.updated_at) identical += 1;
      else differing += 1;
    }
    const localMoods = await db.getAllAsync('SELECT journal_date, mood FROM daily_moods');
    const moodByDate = new Map(localMoods.map((r) => [r.journal_date, r.mood]));
    let moodConflicts = 0;
    for (const m of result.data.dailyMoods) {
      if (moodByDate.has(m.journal_date) && moodByDate.get(m.journal_date) !== m.mood) moodConflicts += 1;
    }
    const localAtt = await db.getFirstAsync('SELECT COUNT(*) AS n FROM attachments');
    result.preview = {
      kind: result.kind,
      createdAt: envelope.createdAt || null,
      counts,
      trashedEntries: result.data.entries.filter((e) => e.deleted_at).length,
      missingPhotos: result.kind === 'json' ? counts.attachments : missing.length,
      newEntries: result.data.entries.length - identical - differing,
      fromTrash,
      duplicatesIdentical: identical,
      duplicatesDifferent: differing,
      moodConflicts,
      local: { entries: localEntries.length, attachments: localAtt.n },
    };
    result.ok = true;
    return result;
  } catch (error) {
    errors.push({ code: 'parse-failed', detail: String(error && error.message) });
    return result;
  }
}

/* ------------------------------- restore ----------------------------- */

async function stageAttachment(deps, parsed, att, written) {
  const { fs } = deps;
  const mainName = `${att.uuid}.jpg`;
  const mainUri = attachmentUri(fs, mainName);
  const file = parsed.zip && parsed.zip.file(`attachments/${att.uuid}.jpg`);
  if (!file) return { ok: false, reason: 'missing' };

  // Same attachment already on this device (same lineage): reuse it.
  const existing = await fs.size(mainUri);
  const thumbName = `${att.uuid}_t.jpg`;
  let hasThumb = false;
  if (existing) {
    hasThumb = Boolean(await fs.size(attachmentUri(fs, thumbName)));
    return { ok: true, size: existing, thumb: hasThumb ? thumbName : null, reused: true };
  }

  const b64 = await file.async('base64');
  const declared = (parsed.manifest && parsed.manifest.files || []).find((f) => f.path === `attachments/${att.uuid}.jpg`);
  if (!b64 || (declared && declared.size !== base64Bytes(b64)) || !b64.startsWith('/9j/')) {
    return { ok: false, reason: 'corrupt' };
  }
  await fs.writeBase64(mainUri, b64);
  written.push(mainName);
  const size = await fs.size(mainUri);
  if (!size || size !== base64Bytes(b64)) return { ok: false, reason: 'corrupt' };

  const thumbFile = parsed.zip.file(`thumbs/${att.uuid}.jpg`);
  if (thumbFile) {
    const t64 = await thumbFile.async('base64');
    const tDeclared = (parsed.manifest && parsed.manifest.files || []).find((f) => f.path === `thumbs/${att.uuid}.jpg`);
    if (t64 && t64.startsWith('/9j/') && (!tDeclared || tDeclared.size === base64Bytes(t64))) {
      await fs.writeBase64(attachmentUri(fs, thumbName), t64);
      written.push(thumbName);
      if (await fs.size(attachmentUri(fs, thumbName))) hasThumb = true;
    }
  }
  return { ok: true, size, thumb: hasThumb ? thumbName : null, reused: false };
}

async function insertEntryDeep(db, e, staged) {
  const res = await db.runAsync(
    `INSERT INTO entries (uuid, title, body, body_html, journal_date, mood, favorite, pinned, created_at,
                          updated_at, deleted_at, content_format_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    e.uuid, e.title, e.body, e.body_html, e.journal_date, e.mood, e.favorite, e.pinned,
    e.created_at, e.updated_at, e.deleted_at, e.content_format_version,
  );
  const id = res.lastInsertRowId;
  const now = nowIso();
  for (const name of e.tags) {
    const key = tagKey(name);
    await db.runAsync(
      'INSERT OR IGNORE INTO tags (name, name_key, created_at, updated_at) VALUES (?,?,?,?)',
      name, key, now, now,
    );
    const tag = await db.getFirstAsync('SELECT id FROM tags WHERE name_key=?', key);
    await db.runAsync('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?,?)', id, tag.id);
  }
  for (const em of e.emotions) {
    await db.runAsync(
      'INSERT INTO entry_emotions (entry_id, emotion_key, intensity) VALUES (?,?,?)',
      id, em.key, em.intensity,
    );
  }
  if (e.location) {
    await db.runAsync(
      `INSERT INTO locations (uuid, entry_id, latitude, longitude, name, address, created_at)
       VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?)`,
      id, e.location.latitude, e.location.longitude, e.location.name, e.location.address, now,
    );
  }
  for (const a of e.attachments) {
    const s = staged.get(a.uuid);
    if (!s || !s.ok) continue;
    await db.runAsync(
      `INSERT INTO attachments (uuid, entry_id, file_name, thumb_name, original_name, mime_type,
                                size_bytes, width, height, captured_at, status, sort_order, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'ready',?,?)`,
      a.uuid, id, `${a.uuid}.jpg`, s.thumb, a.original_name, 'image/jpeg', s.size,
      a.width, a.height, a.captured_at, a.sort_order, a.created_at,
    );
  }
  return id;
}

/**
 * Apply a parsed backup.
 * @param {'merge'|'replace'} mode
 * @returns {Promise<object>} summary (what was added / kept / skipped)
 */
export async function applyRestore(db, deps, parsed, mode) {
  if (!parsed || !parsed.ok) throw new BackupError('not-valid');
  if (mode !== 'merge' && mode !== 'replace') throw new BackupError('bad-mode');
  const { fs } = deps;
  const release = beginFileOp();
  const written = [];
  const summary = {
    mode,
    entriesAdded: 0,
    entriesUntrashed: 0,
    duplicatesKept: 0,
    conflictsKeptLocal: 0,
    moodsAdded: 0,
    moodConflictsKeptLocal: 0,
    photosAdded: 0,
    photosSkipped: [],
    safetyBackup: null,
  };

  try {
    await fs.ensureDir(fs.attachmentsDir);
    const data = parsed.data;

    let oldFiles = new Set();
    let toInsert = data.entries;
    let localByUuid = new Map();
    const untrash = [];

    if (mode === 'replace') {
      // Fail closed: no safety copy, no replace.
      let safety;
      try {
        safety = await createZipBackup(db, deps, { prefix: 'kitty-journal-safety' });
      } catch (error) {
        throw new BackupError('safety-backup-failed', error.code || String(error && error.message));
      }
      summary.safetyBackup = { uri: safety.uri, name: safety.name };
      await pruneSafetyBackups(fs, safety.name);
      oldFiles = await listReferencedFiles(db);
    } else {
      const rows = await db.getAllAsync('SELECT uuid, updated_at, deleted_at FROM entries');
      localByUuid = new Map(rows.map((r) => [r.uuid, r.updated_at]));
      const localTrashed = new Set(rows.filter((r) => r.deleted_at).map((r) => r.uuid));
      toInsert = [];
      for (const e of data.entries) {
        if (localByUuid.has(e.uuid)) {
          // In the trash here but active in the file: bring it back (see below).
          if (localTrashed.has(e.uuid) && !e.deleted_at) {
            untrash.push(e.uuid);
            continue;
          }
          summary.duplicatesKept += 1;
          if (localByUuid.get(e.uuid) !== e.updated_at) summary.conflictsKeptLocal += 1;
        } else {
          toInsert.push(e);
        }
      }
    }

    // Stage files first (rolled back below if the transaction fails).
    const staged = new Map();
    const skippedPhotos = [];
    for (const e of toInsert) {
      for (const a of e.attachments) {
        const s = await stageAttachment(deps, parsed, a, written);
        staged.set(a.uuid, s);
        if (!s.ok) skippedPhotos.push({ entry: e.uuid, attachment: a.uuid, reason: s.reason });
      }
    }

    await db.withTransactionAsync(async () => {
      if (mode === 'replace') {
        for (const table of ['entry_tags', 'entry_emotions', 'locations', 'attachments', 'entries', 'daily_moods', 'tags']) {
          await db.runAsync(`DELETE FROM ${table}`);
        }
        for (const [key, value] of Object.entries(data.settings || {})) {
          await db.runAsync(
            `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
            key, JSON.stringify(value), nowIso(),
          );
        }
        for (const m of data.dailyMoods) {
          await db.runAsync('INSERT INTO daily_moods (journal_date, mood, updated_at) VALUES (?,?,?)', m.journal_date, m.mood, m.updated_at);
          summary.moodsAdded += 1;
        }
      } else {
        const localMoods = await db.getAllAsync('SELECT journal_date, mood FROM daily_moods');
        const byDate = new Map(localMoods.map((r) => [r.journal_date, r.mood]));
        for (const m of data.dailyMoods) {
          if (!byDate.has(m.journal_date)) {
            await db.runAsync('INSERT INTO daily_moods (journal_date, mood, updated_at) VALUES (?,?,?)', m.journal_date, m.mood, m.updated_at);
            summary.moodsAdded += 1;
          } else if (byDate.get(m.journal_date) !== m.mood) {
            summary.moodConflictsKeptLocal += 1;
          }
        }
      }
      for (const uuid of untrash) {
        await db.runAsync('UPDATE entries SET deleted_at = NULL, updated_at = ? WHERE uuid = ?', nowIso(), uuid);
        summary.entriesUntrashed += 1;
      }
      for (const e of toInsert) {
        await insertEntryDeep(db, e, staged);
        summary.entriesAdded += 1;
        for (const a of e.attachments) if (staged.get(a.uuid)?.ok) summary.photosAdded += 1;
      }
    });
    summary.photosSkipped = skippedPhotos;

    if (mode === 'replace') {
      // Commit succeeded: now it is safe to drop files nothing references any more.
      const still = await listReferencedFiles(db);
      const stale = [...oldFiles].filter((n) => !still.has(n) && OWN_FILE_RE.test(n));
      await removeFiles(fs, stale);
    }
    return summary;
  } catch (error) {
    // Roll back file staging. Never touch files that existed before this run
    // and are referenced by the (unchanged) database.
    const referenced = await listReferencedFiles(db).catch(() => new Set());
    await removeFiles(fs, written.filter((n) => !referenced.has(n)));
    if (error instanceof BackupError) throw error;
    throw new BackupError('restore-failed', String(error && error.message));
  } finally {
    release();
  }
}

/** Keep only the newest automatic safety backup. */
export async function pruneSafetyBackups(fs, keepName) {
  try {
    const names = await fs.list(fs.backupsDir);
    for (const n of names) {
      if (/^kitty-journal-safety-.*\.zip$/.test(n) && n !== keepName) {
        await fs.remove(`${fs.backupsDir}${n}`).catch(() => {});
      }
    }
  } catch {
    /* best effort */
  }
}
