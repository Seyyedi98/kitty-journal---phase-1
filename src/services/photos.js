// Photo attachment pipeline. Pure logic over injected dependencies
// (`fs`, `manipulate`) so it runs unchanged in the app and in Node tests.
//
// Recoverable sequence (spec 10.4) — an image is reported as attached only
// once BOTH its files exist with non-zero size AND its database row committed:
//   1. process (resize / re-encode only when needed) into the cache dir
//   2. copy into the app-private attachments dir under a fresh unique name
//   3. verify size, build the thumbnail from the stored copy, verify again
//   4. insert the attachment row
// Any failure removes the files created by THIS call. Crashes between 2 and 4
// can only leave orphan files, which cleanOrphanFiles() removes later after
// verifying nothing references them.

import {
  deleteAttachment,
  emptyTrash,
  insertAttachment,
  listAttachmentRows,
  listReferencedFiles,
  newUid,
  purgeEntry,
} from '../db/repository';

export const MAX_EDGE = 2048;
export const QUALITY = 0.82;
export const THUMB_EDGE = 360;
export const THUMB_QUALITY = 0.7;
export const KEEP_AS_IS_BYTES = 2.5 * 1024 * 1024;

// Only files that look like ours are ever deleted by the cleanup code.
export const OWN_FILE_RE = /^[a-f0-9]{16,64}(_t)?\.jpg$/;

export class PhotoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/* A file operation lock: orphan cleanup must never run while an import or a
   restore is writing files that are not yet referenced by the database. */
let activeFileOps = 0;
export function beginFileOp() {
  activeFileOps += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      activeFileOps = Math.max(0, activeFileOps - 1);
    }
  };
}
export const fileOpsActive = () => activeFileOps > 0;

/** "2026:10:23 14:05:09" (EXIF) -> "2026-10-23T14:05:09", or null. */
export function parseExifDate(value) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/**
 * Decide whether an image needs re-encoding. A modest JPEG is copied
 * byte-for-byte so it is never degraded by needless re-compression.
 */
export function planImageProcessing(asset) {
  const w = Number(asset.width) || 0;
  const h = Number(asset.height) || 0;
  const longest = Math.max(w, h);
  const mime = String(asset.mimeType || '').toLowerCase();
  const isJpeg = mime === 'image/jpeg' || mime === 'image/jpg';
  const small = Number(asset.fileSize) > 0 && Number(asset.fileSize) <= KEEP_AS_IS_BYTES;
  if (isJpeg && small && longest > 0 && longest <= MAX_EDGE) {
    return { recompress: false, resize: null };
  }
  const resize = longest > MAX_EDGE ? (w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE }) : null;
  return { recompress: true, resize };
}

export const attachmentUri = (fs, name) => `${fs.attachmentsDir}${name}`;

