// Picking a backup file to restore (used from step B2).
import * as DocumentPicker from 'expo-document-picker';
import { fs } from './fs';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    const c = i + 2 < bytes.length ? bytes[i + 2] : NaN;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((Number.isNaN(b) ? 0 : b) >> 4)];
    out += Number.isNaN(b) ? '=' : B64[((b & 15) << 2) | ((Number.isNaN(c) ? 0 : c) >> 6)];
    out += Number.isNaN(c) ? '=' : B64[c & 63];
  }
  return out;
}

/** Last resort: read the picked URI through fetch(). */
async function readViaFetch(uri) {
  const res = await fetch(uri);
  const buf = await res.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

/**
 * Lets the user choose a backup (.zip / .json) and returns its content in the
 * shape parseBackup() expects: { name, base64 } for ZIP, { name, text } for
 * JSON. Returns null when cancelled.
 *
 * The picker's own cache copy is unreliable on some Android builds ("Location
 * ... isn't readable"), so the original document is picked (no cache copy) and
 * copied by us into the app's cache, then read from there.
 */
export async function pickBackupFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', 'application/json', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: false,
    multiple: false,
  });
  if (result.canceled || !result.assets || !result.assets.length) return null;
  const asset = result.assets[0];

  const temp = `${fs.cacheDir}restore-pick-${Date.now()}.tmp`;
  try {
    let base64;
    try {
      await fs.copy(asset.uri, temp);
      base64 = await fs.readBase64(temp);
    } catch {
      try {
        base64 = await fs.readBase64(asset.uri);
      } catch {
        base64 = await readViaFetch(asset.uri);
      }
    }
    // A ZIP starts with "PK" -> base64 "UEsD"; anything else is read as JSON text.
    if (base64.startsWith('UEsD')) return { name: asset.name, base64 };
    let text;
    try {
      text = await fs.readText(temp);
    } catch {
      text = await (await fetch(asset.uri)).text();
    }
    return { name: asset.name, text };
  } finally {
    // The cache copy can hold private journal text; do not leave it behind.
    await fs.remove(temp).catch(() => {});
  }
}