async function bestEffortRemove(fs, uris) {
  for (const uri of uris) {
    try {
      await fs.remove(uri);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Import one picked asset as an attachment of `entryId`.
 * @returns the inserted attachment row fields (including `id`)
 * @throws PhotoError
 */
export async function importPhoto(db, deps, entryId, asset) {
  const { fs, manipulate } = deps;
  const release = beginFileOp();
  const created = [];
  const temps = [];
  try {
    await fs.ensureDir(fs.attachmentsDir);
    const uuid = await newUid(db);
    const fileName = `${uuid}.jpg`;
    const dest = attachmentUri(fs, fileName);

    let source = asset.uri;
    let width = Number(asset.width) || null;
    let height = Number(asset.height) || null;
    const plan = planImageProcessing(asset);
    if (plan.recompress) {
      const out = await manipulate(asset.uri, { resize: plan.resize, quality: QUALITY });
      source = out.uri;
      temps.push(out.uri);
      width = out.width;
      height = out.height;
    }

    const free = await fs.freeBytes?.();
    if (free != null && free < 20 * 1024 * 1024) throw new PhotoError('no-space', 'Not enough free storage');

    await fs.copy(source, dest);
    created.push(dest);
    const size = await fs.size(dest);
    if (!size) throw new PhotoError('copy-failed', 'Copied image is missing or empty');

    let thumbName = null;
    if (Math.max(width || 0, height || 0) > THUMB_EDGE) {
      const thumbDest = attachmentUri(fs, `${uuid}_t.jpg`);
      const resize = (width || 0) >= (height || 0) ? { width: THUMB_EDGE } : { height: THUMB_EDGE };
      const thumb = await manipulate(dest, { resize, quality: THUMB_QUALITY });
      temps.push(thumb.uri);
      await fs.copy(thumb.uri, thumbDest);
      created.push(thumbDest);
      if (!(await fs.size(thumbDest))) throw new PhotoError('thumb-failed', 'Thumbnail is missing or empty');
      thumbName = `${uuid}_t.jpg`;
    }

    const row = {
      uuid,
      entry_id: entryId,
      file_name: fileName,
      thumb_name: thumbName,
      original_name: asset.fileName || null,
      mime_type: 'image/jpeg',
      size_bytes: size,
      width,
      height,
      captured_at: parseExifDate(asset.exif && (asset.exif.DateTimeOriginal || asset.exif.DateTime)),
      status: 'ready',
    };
    row.id = await insertAttachment(db, row);
    return row;
  } catch (error) {
    await bestEffortRemove(fs, created);
    if (error instanceof PhotoError) throw error;
    throw new PhotoError('import-failed', String(error && error.message));
  } finally {
    await bestEffortRemove(
      fs,
      temps.filter((u) => u && !String(u).startsWith(fs.attachmentsDir)),
    );
    release();
  }
}

/**
 * Import several assets; one failure never aborts the others.
 * @returns {{added: object[], failed: {asset:object, code:string}[]}}
 */
export async function importPhotos(db, deps, entryId, assets) {
  const added = [];
  const failed = [];
  for (const asset of assets) {
    try {
      added.push(await importPhoto(db, deps, entryId, asset));
    } catch (error) {
      failed.push({ asset, code: error.code || 'import-failed', message: String((error && error.message) || error) });
    }
  }
  return { added, failed };
}

/** Delete files by name; only names that look like ours are ever touched. */
export async function removeFiles(fs, names) {
  let failed = 0;
  for (const name of names) {
    if (!OWN_FILE_RE.test(name)) continue;
    try {
      await fs.remove(attachmentUri(fs, name));
    } catch {
      failed += 1; // the orphan sweep will catch it later
    }
  }
  return failed;
}

export async function removeAttachmentAndFiles(db, fs, attachmentId) {
  const files = await deleteAttachment(db, attachmentId);
  await removeFiles(fs, files);
}

export async function purgeEntryAndFiles(db, fs, entryId) {
  const files = await purgeEntry(db, entryId);
  await removeFiles(fs, files);
}

export async function emptyTrashAndFiles(db, fs) {
  const files = await emptyTrash(db);
  await removeFiles(fs, files);
}

/**
 * Remove files in the attachments dir that no database row references.
 * Refuses to run while an import/restore is in progress.
 * @returns {{skipped:boolean, removed:number}}
 */
export async function cleanOrphanFiles(db, fs) {
  if (fileOpsActive()) return { skipped: true, removed: 0 };
  const release = beginFileOp();
  try {
    const referenced = await listReferencedFiles(db);
    const names = await fs.list(fs.attachmentsDir);
    let removed = 0;
    for (const name of names) {
      if (!OWN_FILE_RE.test(name) || referenced.has(name)) continue;
      try {
        await fs.remove(attachmentUri(fs, name));
        removed += 1;
      } catch {
        /* retry next time */
      }
    }
    return { skipped: false, removed };
  } finally {
    release();
  }
}

/** Find attachment rows whose file (or thumbnail) is missing on disk. */
export async function checkAttachments(db, fs) {
  const rows = await listAttachmentRows(db);
  const missing = [];
  let missingThumbs = 0;
  for (const row of rows) {
    if (!(await fs.exists(attachmentUri(fs, row.file_name)))) {
      missing.push({ id: row.id, entry_id: row.entry_id, file_name: row.file_name });
    } else if (row.thumb_name && !(await fs.exists(attachmentUri(fs, row.thumb_name)))) {
      missingThumbs += 1;
    }
  }
  return { total: rows.length, missing, missingThumbs };
}

/** Remove rows whose image file is gone (after the user confirmed). */
export async function removeBrokenReferences(db, fs, missing) {
  for (const m of missing) await removeAttachmentAndFiles(db, fs, m.id);
}
